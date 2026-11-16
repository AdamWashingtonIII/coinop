import { describe, it, expect } from "vitest";
process.env.COINOP_DB_DIR = "memory://"; // in-memory PGlite: no disk, isolated per test file
process.env.SESSION_HMAC_SECRET = "test-secret-for-matches";
process.env.TREASURY_ADDRESS = "0x312e8Efd90C134f6E54A0B612dF4f55775eC2Bd7";
// NOTE: no MATCH_ESCROW_PRIVATE_KEY in this file on purpose — settlement must
// fail safe into settlement_pending with the error recorded, never throw away
// a decided match.
import { eq } from "drizzle-orm";
import { getDb, schema } from "./db";
import { createMatchSession, insertMatch, claimJoinerSlot, attachJoinerSession,
  findActiveMatchFor, refreshMatch, getMatchRow } from "./matches";

const A = "0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const B = "0xBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";

async function openMatch(id: string, seed: number | null = 4242) {
  const { session } = await createMatchSession("snake", A, id, seed);
  await insertMatch({ matchId: id, gameSlug: "snake", creatorWallet: A, session, seed });
  return session;
}

describe("versus matches (ADR 0009)", () => {
  it("creates an open match: seed committed, seed itself hidden while open", async () => {
    const s = await openMatch("m-open");
    const v = await refreshMatch("m-open");
    expect(v?.status).toBe("open");
    expect(v?.seedCommit).toBe(s.game.seedCommitment);
    expect(v?.seed).toBeNull(); // revealed only after settlement
    expect(v?.scores).toEqual({ creator: null, joiner: null });
    expect((await findActiveMatchFor(A, "snake"))?.id).toBe("m-open");
    expect(await findActiveMatchFor(B, "snake")).toBeUndefined();
  });

  it("joiner slot can be claimed exactly once", async () => {
    await openMatch("m-join");
    expect(await claimJoinerSlot("m-join", B)).toBe(true);
    expect(await claimJoinerSlot("m-join", B)).toBe(false);
    const { session } = await createMatchSession("snake", B, "m-join", 4242);
    await attachJoinerSession("m-join", session.sid);
    const row = await getMatchRow("m-join");
    expect(row?.status).toBe("full");
    expect(row?.sessionB).toBe(session.sid);
    // same seed -> same commitment on both runs
    expect(session.game.seedCommitment).toBe(row?.seedCommit);
  });

  it("unjoined match past the join deadline decides expired; failed payout stays pending with error", async () => {
    await openMatch("m-expire");
    const db = await getDb();
    await db.update(schema.matches).set({ createdAt: new Date(Date.now() - 11 * 60_000) })
      .where(eq(schema.matches.id, "m-expire"));
    const v = await refreshMatch("m-expire");
    expect(v?.status).toBe("settlement_pending");
    expect(v?.outcome).toBe("expired");
    expect(v?.error).toContain("escrow_not_configured");
    expect(v?.seed).toBe("4242"); // decided -> seed revealed
  });

  it("deadline forfeit: finisher wins; decision freezes even though payout cannot run", async () => {
    const sA = await openMatch("m-forfeit");
    expect(await claimJoinerSlot("m-forfeit", B)).toBe(true);
    const { session: sB } = await createMatchSession("snake", B, "m-forfeit", 4242);
    await attachJoinerSession("m-forfeit", sB.sid);
    const db = await getDb();
    // creator finished with a recorded score; joiner never did; join is stale
    await db.insert(schema.scores).values({ id: "score-a", gameSlug: "snake", wallet: A.toLowerCase(),
      value: 120, verified: true, sessionId: sA.sid, rulesetHash: "test" });
    await db.update(schema.matches).set({ joinedAt: new Date(Date.now() - 11 * 60_000) })
      .where(eq(schema.matches.id, "m-forfeit"));
    const v = await refreshMatch("m-forfeit");
    expect(v?.status).toBe("settlement_pending");
    expect(v?.outcome).toBe("forfeit");
    expect(v?.winner).toBe(A.toLowerCase());
    expect(v?.scores.creator).toBe(120);
    // a second read must not change the frozen decision
    const v2 = await refreshMatch("m-forfeit");
    expect(v2?.outcome).toBe("forfeit");
    expect(v2?.winner).toBe(A.toLowerCase());
  });
});
