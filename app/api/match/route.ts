import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { matchPaymentRequirements, settlePayment } from "@/lib/x402/facilitator";
import { paygate, paymentRequiredResponse } from "@/lib/x402/paygate";
import { isLiveEngine } from "@/lib/games/engine";
import { createMatchSession, findActiveMatchFor, insertMatch, newMatchSeed, refreshMatch } from "@/lib/matches";
import { attributeReferral } from "@/lib/referrals";
// Versus (ADR 0009): create a head-to-head match. The creator's 0.25 USDC stake
// settles to the match ESCROW (not the treasury) through the standard x402
// flow, and the creator's linked play session starts immediately. The match
// sits "open" for 10 minutes awaiting a joiner; no joiner -> full refund.
// Discovery probes ask with GET: same 402 challenge as an unpaid POST; a GET
// never creates a match and never takes payment.
export async function GET() {
  let reqs; try { reqs = matchPaymentRequirements("snake", "/api/match"); }
  catch { return NextResponse.json({ error: "escrow_not_configured" }, { status: 503 }); }
  return paymentRequiredResponse(reqs, "payment_required");
}
export async function POST(req: Request) {
  const { gameSlug, referralCode } = (await req.json().catch(() => ({}))) as { gameSlug?: string; referralCode?: string };
  // Paywall before body validation, same as /api/coin: unpaid requests and
  // discovery probes get the 402 challenge, never a 400; validation still
  // precedes payment verification inside paygate's caller flow below.
  let reqs; try { reqs = matchPaymentRequirements(gameSlug ?? "snake", "/api/match"); }
  catch { return NextResponse.json({ error: "escrow_not_configured" }, { status: 503 }); }
  const header = req.headers.get("payment-signature") ?? req.headers.get("x-payment");
  if (!header) return paymentRequiredResponse(reqs, "payment_required");
  if (!gameSlug) return NextResponse.json({ error: "gameSlug required" }, { status: 400 });
  if (!isLiveEngine(gameSlug)) return NextResponse.json({ error: "engine_not_live", gameSlug }, { status: 400 });
  const gate = await paygate(req, reqs);
  if ("response" in gate) return gate.response;
  const payer = gate.payer;
  // Guard before anything settles: one active match per wallet per game.
  if (await findActiveMatchFor(payer, gameSlug))
    return NextResponse.json({ error: "already_in_active_match", gameSlug }, { status: 409 });
  const matchId = randomBytes(12).toString("hex");
  const seed = newMatchSeed(gameSlug);
  const { session, token, expiresAt } = await createMatchSession(gameSlug, payer, matchId, seed);
  await insertMatch({ matchId, gameSlug, creatorWallet: payer, session, seed });
  // Referrals (ADR 0010): the match-create stake is a verified coin-in too —
  // a brand-new creator carrying a code attributes exactly as on /api/coin.
  // (Joining a match does not attribute in v1; see the ADR.)
  let referral: { status: string; reason?: string } | undefined;
  if (referralCode) {
    try {
      const a = await attributeReferral(referralCode, payer);
      referral = a.attributed ? { status: "attributed" } : { status: "ignored", reason: a.reason };
    } catch { referral = { status: "ignored", reason: "unavailable" }; }
  }
  // Async settle into escrow — never block play on confirmation latency.
  void settlePayment(gate.payload, reqs).then((s) => {
    session.paymentStatus = s.success ? "settled" : "needs_reconcile";
    if (s.tx) session.tx = s.tx;
  }).catch(() => { session.paymentStatus = "needs_reconcile"; });
  const match = await refreshMatch(matchId);
  return NextResponse.json({ matchId, sessionToken: token, sid: session.sid, expiresAt, gameSlug,
    seedCommit: session.game.seedCommitment ?? null,
    ...(referral ? { referral } : {}),
    match,
    note: "Your stake is in escrow. Play your run now; a rival has 10 minutes to join via POST /api/match/" + matchId + "/join. Winner is refunded 0.25 USDC and earns 25 QTR; the loser's stake goes to the treasury.",
    play: { state: "/api/play/state", action: "/api/play/action", heartbeat: "/api/coin/heartbeat" } });
}
