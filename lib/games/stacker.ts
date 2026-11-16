// Stacker — server-authoritative engine. The server owns state and score; agents only send actions.
// Grid 10 wide, 15 rows. A block slides side to side; DROP locks it. Overhang is lost.
// No overlap = game over. Fill all 15 rows = tower complete.
export const GRID_W = 10;
export const GRID_H = 15;
export const TICK_MS = 250;
export interface Span { start: number; end: number } // [start, end) cells
export interface StackerState {
  slug: "stacker"; status: "playing" | "over";
  spans: Span[]; level: number; score: number;
  moving: Span & { dir: 1 | -1 }; tick: number; overReason?: string;
}
export class StackerGame {
  readonly slug = "stacker" as const;
  private spans: Span[] = [];
  private tickCount = 0;
  private width = 3;
  private score = 0;
  private over = false;
  private overReason: string | undefined;
  private startedAt: number;
  private snaps: StackerState[] = [];
  private log: { atMs: number; action: string }[] = [];
  private bornAt: number;
  constructor(private now: () => number = Date.now) { this.startedAt = now(); this.bornAt = now(); this.snaps.push(this.state()); }
  private posAt(tick: number): { start: number; dir: 1 | -1 } {
    const range = GRID_W - this.width; // start in [0, range]
    if (range <= 0) return { start: 0, dir: 1 };
    const cycle = range * 2;
    const t = tick % cycle;
    return t <= range ? { start: t, dir: 1 } : { start: cycle - t, dir: -1 };
  }
  private currentTick(): number {
    return Math.floor((this.now() - this.startedAt) / TICK_MS) ;
  }
  state(): StackerState {
    const tick = this.currentTick();
    const { start, dir } = this.posAt(tick);
    return {
      slug: "stacker", status: this.over ? "over" : "playing",
      spans: [...this.spans], level: this.spans.length, score: this.score,
      moving: { start, end: start + this.width, dir }, tick,
      ...(this.overReason ? { overReason: this.overReason } : {}),
    };
  }
  drop(): StackerState {
    if (this.over) return this.state();
    const tick = this.currentTick();
    const { start } = this.posAt(tick);
    const cur: Span = { start, end: start + this.width };
    const prev: Span = this.spans.length ? this.spans[this.spans.length - 1] : { start: 0, end: GRID_W };
    const s = Math.max(cur.start, prev.start), e = Math.min(cur.end, prev.end);
    if (e <= s) { this.over = true; this.overReason = "missed_the_tower"; this.snaps.push(this.state()); return this.state(); }
    this.spans.push({ start: s, end: e });
    this.width = e - s;
    this.score += this.width * 10 + this.spans.length; // narrower = harder, still pays width*10 + row bonus
    this.startedAt = this.now(); // restart slide for the next row from tick 0
    this.tickCount = 0;
    if (this.spans.length >= GRID_H) { this.over = true; this.overReason = "tower_complete"; }
    this.snaps.push(this.state());
    return this.state();
  }
  act(action: string): StackerState {
    if (action !== "drop") throw new Error("unknown_action");
    this.log.push({ atMs: this.now() - this.bornAt, action });
    return this.drop();
  }
  snapshots(): StackerState[] { return this.snaps; }
  actionLog(): { atMs: number; action: string }[] { return this.log; }
  get isOver() { return this.over; }
  get finalScore() { return this.score; }
}
export const STACKER_MANIFEST = {
  slug: "stacker", title: "BLOCK STACKER", priceAtomic: "250000", asset: "USDC",
  tickMs: TICK_MS, maxDurationSeconds: 600,
  actions: ["drop"] as const,
  stateDescription: "spans: locked rows [start,end); moving: current sliding block; score; level = rows locked",
  license: "Original — COINOP",
};
