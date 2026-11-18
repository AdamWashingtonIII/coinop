import { describe, it, expect, beforeAll } from "vitest";
process.env.COINOP_DB_DIR = "memory://"; // in-memory PGlite: no disk, isolated per test file
process.env.SESSION_HMAC_SECRET = "capped-test-secret";
import { eq } from "drizzle-orm";
import { accruePlayRewardPending, releasePlayReward, rewardBalance } from "../rewards";
import { createPlaySession, finalizeCappedSession, getSession } from "./store";
import { getDb, schema } from "../db";

// Distinct lowercase wallets per test — the in-memory DB is shared per file.
const W = (n: number) => "0x" + n.toString(16).padStart(40, "0");
const CAP_MS = 600_000;

async function scoreRows(sid: string) {
  const db = await getDb();
  return db.select().from(schema.scores).where(eq(schema.scores.sessionId, sid));
}
async function replayPayload(sid: string): Promise<Record<string, unknown> | null> {
  const db = await getDb();
  const rows = await db.select().from(schema.gameEvents).where(eq(schema.gameEvents.sessionId, sid));
  return rows.length ? JSON.parse(rows[0].payload as string) : null;
}

// Warm the in-memory DB outside the per-test timeout: PGlite's first init
// pays a multi-second cost that belongs to setup, not to any test.
beforeAll(async () => { await getDb(); }, 60_000);

describe("session-cap finalization (ADR 0023)", () => {
  it("a played run at the cap records its score (flagged capped) and releases the reward", async () => {
    const { session } = await createPlaySession("thermonuclear", W(1));
    session.game.act("build_warheads");
    expect(session.game.isOver).toBe(false);
    await accruePlayRewardPending(W(1), session.sid);
    session.createdAt = Date.now() - CAP_MS - 1000; // past the cap

    expect(await finalizeCappedSession(session)).toBe("capped");
    const rows = await scoreRows(session.sid);
    expect(rows).toHaveLength(1);
    expect(rows[0].verified).toBe(true);
    expect((await replayPayload(session.sid))?.capped).toBe(true);
    expect(await rewardBalance(W(1))).toBe(25); // released like any recorded result

    // Exactly once: a second finalize is a no-op and the balance never doubles.
    expect(await finalizeCappedSession(session)).toBeNull();
    expect(await scoreRows(session.sid)).toHaveLength(1);
    expect(await rewardBalance(W(1))).toBe(25);
    expect(getSession(session.sid)).toBeUndefined(); // evicted: the run is closed
  });

  it("an unplayed run at the cap records no score and its reward is voided", async () => {
    const { session } = await createPlaySession("thermonuclear", W(2));
    await accruePlayRewardPending(W(2), session.sid);
    session.createdAt = Date.now() - CAP_MS - 1000;

    expect(await finalizeCappedSession(session)).toBe("voided");
    expect(await scoreRows(session.sid)).toHaveLength(0);
    expect(await rewardBalance(W(2))).toBe(0);
    expect(await releasePlayReward(session.sid)).toBe(false); // voided can never release
  });

  it("a session under the cap is left completely alone", async () => {
    const { session } = await createPlaySession("thermonuclear", W(3));
    session.game.act("build_warheads");
    await accruePlayRewardPending(W(3), session.sid);

    expect(await finalizeCappedSession(session)).toBeNull();
    expect(await scoreRows(session.sid)).toHaveLength(0);
    expect(await rewardBalance(W(3))).toBe(0); // still pending, not voided
    expect(getSession(session.sid)).toBeDefined(); // still live
    expect(await releasePlayReward(session.sid)).toBe(true); // pending entry intact
  });

  it("a run that ended naturally but never recorded is recorded, not capped", async () => {
    const { session } = await createPlaySession("thermonuclear", W(4));
    session.game.act("stand_down");
    expect(session.game.isOver).toBe(true);
    await accruePlayRewardPending(W(4), session.sid);
    session.createdAt = Date.now() - CAP_MS - 1000;

    expect(await finalizeCappedSession(session)).toBe("recorded");
    expect(await scoreRows(session.sid)).toHaveLength(1);
    expect((await replayPayload(session.sid))?.capped).toBeUndefined();
    expect(await rewardBalance(W(4))).toBe(25);
  });
});
