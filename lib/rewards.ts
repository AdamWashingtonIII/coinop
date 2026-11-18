import { randomBytes } from "crypto";
import { eq, and, inArray, sql } from "drizzle-orm";
import { getDb, schema } from "./db";
// ADR 0004: 25 tokens per paid play (per 0.25 USDC). Fixed rate, never floats.
// Claims reserve the balance and the batch processor mints them.
// M2': Postgres-backed (rewards_ledger + claims tables) — balances survive restarts.
//
// Farming hardening (Nov 17, 2026): a coin-in no longer earns on payment
// alone. The play reward lands as a PENDING entry (reason play_reward_pending,
// flagged, so it counts toward nothing — not balance, not claimable, not
// QTR-play spendable) and is RELEASED only when the session records a
// verified score (recordResult in lib/play/store.ts). A session that never
// records a score earns nothing. If the USDC settle later fails, the pending
// entry is VOIDED (reason play_reward_void) so a late score can never
// release it; a reward already released is excluded by the existing
// flagReward path, exactly as before. Release/void are reason-guarded
// updates, so retries and replays can never pay twice.
export const TOKENS_PER_PLAY = 25;
export const TOKEN = { name: "COINOP Quarter", symbol: "QTR", chain: "base", decimals: 18,
  contract: process.env.QTR_CONTRACT_ADDRESS ?? null } as const;
export type RewardReason = "play_reward" | "play_reward_pending" | "play_reward_void" | "reversal" | "match_win" | "match_draw" | "referral" | "task_lock" | "task_pay" | "task_fee" | "task_refund" | "task_stake_lock" | "task_stake_return" | "task_stake_slash" | "play_spend";
export type TaskLedgerReason = "task_lock" | "task_pay" | "task_fee" | "task_refund" | "task_stake_lock" | "task_stake_return" | "task_stake_slash";
export interface RewardEntry { wallet: string; delta: number; reason: RewardReason; refSid: string; ts: number; flagged: boolean }
const id = () => randomBytes(12).toString("hex");

export async function accruePlayReward(wallet: string, refSid: string): Promise<RewardEntry> {
  const db = await getDb();
  const e: RewardEntry = { wallet: wallet.toLowerCase(), delta: TOKENS_PER_PLAY, reason: "play_reward", refSid, ts: Date.now(), flagged: false };
  await db.insert(schema.rewardsLedger).values({ id: id(), wallet: e.wallet, delta: e.delta, reason: e.reason, refId: refSid, flagged: false });
  return e;
}
// The coin-in accrual (farming hardening): +25 QTR held pending until the
// session records a verified score. Flagged from birth, so pending QTR is
// invisible to rewardBalance / availableToClaim / the QTR-play spend check.
export async function accruePlayRewardPending(wallet: string, refSid: string): Promise<RewardEntry> {
  const db = await getDb();
  const e: RewardEntry = { wallet: wallet.toLowerCase(), delta: TOKENS_PER_PLAY, reason: "play_reward_pending", refSid, ts: Date.now(), flagged: true };
  await db.insert(schema.rewardsLedger).values({ id: id(), wallet: e.wallet, delta: e.delta, reason: e.reason, refId: refSid, flagged: true });
  return e;
}
// Release the pending reward for a session whose score was just recorded.
// The reason guard makes this exactly-once: a second call (retry, replay,
// double recordResult) finds no pending row and changes nothing.
export async function releasePlayReward(refSid: string): Promise<boolean> {
  const db = await getDb();
  const rows = await db.update(schema.rewardsLedger)
    .set({ reason: "play_reward", flagged: false })
    .where(and(eq(schema.rewardsLedger.refId, refSid), eq(schema.rewardsLedger.reason, "play_reward_pending")))
    .returning();
  return rows.length > 0;
}
// Settle failure for a session whose reward is still pending: void it, so
// the score gate can never release QTR for an unpaid play. (A reward that
// was already released before the failure is handled by flagReward.)
export async function voidPendingPlayReward(refSid: string): Promise<void> {
  const db = await getDb();
  await db.update(schema.rewardsLedger)
    .set({ reason: "play_reward_void" })
    .where(and(eq(schema.rewardsLedger.refId, refSid), eq(schema.rewardsLedger.reason, "play_reward_pending")));
}
// Versus (ADR 0009): match QTR is awarded ONLY by settlement — the winner of a
// decided match (match_win) or both players on a draw (match_draw). Losers,
// forfeit-losers, void and expired matches accrue nothing. refId = match id.
export async function accrueMatchReward(wallet: string, matchId: string, reason: "match_win" | "match_draw"): Promise<RewardEntry> {
  const db = await getDb();
  const e: RewardEntry = { wallet: wallet.toLowerCase(), delta: TOKENS_PER_PLAY, reason, refSid: matchId, ts: Date.now(), flagged: false };
  await db.insert(schema.rewardsLedger).values({ id: id(), wallet: e.wallet, delta: e.delta, reason: e.reason, refId: matchId, flagged: false });
  return e;
}
// Referral program (ADR 0010): +25 QTR to the referrer when a wallet they
// referred records its first game result. refId = the referred wallet, so the
// ledger itself proves the one-reward-per-referred-wallet rule.
export async function accrueReferralReward(referrerWallet: string, referredWallet: string): Promise<RewardEntry> {
  const db = await getDb();
  const e: RewardEntry = { wallet: referrerWallet.toLowerCase(), delta: TOKENS_PER_PLAY, reason: "referral", refSid: referredWallet.toLowerCase(), ts: Date.now(), flagged: false };
  await db.insert(schema.rewardsLedger).values({ id: id(), wallet: e.wallet, delta: e.delta, reason: e.reason, refId: e.refSid, flagged: false });
  return e;
}
// The Exchange (ADR 0013): bounty movements are signed ledger deltas keyed by
// task id — a lock debits the poster's claimable balance, settlement credits
// the worker and the treasury fee, a refund credits the poster back.
// ADR 0017 adds the worker stake: a lock at claim (a negative delta, exactly
// like task_lock, so the stake is not spendable elsewhere while held), a
// return on settlement/rejection/poster-cancel, and a slash to the treasury
// when a claim lapses unsubmitted or the worker releases their own claim.
export async function taskLedger(wallet: string, delta: number, reason: TaskLedgerReason, taskId: string): Promise<void> {
  const db = await getDb();
  await db.insert(schema.rewardsLedger).values({ id: id(), wallet: wallet.toLowerCase(), delta, reason, refId: taskId, flagged: false });
}
export async function flagReward(refSid: string): Promise<void> {
  const db = await getDb();
  await db.update(schema.rewardsLedger).set({ flagged: true }).where(eq(schema.rewardsLedger.refId, refSid));
}
export async function reverseReward(wallet: string, refSid: string): Promise<void> {
  const db = await getDb();
  await db.insert(schema.rewardsLedger).values({ id: id(), wallet: wallet.toLowerCase(), delta: -TOKENS_PER_PLAY, reason: "reversal", refId: refSid, flagged: false });
}
export async function rewardBalance(wallet: string): Promise<number> {
  const db = await getDb();
  const rows = await db.select({ s: sql<number>`coalesce(sum(${schema.rewardsLedger.delta}),0)` })
    .from(schema.rewardsLedger)
    .where(and(eq(schema.rewardsLedger.wallet, wallet.toLowerCase()), eq(schema.rewardsLedger.flagged, false)));
  return Number(rows[0]?.s ?? 0);
}
export async function rewardEntries(wallet: string): Promise<RewardEntry[]> {
  const db = await getDb();
  const rows = await db.select().from(schema.rewardsLedger)
    .where(eq(schema.rewardsLedger.wallet, wallet.toLowerCase()))
    .orderBy(schema.rewardsLedger.createdAt);
  return rows.map((r) => ({ wallet: r.wallet, delta: r.delta, reason: r.reason as RewardEntry["reason"],
    refSid: r.refId ?? "", ts: r.createdAt.getTime(), flagged: r.flagged }));
}
// Tokens already reserved by claims (queued/batched/minted) are no longer claimable.
export async function claimedTotal(wallet: string): Promise<number> {
  const db = await getDb();
  const rows = await db.select({ s: sql<number>`coalesce(sum(${schema.claims.amount}),0)` })
    .from(schema.claims)
    .where(and(eq(schema.claims.wallet, wallet.toLowerCase()),
      inArray(schema.claims.status, ["queued", "batched", "minted"])));
  return Number(rows[0]?.s ?? 0);
}
export async function availableToClaim(wallet: string): Promise<number> {
  return Math.max(0, (await rewardBalance(wallet)) - (await claimedTotal(wallet)));
}
