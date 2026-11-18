import { describe, it, expect } from "vitest";
process.env.COINOP_DB_DIR = "memory://"; // in-memory PGlite: no disk, isolated per test file
process.env.SESSION_HMAC_SECRET = "test-secret-for-reward-gate";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { accruePlayReward, accruePlayRewardPending, releasePlayReward, voidPendingPlayReward,
  flagReward, rewardBalance, availableToClaim } from "./rewards";
import { createPlaySession, recordResult } from "./play/store";
import { getOrCreateReferralCode, attributeReferral } from "./referrals";
import { issueQtrNonce, spendQtrForPlay } from "./qtrplay";

// Distinct lowercase wallets per test — the in-memory DB is shared per file.
const W = (n: number) => "0x" + n.toString(16).padStart(40, "0");

// A finished game, fast and deterministic: thermonuclear ends on stand_down.
async function finishedSession(wallet: string) {
  const { session } = await createPlaySession("thermonuclear", wallet);
  session.game.act("stand_down");
  expect(session.game.isOver).toBe(true);
  return session;
}

describe("play reward score gate (farming hardening)", () => {
  it("a paid session earns nothing until it records a score", async () => {
    await accruePlayRewardPending(W(1), "gate-sid-1");
    expect(await rewardBalance(W(1))).toBe(0);
    expect(await availableToClaim(W(1))).toBe(0); // pending is not claimable either
  });

  it("release pays exactly 25, exactly once — retries and replays are no-ops", async () => {
    expect(await releasePlayReward("gate-sid-1")).toBe(true);
    expect(await rewardBalance(W(1))).toBe(25);
    expect(await releasePlayReward("gate-sid-1")).toBe(false);
    expect(await releasePlayReward("gate-sid-1")).toBe(false);
    expect(await rewardBalance(W(1))).toBe(25);
  });

  it("a voided reward (settle failed before the score) can never be released", async () => {
    await accruePlayRewardPending(W(2), "gate-sid-2");
    await voidPendingPlayReward("gate-sid-2");
    expect(await releasePlayReward("gate-sid-2")).toBe(false);
    expect(await rewardBalance(W(2))).toBe(0);
  });

  it("settle failure AFTER release still excludes the reward (flag path)", async () => {
    await accruePlayRewardPending(W(3), "gate-sid-3");
    expect(await releasePlayReward("gate-sid-3")).toBe(true);
    expect(await rewardBalance(W(3))).toBe(25);
    await flagReward("gate-sid-3");
    expect(await rewardBalance(W(3))).toBe(0);
  });

  it("full flow: coin-in pending -> finished game -> recordResult pays 25 once", async () => {
    const session = await finishedSession(W(4));
    await accruePlayRewardPending(W(4), session.sid);
    expect(await rewardBalance(W(4))).toBe(0); // paid, played, not yet recorded
    await recordResult(session);
    expect(await rewardBalance(W(4))).toBe(25);
    await recordResult(session); // the play routes may re-fire; must stay a no-op
    expect(await rewardBalance(W(4))).toBe(25);
  });

  it("a session that is paid but never finished records no score and earns zero", async () => {
    const { session } = await createPlaySession("thermonuclear", W(5));
    await accruePlayRewardPending(W(5), session.sid);
    await recordResult(session); // not over -> records nothing
    expect(session.recorded).toBe(false);
    expect(await rewardBalance(W(5))).toBe(0);
  });

  it("referral bonus follows the referred wallet's first SCORED play, not its payment", async () => {
    const code = await getOrCreateReferralCode(W(6));
    expect((await attributeReferral(code, W(7))).attributed).toBe(true);
    const session = await finishedSession(W(7));
    await accruePlayRewardPending(W(7), session.sid);
    // Paid and finished, but nothing recorded yet: nobody has earned anything.
    expect(await rewardBalance(W(6))).toBe(0);
    expect(await rewardBalance(W(7))).toBe(0);
    await recordResult(session);
    expect(await rewardBalance(W(6))).toBe(25); // the referral bonus
    expect(await rewardBalance(W(7))).toBe(25); // the play reward
  });

  it("QTR play: the 50 debit stands at coin-in; the +25 lands only on a recorded score (net -25)", async () => {
    const acct = privateKeyToAccount(generatePrivateKey());
    const w = acct.address;
    // Seed an earned balance the honest way: three released play rewards.
    for (const sid of ["gate-seed-1", "gate-seed-2", "gate-seed-3"]) await accruePlayReward(w, sid);
    expect(await rewardBalance(w)).toBe(75);
    const session = await finishedSession(w);
    const n = await issueQtrNonce(w);
    const signature = await acct.signMessage({ message: n.message });
    expect(await spendQtrForPlay(w, n.nonce, signature, session.sid)).toBe("ok");
    expect(await rewardBalance(w)).toBe(25); // -50 at coin-in
    await accruePlayRewardPending(w, session.sid);
    expect(await rewardBalance(w)).toBe(25); // reward still gated on the score
    await recordResult(session);
    expect(await rewardBalance(w)).toBe(50); // +25 released: the play's net was -25
  });

  it("pending QTR is not spendable on another QTR play", async () => {
    const acct = privateKeyToAccount(generatePrivateKey());
    const w = acct.address;
    await accruePlayRewardPending(w, "gate-pend-1");
    await accruePlayRewardPending(w, "gate-pend-2");
    await accruePlayRewardPending(w, "gate-pend-3"); // 75 QTR of pending — worth nothing yet
    const n = await issueQtrNonce(w);
    const signature = await acct.signMessage({ message: n.message });
    expect(await spendQtrForPlay(w, n.nonce, signature, "gate-pend-spend")).toBe("insufficient");
    expect(await rewardBalance(w)).toBe(0);
  });
});
