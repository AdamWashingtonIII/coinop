import { describe, it, expect } from "vitest";
import { createHash } from "crypto";
import { ChessGame, perft, START_FEN } from "./chess";

const KIWIPETE = "r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1";

describe("chess move generation (perft)", () => {
  it("start position: 20 / 400 / 8902", () => {
    expect(perft(START_FEN, 1)).toBe(20);
    expect(perft(START_FEN, 2)).toBe(400);
    expect(perft(START_FEN, 3)).toBe(8902);
  });
  it("Kiwipete (castling, pins, promotions in tree): 48 / 2039", () => {
    expect(perft(KIWIPETE, 1)).toBe(48);
    expect(perft(KIWIPETE, 2)).toBe(2039);
  });
});

describe("chess game shell", () => {
  it("publishes a seed commitment and reveals the seed on request", () => {
    const g = new ChessGame(() => 0, 4242);
    const st = g.state();
    expect(st.seedCommit).toBe(createHash("sha256").update("coinop-chess-seed:4242").digest("hex"));
    expect(st.fen).toBe(START_FEN);
    expect(st.score).toBe(0);
    expect(st.lastMove).toBeNull();
    expect(g.revealSeed()).toBe("4242");
    expect(g.legalMoves()).toHaveLength(20);
    expect(g.legalMoves()).toContain("e2e4");
  });

  it("act applies the agent move and the house reply; White to move again", () => {
    const g = new ChessGame(() => 0, 7);
    const st = g.act("move_e2e4");
    expect(st.status).toBe("playing");
    expect(st.fen.split(" ")[1]).toBe("w"); // house already answered
    expect(st.fen.split(" ")[5]).toBe("2"); // one full move completed
    expect(st.lastMove).toMatch(/^[a-h][1-8][a-h][1-8][qrbn]?$/);
    expect(st.capturedByYou).toEqual([]);
    expect(st.capturedByHouse).toEqual([]);
    expect(g.snapshots()).toHaveLength(2); // initial + after the full move
    expect(g.actionLog().map((l) => l.action)).toEqual(["move_e2e4"]);
  });

  it("is deterministic: same seed + same agent moves = same house replies", () => {
    const run = () => {
      const g = new ChessGame(() => 0, 42);
      g.act("move_e2e4");
      g.act("move_g1f3");
      g.act("move_d2d4");
      return g.state();
    };
    expect(run()).toEqual(run());
  });

  it("rejects malformed actions and illegal moves distinctly", () => {
    const g = new ChessGame(() => 0, 3);
    expect(() => g.act("e2e4")).toThrow("unknown_action");
    expect(() => g.act("move_e9e4")).toThrow("unknown_action");
    expect(() => g.act("move_e2e5")).toThrow("illegal_move");
    expect(() => g.act("move_e2e4q")).toThrow("illegal_move"); // spurious promotion suffix
    expect(() => g.act("move_a1a8")).toThrow("illegal_move"); // path blocked
  });

  it("scores captured material for the agent", () => {
    const g = ChessGame.fromFen("rnbqkbnr/ppp1pppp/8/3p4/4P3/8/PPPP1PPP/RNBQKBNR w KQkq d6 0 2", () => 0, 1);
    const st = g.act("move_e4d5");
    expect(st.capturedByYou).toEqual(["p"]);
    expect(st.score).toBe(10);
  });
});

describe("chess endings", () => {
  it("Fool's mate: the house, to move from fromFen, mates the agent (loss)", () => {
    const g = ChessGame.fromFen("rnbqkbnr/pppp1ppp/8/4p3/6P1/5P2/PPPPP2P/RNBQKBNR b KQkq - 0 2", () => 0, 1);
    const st = g.state();
    expect(st.lastMove).toBe("d8h4");
    expect(st.outcome).toBe("loss");
    expect(g.isOver).toBe(true);
    expect(g.finalScore).toBe(0);
  });

  it("agent delivers mate in 1: outcome win, +150 in the score", () => {
    const g = ChessGame.fromFen("6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1", () => 0, 1);
    const st = g.act("move_a1a8");
    expect(st.outcome).toBe("win");
    expect(st.score).toBe(150);
    expect(g.finalScore).toBe(150);
    expect(() => g.act("move_a8a1")).toThrow("game_over");
  });

  it("stalemate is a draw worth +40", () => {
    const g = ChessGame.fromFen("7k/5Q2/6K1/8/8/8/8/8 b - - 0 1", () => 0, 1);
    expect(g.state().outcome).toBe("draw");
    expect(g.finalScore).toBe(40);
  });

  it("bare kings are an insufficient-material draw", () => {
    const g = ChessGame.fromFen("8/8/8/8/8/8/k6K/8 w - - 0 1", () => 0, 1);
    expect(g.state().outcome).toBe("draw");
    expect(g.isOver).toBe(true);
  });

  it("the fifty-move rule declares a draw at 100 half-moves", () => {
    const g = ChessGame.fromFen("7k/8/8/8/8/8/8/R5K1 w - - 99 60", () => 0, 1);
    const st = g.act("move_a1a2"); // quiet move: the clock reaches 100
    expect(st.outcome).toBe("draw");
    expect(st.score).toBe(40);
  });

  it("the 300-half-move cap adjudicates on material (win, no mate bonus)", () => {
    const g = ChessGame.fromFen("7k/8/8/8/8/8/8/R5K1 w - - 0 150", () => 0, 1);
    const st = g.act("move_a1a2"); // house reply is half-move 300
    expect(st.outcome).toBe("win"); // rook up on the bare king
    expect(st.score).toBe(0); // no captures, and no +150 for an adjudicated win
  });
});

describe("chess special moves", () => {
  it("castling is generated when legal, and the rook comes along", () => {
    const g = ChessGame.fromFen("r3k2r/pppppppp/8/8/8/8/PPPPPPPP/R3K2R w KQkq - 0 1", () => 0, 1);
    expect(g.legalMoves()).toContain("e1g1");
    expect(g.legalMoves()).toContain("e1c1");
    const st = g.act("move_e1g1");
    expect(st.fen.split(" ")[0].endsWith("/R4RK1")).toBe(true);
  });

  it("castling through check is illegal; the other side stays legal", () => {
    const g = ChessGame.fromFen("5r2/8/8/8/8/8/8/R3K2R w KQ - 0 1", () => 0, 1); // rook f8 covers f1
    expect(g.legalMoves()).not.toContain("e1g1");
    expect(g.legalMoves()).toContain("e1c1");
  });

  it("castling out of check is illegal on both wings", () => {
    const g = ChessGame.fromFen("4r3/8/8/8/8/8/8/R3K2R w KQ - 0 1", () => 0, 1); // rook e8 checks e1
    expect(g.legalMoves()).not.toContain("e1g1");
    expect(g.legalMoves()).not.toContain("e1c1");
  });

  it("en passant captures the pawn that just double-pushed", () => {
    const g = ChessGame.fromFen("rnbqkbnr/ppp1pppp/8/3pPp2/8/8/PPPP1PPP/RNBQKBNR w KQkq f6 0 3", () => 0, 1);
    expect(g.legalMoves()).toContain("e5f6");
    const st = g.act("move_e5f6");
    expect(st.capturedByYou).toContain("p");
    expect(st.score).toBeGreaterThanOrEqual(10);
  });

  it("en passant is illegal when it exposes the king (the pin case)", () => {
    const g = ChessGame.fromFen("8/8/8/K2pP2r/8/8/8/4k3 w - d6 0 1", () => 0, 1);
    expect(g.legalMoves()).not.toContain("e5d6"); // both pawns leave rank 5, rook h5 would hit Ka5
    expect(g.legalMoves()).toContain("e5e6");
  });

  it("promotion offers all four pieces and produces a queen on request", () => {
    const g = ChessGame.fromFen("8/P7/8/8/8/8/k6K/8 w - - 0 1", () => 0, 1);
    for (const p of ["q", "r", "b", "n"]) expect(g.legalMoves()).toContain("a7a8" + p);
    const st = g.act("move_a7a8q");
    expect(st.fen.split(" ")[0].startsWith("Q7/")).toBe(true);
    expect(st.capturedByYou).toEqual([]);
  });
});

describe("the house", () => {
  it("grabs a free queen when one is offered", () => {
    const g = ChessGame.fromFen("rnb1kbnr/pppp1ppp/8/4p3/3Q4/8/PPPP1PPP/RNB1KBNR b KQkq - 0 1", () => 0, 1);
    expect(g.state().lastMove).toBe("e5d4");
    expect(g.state().capturedByHouse).toContain("Q");
  });
});
