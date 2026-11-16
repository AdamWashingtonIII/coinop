import { describe, it, expect } from "vitest";
import { createHash } from "crypto";
import { TicTacToeGame, bestMoves, TTT_BOARDS } from "./tictactoe";

describe("tic-tac-toe (WarGames cabinet)", () => {
  it("publishes a seed commitment and never leaks the seed mid-match", () => {
    const g = new TicTacToeGame(() => 0, 777);
    const st = g.state();
    expect(st.seedCommit).toBe(createHash("sha256").update("coinop-tictactoe-seed:777").digest("hex"));
    expect(JSON.stringify(st)).not.toContain("777");
    expect(g.revealSeed()).toBe("777");
  });

  it("is deterministic: same seed + same moves = same match", () => {
    const play = () => {
      const g = new TicTacToeGame(() => 0, 42);
      let guard = 0;
      while (!g.isOver && guard++ < 200) {
        const st = g.state();
        const mv = bestMoves([...st.cells], "X")[0];
        g.act("place_" + mv);
      }
      return g.state();
    };
    expect(play()).toEqual(play());
  });

  it("perfect agent play never loses a board in the whole match", () => {
    const g = new TicTacToeGame(() => 0, 1234);
    let guard = 0;
    while (!g.isOver && guard++ < 200) {
      const st = g.state();
      g.act("place_" + bestMoves([...st.cells], "X")[0]);
    }
    const st = g.state();
    expect(g.isOver).toBe(true);
    expect(st.won + st.drawn + st.lost).toBe(TTT_BOARDS);
    expect(st.lost).toBe(0);
    expect(st.score).toBe(st.won * 30 + st.drawn * 10);
    expect(st.score).toBeGreaterThanOrEqual(TTT_BOARDS * 10);
    expect(st.verdict).toBeTruthy();
  });

  it("rejects occupied cells and unknown actions", () => {
    const g = new TicTacToeGame(() => 0, 5);
    g.act("place_0");
    expect(() => g.act("place_0")).toThrow("illegal_move");
    expect(() => g.act("dance")).toThrow("unknown_action");
  });
});
