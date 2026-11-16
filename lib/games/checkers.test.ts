import { describe, it, expect } from "vitest";
import { createHash } from "crypto";
import { CheckersGame } from "./checkers";

// Builds a 64-char board: light squares "-", empty dark squares ".", plus the
// given pieces by square index (0-63, row*8+col, row 0 = top).
function boardWith(pieces: Record<number, string>): string {
  const b: string[] = [];
  for (let i = 0; i < 64; i++) {
    const r = Math.floor(i / 8), c = i % 8;
    b.push((r + c) % 2 === 1 ? "." : "-");
  }
  for (const [k, v] of Object.entries(pieces)) b[Number(k)] = v;
  return b.join("");
}

describe("checkers (American draughts cabinet)", () => {
  it("publishes a seed commitment and never leaks the seed in the opening state", () => {
    const g = new CheckersGame(() => 0, 777);
    const st = g.state();
    expect(st.seedCommit).toBe(createHash("sha256").update("coinop-checkers-seed:777").digest("hex"));
    expect(JSON.stringify(st)).not.toContain("777");
    expect(g.revealSeed()).toBe("777");
  });

  it("opens with 12 men a side and exactly 7 legal moves", () => {
    const g = new CheckersGame(() => 0, 1);
    const st = g.state();
    expect(st.status).toBe("playing");
    expect(st.turn).toBe("you");
    expect(st.board.split("").filter((c) => c === "a")).toHaveLength(12);
    expect(st.board.split("").filter((c) => c === "h")).toHaveLength(12);
    expect(g.legalMoves()).toHaveLength(7);
    expect(g.legalMoves()).toContain("move_40_33");
    expect(g.legalMoves()).toContain("move_46_39");
  });

  it("rejects malformed actions as unknown and wrong-side moves as illegal", () => {
    const g = new CheckersGame(() => 0, 5);
    expect(() => g.act("dance")).toThrow("unknown_action");
    expect(() => g.act("move_99_0")).toThrow("unknown_action");
    expect(() => g.act("move_1_8")).toThrow("illegal_move"); // a house man
    expect(() => g.act("move_40_32")).toThrow("illegal_move"); // not a diagonal hop
  });

  it("forces captures: a quiet move is illegal while a jump exists, and a capture scores +15", () => {
    // Agent man on 35 can jump the house man on 28 (landing 21); the agent man
    // on 46 has a quiet step that must be refused while the capture exists.
    const g = CheckersGame.fromBoard(boardWith({ 35: "a", 46: "a", 28: "h", 3: "h" }), "you", () => 0, 7);
    expect(g.legalMoves()).toEqual(["move_35_21"]);
    expect(() => g.act("move_46_39")).toThrow("illegal_move");
    const st = g.act("move_35_21");
    expect(st.score).toBe(15);
    expect(st.capturedByYou).toBe(1);
    expect(st.board[21]).toBe("a");
    expect(st.board[28]).toBe(".");
    expect(st.mustContinueFrom).toBeUndefined();
    expect(st.status).toBe("playing"); // house answered with its spare man
  });

  it("capturing a king scores +25", () => {
    const g = CheckersGame.fromBoard(boardWith({ 35: "a", 28: "H", 3: "h" }), "you", () => 0, 7);
    const st = g.act("move_35_21");
    expect(st.score).toBe(25);
    expect(st.capturedByYou).toBe(1);
  });

  it("multi-jumps continue with the same piece and the house waits", () => {
    // 42 jumps 35 landing 28, then must jump 19 landing 10.
    const g = CheckersGame.fromBoard(
      boardWith({ 42: "a", 56: "a", 35: "h", 19: "h", 1: "h" }), "you", () => 0, 9);
    expect(g.legalMoves()).toEqual(["move_42_28"]);
    const mid = g.act("move_42_28");
    expect(mid.mustContinueFrom).toBe(28);
    expect(mid.capturedByYou).toBe(1);
    expect(mid.board[1]).toBe("h"); // house has not moved yet
    expect(mid.board[10]).toBe(".");
    expect(g.legalMoves()).toEqual(["move_28_10"]);
    expect(() => g.act("move_56_49")).toThrow("illegal_move"); // another piece may not move
    const st = g.act("move_28_10");
    expect(st.mustContinueFrom).toBeUndefined();
    expect(st.capturedByYou).toBe(2);
    expect(st.score).toBe(30);
    // The house's reply is forced too: its man on 1 must jump the piece on 10.
    expect(st.capturedByHouse).toBe(1);
    expect(st.board[19]).toBe("h");
    expect(st.board[10]).toBe(".");
    expect(st.status).toBe("playing");
  });

  it("crowning by a jump ends the turn — no continuing as a king", () => {
    // 19 jumps 12 and crowns on 5; as a king it could jump back over 14 to 23,
    // but the American rule ends the turn at crowning.
    const g = CheckersGame.fromBoard(
      boardWith({ 19: "a", 12: "h", 14: "h", 49: "h" }), "you", () => 0, 11);
    expect(g.legalMoves()).toEqual(["move_19_5"]);
    const st = g.act("move_19_5");
    expect(st.board[5]).toBe("A");
    expect(st.capturedByYou).toBe(1);
    expect(st.score).toBe(25); // 15 capture + 10 crowning
    expect(st.mustContinueFrom).toBeUndefined();
    expect(st.board[14] !== "h" || st.board[49] !== "h").toBe(true); // the house took its turn
    expect(st.status).toBe("playing");
  });

  it("is deterministic: same seed + same moves = same game", () => {
    const play = () => {
      const g = new CheckersGame(() => 0, 42);
      const states = [];
      let guard = 0;
      while (!g.isOver && guard++ < 400) {
        states.push(g.act(g.legalMoves()[0]));
      }
      return states;
    };
    expect(play()).toEqual(play());
  });

  it("a full random-legal game terminates with an outcome", () => {
    const g = new CheckersGame(() => 0, 2024);
    let s = 987654321;
    const pick = () => { s = (s * 1103515245 + 12345) % 2147483648; return s; };
    let guard = 0;
    while (!g.isOver && guard++ < 20000) {
      const moves = g.legalMoves();
      expect(moves.length).toBeGreaterThan(0);
      g.act(moves[pick() % moves.length]);
    }
    expect(g.isOver).toBe(true);
    expect(["win", "draw", "loss"]).toContain(g.state().outcome);
    expect(g.finalScore).toBeGreaterThanOrEqual(0);
    expect(g.legalMoves()).toEqual([]);
  });
});
