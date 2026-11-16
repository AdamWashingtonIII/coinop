import { describe, it, expect, beforeAll } from "vitest";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { getDb, schema } from "./db";
import { accruePlayReward, availableToClaim, rewardBalance } from "./rewards";
import { issueTaskNonce, postTask, claimTask, submitTask, acceptTask, rejectTask, cancelTask, listTasks, setProfile, directory, taskStats } from "./tasks";
// Exchange money-flow tests on the in-memory DB: lock, settle + fee, refunds,
// expiry, auto-verification, and the auth/nonce rules. Keys are throwaway.
process.env.COINOP_DB_DIR = process.env.COINOP_DB_DIR ?? "memory://";
process.env.TREASURY_ADDRESS = "0x312e8Efd90C134f6E54A0B612dF4f55775eC2Bd7";
const poster = privateKeyToAccount(generatePrivateKey());
const worker = privateKeyToAccount(generatePrivateKey());
const third = privateKeyToAccount(generatePrivateKey());
async function sign(a: ReturnType<typeof privateKeyToAccount>) {
  const { nonce, message } = await issueTaskNonce(a.address);
  return { nonce, signature: await a.signMessage({ message }) };
}
async function fund(a: ReturnType<typeof privateKeyToAccount>, plays: number) {
  for (let i = 0; i < plays; i++) await accruePlayReward(a.address, "seed-" + a.address + "-" + i + "-" + Math.random());
}
beforeAll(async () => { await fund(poster, 8); await fund(third, 2); }); // poster 200 QTR, third 50

describe("exchange", () => {
  it("posts with a lock, settles a custom task with the 10% fee", async () => {
    expect(await availableToClaim(poster.address)).toBe(200);
    const s1 = await sign(poster);
    const t = await postTask(poster.address, s1.nonce, s1.signature,
      { type: "custom", title: "Write a haiku", description: "About rain.", bounty: 100, deadlineHours: 24 });
    expect(t.status).toBe("open");
    expect(await availableToClaim(poster.address)).toBe(100);
    const s2 = await sign(worker);
    const claimed = await claimTask(worker.address, s2.nonce, s2.signature, t.id);
    expect(claimed.status).toBe("claimed");
    const s3 = await sign(worker);
    const submitted = await submitTask(worker.address, s3.nonce, s3.signature, t.id, "rain on rooftops");
    expect(submitted.status).toBe("submitted");
    const s4 = await sign(poster);
    const settled = await acceptTask(poster.address, s4.nonce, s4.signature, t.id);
    expect(settled.status).toBe("settled");
    expect(await rewardBalance(worker.address)).toBe(90); // 100 - 10% fee
    expect(await rewardBalance(process.env.TREASURY_ADDRESS!)).toBe(10);
    const stats = await taskStats();
    expect(stats.settled).toBe(1); expect(stats.qtrVolume).toBe(100); expect(stats.feesEarned).toBe(10);
  });
  it("rejects bad signatures and nonce reuse", async () => {
    const { nonce } = await issueTaskNonce(poster.address);
    await expect(postTask(poster.address, nonce, "0x" + "00".repeat(65),
      { type: "custom", title: "x", description: "y", bounty: 10, deadlineHours: 2 })).rejects.toThrow("bad_signature");
    const s = await sign(poster);
    const t = await postTask(poster.address, s.nonce, s.signature,
      { type: "custom", title: "Cancel me", description: "d", bounty: 10, deadlineHours: 2 });
    await expect(cancelTask(poster.address, s.nonce, s.signature, t.id)).rejects.toThrow("bad_nonce"); // nonce was single-use
    const s2 = await sign(poster);
    const cancelled = await cancelTask(poster.address, s2.nonce, s2.signature, t.id);
    expect(cancelled.status).toBe("refunded");
  });
  it("refunds the poster in full on rejection, and blocks self-claims and over-claiming", async () => {
    const s1 = await sign(third);
    const t = await postTask(third.address, s1.nonce, s1.signature,
      { type: "custom", title: "Doomed task", description: "d", bounty: 50, deadlineHours: 4 });
    expect(await availableToClaim(third.address)).toBe(0);
    const ss = await sign(third);
    await expect(claimTask(third.address, ss.nonce, ss.signature, t.id)).rejects.toThrow("self_claim");
    const s2 = await sign(worker);
    await claimTask(worker.address, s2.nonce, s2.signature, t.id);
    const s3 = await sign(worker);
    await submitTask(worker.address, s3.nonce, s3.signature, t.id, "an attempt");
    const s4 = await sign(third);
    const rejected = await rejectTask(third.address, s4.nonce, s4.signature, t.id, "not what I asked for");
    expect(rejected.status).toBe("refunded");
    expect(await availableToClaim(third.address)).toBe(50);
    const dir = await directory();
    const w = dir.find((d) => d.wallet === worker.address.toLowerCase());
    expect(w?.tasksRejected).toBe(1);
  });
  it("insufficient QTR cannot post", async () => {
    const s = await sign(worker); // worker has 90 claimable but they're earnings; bounty 500 > 90
    await expect(postTask(worker.address, s.nonce, s.signature,
      { type: "custom", title: "Too rich", description: "d", bounty: 500, deadlineHours: 2 })).rejects.toThrow("insufficient_qtr");
  });
  it("arcade_score tasks auto-verify against a recorded run and settle instantly", async () => {
    const s1 = await sign(poster);
    const t = await postTask(poster.address, s1.nonce, s1.signature,
      { type: "arcade_score", title: "Snake 50+", description: "Score at least 50 on Snake.", bounty: 40, deadlineHours: 6, spec: { gameSlug: "snake", minScore: 50 } });
    const s2 = await sign(worker);
    const claimed = await claimTask(worker.address, s2.nonce, s2.signature, t.id);
    const db = await getDb();
    // a run that finished BEFORE the claim must not count
    await db.insert(schema.scores).values({ id: "old-run", gameSlug: "snake", wallet: worker.address.toLowerCase(), value: 500, verified: true, sessionId: "old-sid", createdAt: new Date((claimed.claimedAt ?? 0) - 60_000) });
    const sOld = await sign(worker);
    await expect(submitTask(worker.address, sOld.nonce, sOld.signature, t.id, "old-sid")).rejects.toThrow("verification_failed");
    // a fresh qualifying run settles immediately: 40 - 4 fee = 36 more QTR
    await db.insert(schema.scores).values({ id: "new-run", gameSlug: "snake", wallet: worker.address, value: 80, verified: true, sessionId: "new-sid", createdAt: new Date() }); // checksummed, as production writes it
    const before = await rewardBalance(worker.address);
    const s3 = await sign(worker);
    const settled = await submitTask(worker.address, s3.nonce, s3.signature, t.id, "new-sid");
    expect(settled.status).toBe("settled");
    expect((await rewardBalance(worker.address)) - before).toBe(36);
  });
  it("clock-skew grace: a run recorded seconds before the claim still verifies", async () => {
    const s1 = await sign(poster);
    const t = await postTask(poster.address, s1.nonce, s1.signature,
      { type: "arcade_score", title: "Skew check", description: "d", bounty: 10, deadlineHours: 2, spec: { gameSlug: "snake", minScore: 10 } });
    const s2 = await sign(worker);
    const claimed = await claimTask(worker.address, s2.nonce, s2.signature, t.id);
    const db = await getDb();
    await db.insert(schema.scores).values({ id: "skew-run", gameSlug: "snake", wallet: worker.address.toLowerCase(), value: 20, verified: true, sessionId: "skew-sid", createdAt: new Date((claimed.claimedAt ?? 0) - 5_000) });
    const s3 = await sign(worker);
    const settled = await submitTask(worker.address, s3.nonce, s3.signature, t.id, "skew-sid");
    expect(settled.status).toBe("settled");
  });
  it("profiles round-trip into the directory", async () => {
    const s = await sign(worker);
    await setProfile(worker.address, s.nonce, s.signature, { name: "SNAKE-CHARMER", capabilities: ["snake", "scouting"], blurb: "Fast on the grid." });
    const dir = await directory();
    const w = dir.find((d) => d.wallet === worker.address.toLowerCase());
    expect(w?.name).toBe("SNAKE-CHARMER");
    expect(w?.capabilities).toContain("snake");
    expect(w?.tasksCompleted).toBe(2);
    const open = await listTasks({ status: "open" });
    expect(Array.isArray(open)).toBe(true);
  });
});
