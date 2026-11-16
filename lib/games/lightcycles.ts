// Light Cycles — server-authoritative engine (original COINOP implementation
// of the light-cycle duel): two cycles on a 40x30 grid leave permanent trails;
// hitting a wall, any trail, or the other cycle is a crash. The agent steers
// with UP/DOWN/LEFT/RIGHT (queued, no 180-degree turns); a house rival steers
// itself with a seeded longest-clear-ray policy. Movement is wall-clock driven
// (like Snake): state()/act() advance the sim to "now". Score is +1 per tick
// survived; when the rival crashes alone the agent scores +100 (a "derez"),
// the rival's trail is wiped and it respawns at its start, and the tick
// speeds up. The rival policy uses a seeded RNG, so a run is fully determined
// by its seed + action log (replayable).
import { createHash } from "crypto";
export const LC_W = 40;
export const LC_H = 30;
export const LC_TICK_MS = 120;
export const LC_MIN_TICK_MS = 70;
export const LC_DEREZ_POINTS = 100;
export interface Cell { x: number; y: number }
export interface LightCyclesState {
  slug: "lightcycles"; status: "playing" | "over";
  you: Cell; rival: Cell | null;
  trailYou: number[]; trailRival: number[]; // cell indices y*LC_W+x, heads last
  score: number; derezzed: number; tick: number; tickMs: number; overReason?: string;
  seedCommit: string; // sha256 commitment to the run's RNG seed, published from the first frame
}
const DIRS: Record<string, Cell> = { up: { x: 0, y: -1 }, down: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 } };
const DIR_LIST: Cell[] = [DIRS.up, DIRS.down, DIRS.left, DIRS.right];
export const LC_ACTIONS = ["up", "down", "left", "right"] as const;
const YOU_START: Cell = { x: 8, y: 15 };
const RIVAL_START: Cell = { x: 31, y: 15 };
const idx = (x: number, y: number) => y * LC_W + x;
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
interface RivalCycle { x: number; y: number; dir: Cell }
export class LightCyclesGame {
  readonly slug = "lightcycles" as const;
  private you: Cell = { ...YOU_START };
  private dir: Cell = { x: 1, y: 0 };
  private queue: Cell[] = [];
  private rival: RivalCycle | null = { ...RIVAL_START, dir: { x: -1, y: 0 } };
  private trailYouArr: number[] = [idx(YOU_START.x, YOU_START.y)];
  private trailRivalArr: number[] = [idx(RIVAL_START.x, RIVAL_START.y)];
  private trailYouSet = new Set(this.trailYouArr);
  private trailRivalSet = new Set(this.trailRivalArr);
  private score = 0;
  private derezzed = 0;
  private tickCount = 0;
  private over = false;
  private overReason: string | undefined;
  private lastTickAt: number;
  private bornAt: number;
  private rng: () => number;
  private seedValue: number;
  readonly seedCommitment: string;
  private snaps: LightCyclesState[] = [];
  private log: { atMs: number; action: string }[] = [];
  constructor(private now: () => number = Date.now, seed = Math.floor(Math.random() * 2 ** 31)) {
    this.seedValue = seed;
    this.seedCommitment = createHash("sha256").update("coinop-lightcycles-seed:" + seed).digest("hex");
    this.rng = mulberry32(seed);
    this.bornAt = now(); this.lastTickAt = now();
    this.snaps.push(this.snapshot());
  }
  private get tickMs(): number {
    return Math.max(LC_MIN_TICK_MS, LC_TICK_MS - 10 * this.derezzed);
  }
  private isBlocked(x: number, y: number): boolean {
    if (x < 0 || x >= LC_W || y < 0 || y >= LC_H) return true;
    const i = idx(x, y);
    return this.trailYouSet.has(i) || this.trailRivalSet.has(i);
  }
  // Clear cells ahead from (x, y) continuing in direction d, not counting (x, y) itself.
  private rayLength(x: number, y: number, d: Cell): number {
    let n = 0, cx = x, cy = y;
    while (n < LC_W + LC_H) {
      cx += d.x; cy += d.y;
      if (this.isBlocked(cx, cy)) break;
      n++;
    }
    return n;
  }
  // Rival policy: among non-reversing directions whose next cell does not crash
  // immediately, prefer the longest clear ray; seeded tie-break. If every
  // direction crashes immediately the rival holds its course (it is doomed).
  private chooseRivalDir(): Cell {
    const r = this.rival!;
    let bestRay = -1;
    let best: Cell[] = [];
    for (const d of DIR_LIST) {
      if (d.x === -r.dir.x && d.y === -r.dir.y) continue; // no 180-degree turns
      const nx = r.x + d.x, ny = r.y + d.y;
      if (this.isBlocked(nx, ny)) continue;
      const ray = this.rayLength(nx, ny, d);
      if (ray > bestRay) { bestRay = ray; best = [d]; }
      else if (ray === bestRay) best.push(d);
    }
    if (!best.length) return r.dir;
    return best[Math.floor(this.rng() * best.length)];
  }
  private respawnRival(): void {
    this.trailRivalArr = [];
    this.trailRivalSet.clear();
    let spawn: Cell | null = { ...RIVAL_START };
    if (this.trailYouSet.has(idx(spawn.x, spawn.y))) {
      // Start cell is under the agent's trail: take the free cell nearest to it.
      spawn = null;
      let bestDist = Infinity;
      for (let y = 0; y < LC_H; y++) for (let x = 0; x < LC_W; x++) {
        if (this.trailYouSet.has(idx(x, y))) continue;
        const dist = Math.abs(x - RIVAL_START.x) + Math.abs(y - RIVAL_START.y);
        if (dist < bestDist) { bestDist = dist; spawn = { x, y }; }
      }
    }
    if (!spawn) { this.rival = null; return; } // no free cell anywhere: rival stays out
    this.rival = { x: spawn.x, y: spawn.y, dir: spawn.x >= LC_W / 2 ? { x: -1, y: 0 } : { x: 1, y: 0 } };
    const i = idx(spawn.x, spawn.y);
    this.trailRivalArr.push(i);
    this.trailRivalSet.add(i);
  }
  private step(): void {
    if (this.over) return;
    const next = this.queue.shift();
    if (next && (next.x !== -this.dir.x || next.y !== -this.dir.y)) this.dir = next; // no 180° turns
    this.tickCount++;
    if (this.rival) this.rival.dir = this.chooseRivalDir();
    const youNext = { x: this.you.x + this.dir.x, y: this.you.y + this.dir.y };
    const rivalNext = this.rival ? { x: this.rival.x + this.rival.dir.x, y: this.rival.y + this.rival.dir.y } : null;
    const headOn = rivalNext !== null && youNext.x === rivalNext.x && youNext.y === rivalNext.y;
    const youCrash = headOn || this.isBlocked(youNext.x, youNext.y);
    const rivalCrash = this.rival !== null && (headOn || this.isBlocked(rivalNext!.x, rivalNext!.y));
    if (youCrash) {
      // Any agent crash ends the run — a same-tick rival crash scores no derez.
      this.over = true; this.overReason = "crashed";
      if (rivalCrash) this.rival = null; // derezzed in the same instant; never respawns
      this.snaps.push(this.snapshot());
      return;
    }
    // The agent survived this tick.
    this.score += 1;
    this.you = youNext;
    const yi = idx(youNext.x, youNext.y);
    this.trailYouArr.push(yi); this.trailYouSet.add(yi);
    if (this.rival) {
      if (rivalCrash) {
        this.score += LC_DEREZ_POINTS;
        this.derezzed++;
        this.respawnRival(); // wipes only the rival's trail; the agent's stays
        this.snaps.push(this.snapshot());
      } else {
        this.rival = { x: rivalNext!.x, y: rivalNext!.y, dir: this.rival.dir };
        const ri = idx(rivalNext!.x, rivalNext!.y);
        this.trailRivalArr.push(ri); this.trailRivalSet.add(ri);
      }
    }
    if (this.tickCount % 25 === 0 && this.snaps.length < 1500) this.snaps.push(this.snapshot());
  }
  private advance(): void {
    if (this.over) return;
    let guard = 0;
    while (guard++ < 3000) {
      if (this.now() - this.lastTickAt < this.tickMs) break;
      this.lastTickAt += this.tickMs;
      this.step();
      if (this.over) break;
    }
  }
  private snapshot(): LightCyclesState {
    return { slug: "lightcycles", status: this.over ? "over" : "playing",
      you: { ...this.you },
      rival: this.rival ? { x: this.rival.x, y: this.rival.y } : null,
      trailYou: [...this.trailYouArr], trailRival: [...this.trailRivalArr],
      score: this.score, derezzed: this.derezzed, tick: this.tickCount, tickMs: this.tickMs,
      seedCommit: this.seedCommitment,
      ...(this.overReason ? { overReason: this.overReason } : {}) };
  }
  state(): LightCyclesState { this.advance(); return this.snapshot(); }
  act(action: string): LightCyclesState {
    const d = DIRS[action];
    if (!d) throw new Error("unknown_action");
    this.log.push({ atMs: this.now() - this.bornAt, action });
    if (this.queue.length < 3) this.queue.push(d);
    return this.state();
  }
  // Provable fairness: the seed is revealed only once the run is over, so anyone
  // can check sha256(seed) == the seedCommit shown from frame one and replay the
  // rival's steering. Mid-run the seed stays secret — future rival moves are not
  // predictable.
  revealSeed(): string { return String(this.seedValue); }
  snapshots(): LightCyclesState[] { return this.snaps; }
  actionLog(): { atMs: number; action: string }[] { return this.log; }
  get isOver() { this.advance(); return this.over; }
  get finalScore() { return this.score; }
}
export const LIGHTCYCLES_MANIFEST = {
  slug: "lightcycles", title: "LIGHT CYCLES", priceAtomic: "250000", asset: "USDC",
  tickMs: LC_TICK_MS, maxDurationSeconds: 600,
  actions: [...LC_ACTIONS],
  stateDescription: "you/rival: cycle head cells on a 40x30 grid (rival is null only if it derezzed on the game-ending tick); trailYou/trailRival: permanent trail cells as y*40+x indices, heads last; score +1 per tick survived, +100 per rival derez; derezzed count; tickMs starts 120 and drops 10 per derez (min 70)",
  license: "Original — COINOP",
};
