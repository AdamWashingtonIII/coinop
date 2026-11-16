// Tic-Tac-Toe — the WarGames cabinet (ADR 0011). A 9-board match against the
// house computer. The agent is X; starters alternate by board. The house
// "learns": its seeded mistake rate falls board by board (50% -> 0%), so the
// late boards are perfect play, where a draw is the best possible result —
// the film's lesson, as a ruleset. Win 30 / draw 10 / loss 0 per board.
// Turn-based: each act() places one X and, unless the board just ended, the
// house replies inside the same call. Seeded RNG with a published commitment
// (same provable-fairness pattern as Snake).
import { createHash } from "crypto";
export const TTT_BOARDS = 9;
export const TTT_WIN = 30;
export const TTT_DRAW = 10;
// House mistake probability per board (1-indexed board number minus 1).
export const TTT_MISTAKE = [0.5, 0.35, 0.35, 0.2, 0.2, 0.1, 0.1, 0, 0];
export type Mark = "X" | "O";
export interface TicTacToeState {
  slug: "tictactoe"; status: "playing" | "over";
  cells: string[]; // 9 cells, "" | "X" | "O", row-major
  boardNumber: number; starter: Mark;
  score: number; won: number; drawn: number; lost: number;
  lastResult?: "win" | "draw" | "loss";
  verdict?: string;
  seedCommit: string;
}
export const TTT_ACTIONS = Array.from({ length: 9 }, (_, i) => "place_" + i);
const LINES = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];
export function winnerOf(cells: string[]): Mark | null {
  for (const [a, b, c] of LINES) if (cells[a] && cells[a] === cells[b] && cells[a] === cells[c]) return cells[a] as Mark;
  return null;
}
// Perfect-play minimax from `mark`'s perspective: +1 win, 0 draw, -1 loss.
function minimax(cells: string[], turn: Mark, mark: Mark): number {
  const w = winnerOf(cells);
  if (w) return w === mark ? 1 : -1;
  if (cells.every((c) => c)) return 0;
  let best = turn === mark ? -2 : 2;
  for (let i = 0; i < 9; i++) {
    if (cells[i]) continue;
    cells[i] = turn;
    const v = minimax(cells, turn === "X" ? "O" : "X", mark);
    cells[i] = "";
    best = turn === mark ? Math.max(best, v) : Math.min(best, v);
  }
  return best;
}
// All cells achieving the best minimax outcome for `mark` to move.
export function bestMoves(cells: string[], mark: Mark): number[] {
  let best = -2; const out: number[] = [];
  for (let i = 0; i < 9; i++) {
    if (cells[i]) continue;
    cells[i] = mark;
    const v = minimax(cells, mark === "X" ? "O" : "X", mark);
    cells[i] = "";
    if (v > best) { best = v; out.length = 0; out.push(i); }
    else if (v === best) out.push(i);
  }
  return out;
}
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
export class TicTacToeGame {
  readonly slug = "tictactoe" as const;
  private cells: string[] = Array(9).fill("");
  private boardNumber = 1;
  private starter: Mark = "X";
  private score = 0;
  private won = 0; private drawn = 0; private lost = 0;
  private lastResult: "win" | "draw" | "loss" | undefined;
  private over = false;
  private rng: () => number;
  private seedValue: number;
  readonly seedCommitment: string;
  private bornAt: number;
  private snaps: TicTacToeState[] = [];
  private log: { atMs: number; action: string }[] = [];
  constructor(private now: () => number = Date.now, seed = Math.floor(Math.random() * 2 ** 31)) {
    this.seedValue = seed;
    this.seedCommitment = createHash("sha256").update("coinop-tictactoe-seed:" + seed).digest("hex");
    this.rng = mulberry32(seed);
    this.bornAt = now();
    this.startBoard();
    this.snaps.push(this.snapshot());
  }
  private startBoard(): void {
    this.cells = Array(9).fill("");
    this.starter = this.boardNumber % 2 === 1 ? "X" : "O";
    if (this.starter === "O") this.houseMove(); // house opens even boards
  }
  private houseMove(): void {
    const open: number[] = [];
    this.cells.forEach((c, i) => { if (!c) open.push(i); });
    if (!open.length) return;
    const p = TTT_MISTAKE[this.boardNumber - 1] ?? 0;
    let pick: number;
    if (this.rng() < p) {
      pick = open[Math.floor(this.rng() * open.length)]; // a "not-yet-learned" move
    } else {
      const best = bestMoves([...this.cells], "O");
      pick = best[Math.floor(this.rng() * best.length)];
    }
    this.cells[pick] = "O";
  }
  private boardOutcome(): "win" | "draw" | "loss" | null {
    const w = winnerOf(this.cells);
    if (w === "X") return "win";
    if (w === "O") return "loss";
    if (this.cells.every((c) => c)) return "draw";
    return null;
  }
  private settleBoard(result: "win" | "draw" | "loss"): void {
    this.lastResult = result;
    if (result === "win") { this.score += TTT_WIN; this.won++; }
    else if (result === "draw") { this.score += TTT_DRAW; this.drawn++; }
    else this.lost++;
    if (this.boardNumber >= TTT_BOARDS) { this.over = true; return; }
    this.boardNumber++;
    this.startBoard();
  }
  private snapshot(): TicTacToeState {
    return { slug: "tictactoe", status: this.over ? "over" : "playing",
      cells: [...this.cells], boardNumber: this.boardNumber, starter: this.starter,
      score: this.score, won: this.won, drawn: this.drawn, lost: this.lost,
      ...(this.lastResult ? { lastResult: this.lastResult } : {}),
      ...(this.over ? { verdict: this.verdictText() } : {}),
      seedCommit: this.seedCommitment };
  }
  private verdictText(): string {
    if (this.drawn === TTT_BOARDS) return "WINNER: NONE. THE ONLY WINNING MOVE IS NOT TO PLAY.";
    if (this.won > this.lost) return "THE HOUSE IS STILL LEARNING. REMATCH ADVISED.";
    return "A STRANGE GAME. THE ONLY WINNING MOVE IS NOT TO PLAY.";
  }
  state(): TicTacToeState { return this.snapshot(); }
  act(action: string): TicTacToeState {
    const m = /^place_([0-8])$/.exec(action);
    if (!m) throw new Error("unknown_action");
    if (this.over) throw new Error("game_over");
    const i = Number(m[1]);
    if (this.cells[i]) throw new Error("illegal_move");
    this.log.push({ atMs: this.now() - this.bornAt, action });
    this.cells[i] = "X";
    let result = this.boardOutcome();
    if (!result) {
      this.houseMove();
      result = this.boardOutcome();
    }
    if (result) this.settleBoard(result);
    const st = this.snapshot();
    this.snaps.push(st);
    return st;
  }
  revealSeed(): string { return String(this.seedValue); }
  snapshots(): TicTacToeState[] { return this.snaps; }
  actionLog(): { atMs: number; action: string }[] { return this.log; }
  get isOver() { return this.over; }
  get finalScore() { return this.score; }
}
export const TICTACTOE_MANIFEST = {
  slug: "tictactoe", title: "TIC-TAC-TOE", priceAtomic: "250000", asset: "USDC",
  tickMs: 0, maxDurationSeconds: 600,
  actions: [...TTT_ACTIONS],
  stateDescription: "cells: 9 cells row-major ('' | 'X' | 'O'), you are X; boardNumber 1-9 of the match; starter alternates; score (win 30 / draw 10 / loss 0 per board); the house mistake rate falls every board — the last boards are perfect play",
  license: "Original — COINOP",
};
