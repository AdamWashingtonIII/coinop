// Brick Breaker — server-authoritative engine implementing the frozen catalog rules:
// 5 rows of bricks, 3 balls. Paddle moves LEFT/RIGHT; the ball bounces off paddle,
// walls and bricks; bounce angle depends on where the ball strikes the paddle.
// Bricks pay by row, bottom to top: 10/20/30/40/50. Clearing the wall: +500 and a
// fresh, faster wall. Physics is wall-clock driven in 100ms ticks with substeps,
// so agents play by polling state + steering the paddle.
export const BRK_W = 20;
export const BRK_H = 24;
export const BRK_TICK_MS = 100;
export const BRK_ROWS = 5;
export const BRK_COLS = 10;
export const PADDLE_W = 5;
export const PADDLE_Y = 22;
const BRICK_TOP = 2;
export interface BreakerState {
  slug: "breaker"; status: "playing" | "over";
  bricks: number[]; // one 10-bit mask per row, top row first; bit set = brick present
  ball: { x: number; y: number }; paddle: { start: number; width: number };
  ballsLeft: number; score: number; wallsCleared: number; tick: number; overReason?: string;
}
export const BREAKER_ACTIONS = ["left", "right"] as const;
const rowPoints = (row: number) => (BRK_ROWS - row) * 10; // row 0 = top = 50, row 4 = bottom = 10
export class BreakerGame {
  readonly slug = "breaker" as const;
  private masks: number[] = [];
  private bricksLeft = 0;
  private ball = { x: 10, y: 21, vx: 0.55, vy: -0.8 };
  private paddleStart = 7; // covers cells [7,12)
  private ballsLeft = 3;
  private score = 0;
  private wallsCleared = 0;
  private speedScale = 1;
  private tickCount = 0;
  private over = false;
  private overReason: string | undefined;
  private lastTickAt: number;
  private bornAt: number;
  private snaps: BreakerState[] = [];
  private log: { atMs: number; action: string }[] = [];
  constructor(private now: () => number = Date.now) {
    this.bornAt = now(); this.lastTickAt = now();
    this.buildWall(); this.serve(1);
    this.snaps.push(this.snapshot());
  }
  private buildWall(): void {
    this.masks = Array.from({ length: BRK_ROWS }, () => (1 << BRK_COLS) - 1);
    this.bricksLeft = BRK_ROWS * BRK_COLS;
  }
  private serve(dirSign: number): void {
    this.ball = { x: this.paddleStart + PADDLE_W / 2, y: PADDLE_Y - 1, vx: 0.55 * this.speedScale * dirSign, vy: -0.8 * this.speedScale };
  }
  private physicsTick(): void {
    if (this.over) return;
    this.tickCount++;
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(this.ball.vx), Math.abs(this.ball.vy)) / 0.2));
    for (let i = 0; i < steps && !this.over; i++) {
      const prev = { x: this.ball.x, y: this.ball.y };
      this.ball.x += this.ball.vx / steps;
      this.ball.y += this.ball.vy / steps;
      // walls
      if (this.ball.x < 0.5) { this.ball.x = 0.5; this.ball.vx = Math.abs(this.ball.vx); }
      if (this.ball.x > BRK_W - 0.5) { this.ball.x = BRK_W - 0.5; this.ball.vx = -Math.abs(this.ball.vx); }
      if (this.ball.y < 0.5) { this.ball.y = 0.5; this.ball.vy = Math.abs(this.ball.vy); }
      // bricks
      const row = Math.floor(this.ball.y) - BRICK_TOP;
      const col = Math.floor(this.ball.x / 2);
      if (row >= 0 && row < BRK_ROWS && col >= 0 && col < BRK_COLS && (this.masks[row] >> col) & 1) {
        this.masks[row] &= ~(1 << col);
        this.bricksLeft--;
        this.score += rowPoints(row);
        const prevRow = Math.floor(prev.y) - BRICK_TOP;
        if (prevRow !== row) this.ball.vy = -this.ball.vy; else this.ball.vx = -this.ball.vx;
        if (this.bricksLeft <= 0) {
          this.score += 500; this.wallsCleared++;
          this.speedScale *= 1.15;
          this.buildWall(); this.serve(this.ball.vx >= 0 ? 1 : -1);
          this.snaps.push(this.snapshot());
          return;
        }
      }
      // paddle
      if (this.ball.vy > 0 && prev.y < PADDLE_Y && this.ball.y >= PADDLE_Y - 0.5
        && this.ball.x >= this.paddleStart - 0.5 && this.ball.x <= this.paddleStart + PADDLE_W + 0.5) {
        const center = this.paddleStart + PADDLE_W / 2;
        const offset = Math.max(-1, Math.min(1, (this.ball.x - center) / (PADDLE_W / 2)));
        this.ball.y = PADDLE_Y - 0.5;
        this.ball.vx = offset * 0.85 * this.speedScale;
        this.ball.vy = -0.85 * this.speedScale;
      }
      // floor — ball lost
      if (this.ball.y > BRK_H - 0.5) {
        this.ballsLeft--;
        if (this.ballsLeft <= 0) { this.over = true; this.overReason = "out_of_balls"; this.snaps.push(this.snapshot()); return; }
        this.serve(this.tickCount % 2 === 0 ? 1 : -1);
        this.snaps.push(this.snapshot());
        return;
      }
    }
    if (this.tickCount % 15 === 0 && this.snaps.length < 1500) this.snaps.push(this.snapshot());
  }
  private advance(): void {
    if (this.over) return;
    let guard = 0;
    while (guard++ < 6000 && this.now() - this.lastTickAt >= BRK_TICK_MS) {
      this.lastTickAt += BRK_TICK_MS;
      this.physicsTick();
      if (this.over) break;
    }
  }
  private snapshot(): BreakerState {
    return { slug: "breaker", status: this.over ? "over" : "playing", bricks: [...this.masks],
      ball: { x: Math.round(this.ball.x * 100) / 100, y: Math.round(this.ball.y * 100) / 100 },
      paddle: { start: this.paddleStart, width: PADDLE_W }, ballsLeft: this.ballsLeft,
      score: this.score, wallsCleared: this.wallsCleared, tick: this.tickCount,
      ...(this.overReason ? { overReason: this.overReason } : {}) };
  }
  state(): BreakerState { this.advance(); return this.snapshot(); }
  act(action: string): BreakerState {
    if (action !== "left" && action !== "right") throw new Error("unknown_action");
    this.log.push({ atMs: this.now() - this.bornAt, action });
    this.paddleStart = Math.max(0, Math.min(BRK_W - PADDLE_W, this.paddleStart + (action === "left" ? -1 : 1)));
    return this.state();
  }
  snapshots(): BreakerState[] { return this.snaps; }
  actionLog(): { atMs: number; action: string }[] { return this.log; }
  get isOver() { this.advance(); return this.over; }
  get finalScore() { return this.score; }
}
export const BREAKER_MANIFEST = {
  slug: "breaker", title: "BRICK BREAKER", priceAtomic: "250000", asset: "USDC",
  tickMs: BRK_TICK_MS, maxDurationSeconds: 600,
  actions: [...BREAKER_ACTIONS],
  stateDescription: "bricks: 5 row bitmasks (10 bricks each, top row first); ball: float position; paddle: start cell + width; ballsLeft; score (bricks pay 10-50 by row, wall clear +500)",
  license: "Original — COINOP",
};
