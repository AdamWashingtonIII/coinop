import { describe, it, expect, beforeAll } from "vitest";
import { eq } from "drizzle-orm";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { getDb, schema } from "./db";
import { accruePlayReward, availableToClaim, rewardBalance, rewardEntries } from "./rewards";
import { issueTaskNonce, postTask, claimTask, submitTask, acceptTask, rejectTask, cancelTask, getTask, listTasks, stakeFor, stakeRateFor } from "./tasks";
// ADR 0017: tiered worker stake (lock / return / slash), the new-worker
// bounty cap, and the structured custom-task schema. In-memory DB, throwaway
// keys; each scenario uses a fresh worker so balances stay exact.
process.env.COINOP_DB_DIR = process.env.COINOP_DB_DIR ?? "memory://";
process.env.TREASURY_ADDRESS = "0x312e8Efd90C134f6E54A0B612dF4f55775eC2Bd7";
const TREASURY = "0x312e8Efd90C134f6E54A0B612dF4f55775eC2Bd7";
const poster = privateKeyToAccount(generatePrivateKey());
type Account = ReturnType<typeof privateKeyToAccount>;
async function sign(a: Account) {
  const { nonce, message } = await issueTaskNonce(a.address);
  return { nonce, signature: await a.signMessage({ message }) };
}
async function fund(a: Account, plays: number) {
  for (let i = 0; i < plays; i++) await accruePlayReward(a.address, "seed-" + a.address + "-" + i + "-" + Math.random());
}
async function freshWorker(plays: number): Promise<Account> {
  const a = privateKeyToAccount(generatePrivateKey());
  await fund(a, plays);
  return a;
}
async function post(bounty: number, extra: Record<string, unknown> = {}) {
  const s = await sign(poster);
  return postTask(poster.address, s.nonce, s.signature,
    { type: "custom", title: "Stake test task", description: "d", bounty, deadlineHours: 24, ...extra } as Parameters<typeof postTask>[3]);
}
async function entriesFor(wallet: string, taskId: string) {
  return (await rewardEntries(wallet)).filter((e) => e.refSid === taskId);
}
beforeAll(async () => { await fund(poster, 40); }); // poster 1000 QTR

describe("stake math", () => {
  it("tiers by lifetime completions, rounding up", () => {
    expect(stakeRateFor(0)).toBe(0.30);
    expect(stakeRateFor(1)).toBe(0.20);
    expect(stakeRateFor(4)).toBe(0.20);
    expect(stakeRateFor(5)).toBe(0.10);
    expect(stakeRateFor(25)).toBe(0.10);
    expect(stakeFor(100, 0)).toBe(30);
    expect(stakeFor(50, 1)).toBe(10);
    expect(stakeFor(33, 5)).toBe(4); // ceil(3.3)
    expect(stakeFor(10, 0)).toBe(3);
  });
});

describe("worker stake", () => {
  it("locks the stake at claim and drops the claimable balance", async () => {
    const w = await freshWorker(4); // 100 QTR, 0 completions
    const t = await post(50);
    const s = await sign(w);
    const claimed = await claimTask(w.address, s.nonce, s.signature, t.id);
    expect(claimed.stake).toBe(15); // 30% of 50
    expect(await rewardBalance(w.address)).toBe(85);
    expect(await availableToClaim(w.address)).toBe(85); // locked stake is not spendable elsewhere
    const entries = await entriesFor(w.address, t.id);
    expect(entries).toContainEqual(expect.objectContaining({ delta: -15, reason: "task_stake_lock" }));
  });

  it("blocks new workers from bounties over the 100 QTR cap", async () => {
    const w = await freshWorker(40); // balance is not the issue — the cap is
    const t = await post(150);
    const s = await sign(w);
    await expect(claimTask(w.address, s.nonce, s.signature, t.id)).rejects.toThrow("new_worker_cap");
  });

  it("fails the claim when the balance cannot cover the stake", async () => {
    const w = await freshWorker(1); // 25 QTR; a 100 bounty needs a 30 stake
    const t = await post(100);
    const s = await sign(w);
    await expect(claimTask(w.address, s.nonce, s.signature, t.id)).rejects.toThrow("insufficient_stake");
    expect((await getTask(t.id)).status).toBe("open"); // a failed claim leaves no trace
  });

  it("returns the stake on settlement, alongside pay and fee", async () => {
    const w = await freshWorker(4); // 100
    const t = await post(50);
    let s = await sign(w);
    await claimTask(w.address, s.nonce, s.signature, t.id);
    s = await sign(w);
    await submitTask(w.address, s.nonce, s.signature, t.id, "done");
    s = await sign(poster);
    await acceptTask(poster.address, s.nonce, s.signature, t.id);
    expect(await rewardBalance(w.address)).toBe(145); // 100 - 15 stake + 45 pay + 15 stake back
    const entries = await entriesFor(w.address, t.id);
    expect(entries).toContainEqual(expect.objectContaining({ delta: 45, reason: "task_pay" }));
    expect(entries).toContainEqual(expect.objectContaining({ delta: 15, reason: "task_stake_return" }));
    const house = await entriesFor(TREASURY, t.id);
    expect(house).toContainEqual(expect.objectContaining({ delta: 5, reason: "task_fee" }));
  });

  it("returns the stake when the poster rejects a submission", async () => {
    const w = await freshWorker(4); // 100
    const t = await post(40); // stake 12 at the new-worker tier
    let s = await sign(w);
    await claimTask(w.address, s.nonce, s.signature, t.id);
    s = await sign(w);
    await submitTask(w.address, s.nonce, s.signature, t.id, "an attempt");
    s = await sign(poster);
    await rejectTask(poster.address, s.nonce, s.signature, t.id, "not it");
    expect(await rewardBalance(w.address)).toBe(100); // stake back, no pay
    const entries = await entriesFor(w.address, t.id);
    expect(entries).toContainEqual(expect.objectContaining({ delta: 12, reason: "task_stake_return" }));
    expect(entries.some((e) => e.reason === "task_pay")).toBe(false);
  });

  it("slashes the stake when a claim lapses unsubmitted and reopens the task", async () => {
    const w = await freshWorker(4); // 100
    const t = await post(50); // stake 15
    const s = await sign(w);
    await claimTask(w.address, s.nonce, s.signature, t.id);
    const db = await getDb();
    await db.update(schema.tasks).set({ claimExpires: new Date(Date.now() - 1000) }).where(eq(schema.tasks.id, t.id));
    const houseBefore = await rewardBalance(TREASURY);
    await listTasks(); // any read runs the lazy expiry
    const after = await getTask(t.id);
    expect(after.status).toBe("open");
    expect(after.worker).toBeNull();
    expect(after.stake).toBeNull();
    expect(await rewardBalance(w.address)).toBe(85); // the stake is gone
    expect((await rewardBalance(TREASURY)) - houseBefore).toBe(15);
    const house = await entriesFor(TREASURY, t.id);
    expect(house).toContainEqual(expect.objectContaining({ delta: 15, reason: "task_stake_slash" }));
  });

  it("slashes the stake when a claimed task passes its deadline unsubmitted", async () => {
    const w = await freshWorker(4);
    const t = await post(50);
    const s = await sign(w);
    await claimTask(w.address, s.nonce, s.signature, t.id);
    const db = await getDb();
    await db.update(schema.tasks).set({ deadline: new Date(Date.now() - 1000), claimExpires: new Date(Date.now() - 1000) }).where(eq(schema.tasks.id, t.id));
    const posterBefore = await rewardBalance(poster.address);
    const after = await getTask(t.id); // triggers expiry
    expect(after.status).toBe("expired");
    expect((await rewardBalance(poster.address)) - posterBefore).toBe(50); // bounty refunded
    const house = await entriesFor(TREASURY, t.id);
    expect(house).toContainEqual(expect.objectContaining({ delta: 15, reason: "task_stake_slash" }));
  });

  it("slashes the stake when the worker releases their own claim", async () => {
    const w = await freshWorker(4); // 100
    const t = await post(50); // stake 15
    let s = await sign(w);
    await claimTask(w.address, s.nonce, s.signature, t.id);
    s = await sign(w);
    const released = await cancelTask(w.address, s.nonce, s.signature, t.id);
    expect(released.status).toBe("open");
    expect(released.worker).toBeNull();
    expect(await rewardBalance(w.address)).toBe(85);
    const house = await entriesFor(TREASURY, t.id);
    expect(house).toContainEqual(expect.objectContaining({ delta: 15, reason: "task_stake_slash" }));
  });

  it("returns the stake when the poster cancels a live claim", async () => {
    const w = await freshWorker(4); // 100
    const t = await post(50);
    let s = await sign(w);
    await claimTask(w.address, s.nonce, s.signature, t.id);
    const posterBefore = await rewardBalance(poster.address);
    s = await sign(poster);
    const cancelled = await cancelTask(poster.address, s.nonce, s.signature, t.id);
    expect(cancelled.status).toBe("refunded");
    expect((await rewardBalance(poster.address)) - posterBefore).toBe(50);
    expect(await rewardBalance(w.address)).toBe(100); // stake returned in full
    const entries = await entriesFor(w.address, t.id);
    expect(entries).toContainEqual(expect.objectContaining({ delta: 15, reason: "task_stake_return" }));
  });

  it("a worker cannot cancel after submitting, and strangers cannot cancel at all", async () => {
    const w = await freshWorker(4);
    const stranger = await freshWorker(1);
    const t = await post(50);
    let s = await sign(w);
    await claimTask(w.address, s.nonce, s.signature, t.id);
    s = await sign(w);
    await submitTask(w.address, s.nonce, s.signature, t.id, "work");
    s = await sign(w);
    await expect(cancelTask(w.address, s.nonce, s.signature, t.id)).rejects.toThrow("not_your_claim");
    s = await sign(stranger);
    await expect(cancelTask(stranger.address, s.nonce, s.signature, t.id)).rejects.toThrow("not_poster");
  });

  it("drops to the 20% tier after one completion and 10% after five", async () => {
    const w = await freshWorker(8); // 200
    // earn the first completion the real way
    const t1 = await post(50);
    let s = await sign(w);
    const c1 = await claimTask(w.address, s.nonce, s.signature, t1.id);
    expect(c1.stake).toBe(15); // 30% while new
    s = await sign(w);
    await submitTask(w.address, s.nonce, s.signature, t1.id, "done");
    s = await sign(poster);
    await acceptTask(poster.address, s.nonce, s.signature, t1.id);
    const t2 = await post(50);
    s = await sign(w);
    const c2 = await claimTask(w.address, s.nonce, s.signature, t2.id);
    expect(c2.stake).toBe(10); // 20% with 1 completion
    // four more settled rows put the worker at 5 completions
    const db = await getDb();
    for (let i = 0; i < 4; i++) {
      await db.insert(schema.tasks).values({ id: "hist-" + i + "-" + w.address, poster: poster.address.toLowerCase(), worker: w.address.toLowerCase(),
        type: "custom", title: "history", description: "d", bounty: 10, status: "settled", spec: {},
        deadline: new Date(Date.now() + 3600_000), createdAt: new Date() });
    }
    const t3 = await post(50);
    s = await sign(w);
    const c3 = await claimTask(w.address, s.nonce, s.signature, t3.id);
    expect(c3.stake).toBe(5); // 10% with 5 completions
  });
});

describe("structured custom-task schema", () => {
  it("round-trips deliverable and acceptance through the spec, capped at 280 chars", async () => {
    const s = await sign(poster);
    const t = await postTask(poster.address, s.nonce, s.signature, {
      type: "custom", title: "Schema task", description: "d", bounty: 25, deadlineHours: 4,
      deliverable: "x".repeat(300), acceptance: "Poster checks the summary against the board.",
    });
    expect(String(t.spec.deliverable)).toHaveLength(280);
    expect(t.spec.acceptance).toBe("Poster checks the summary against the board.");
    const read = await getTask(t.id);
    expect(read.spec.deliverable).toBe(t.spec.deliverable);
    expect(read.spec.acceptance).toBe("Poster checks the summary against the board.");
  });
  it("leaves arcade_score specs untouched by the schema fields", async () => {
    const s = await sign(poster);
    const t = await postTask(poster.address, s.nonce, s.signature, {
      type: "arcade_score", title: "Score task", description: "d", bounty: 25, deadlineHours: 4,
      spec: { gameSlug: "snake", minScore: 10 }, deliverable: "should not stick", acceptance: "nor this",
    });
    expect(t.spec.deliverable).toBeUndefined();
    expect(t.spec.acceptance).toBeUndefined();
    expect(t.spec.gameSlug).toBe("snake");
  });
});
