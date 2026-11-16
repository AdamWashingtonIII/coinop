// Go — 9x9 board, full Go rules in compact form. The agent is Black; the house
// is White and replies inside the same act() call (turn-based, like Tic-Tac-Toe).
// Captures remove dead groups; suicide is illegal; simple ko forbids repeating
// the board position from two plies ago. Two consecutive passes — or 160 total
// moves — end the game, scored by area (Chinese style): stones on the board
// plus empty points surrounded only by that color; White gets komi 6.5.
// The house is a seeded beginner policy (capture atari, save atari, approach
// the last stone, otherwise any non-eye point), so a run is fully determined
// by its seed + action log; the seed commitment is published from frame one.
import { createHash } from "crypto";
export const GO_SIZE = 9;
export const GO_POINTS = 81;
export const GO_KOMI = 6.5;
export const GO_MOVE_CAP = 160;
export const GO_PRISONER_POINTS = 5;
export const GO_WIN_BONUS = 100;
export interface GoState {
  slug: "go"; status: "playing" | "over";
  board: string; // 81 chars, row-major: "." empty, "B" yours, "W" house
  prisonersByYou: number; prisonersByHouse: number;
  score: number; moves: number;
  lastMove: string | null; // the house's last action: "play_40" | "pass"
  outcome?: "win" | "loss";
  finalMargin?: number;
  seedCommit: string;
}
export const GO_ACTIONS = [...Array.from({ length: GO_POINTS }, (_, i) => "play_" + i), "pass"];
type Color = "B" | "W";
type BoardArr = string[]; // 81 entries: "." | "B" | "W"
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function neighborsOf(i: number): number[] {
  const r = Math.floor(i / GO_SIZE), c = i % GO_SIZE;
  const out: number[] = [];
  if (r > 0) out.push(i - GO_SIZE);
  if (r < GO_SIZE - 1) out.push(i + GO_SIZE);
  if (c > 0) out.push(i - 1);
  if (c < GO_SIZE - 1) out.push(i + 1);
  return out;
}
function groupAndLiberties(b: BoardArr, start: number): { stones: number[]; liberties: Set<number> } {
  const color = b[start];
  const stones: number[] = [];
  const liberties = new Set<number>();
  const seen = new Set<number>([start]);
  const stack = [start];
  while (stack.length) {
    const p = stack.pop()!;
    stones.push(p);
    for (const n of neighborsOf(p)) {
      if (b[n] === ".") liberties.add(n);
      else if (b[n] === color && !seen.has(n)) { seen.add(n); stack.push(n); }
    }
  }
  return { stones, liberties };
}
// Place `color` at `point` on a copy of the board. Returns the new board and
// the number of prisoners taken, or null when the move is illegal: occupied,
// suicide (own group left without a liberty after captures), or ko (the
// resulting board would repeat `forbidden`, the position from two plies ago).
function simulate(b: BoardArr, color: Color, point: number, forbidden: string | null):
  { board: BoardArr; captured: number } | null {
  if (b[point] !== ".") return null;
  const arr = [...b];
  arr[point] = color;
  const opp: Color = color === "B" ? "W" : "B";
  let captured = 0;
  const checked = new Set<number>();
  for (const n of neighborsOf(point)) {
    if (arr[n] === opp && !checked.has(n)) {
      const g = groupAndLiberties(arr, n);
      g.stones.forEach((s) => checked.add(s));
      if (g.liberties.size === 0) {
        g.stones.forEach((s) => { arr[s] = "."; });
        captured += g.stones.length;
      }
    }
  }
  if (groupAndLiberties(arr, point).liberties.size === 0) return null; // suicide
  if (forbidden !== null && arr.join("") === forbidden) return null; // ko
  return { board: arr, captured };
}
// Area scoring: a side's area is its stones plus the empty points in regions
// bordered only by its stones (regions touching both colors are neutral).
function scorePosition(b: BoardArr): { blackArea: number; whiteArea: number; margin: number } {
  let blackArea = 0, whiteArea = 0;
  const visited = new Set<number>();
  for (let i = 0; i < GO_POINTS; i++) {
    if (b[i] === "B") { blackArea++; continue; }
    if (b[i] === "W") { whiteArea++; continue; }
    if (visited.has(i)) continue;
    const region: number[] = [];
    const borders = new Set<string>();
    const stack = [i];
    visited.add(i);
    while (stack.length) {
      const p = stack.pop()!;
      region.push(p);
      for (const n of neighborsOf(p)) {
        if (b[n] === ".") { if (!visited.has(n)) { visited.add(n); stack.push(n); } }
        else borders.add(b[n]);
      }
    }
    if (borders.size === 1) {
      if (borders.has("B")) blackArea += region.length; else whiteArea += region.length;
    }
  }
  return { blackArea, whiteArea, margin: blackArea - (whiteArea + GO_KOMI) };
}
export class GoGame {
  readonly slug = "go" as const;
  private board: BoardArr = Array(GO_POINTS).fill(".");
  private prisonersByYou = 0;
  private prisonersByHouse = 0;
  private movesCount = 0;
  private lastHouseMove: string | null = null;
  private lastBlackPoint: number | null = null;
  private prevPlyWasPass = false;
  private history: string[] = []; // board after every ply, history[0] = start
  private over = false;
  private outcome: "win" | "loss" | undefined;
  private finalMargin: number | undefined;
  private rng: () => number;
  private seedValue: number;
  readonly seedCommitment: string;
  private bornAt: number;
  private snaps: GoState[] = [];
  private log: { atMs: number; action: string }[] = [];
  constructor(private now: () => number = Date.now, seed = Math.floor(Math.random() * 2 ** 31)) {
    this.seedValue = seed;
    this.seedCommitment = createHash("sha256").update("coinop-go-seed:" + seed).digest("hex");
    this.rng = mulberry32(seed);
    this.bornAt = now();
    this.history = [this.board.join("")];
    this.snaps.push(this.snapshot());
  }
  // Test/setup helper: start from a crafted position, Black (the agent) to move.
  static fromBoard(board81: string, prisoners: { byYou: number; byHouse: number },
    now: () => number = Date.now, seed = Math.floor(Math.random() * 2 ** 31)): GoGame {
    if (!/^[.BW]{81}$/.test(board81)) throw new Error("bad_board");
    const g = new GoGame(now, seed);
    g.board = board81.split("");
    g.prisonersByYou = prisoners.byYou;
    g.prisonersByHouse = prisoners.byHouse;
    g.history = [board81];
    g.snaps = [g.snapshot()];
    return g;
  }
  private koForbidden(): string | null {
    return this.history.length >= 2 ? this.history[this.history.length - 2] : null;
  }
  private scoreNow(): number {
    let s = this.prisonersByYou * GO_PRISONER_POINTS;
    if (this.over && this.outcome === "win") s += GO_WIN_BONUS + Math.floor(this.finalMargin!) * 2;
    return s;
  }
  private endGame(): void {
    this.over = true;
    const { margin } = scorePosition(this.board);
    this.finalMargin = margin;
    this.outcome = margin > 0 ? "win" : "loss";
  }
  // After a ply: returns true when the game just ended (double pass or cap).
  private afterPly(wasPass: boolean): boolean {
    if (wasPass && this.prevPlyWasPass) { this.endGame(); return true; }
    this.prevPlyWasPass = wasPass;
    if (this.movesCount >= GO_MOVE_CAP) { this.endGame(); return true; }
    return false;
  }
  private pick(candidates: number[]): number {
    const sorted = [...candidates].sort((a, b) => a - b);
    return sorted[Math.floor(this.rng() * sorted.length)];
  }
  // The house (White) policy, beginner-strength, in priority order. Returns
  // "pass" or "play_<point>". Every candidate goes through the same legality
  // simulation as the agent's moves, so the house can never play illegally.
  private houseChoose(): string {
    const stones = this.board.reduce((a, c) => a + (c === "." ? 0 : 1), 0);
    // Degenerate opening: an empty board has nothing to respond to — the house
    // declines to open, which makes a first-move pass a double pass (game over,
    // 0-0 before komi). Unreachable once any stone has been played.
    if (stones === 0) return "pass";
    if (stones > 70) return "pass"; // nearly full: pass
    const forbidden = this.koForbidden();
    const legal = (p: number) => simulate(this.board, "W", p, forbidden);
    // (1) Capture an agent group in atari — take the biggest capture on offer.
    let bestCap = 0;
    let capMoves: number[] = [];
    for (let p = 0; p < GO_POINTS; p++) {
      if (this.board[p] !== ".") continue;
      const sim = legal(p);
      if (sim && sim.captured > 0) {
        if (sim.captured > bestCap) { bestCap = sim.captured; capMoves = [p]; }
        else if (sim.captured === bestCap) capMoves.push(p);
      }
    }
    if (capMoves.length) return "play_" + this.pick(capMoves);
    // (2) Save its own group in atari: play its liberty if the group then has
    // more than one liberty.
    const saveMoves = new Set<number>();
    const seenGroups = new Set<number>();
    for (let p = 0; p < GO_POINTS; p++) {
      if (this.board[p] !== "W" || seenGroups.has(p)) continue;
      const g = groupAndLiberties(this.board, p);
      g.stones.forEach((s) => seenGroups.add(s));
      if (g.liberties.size === 1) {
        const liberty = [...g.liberties][0];
        const sim = legal(liberty);
        if (sim && groupAndLiberties(sim.board, liberty).liberties.size > 1) saveMoves.add(liberty);
      }
    }
    if (saveMoves.size) return "play_" + this.pick([...saveMoves]);
    // (3) Play an empty neighbor of the last agent stone.
    if (this.lastBlackPoint !== null) {
      const near = neighborsOf(this.lastBlackPoint).filter((p) => this.board[p] === "." && legal(p));
      if (near.length) return "play_" + this.pick(near);
    }
    // (4) Any legal empty point that is not filling its own single-point eye
    // (all neighbors its own stones, no capture).
    const open: number[] = [];
    for (let p = 0; p < GO_POINTS; p++) {
      if (this.board[p] !== ".") continue;
      const sim = legal(p);
      if (!sim) continue;
      const ownEye = neighborsOf(p).every((n) => this.board[n] === "W") && sim.captured === 0;
      if (!ownEye) open.push(p);
    }
    if (open.length) return "play_" + this.pick(open);
    return "pass";
  }
  private snapshot(): GoState {
    return { slug: "go", status: this.over ? "over" : "playing",
      board: this.board.join(""),
      prisonersByYou: this.prisonersByYou, prisonersByHouse: this.prisonersByHouse,
      score: this.scoreNow(), moves: this.movesCount,
      lastMove: this.lastHouseMove,
      ...(this.over ? { outcome: this.outcome, finalMargin: this.finalMargin } : {}),
      seedCommit: this.seedCommitment };
  }
  state(): GoState { return this.snapshot(); }
  act(action: string): GoState {
    if (this.over) throw new Error("game_over");
    let point: number | null = null;
    if (action !== "pass") {
      const m = /^play_(\d{1,2})$/.exec(action);
      if (!m) throw new Error("unknown_action");
      point = Number(m[1]);
      if (point >= GO_POINTS) throw new Error("unknown_action");
    }
    // Validate Black's move before mutating anything: a rejected move costs
    // nothing — no log entry, no snapshot, no turn spent.
    let sim: { board: BoardArr; captured: number } | null = null;
    if (point !== null) {
      sim = simulate(this.board, "B", point, this.koForbidden());
      if (!sim) throw new Error("illegal_move");
    }
    this.log.push({ atMs: this.now() - this.bornAt, action });
    // Black's ply.
    this.movesCount++;
    if (point !== null && sim) {
      this.board = sim.board;
      this.prisonersByYou += sim.captured;
      this.lastBlackPoint = point;
    }
    this.history.push(this.board.join(""));
    if (this.afterPly(point === null)) {
      const st = this.snapshot();
      this.snaps.push(st);
      return st;
    }
    // White (the house) replies inside the same call.
    const houseAction = this.houseChoose();
    this.movesCount++;
    if (houseAction === "pass") {
      this.lastHouseMove = "pass";
    } else {
      const hp = Number(houseAction.slice("play_".length));
      const hs = simulate(this.board, "W", hp, this.koForbidden());
      if (!hs) throw new Error("house_illegal_move"); // unreachable: policy pre-checks legality
      this.board = hs.board;
      this.prisonersByHouse += hs.captured;
      this.lastHouseMove = houseAction;
    }
    this.history.push(this.board.join(""));
    this.afterPly(houseAction === "pass");
    const st = this.snapshot();
    this.snaps.push(st);
    return st;
  }
  // Provable fairness: the seed is revealed only once the run is over, so anyone
  // can check sha256(seed) == the seedCommit shown from frame one and replay the
  // house's choices. Mid-run the seed stays secret.
  revealSeed(): string { return String(this.seedValue); }
  snapshots(): GoState[] { return this.snaps; }
  actionLog(): { atMs: number; action: string }[] { return this.log; }
  get isOver() { return this.over; }
  get finalScore() { return this.scoreNow(); }
}
export const GO_MANIFEST = {
  slug: "go", title: "GO", priceAtomic: "250000", asset: "USDC",
  tickMs: 0, maxDurationSeconds: 600,
  actions: [...GO_ACTIONS],
  stateDescription: "9x9 board, full Go rules (captures, no suicide, simple ko) in compact form; board: 81 chars row-major, points 0-80 ('.' empty, 'B' your stones, 'W' house stones); you are Black; area scoring (stones + surrounded empty points), komi 6.5 to White; score = 5 per prisoner you capture, plus on a win 100 + 2 per point of margin; two consecutive passes or 160 moves ends the game",
  license: "Original — COINOP",
};
