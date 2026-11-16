import { NextResponse } from "next/server";
import { matchPaymentRequirements, settlePayment } from "@/lib/x402/facilitator";
import { paygate } from "@/lib/x402/paygate";
import { attachJoinerSession, claimJoinerSlot, createMatchSession, findActiveMatchFor, getMatchRow, refreshMatch } from "@/lib/matches";
// Versus (ADR 0009): join an open match. Same x402 flow, stake to escrow.
// Guards run after verify but before settle, so a refused join never moves
// funds: own match -> 400; full/expired/settled/unknown -> 409/404; already in
// another active match on this game -> 409.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const existing = await getMatchRow(id);
  if (!existing) return NextResponse.json({ error: "match_not_found" }, { status: 404 });
  let reqs; try { reqs = matchPaymentRequirements(existing.gameSlug, "/api/match/" + id + "/join"); }
  catch { return NextResponse.json({ error: "escrow_not_configured" }, { status: 503 }); }
  const gate = await paygate(req, reqs);
  if ("response" in gate) return gate.response;
  const payer = gate.payer;
  if (payer.toLowerCase() === existing.creatorWallet)
    return NextResponse.json({ error: "cannot_join_own_match" }, { status: 400 });
  // Refresh first: a stale "open" past the join deadline expires (and refunds
  // the creator) instead of accepting a joiner.
  const view = await refreshMatch(id);
  if (!view || view.status !== "open")
    return NextResponse.json({ error: "match_not_open", status: view?.status ?? "unknown" }, { status: 409 });
  if (await findActiveMatchFor(payer, existing.gameSlug))
    return NextResponse.json({ error: "already_in_active_match", gameSlug: existing.gameSlug }, { status: 409 });
  // Atomically claim the slot before creating the session, so two joiners
  // racing the same match cannot both get in — the loser is refused pre-settle.
  if (!(await claimJoinerSlot(id, payer)))
    return NextResponse.json({ error: "match_not_open", status: "full" }, { status: 409 });
  const seed = existing.seed !== null ? Number(existing.seed) : null;
  const { session, token, expiresAt } = await createMatchSession(existing.gameSlug, payer, id, seed);
  await attachJoinerSession(id, session.sid);
  void settlePayment(gate.payload, reqs).then((s) => {
    session.paymentStatus = s.success ? "settled" : "needs_reconcile";
    if (s.tx) session.tx = s.tx;
  }).catch(() => { session.paymentStatus = "needs_reconcile"; });
  const match = await refreshMatch(id);
  return NextResponse.json({ matchId: id, sessionToken: token, sid: session.sid, expiresAt,
    gameSlug: existing.gameSlug, seedCommit: session.game.seedCommitment ?? null, match,
    note: "You are in. Both runs decide it: higher score wins their 0.25 back plus 25 QTR; the loser's stake goes to the treasury. Finish within 10 minutes or forfeit.",
    play: { state: "/api/play/state", action: "/api/play/action", heartbeat: "/api/coin/heartbeat" } });
}
