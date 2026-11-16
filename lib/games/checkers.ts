// Checkers — American/English draughts, agent vs house. 8x8 board, squares
// 0-63 (row*8+col, row 0 = top); only dark squares ((row+col) odd) are playable.
// The agent ("a" men / "A" kings) starts on rows 5-7 and moves toward row 0;
// the house ("h"/"H") starts on rows 0-2 and moves toward row 7. Full American
// rules: captures are forced, multi-jumps must continue with the same piece,
// men capture forward only, no flying kings, and a man crowned by a jump ends
// the turn. The agent acts ONE hop per act(); when its turn fully ends, the
// house plays its whole turn (negamax alpha-beta, depth 4 over full turns)
// inside the same act() call. Seeded RNG (tie-breaks only) with a published
// commitment, same provable-fairness pattern as Snake/Tic-Tac-Toe.
import { createHash } from "crypto";
export const CK_CAPTURE_MAN = 15;
export const CK_CAPTURE_KING = 25;
export const CK_CROWN = 10;
export const CK_WIN = 100;
export const CK_DRAW_AHEAD = 40;
export const CK_DRAW_EQUAL = 20;
export const CK_QUIET_LIMIT = 80; // half-moves without a capture or crowning -> adjudicated
export const CK_SEARCH_DEPTH = 4; // full turns
export interface CheckersState {
  slug: "checkers"; status: "playing" | "over";
  board: string; // 64 chars: "-" light square, "." empty, "a"/"A" agent, "h"/"H" house
  turn: "you" | "house-done"; // always "you": snapshots only exist at agent decision points
  mustContinueFrom?: number; // square of the piece forced to continue a multi-jump
  score: number;
  capturedByYou: number; capturedByHouse: number;
  lastMove: string | null;
  outcome?: "win" | "draw" | "loss";
  seedCommit: string;
}
type Side = "you" | "house";
interface Hop { from: number; to: number; cap: number | null }
const row = (i: number) => Math.floor(i / 8);
const col = (i: number) => i % 8;
const idx = (r: number, c: number) => r * 8 + c;
const onBoard = (r: number, c: number) => r >= 0 && r < 8 && c >= 0 && c < 8;
function sideOf(ch: string): Side | null {
  if (ch === "a" || ch === "A") return "you";
  if (ch === "h" || ch === "H") return "house";
  return null;
}
const other = (s: Side): Side => (s === "you" ? "house" : "you");
const isKingCh = (ch: string) => ch === "A" || ch === "H";
function dirsFor(ch: string): [number, number][] {
  if (isKingCh(ch)) return [[-1, -1], [-1, 1], [1, -1], [1, 1]];
  if (ch === "a") return [[-1, -1], [-1, 1]]; // agent men move/capture toward row 0
  return [[1, -1], [1, 1]]; // house men toward row 7
}
function jumpsFrom(board: string[], sq: number): Hop[] {
  const ch = board[sq];
  const side = sideOf(ch);
  if (!side) return [];
  const r = row(sq), c = col(sq), out: Hop[] = [];
  for (const [dr, dc] of dirsFor(ch)) {
    const mr = r + dr, mc = c + dc, lr = r + 2 * dr, lc = c + 2 * dc;
    if (!onBoard(lr, lc)) continue;
    const mid = board[idx(mr, mc)], land = board[idx(lr, lc)];
    if (sideOf(mid) === other(side) && land === ".") out.push({ from: sq, to: idx(lr, lc), cap: idx(mr, mc) });
  }
  return out;
}
function stepsFrom(board: string[], sq: number): Hop[] {
  const ch = board[sq];
  if (!sideOf(ch)) return [];
  const r = row(sq), c = col(sq), out: Hop[] = [];
  for (const [dr, dc] of dirsFor(ch)) {
    const nr = r + dr, nc = c + dc;
    if (onBoard(nr, nc) && board[idx(nr, nc)] === ".") out.push({ from: sq, to: idx(nr, nc), cap: null });
  }
  return out;
}
function allJumps(board: string[], side: Side): Hop[] {
  const out: Hop[] = [];
  for (let i = 0; i < 64; i++) if (sideOf(board[i]) === side) out.push(...jumpsFrom(board, i));
  return out;
}
function allSteps(board: string[], side: Side): Hop[] {
  const out: Hop[] = [];
  for (let i = 0; i < 64; i++) if (sideOf(board[i]) === side) out.push(...stepsFrom(board, i));
  return out;
}
// Legal single hops for a side at a decision point: a forced continuation
// restricts to that piece's jumps; otherwise jumps if any exist (captures are
// forced), else steps.
function legalHops(board: string[], side: Side, continueFrom: number | null): Hop[] {
  if (continueFrom != null) return jumpsFrom(board, continueFrom);
  const j = allJumps(board, side);
  return j.length ? j : allSteps(board, side);
}
// Full turn-moves for search: a turn is one step, or a maximal jump chain
// (the piece must keep jumping while it can, but may choose its path; a jump
// that crowns ends the turn).
function turnMoves(board: string[], side: Side): Hop[][] {
  const jumps = allJumps(board, side);
  if (!jumps.length) return allSteps(board, side).map((h) => [h]);
  const out: Hop[][] = [];
  const extend = (b: string[], hop: Hop, path: Hop[]) => {
    const { crowned } = applyHop(b, hop);
    if (crowned) { out.push(path); return; }
    const cont = jumpsFrom(b, hop.to);
    if (!cont.length) { out.push(path); return; }
    for (const nxt of cont) extend(b.slice(), nxt, [...path, nxt]);
  };
  for (const j of jumps) extend(board.slice(), j, [j]);
  return out;
}
// Applies a hop to a board array in place; reports what was captured and
// whether the piece was crowned by this hop.
function applyHop(board: string[], hop: Hop): { captured: string | null; crowned: boolean } {
  const ch = board[hop.from];
  board[hop.from] = ".";
  let captured: string | null = null;
  if (hop.cap != null) { captured = board[hop.cap]; board[hop.cap] = "."; }
  let placed = ch, crowned = false;
  if (ch === "a" && row(hop.to) === 0) { placed = "A"; crowned = true; }
  if (ch === "h" && row(hop.to) === 7) { placed = "H"; crowned = true; }
  board[hop.to] = placed;
  return { captured, crowned };
}
const pieceCount = (board: string[], side: Side) => board.reduce((n, ch) => n + (sideOf(ch) === side ? 1 : 0), 0);
const material = (board: string[], side: Side) => board.reduce((n, ch) => n + (sideOf(ch) === side ? (isKingCh(ch) ? 2 : 1) : 0), 0);
// --- House brain: negamax alpha-beta over full turns, from the mover's view.
const MATE = 100000;
function evaluate(board: string[], side: Side): number {
  let s = 0;
  for (let i = 0; i < 64; i++) {
    const ch = board[i];
    if (!sideOf(ch)) continue;
    let v: number;
    if (ch === "a") v = 100 + 6 * (7 - row(i));
    else if (ch === "h") v = 100 + 6 * row(i);
    else v = 175;
    s += sideOf(ch) === side ? v : -v;
  }
  const hops = (sd: Side) => { const j = allJumps(board, sd); return j.length ? j.length : allSteps(board, sd).length; };
  return s + 2 * (hops(side) - hops(other(side))); // small mobility term
}
function negamax(board: string[], side: Side, depth: number, alpha: number, beta: number, ply: number): number {
  const moves = turnMoves(board, side);
  if (!moves.length) return -MATE + ply; // no pieces or no legal moves: side to move loses
  if (depth === 0) return evaluate(board, side);
  const capValue = (seq: Hop[]) => seq.reduce((n, h) => n + (h.cap != null ? (isKingCh(board[h.cap]) ? 2 : 1) : 0), 0);
  moves.sort((a, b) => capValue(b) - capValue(a)); // captures first: better pruning
  let best = -Infinity;
  for (const seq of moves) {
    const b = board.slice();
    for (const h of seq) applyHop(b, h);
    const v = -negamax(b, other(side), depth - 1, -beta, -alpha, ply + 1);
    if (v > best) best = v;
    if (best > alpha) alpha = best;
    if (alpha >= beta) break;
  }
  return best;
}
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function initialBoard(): string[] {
  const b: string[] = [];
  for (let i = 0; i < 64; i++) {
    const dark = (row(i) + col(i)) % 2 === 1;
    if (!dark) { b.push("-"); continue; }
    if (row(i) <= 2) b.push("h");
    else if (row(i) >= 5) b.push("a");
    else b.push(".");
  }
  return b;
}
export class CheckersGame {
  readonly slug = "checkers" as const;
  private board: string[] = initialBoard();
  private score = 0;
  private capturedByYou = 0;
  private capturedByHouse = 0;
  private continueFrom: number | null = null;
  private lastMove: string | null = null;
  private outcome: "win" | "draw" | "loss" | undefined;
  private over = false;
  private quiet = 0; // half-moves since the last capture or crowning
  private rng: () => number;
  private seedValue: number;
  readonly seedCommitment: string;
  private bornAt: number;
  private snaps: CheckersState[] = [];
  private log: { atMs: number; action: string }[] = [];
  constructor(private now: () => number = Date.now, seed = Math.floor(Math.random() * 2 ** 31)) {
    this.seedValue = seed;
    this.seedCommitment = createHash("sha256").update("coinop-checkers-seed:" + seed).digest("hex");
    this.rng = mulberry32(seed);
    this.bornAt = now();
    this.snaps.push(this.snapshot());
  }
  // Build a game from a raw 64-char board (tests, puzzles). With turn "house"
  // the house plays its full turn immediately, leaving an agent decision point.
  static fromBoard(board64: string, turn: "you" | "house", now: () => number = Date.now,
    seed = Math.floor(Math.random() * 2 ** 31)): CheckersGame {
    if (board64.length !== 64 || /[^-.aAhH]/.test(board64)) throw new Error("invalid_board");
    const g = new CheckersGame(now, seed);
    g.board = board64.split("");
    g.score = 0; g.capturedByYou = 0; g.capturedByHouse = 0;
    g.continueFrom = null; g.lastMove = null; g.quiet = 0;
    g.outcome = undefined; g.over = false; g.log = [];
    if (pieceCount(g.board, "you") === 0) g.finish("loss", 0);
    else if (pieceCount(g.board, "house") === 0) g.finish("win", 0);
    else if (turn === "you") {
      if (!legalHops(g.board, "you", null).length) g.finish("loss", 0);
    } else {
      if (!turnMoves(g.board, "house").length) g.finish("win", 0);
      else g.runHouseTurn();
    }
    g.snaps = [g.snapshot()];
    return g;
  }
  private finish(outcome: "win" | "draw" | "loss", bonus: number): void {
    this.over = true;
    this.outcome = outcome;
    this.score += bonus;
    this.continueFrom = null;
  }
  private adjudicateDraw(): void {
    const mine = material(this.board, "you"), theirs = material(this.board, "house");
    if (mine > theirs) this.finish("win", CK_DRAW_AHEAD);
    else if (mine === theirs) this.finish("draw", CK_DRAW_EQUAL);
    else this.finish("loss", 0);
  }
  private chooseHouseTurn(): Hop[] {
    const moves = turnMoves(this.board, "house");
    if (!moves.length) return [];
    let best = -Infinity;
    const scored: { seq: Hop[]; v: number }[] = [];
    for (const seq of moves) {
      const b = this.board.slice();
      for (const h of seq) applyHop(b, h);
      const v = -negamax(b, "you", CK_SEARCH_DEPTH - 1, -Infinity, Infinity, 1);
      scored.push({ seq, v });
      if (v > best) best = v;
    }
    const top = scored.filter((x) => x.v === best);
    return top[Math.floor(this.rng() * top.length)].seq;
  }
  // Plays the house's entire turn (multi-jumps included), then settles the
  // agent-side end conditions. Assumes the house has at least one turn-move.
  private runHouseTurn(): void {
    const seq = this.chooseHouseTurn();
    const parts: string[] = [];
    for (const hop of seq) {
      const { captured, crowned } = applyHop(this.board, hop);
      if (captured) this.capturedByHouse++;
      this.quiet = captured || crowned ? 0 : this.quiet + 1;
      parts.push(`move_${hop.from}_${hop.to}`);
      if (this.quiet >= CK_QUIET_LIMIT) { this.lastMove = parts.join(">"); this.adjudicateDraw(); return; }
    }
    this.lastMove = parts.join(">");
    if (pieceCount(this.board, "you") === 0) this.finish("loss", 0);
    else if (!legalHops(this.board, "you", null).length) this.finish("loss", 0);
  }
  private snapshot(): CheckersState {
    return { slug: "checkers", status: this.over ? "over" : "playing",
      board: this.board.join(""), turn: "you",
      ...(this.continueFrom != null ? { mustContinueFrom: this.continueFrom } : {}),
      score: this.score, capturedByYou: this.capturedByYou, capturedByHouse: this.capturedByHouse,
      lastMove: this.lastMove,
      ...(this.outcome ? { outcome: this.outcome } : {}),
      seedCommit: this.seedCommitment };
  }
  state(): CheckersState { return this.snapshot(); }
  legalMoves(): string[] {
    if (this.over) return [];
    return legalHops(this.board, "you", this.continueFrom).map((h) => `move_${h.from}_${h.to}`);
  }
  act(action: string): CheckersState {
    const m = /^move_(\d+)_(\d+)$/.exec(action);
    if (!m) throw new Error("unknown_action");
    const from = Number(m[1]), to = Number(m[2]);
    if (from > 63 || to > 63) throw new Error("unknown_action");
    if (this.over) throw new Error("game_over");
    const hop = legalHops(this.board, "you", this.continueFrom)
      .find((h) => h.from === from && h.to === to);
    if (!hop) throw new Error("illegal_move");
    this.log.push({ atMs: this.now() - this.bornAt, action });
    const { captured, crowned } = applyHop(this.board, hop);
    if (captured) {
      this.capturedByYou++;
      this.score += isKingCh(captured) ? CK_CAPTURE_KING : CK_CAPTURE_MAN;
    }
    if (crowned) this.score += CK_CROWN;
    this.quiet = captured || crowned ? 0 : this.quiet + 1;
    this.lastMove = action;
    // Multi-jump: the same piece must keep jumping if it can (unless the jump
    // crowned it — crowning ends the turn). The house does not move yet.
    if (hop.cap != null && !crowned && jumpsFrom(this.board, hop.to).length) {
      this.continueFrom = hop.to;
      const st = this.snapshot();
      this.snaps.push(st);
      return st;
    }
    this.continueFrom = null;
    if (pieceCount(this.board, "house") === 0) this.finish("win", CK_WIN);
    else if (this.quiet >= CK_QUIET_LIMIT) this.adjudicateDraw();
    else if (!turnMoves(this.board, "house").length) this.finish("win", CK_WIN);
    else this.runHouseTurn();
    const st = this.snapshot();
    this.snaps.push(st);
    return st;
  }
  revealSeed(): string { return String(this.seedValue); }
  snapshots(): CheckersState[] { return this.snaps; }
  actionLog(): { atMs: number; action: string }[] { return this.log; }
  get isOver() { return this.over; }
  get finalScore() { return this.score; }
}
export const CHECKERS_MANIFEST = {
  slug: "checkers", title: "CHECKERS", priceAtomic: "250000", asset: "USDC",
  tickMs: 0, maxDurationSeconds: 600,
  actions: ["move_<from>_<to>"],
  stateDescription: "board: 64 chars, squares 0-63 row-major from the top ('-' light square, '.' empty, 'a'/'A' your men/kings, 'h'/'H' house); you move toward row 0 and act one hop per call — captures are forced, multi-jumps continue with the same piece (mustContinueFrom), then the house answers with its full turn; score: capture man 15 / king 25, crown 10, win 100; 80 quiet half-moves ends the game on material",
  license: "Original — COINOP",
};
