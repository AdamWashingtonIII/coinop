import { NextResponse } from "next/server";
import { paymentRequirements, verifyPayment, settlePayment, precheckPayload } from "@/lib/x402/facilitator";
import { paymentRequiredResponse } from "@/lib/x402/paygate";
import { createPlaySession, evictSession } from "@/lib/play/store";
import { accruePlayReward, flagReward } from "@/lib/rewards";
import { attributeReferral } from "@/lib/referrals";
import { isLiveEngine } from "@/lib/games/engine";
import { spendQtrForPlay, QTR_PLAY_PRICE } from "@/lib/qtrplay";
import { rakeAccrue, rakeReverse } from "@/lib/prizes";
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
  const { gameSlug, referralCode, payWith, wallet, nonce, signature } = (await req.json().catch(() => ({}))) as
    { gameSlug?: string; referralCode?: string; payWith?: string; wallet?: string; nonce?: string; signature?: string };
  // Pay with QTR (ADR 0016): 50 QTR from the claimable ledger balance buys a
  // play. Wallet-signature auth via /api/coin/qtr-nonce; the debit is atomic.
  if (payWith === "qtr") {
    if (!gameSlug) return NextResponse.json({ error: "gameSlug required" }, { status: 400 });
    if (!isLiveEngine(gameSlug)) return NextResponse.json({ error: "engine_not_live", gameSlug }, { status: 400 });
    if (!wallet || !nonce || !signature) return NextResponse.json({ error: "qtr_auth_required" }, { status: 400 });
    const { session, token, expiresAt } = await createPlaySession(gameSlug, wallet);
    const spend = await spendQtrForPlay(wallet, nonce, signature, session.sid);
    if (spend !== "ok") {
      evictSession(session.sid);
      return NextResponse.json({ error: "qtr_" + spend },
        { status: spend === "insufficient" ? 402 : 401 });
    }
    const reward = await accruePlayReward(wallet, session.sid);
    return NextResponse.json({ sessionToken: token, sid: session.sid, expiresAt, gameSlug, paidWith: "qtr", qtrSpent: QTR_PLAY_PRICE,
      reward: { tokens: reward.delta, status: "accrued", claim: "/api/rewards" },
      play: { state: "/api/play/state", action: "/api/play/action", heartbeat: "/api/coin/heartbeat" } });
  }
  // The paywall answers BEFORE body validation: an unpaid request (including
  // discovery probes with empty bodies) always gets the 402 challenge, never
  // a 400. Validation still runs before any payment is verified, so a bad
  // slug can never consume a signed authorization.
  let reqs; try { reqs = paymentRequirements(gameSlug ?? "stacker"); }
  catch { return NextResponse.json({ error: "treasury_not_configured" }, { status: 503 }); }
  const header = req.headers.get("payment-signature") ?? req.headers.get("x-payment");
  if (!header) {
    return paymentRequiredResponse(reqs, "payment_required");
  }
  if (!gameSlug) return NextResponse.json({ error: "gameSlug required" }, { status: 400 });
  // Never take a payment for a cabinet whose engine is not live yet.
  if (!isLiveEngine(gameSlug)) return NextResponse.json({ error: "engine_not_live", gameSlug }, { status: 400 });
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
  await rakeAccrue(session.sid); // ADR 0016: $0.05 of the quarter feeds the weekly prize pool
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
    if (!s.success) { await flagReward(session.sid); await rakeReverse(session.sid); } // tokens and rake don't stand on an unpaid play
    if (s.tx) session.tx = s.tx;
  }).catch(async () => { session.paymentStatus = "needs_reconcile"; await flagReward(session.sid); await rakeReverse(session.sid); });
  return NextResponse.json({ sessionToken: token, sid: session.sid, expiresAt, gameSlug,
    reward: { tokens: reward.delta, status: "accrued", claim: "/api/rewards" },
    ...(referral ? { referral } : {}),
    play: { state: "/api/play/state", action: "/api/play/action", heartbeat: "/api/coin/heartbeat" } });
}
