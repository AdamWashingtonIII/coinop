import { describe, it, expect, beforeAll } from "vitest";
process.env.COINOP_DB_DIR = "memory://"; // in-memory PGlite: no disk, isolated per test file
process.env.SESSION_HMAC_SECRET = "practice-test-secret";
import { eq } from "drizzle-orm";
import { startPracticeRun, houseBotScore, hashIp } from "./practice";
import { recordResult, finalizeCappedSession } from "./play/store";
import { bestMoves, TicTacToeGame } from "./games/tictactoe";
import { getDb, schema } from "./db";

// Warm the in-memory DB outside the per-test timeout (PGlite first-init cost).
beforeAll(async () => { await getDb(); }, 60_000);

const IP_A = hashIp("203.0.113.1");
const IP_B = hashIp("203.0.113.2");
const CAP_MS = 600_000;

// Play a practice session to completion with perfect X moves.
function playOut(session: { game: unknown }) {
  const g = session.game as TicTacToeGame;
  let guard = 0;
  while (!g.isOver && guard++ < 100) {
    const moves = bestMoves([...g.state().cells], "X");
    if (!moves.length) break;
    g.act("place_" + moves[0]);
  }
}

describe("practice mode (ADR 0025)", () => {
  it("houseBotScore is deterministic and equals a perfect-play run", () => {
    const a = houseBotScore("tictactoe", 424242);
    const b = houseBotScore("tictactoe", 424242);
    expect(a).toBe(b);
    expect(a).toBeGreaterThan(0); // perfect X play beats the learning house on early boards
  });

  it("a finished practice run writes a flagged replay and NO score, NO rewards, NO referrals", async () => {
    const r = await startPracticeRun("tictactoe", { seed: 777, ipHash: IP_A });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.houseScore).toBe(houseBotScore("tictactoe", 777));
    playOut(r.session);
    expect(r.session.game.isOver).toBe(true);
    await recordResult(r.session);
    // Perfect play in the test must match the house bar exactly.
    expect(r.session.game.finalScore).toBe(r.houseScore);

    const db = await getDb();
    const scores = await db.select().from(schema.scores).where(eq(schema.scores.sessionId, r.session.sid));
    expect(scores).toHaveLength(0); // nothing ranked, ever
    const ledger = await db.select().from(schema.rewardsLedger).where(eq(schema.rewardsLedger.refId, r.session.sid));
    expect(ledger).toHaveLength(0);
    const events = await db.select().from(schema.gameEvents).where(eq(schema.gameEvents.sessionId, r.session.sid));
    expect(events).toHaveLength(1);
    const payload = JSON.parse(events[0].payload as string) as Record<string, unknown>;
    expect(payload.practice).toBe(true);
    expect(payload.houseScore).toBe(r.houseScore);
    expect(payload.seed).toBe("777"); // seed revealed for challenge rematches
    const runs = await db.select().from(schema.practiceRuns).where(eq(schema.practiceRuns.sid, r.session.sid));
    expect(runs).toHaveLength(1);
    expect(runs[0].status).toBe("finished");
    expect(runs[0].finalScore).toBe(r.houseScore);
  });

  it("the same seed replays the same challenge: identical house score", async () => {
    const r1 = await startPracticeRun("tictactoe", { seed: 31337, ipHash: IP_B });
    const r2 = await startPracticeRun("tictactoe", { seed: 31337, ipHash: IP_B });
    expect(r1.ok && r2.ok).toBe(true);
    if (r1.ok && r2.ok) expect(r1.houseScore).toBe(r2.houseScore);
  });

  it("only the practice cabinet is available", async () => {
    const r = await startPracticeRun("snake", { ipHash: IP_B });
    expect(r.ok).toBe(false);
    if (!r.ok) { expect(r.error).toBe("practice_not_available"); expect(r.status).toBe(400); }
  });

  it("the per-IP hourly cap refuses further starts", async () => {
    process.env.COINOP_PRACTICE_IP_HOURLY = "2";
    try {
      const ip = hashIp("198.51.100.9");
      expect((await startPracticeRun("tictactoe", { ipHash: ip })).ok).toBe(true);
      expect((await startPracticeRun("tictactoe", { ipHash: ip })).ok).toBe(true);
      const third = await startPracticeRun("tictactoe", { ipHash: ip });
      expect(third.ok).toBe(false);
      if (!third.ok) { expect(third.error).toBe("practice_rate_limited"); expect(third.status).toBe(429); }
      // A different IP is unaffected.
      expect((await startPracticeRun("tictactoe", { ipHash: hashIp("198.51.100.10") })).ok).toBe(true);
    } finally { delete process.env.COINOP_PRACTICE_IP_HOURLY; }
  });

  it("an unplayed practice run at the cap is voided with no score and no reward rows", async () => {
    const r = await startPracticeRun("tictactoe", { seed: 55, ipHash: IP_A });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    r.session.createdAt = Date.now() - CAP_MS - 1000;
    expect(await finalizeCappedSession(r.session)).toBe("voided");
    const db = await getDb();
    expect(await db.select().from(schema.scores).where(eq(schema.scores.sessionId, r.session.sid))).toHaveLength(0);
    const runs = await db.select().from(schema.practiceRuns).where(eq(schema.practiceRuns.sid, r.session.sid));
    expect(runs[0].status).toBe("voided");
  });
});
