import { describe, it, expect } from "vitest";
process.env.COINOP_DB_DIR = "memory://";
process.env.SESSION_HMAC_SECRET = ["rebuild", "test", "secret"].join("-");
import { createPlaySession, getSessionAsync, evictSession, persistPlayState, recordResult } from "./store";
import type { ChessState } from "@/lib/games/chess";
import type { ThermonuclearState } from "@/lib/games/thermonuclear";
// ADR 0014: a session a sibling instance has never seen must rebuild from its
// persisted seed + action log and continue identically. Turn-based engines
// rebuild exactly; the ended-session and double-record guards are covered too.
const W = "0x" + "ab".repeat(20);

describe("session rebuild (ADR 0014)", () => {
  it("chess: a rebuilt session carries the exact position", async () => {
    const { session } = await createPlaySession("chess", W);
    const s1 = session.game.act("move_e2e4") as ChessState;
    session.actionIds.push(null);
    await persistPlayState(session);
    const fenBefore = s1.fen;
    evictSession(session.sid); // simulate landing on a fresh instance
    const rebuilt = await getSessionAsync(session.sid);
    expect(rebuilt).toBeDefined();
    const s2 = rebuilt!.game.state() as ChessState;
    expect(s2.fen).toBe(fenBefore); // the house reply is seeded: same position
    expect(rebuilt!.seed).toBe(session.seed);
    // and it keeps playing: the next move applies on the rebuilt engine
    const s3 = rebuilt!.game.act("move_d2d4") as ChessState;
    expect(s3.fen).not.toBe(fenBefore);
  });

  it("thermonuclear: a finished run rebuilds as finished, records once, then never rebuilds", async () => {
    const { session } = await createPlaySession("thermonuclear", W);
    const end = session.game.act("stand_down") as ThermonuclearState;
    session.actionIds.push(null);
    await persistPlayState(session);
    expect(end.status).toBe("over");
    expect(end.score).toBe(45);
    evictSession(session.sid);
    const rebuilt = await getSessionAsync(session.sid);
    expect(rebuilt).toBeDefined();
    expect(rebuilt!.recorded).toBe(false);
    expect((rebuilt!.game.state() as ThermonuclearState).score).toBe(45);
    await recordResult(rebuilt!); // writes the scores row + ends the session row
    expect(rebuilt!.recorded).toBe(true);
    evictSession(session.sid);
    expect(await getSessionAsync(session.sid)).toBeUndefined(); // ended: never rebuilt
  });

  it("snake: a rebuilt run keeps its seed commitment, score and length", async () => {
    const { session } = await createPlaySession("snake", W);
    const before = session.game.state();
    evictSession(session.sid);
    const rebuilt = await getSessionAsync(session.sid);
    expect(rebuilt).toBeDefined();
    const after = rebuilt!.game.state();
    expect(after.seedCommit).toBe(before.seedCommit); // same seed, same run
    expect(after.score).toBe(before.score);
    expect(after.length).toBe(before.length);
    expect(rebuilt!.seed).toBe(session.seed);
  });

  it("unknown sid stays unknown", async () => {
    expect(await getSessionAsync("deadbeef".repeat(4))).toBeUndefined();
  });
});
