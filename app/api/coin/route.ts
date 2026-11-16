import { NextResponse } from "next/server";
import { paymentRequirements, verifyPayment, settlePayment, precheckPayload } from "@/lib/x402/facilitator";
import { paymentRequiredResponse } from "@/lib/x402/paygate";
import { createPlaySession } from "@/lib/play/store";
import { accruePlayReward, flagReward } from "@/lib/rewards";
import { attributeReferral } from "@/lib/referrals";
import { isLiveEngine } from "@/lib/games/engine";
// ADR 0003: the player is an agent. No payment header -> 402. Valid verify -> session token + play session.
// Verified-but-settle-fails still plays, flagged needs_reconcile (spec s5). No pay = no play, no exceptions.
// Discovery probes (x402scan and other catalogs) ask with GET: answer with the
// same 402 challenge an unpaid POST gets. A GET never creates a session and
// never takes payment — plays start with POST only.
export async function GET() {
  let reqs; try { reqs = paymentRequirements("stacker"); }
  catch { return NextResponse.json({ error: "treasury_not_configured" }, { status: 503 }); }
  return paymentRequiredResponse(reqs, "payment_required");
}
export async function POST(req: Request) {
  const { gameSlug, referralCode } = (await req.json().catch(() => ({}))) as { gameSlug?: string; referralCode?: string };
  if (!gameSlug) return NextResponse.json({ error: "gameSlug required" }, { status: 400 });
  // Never take a payment for a cabinet whose engine is not live yet.
  if (!isLiveEngine(gameSlug)) return NextResponse.json({ error: "engine_not_live", gameSlug }, { status: 400 });
  let reqs; try { reqs = paymentRequirements(gameSlug); }
  catch { return NextResponse.json({ error: "treasury_not_configured" }, { status: 503 }); }
  const header = req.headers.get("payment-signature") ?? req.headers.get("x-payment");
  if (!header) {
    return paymentRequiredResponse(reqs, "payment_required");
  }
  let payload: unknown;
  try { payload = JSON.parse(Buffer.from(header, "base64").toString("utf8")); }
  catch { return paymentRequiredResponse(reqs, "bad_payment_header"); }
  const pre = precheckPayload(payload, reqs);
  if (pre) return paymentRequiredResponse(reqs, pre);
  let verdict;
  try { verdict = await verifyPayment(payload, reqs); }
  catch { return NextResponse.json({ error: "facilitator_down_try_again" }, { status: 503 }); }
  if (!verdict.isValid) {
    return paymentRequiredResponse(reqs, verdict.invalidReason ?? "invalid_payment");
  }
  const payer = verdict.payer ?? (payload as { payload?: { authorization?: { from?: string } } }).payload?.authorization?.from ?? "unknown";
  const { session, token, expiresAt } = await createPlaySession(gameSlug, payer);
  const reward = await accruePlayReward(payer, session.sid); // ADR 0004: +25 tokens per paid play
  // Referrals (ADR 0010): a verified first coin-in carrying someone's code
  // attributes this payer to that referrer. Invalid / self / late codes are
  // ignored — attribution must never fail or delay a paid play.
  let referral: { status: string; reason?: string } | undefined;
  if (referralCode) {
    try {
      const a = await attributeReferral(referralCode, payer);
      referral = a.attributed ? { status: "attributed" } : { status: "ignored", reason: a.reason };
    } catch { referral = { status: "ignored", reason: "unavailable" }; }
  }
  // Async settle — never block play on confirmation latency.
  void settlePayment(payload, reqs).then(async (s) => {
    session.paymentStatus = s.success ? "settled" : "needs_reconcile";
    if (!s.success) await flagReward(session.sid); // tokens don't stand on an unpaid play
    if (s.tx) session.tx = s.tx;
  }).catch(async () => { session.paymentStatus = "needs_reconcile"; await flagReward(session.sid); });
  return NextResponse.json({ sessionToken: token, sid: session.sid, expiresAt, gameSlug,
    reward: { tokens: reward.delta, status: "accrued", claim: "/api/rewards" },
    ...(referral ? { referral } : {}),
    play: { state: "/api/play/state", action: "/api/play/action", heartbeat: "/api/coin/heartbeat" } });
}
