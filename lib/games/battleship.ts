// Fleet Battle — the Battleship-style cabinet (original implementation).
// 10x10 grids, two fleets of 5 ships (lengths 5,4,3,3,2) placed by the run's
// seeded RNG. Turn-based: each act() is one agent shot, then the house fires
// back from a seeded hunt/target policy that never repeats a cell. The state
// is built from the agent's own knowledge only — un-hit house ship positions
// are never serialized (yourShots marks exactly the cells the agent has
// fired at). Seed commitment published from frame one, like Snake.
import { createHash } from "crypto";
export const BS_SIZE = 10;
export const BS_CELLS = 100;
export const BS_FLEET = [5, 4, 3, 3, 2];
export const BS_HIT_POINTS = 10;
export const BS_SINK_POINTS = 25;
export const BS_WIN_BONUS = 50;
export const BS_SURVIVOR_POINTS = 2;
export interface BattleshipState {
  slug: "battleship"; status: "playing" | "over";
  yourShots: string;   // enemy grid as you know it: "." unknown, "o" miss, "x" hit (afloat), "#" sunk-ship cell
  enemyAfloat: number[]; // lengths of house ships still afloat
  yourFleet: string;   // your grid: "." water, "s" intact ship cell, "x" hit ship cell, "#" sunk ship cell
  yourAfloat: number[];  // lengths of your ships still afloat
  score: number; shotsFired: number;
  lastEvents: string[];
  outcome?: "victory" | "defeat";
  seedCommit: string;
}
interface Ship { len: number; cells: number[]; hits: Set<number> }
export const BATTLESHIP_ACTIONS = Array.from({ length: BS_CELLS }, (_, i) => "fire_" + i);
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function placeFleet(rng: () => number): Ship[] {
  const taken = new Set<number>();
  const ships: Ship[] = [];
  for (const len of BS_FLEET) {
    for (;;) {
      const horiz = rng() < 0.5;
      const row = Math.floor(rng() * BS_SIZE);
      const col = Math.floor(rng() * BS_SIZE);
      const cells: number[] = [];
      for (let k = 0; k < len; k++) {
        const r = horiz ? row : row + k;
        const c = horiz ? col + k : col;
        if (r >= BS_SIZE || c >= BS_SIZE) { cells.length = 0; break; }
        cells.push(r * BS_SIZE + c);
      }
      if (cells.length === len && cells.every((c) => !taken.has(c))) {
        cells.forEach((c) => taken.add(c));
        ships.push({ len, cells, hits: new Set() });
        break;
      }
    }
  }
  return ships;
}
const shipAt = (ships: Ship[], cell: number) => ships.find((s) => s.cells.includes(cell));
const afloat = (ships: Ship[]) => ships.filter((s) => s.hits.size < s.len).map((s) => s.len).sort((a, b) => b - a);
export class BattleshipGame {
  readonly slug = "battleship" as const;
  private rng: () => number;
  private seedValue: number;
  readonly seedCommitment: string;
  private yourShips: Ship[];
  private foeShips: Ship[];
  private yourShotCells = new Set<number>(); // cells the agent has fired at
  private foeShotCells = new Set<number>();  // cells the house has fired at
  private foeUnsunkHits: number[] = [];      // your ship cells the house has hit but not sunk
  private score = 0;
  private shotsFired = 0;
  private over = false;
  private outcome: "victory" | "defeat" | undefined;
  private lastEvents: string[] = ["FLEETS DEPLOYED. FIRE WHEN READY."];
  private bornAt: number;
  private snaps: BattleshipState[] = [];
  private log: { atMs: number; action: string }[] = [];
  constructor(private now: () => number = Date.now, seed = Math.floor(Math.random() * 2 ** 31)) {
    this.seedValue = seed;
    this.seedCommitment = createHash("sha256").update("coinop-battleship-seed:" + seed).digest("hex");
    this.rng = mulberry32(seed);
    this.yourShips = placeFleet(this.rng);
    this.foeShips = placeFleet(this.rng);
    this.bornAt = now();
    this.snaps.push(this.snapshot());
  }
  private housePick(): number {
    // Target mode: probe unshot neighbours of unsunk hits first.
    const cand = new Set<number>();
    for (const h of this.foeUnsunkHits) {
      const r = Math.floor(h / BS_SIZE), c = h % BS_SIZE;
      if (r > 0) cand.add(h - BS_SIZE);
      if (r < BS_SIZE - 1) cand.add(h + BS_SIZE);
      if (c > 0) cand.add(h - 1);
      if (c < BS_SIZE - 1) cand.add(h + 1);
    }
    const targets = [...cand].filter((x) => !this.foeShotCells.has(x));
    if (targets.length) return targets[Math.floor(this.rng() * targets.length)];
    // Hunt mode: any unshot cell.
    const open: number[] = [];
    for (let i = 0; i < BS_CELLS; i++) if (!this.foeShotCells.has(i)) open.push(i);
    return open[Math.floor(this.rng() * open.length)];
  }
  private snapshot(): BattleshipState {
    const shots: string[] = [];
    for (let i = 0; i < BS_CELLS; i++) {
      if (!this.yourShotCells.has(i)) { shots.push("."); continue; }
      const s = shipAt(this.foeShips, i);
      if (!s) shots.push("o");
      else shots.push(s.hits.size >= s.len ? "#" : "x");
    }
    const fleet: string[] = [];
    for (let i = 0; i < BS_CELLS; i++) {
      const s = shipAt(this.yourShips, i);
      if (!s) { fleet.push("."); continue; }
      if (!s.hits.has(i)) fleet.push("s");
      else fleet.push(s.hits.size >= s.len ? "#" : "x");
    }
    return { slug: "battleship", status: this.over ? "over" : "playing",
      yourShots: shots.join(""), enemyAfloat: afloat(this.foeShips),
      yourFleet: fleet.join(""), yourAfloat: afloat(this.yourShips),
      score: this.score, shotsFired: this.shotsFired,
      lastEvents: [...this.lastEvents],
      ...(this.outcome ? { outcome: this.outcome } : {}),
      seedCommit: this.seedCommitment };
  }
  state(): BattleshipState { return this.snapshot(); }
  act(action: string): BattleshipState {
    const m = /^fire_(\d{1,2})$/.exec(action);
    if (!m) throw new Error("unknown_action");
    if (this.over) throw new Error("illegal_move");
    const cell = Number(m[1]);
    if (this.yourShotCells.has(cell)) throw new Error("illegal_move");
    this.log.push({ atMs: this.now() - this.bornAt, action });
    const events: string[] = [];
    // --- agent's shot ---
    this.yourShotCells.add(cell);
    this.shotsFired++;
    const target = shipAt(this.foeShips, cell);
    if (!target) events.push("YOU MISS");
    else {
      target.hits.add(cell);
      this.score += BS_HIT_POINTS;
      if (target.hits.size >= target.len) {
        this.score += BS_SINK_POINTS;
        events.push(`YOU SANK THEIR LENGTH-${target.len} SHIP`);
      } else events.push("YOU HIT");
    }
    if (this.foeShips.every((s) => s.hits.size >= s.len)) {
      const survivors = this.yourShips.reduce((a, s) => a + (s.len - s.hits.size), 0);
      this.score += BS_WIN_BONUS + BS_SURVIVOR_POINTS * survivors;
      this.over = true;
      this.outcome = "victory";
      events.push("VICTORY — THEIR FLEET IS GONE");
    } else {
      // --- house fires back ---
      const hc = this.housePick();
      this.foeShotCells.add(hc);
      const hitShip = shipAt(this.yourShips, hc);
      if (!hitShip) events.push("RED MISS");
      else {
        hitShip.hits.add(hc);
        if (hitShip.hits.size >= hitShip.len) {
          this.foeUnsunkHits = this.foeUnsunkHits.filter((x) => !hitShip.cells.includes(x));
          events.push(`RED SANK YOUR LENGTH-${hitShip.len} SHIP`);
        } else {
          this.foeUnsunkHits.push(hc);
          events.push(`RED HIT YOUR LENGTH-${hitShip.len} SHIP`);
        }
      }
      if (this.yourShips.every((s) => s.hits.size >= s.len)) {
        this.over = true;
        this.outcome = "defeat";
        events.push("DEFEAT — YOUR FLEET IS GONE");
      }
    }
    this.lastEvents = events;
    const st = this.snapshot();
    this.snaps.push(st);
    return st;
  }
  revealSeed(): string { return String(this.seedValue); }
  snapshots(): BattleshipState[] { return this.snaps; }
  actionLog(): { atMs: number; action: string }[] { return this.log; }
  get isOver() { return this.over; }
  get finalScore() { return this.score; }
}
export const BATTLESHIP_MANIFEST = {
  slug: "battleship", title: "FLEET BATTLE", priceAtomic: "250000", asset: "USDC",
  tickMs: 0, maxDurationSeconds: 600,
  actions: [...BATTLESHIP_ACTIONS],
  stateDescription: "yourShots: the enemy 10x10 grid as you know it (100 chars, row-major: '.' unknown, 'o' miss, 'x' hit, '#' sunk-ship cell); enemyAfloat: their ship lengths still afloat; yourFleet: your grid ('.' water, 's' intact, 'x' hit, '#' sunk); yourAfloat: your lengths afloat; score (hit +10, sink +25, win +50 plus +2 per surviving ship cell of yours); fire_0..fire_99 shoots one cell, then the house fires back",
  license: "Original — COINOP",
};
