import { describe, it, expect } from "vitest";
import { createHash } from "crypto";
import { GoGame } from "./go";

// Build an 81-char board string from a {index: "B"|"W"} map.
function boardWith(map: Record<number, string>): string {
  const arr = Array(81).fill(".");
  for (const [k, v] of Object.entries(map)) arr[Number(k)] = v;
  return arr.join("");
}

describe("go (9x9, full rules, area scoring)", () => {
  it("publishes a seed commitment and reveals the seed", () => {
    const g = new GoGame(() => 0, 4242);
    const st = g.state();
    expect(st.seedCommit).toBe(createHash("sha256").update("coinop-go-seed:4242").digest("hex"));
    expect(st.board).toBe(".".repeat(81));
    expect(st.lastMove).toBeNull();
    expect(g.revealSeed()).toBe("4242");
  });

  it("captures a surrounded stone: prisoners increment and the point empties", () => {
    // White stone in the corner (0), Black at 1; Black fills the last liberty (9).
    const g = GoGame.fromBoard(boardWith({ 0: "W", 1: "B" }), { byYou: 0, byHouse: 0 }, () => 0, 7);
    const st = g.act("play_9");
    expect(st.prisonersByYou).toBe(1);
    expect(st.board[0]).toBe(".");
    expect(st.board[9]).toBe("B");
    expect(st.score).toBe(5); // 1 prisoner x 5
  });

  it("rejects suicide: playing into a fully surrounded point with no capture", () => {
    // White at 1 and 9 surround corner point 0; both White stones have other liberties.
    const g = GoGame.fromBoard(boardWith({ 1: "W", 9: "W" }), { byYou: 0, byHouse: 0 }, () => 0, 7);
    const before = g.state();
    expect(() => g.act("play_0")).toThrow("illegal_move");
    expect(g.state().board).toBe(before.board); // a rejected move changes nothing
    expect(g.state().moves).toBe(0);
  });

  it("rejects occupied points as illegal and malformed actions as unknown", () => {
    const g = new GoGame(() => 0, 3);
    g.act("play_40");
    expect(() => g.act("play_40")).toThrow("illegal_move");
    expect(() => g.act("play_81")).toThrow("unknown_action");
    expect(() => g.act("dance")).toThrow("unknown_action");
  });

  it("enforces ko: the immediate re-recapture throws", () => {
    // Ko shape: Black stone at 11 is in atari (White at 2, 10, 20; last liberty 12),
    // and point 12 is itself surrounded by Black (3, 21, 13) except for 11.
    const g = GoGame.fromBoard(
      boardWith({ 11: "B", 3: "B", 21: "B", 13: "B", 2: "W", 10: "W", 20: "W" }),
      { byYou: 0, byHouse: 0 }, () => 0, 7);
    // Black plays a filler elsewhere; the house's only capture is play_12, taking 11.
    const st = g.act("play_80");
    expect(st.lastMove).toBe("play_12");
    expect(st.prisonersByHouse).toBe(1);
    expect(st.board[11]).toBe(".");
    expect(st.board[12]).toBe("W");
    // Black immediately re-capturing at 11 would repeat the position from two
    // plies ago — simple ko forbids it.
    expect(() => g.act("play_11")).toThrow("illegal_move");
  });

  it("double pass ends the game with an outcome and a final margin", () => {
    // 79 Black stones (only 0 and 40 empty, both bordered only by Black):
    // the house passes on a nearly full board, answering Black's pass.
    const arr = Array(81).fill("B");
    arr[0] = "."; arr[40] = ".";
    const g = GoGame.fromBoard(arr.join(""), { byYou: 0, byHouse: 0 }, () => 0, 7);
    const st = g.act("pass");
    expect(st.status).toBe("over");
    expect(st.lastMove).toBe("pass");
    expect(st.finalMargin).toBe(74.5); // Black area 81, White 0 + komi 6.5
    expect(st.outcome).toBe("win");
    expect(st.score).toBe(100 + 74 * 2); // win bonus + 2 per point of margin
    expect(g.isOver).toBe(true);
    expect(g.finalScore).toBe(st.score);
  });

  it("empty board, double pass from move 0: margin is exactly -komi, a scoreless loss", () => {
    const g = new GoGame(() => 0, 1);
    const st = g.act("pass");
    expect(st.status).toBe("over");
    expect(st.finalMargin).toBe(-6.5); // Black area 0, White area 0, komi 6.5
    expect(st.outcome).toBe("loss");
    expect(st.score).toBe(0);
    expect(st.moves).toBe(2);
  });

  it("is deterministic: same seed + same moves = same game", () => {
    const playScript = (seed: number) => {
      const g = new GoGame(() => 0, seed);
      const script = ["play_40", "play_20", "pass", "play_60", "play_0", "play_80", "play_30", "pass", "play_50"];
      for (const a of script) {
        if (g.isOver) break;
        try { g.act(a); } catch (e) {
          if ((e as Error).message !== "illegal_move") throw e;
          g.act("pass");
        }
      }
      return g;
    };
    const a = playScript(2024);
    const b = playScript(2024);
    expect(a.state()).toEqual(b.state());
    expect(a.snapshots()).toEqual(b.snapshots());
    expect(a.actionLog()).toEqual(b.actionLog());
  });

  it("house never plays an illegal move across a random full game", () => {
    let rs = 999;
    const rnd = () => { rs = (rs * 1103515245 + 12345) % 2147483648; return rs / 2147483648; };
    const g = new GoGame(() => 0, 31337);
    let guard = 0;
    while (!g.isOver && guard++ < 400) {
      const points = Array.from({ length: 81 }, (_, i) => i);
      for (let i = points.length - 1; i > 0; i--) {
        const j = Math.floor(rnd() * (i + 1));
        [points[i], points[j]] = [points[j], points[i]];
      }
      let moved = false;
      for (const p of points) {
        try { g.act("play_" + p); moved = true; break; }
        catch (e) { if ((e as Error).message !== "illegal_move") throw e; }
      }
      if (!moved) g.act("pass");
    }
    expect(g.isOver).toBe(true);
    const st = g.state();
    expect(st.outcome).toBeDefined();
    expect(st.finalMargin).toBeDefined();
    expect(st.moves).toBeLessThanOrEqual(160);
    for (const snap of g.snapshots()) expect(snap.board).toMatch(/^[.BW]{81}$/);
  });
});
