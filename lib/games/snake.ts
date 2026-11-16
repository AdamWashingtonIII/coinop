// Snake — server-authoritative engine implementing the frozen catalog rules:
// 20x20 grid, steer UP/DOWN/LEFT/RIGHT, one cell per tick, never stops.
// Orb +10 (grow 1). Bonus orb after every 10 regular orbs, +50, expires in 5s.
// Every 5 orbs the tick speeds up. Wall or self collision ends the run.
// Movement is wall-clock driven (like Stacker): state()/act() advance the sim
// to "now", so agents play by polling + steering. Orb placement uses a seeded
// RNG so a run is fully determined by its seed + action log (replayable).
import { createHash } from "crypto";
export const SNAKE_W = 20;
export const SNAKE_H = 20;
export const SNAKE_BASE_TICK_MS = 200;
export const SNAKE_MIN_TICK_MS = 80;
export interface Cell { x: number; y: number }
export interface SnakeState {
  slug: "snake"; status: "playing" | "over";
  segments: Cell[]; orb: Cell | null; bonus: (Cell & { expiresInMs: number }) | null;
  score: number; tick: number; tickMs: number; length: number; overReason?: string;
  seedCommit: string; // sha256 commitment to the run's RNG seed, published from the first frame
}
const DIRS: Record<string, Cell> = { up: { x: 0, y: -1 }, down: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 } };
export const SNAKE_ACTIONS = ["up", "down", "left", "right"] as const;
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
export class SnakeGame {
  readonly slug = "snake" as const;
  private segments: Cell[] = [{ x: 10, y: 10 }, { x: 9, y: 10 }, { x: 8, y: 10 }];
  private dir: Cell = { x: 1, y: 0 };
  private queue: Cell[] = [];
  private orb: Cell | null = null;
  private bonus: (Cell & { expiresAt: number }) | null = null;
  private orbsEaten = 0;
  private score = 0;
  private tickCount = 0;
  private over = false;
  private overReason: string | undefined;
  private lastTickAt: number;
  private bornAt: number;
  private rng: () => number;
  private seedValue: number;
  readonly seedCommitment: string;
  private snaps: SnakeState[] = [];
  private log: { atMs: number; action: string }[] = [];
  constructor(private now: () => number = Date.now, seed = Math.floor(Math.random() * 2 ** 31)) {
    this.seedValue = seed;
    this.seedCommitment = createHash("sha256").update("coinop-snake-seed:" + seed).digest("hex");
    this.rng = mulberry32(seed);
    this.bornAt = now(); this.lastTickAt = now();
    this.orb = this.placeOrb();
    this.snaps.push(this.snapshot());
  }
  private get tickMs(): number {
    return Math.max(SNAKE_MIN_TICK_MS, SNAKE_BASE_TICK_MS - 10 * Math.floor(this.orbsEaten / 5));
  }
  private freeCells(): Cell[] {
    const taken = new Set(this.segments.map((s) => s.x + "," + s.y));
    if (this.orb) taken.add(this.orb.x + "," + this.orb.y);
    if (this.bonus) taken.add(this.bonus.x + "," + this.bonus.y);
    const out: Cell[] = [];
    for (let y = 0; y < SNAKE_H; y++) for (let x = 0; x < SNAKE_W; x++)
      if (!taken.has(x + "," + y)) out.push({ x, y });
    return out;
  }
  private placeOrb(): Cell | null {
    const free = this.freeCells();
    if (!free.length) return null;
    return free[Math.floor(this.rng() * free.length)];
  }
  private step(): void {
    if (this.over) return;
    const next = this.queue.shift();
    if (next && (next.x !== -this.dir.x || next.y !== -this.dir.y)) this.dir = next; // no 180° turns
    const head = { x: this.segments[0].x + this.dir.x, y: this.segments[0].y + this.dir.y };
    this.tickCount++;
    if (head.x < 0 || head.x >= SNAKE_W || head.y < 0 || head.y >= SNAKE_H) {
      this.over = true; this.overReason = "hit_wall"; this.snaps.push(this.snapshot()); return;
    }
    const eatsOrb = this.orb && head.x === this.orb.x && head.y === this.orb.y;
    const eatsBonus = this.bonus && head.x === this.bonus.x && head.y === this.bonus.y;
    const body = eatsOrb || eatsBonus ? this.segments : this.segments.slice(0, -1);
    if (body.some((s) => s.x === head.x && s.y === head.y)) {
      this.over = true; this.overReason = "hit_self"; this.snaps.push(this.snapshot()); return;
    }
    this.segments.unshift(head);
    if (eatsOrb) {
      this.score += 10; this.orbsEaten++;
      this.orb = this.placeOrb();
      if (this.orbsEaten % 10 === 0) { const c = this.placeOrb(); if (c) this.bonus = { ...c, expiresAt: this.now() + 5000 }; }
      this.snaps.push(this.snapshot());
    } else if (eatsBonus) {
      this.score += 50; this.bonus = null; this.snaps.push(this.snapshot());
    } else {
      this.segments.pop();
    }
    if (this.tickCount % 25 === 0 && this.snaps.length < 1500) this.snaps.push(this.snapshot());
  }
  private advance(): void {
    if (this.over) return;
    let guard = 0;
    while (guard++ < 3000) {
      const t = this.now();
      if (this.bonus && t > this.bonus.expiresAt) this.bonus = null;
      if (t - this.lastTickAt < this.tickMs) break;
      this.lastTickAt += this.tickMs;
      this.step();
      if (this.over) break;
    }
  }
  private snapshot(): SnakeState {
    return { slug: "snake", status: this.over ? "over" : "playing",
      segments: this.segments.map((s) => ({ ...s })), orb: this.orb ? { ...this.orb } : null,
      bonus: this.bonus ? { x: this.bonus.x, y: this.bonus.y, expiresInMs: Math.max(0, this.bonus.expiresAt - this.now()) } : null,
      score: this.score, tick: this.tickCount, tickMs: this.tickMs, length: this.segments.length,
      seedCommit: this.seedCommitment,
      ...(this.overReason ? { overReason: this.overReason } : {}) };
  }
  state(): SnakeState { this.advance(); return this.snapshot(); }
  act(action: string): SnakeState {
    const d = DIRS[action];
    if (!d) throw new Error("unknown_action");
    this.log.push({ atMs: this.now() - this.bornAt, action });
    if (this.queue.length < 3) this.queue.push(d);
    return this.state();
  }
  // Provable fairness: the seed is revealed only once the run is over, so anyone
  // can check sha256(seed) == the seedCommit shown from frame one and replay the
  // orb placements. Mid-run the seed stays secret — future orbs are not predictable.
  revealSeed(): string { return String(this.seedValue); }
  snapshots(): SnakeState[] { return this.snaps; }
  actionLog(): { atMs: number; action: string }[] { return this.log; }
  get isOver() { this.advance(); return this.over; }
  get finalScore() { return this.score; }
}
export const SNAKE_MANIFEST = {
  slug: "snake", title: "SNAKE", priceAtomic: "250000", asset: "USDC",
  tickMs: SNAKE_BASE_TICK_MS, maxDurationSeconds: 600,
  actions: [...SNAKE_ACTIONS],
  stateDescription: "segments: snake cells head-first; orb: food cell; bonus: expiring bonus cell; score; length; tickMs speeds up every 5 orbs",
  license: "Original — COINOP",
};
