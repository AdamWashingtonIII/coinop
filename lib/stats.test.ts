import { describe, it, expect } from "vitest";
process.env.COINOP_DB_DIR = "memory://"; // in-memory PGlite: no disk, isolated per test file
import { getDb, schema } from "./db";
import { rakeAccrue, rakeReverse } from "./prizes";
import { accruePlayReward, accruePlayRewardPending, flagReward, taskLedger } from "./rewards";
import { arcadeStats } from "./stats";

const W = (n: number) => "0x" + n.toString(16).padStart(40, "0");

describe("transparency stats (GET /api/stats aggregates)", () => {
  it("computes every figure from the real ledgers, excluding what never settled", async () => {
    // 3 USDC coin-ins accrue rake; 1 settle fails and reverses -> 2 settled.
    await rakeAccrue("stats-sid-1"); await rakeAccrue("stats-sid-2"); await rakeAccrue("stats-sid-3");
    await rakeReverse("stats-sid-3");
    // Play rewards: 2 released (count), 1 still pending (doesn't), 1 released
    // then flagged by a late settle failure (doesn't).
    await accruePlayReward(W(1), "stats-p1"); await accruePlayReward(W(1), "stats-p2");
    await accruePlayRewardPending(W(2), "stats-p3");
    await accruePlayReward(W(3), "stats-p4"); await flagReward("stats-p4");
    // Exchange settlement payout to a worker.
    await taskLedger(W(4), 90, "task_pay", "stats-task-1");
    // Claims: only the minted one is on-chain.
    const db = await getDb();
    await db.insert(schema.claims).values([
      { id: "stats-c1", wallet: W(1), amount: 40, status: "minted" },
      { id: "stats-c2", wallet: W(1), amount: 999, status: "queued" },
      { id: "stats-c3", wallet: W(1), amount: 888, status: "batched" },
    ]);
    // Scored plays: verified only.
    await db.insert(schema.scores).values([
      { id: "stats-s1", gameSlug: "snake", wallet: W(1), value: 10, verified: true, sessionId: "stats-ss1", rulesetHash: "t" },
      { id: "stats-s2", gameSlug: "snake", wallet: W(2), value: 20, verified: true, sessionId: "stats-ss2", rulesetHash: "t" },
      { id: "stats-s3", gameSlug: "snake", wallet: W(2), value: 30, verified: false, sessionId: "stats-ss3", rulesetHash: "t" },
    ]);
    const s = await arcadeStats();
    expect(s.usdcCoinIns).toBe(2);
    expect(s.usdcTakenIn).toBe(0.5);
    expect(s.qtrPlayRewards).toBe(50);
    expect(s.qtrExchangePaid).toBe(90);
    expect(s.qtrClaimed).toBe(40);
    expect(s.scoredPlays).toBe(2);
  });
});
