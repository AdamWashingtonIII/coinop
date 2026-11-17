// Grand Prix — server-authoritative engine (original COINOP implementation of
// an open-wheel circuit racer): 3 laps of a seeded circuit against 5 house
// drivers. The agent holds persistent controls — LEFT / RIGHT / CENTER set the
// steering, ACCELERATE / BRAKE / COAST set the pedal — and the race runs in
// real time (wall-clock driven, like Snake and Light Cycles): state()/act()
// advance the sim to "now" in fixed 100ms steps. Curves throw the car toward
// the outside, the grass caps speed hard, and trading paint with a rival is a
// crash. Everything derives from the seed (track shape, rival pace and lanes),
// so a run is fully determined by seed + action log + clock (ADR 0014) and
// replays exactly.
import { createHash } from "crypto";
export const GP_TICK_MS = 100;
export const GP_LAPS = 3;
export const GP_RIVALS = 5;
export const GP_SAMPLES = 480; // track samples per lap
export const GP_SAMPLE_M = 10; // metres per sample -> lap = 4,800
export const GP_LAP_M = GP_SAMPLES * GP_SAMPLE_M;
export const GP_MAX_SPEED = 118; // units/s on tarmac
export const GP_OFFTRACK_MAX = 46;
export const GP_RACE_CAP_MS = 360_000; // 6 minutes, then the race is scored as-is
export const GP_ACTIONS = ["left", "right", "center", "accelerate", "brake", "coast"] as const;
const RIVAL_COLORS = ["#ff2e63", "#ffb02e", "#4da3ff", "#b26bff", "#7dff2e"];
const CAR_LEN = 16;
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
export interface GpRivalView { id: number; relS: number; lat: number; kmh: number; color: string }
export interface GpRoadSample { dx: number; curve: number }
export interface GrandPrixState {
  slug: "grandprix"; status: "playing" | "over";
  score: number; kmh: number; speed: number; lat: number;
  steer: -1 | 0 | 1; throttle: -1 | 0 | 1;
  lap: number; laps: number; position: number;
  raceMs: number; lapMs: number; lastLapMs: number | null; bestLapMs: number | null;
  lapTimes: number[]; overtakes: number; crashes: number; offTrack: boolean;
  finished: boolean; outcome?: string; finalPosition?: number;
  rivals: GpRivalView[]; road: GpRoadSample[];
  seedCommit: string;
}
interface Rival { total: number; lat: number; speed: number; base: number; lane: number; phase: number; ahead: boolean }
export class GrandPrixGame {
  readonly slug = "grandprix" as const;
  private curveArr: number[] = [];
  private centerArr: number[] = [];
  private total = 0; // player distance raced (unwrapped)
  private lat = 0;
  private speed = 0;
  private steer: -1 | 0 | 1 = 0;
  private throttle: -1 | 0 | 1 = 0;
  private rivals: Rival[] = [];
  private overtakes = 0;
  private crashes = 0;
  private lastCrashAt = -10_000;
  private tickCount = 0;
  private lapStartTick = 0;
  private lapTimes: number[] = [];
  private finished = false;
  private over = false;
  private outcome: string | undefined;
  private finalPosition: number | undefined;
  private bornAt: number;
  private lastTickAt: number;
  private seedValue: number;
  readonly seedCommitment: string;
  private snaps: GrandPrixState[] = [];
  private log: { atMs: number; action: string }[] = [];
  constructor(private now: () => number = Date.now, seed = Math.floor(Math.random() * 2 ** 31)) {
    this.seedValue = seed;
    this.seedCommitment = createHash("sha256").update("coinop-grandprix-seed:" + seed).digest("hex");
    const rng = mulberry32(seed);
    // Circuit: 5-7 corner impulses of random sign/strength around the loop,
    // smoothed into a closed curve profile; the centre line integrates it.
    const corners = 5 + Math.floor(rng() * 3);
    const raw = new Array(GP_SAMPLES).fill(0) as number[];
    for (let c = 0; c < corners; c++) {
      const at = Math.floor(rng() * GP_SAMPLES);
      const strength = (0.45 + rng() * 0.75) * (rng() < 0.5 ? -1 : 1);
      const width = 9 + Math.floor(rng() * 10);
      for (let k = -width; k <= width; k++) {
        const i = (at + k + GP_SAMPLES) % GP_SAMPLES;
        raw[i] += strength * Math.cos((k / width) * Math.PI * 0.5) ** 2;
      }
    }
    for (let pass = 0; pass < 3; pass++)
      for (let i = 0; i < GP_SAMPLES; i++)
        raw[i] = (raw[(i + GP_SAMPLES - 1) % GP_SAMPLES] + raw[i] * 2 + raw[(i + 1) % GP_SAMPLES]) / 4;
    let cx = 0;
    for (let i = 0; i < GP_SAMPLES; i++) { this.curveArr.push(raw[i]); cx += raw[i] * GP_SAMPLE_M * 0.055; this.centerArr.push(cx); }
    // Grid: five rivals ahead of the player, quickest at the back of the group.
    for (let r = 0; r < GP_RIVALS; r++) {
      this.rivals.push({
        total: 26 + r * 24, speed: 0, base: 83 + rng() * 21,
        lane: -0.55 + rng() * 1.1, phase: rng() * Math.PI * 2, lat: 0, ahead: true,
      });
      this.rivals[r].lat = this.rivals[r].lane;
    }
    this.bornAt = now(); this.lastTickAt = now();
    this.snaps.push(this.snapshot());
  }
  private sampleAt(dist: number): number {
    const i = Math.floor(dist / GP_SAMPLE_M) % GP_SAMPLES;
    return (i + GP_SAMPLES) % GP_SAMPLES;
  }
  private curveAt(dist: number): number { return this.curveArr[this.sampleAt(dist)]; }
  private position(): number {
    return 1 + this.rivals.filter((r) => r.total > this.total).length;
  }
  private currentScore(): number {
    let s = Math.floor(this.total / 8) + this.overtakes * 25 - this.crashes * 40;
    if (this.finished) {
      const raceSec = Math.floor((this.tickCount * GP_TICK_MS) / 1000);
      s += (GP_RIVALS + 1 - (this.finalPosition ?? this.position())) * 100 + Math.max(0, 900 - raceSec);
    }
    return Math.max(0, s);
  }
  private step(): void {
    if (this.over) return;
    const dt = GP_TICK_MS / 1000;
    this.tickCount++;
    const raceMs = this.tickCount * GP_TICK_MS;
    // --- rivals: pace set by the corner ahead, lanes wobble deterministically
    for (const r of this.rivals) {
      const c = Math.abs(this.curveAt(r.total + 130));
      const target = r.base * (1 - Math.min(0.38, c * 1.05));
      r.speed += Math.max(-34 * dt, Math.min(17 * dt, target - r.speed));
      r.total += r.speed * dt;
      r.lat = r.lane + Math.sin(r.total / 290 + r.phase) * 0.10;
      const wasAhead = r.ahead;
      r.ahead = r.total > this.total;
      if (wasAhead && !r.ahead) this.overtakes++;
    }
    // --- player physics
    const curve = this.curveAt(this.total);
    const offTrack = Math.abs(this.lat) > 1;
    const maxSpeed = offTrack ? GP_OFFTRACK_MAX : GP_MAX_SPEED;
    if (this.throttle === 1) this.speed += (offTrack ? 13 : 26) * dt;
    else if (this.throttle === -1) this.speed -= 46 * dt;
    else this.speed -= 6 * dt;
    if (this.speed > maxSpeed) this.speed = Math.max(maxSpeed, this.speed - 55 * dt);
    if (this.speed < 0) this.speed = 0;
    this.total += this.speed * dt;
    const steerRate = 1.35 * (0.35 + 0.65 * Math.min(1, this.speed / 60));
    const drift = curve * (this.speed / GP_MAX_SPEED) ** 2 * 1.9;
    this.lat += (this.steer * steerRate - drift) * dt;
    if (Math.abs(this.lat) > 1.3) {
      this.lat = Math.sign(this.lat) * 1.3;
      this.speed *= 1 - 0.7 * dt; // scraping the edge scrubs speed
    }
    // --- contact: same stretch of road, same slice of width
    if (raceMs - this.lastCrashAt > 1600) {
      for (const r of this.rivals) {
        let gap = (r.total - this.total) % GP_LAP_M;
        if (gap > GP_LAP_M / 2) gap -= GP_LAP_M;
        if (gap < -GP_LAP_M / 2) gap += GP_LAP_M;
        if (Math.abs(gap) < CAR_LEN - 3 && Math.abs(r.lat - this.lat) < 0.40) {
          this.crashes++;
          this.lastCrashAt = raceMs;
          this.speed = Math.min(this.speed, r.speed * 0.45);
          this.lat += (this.lat >= r.lat ? 1 : -1) * 0.3;
          break;
        }
      }
    }
    // --- laps and the flag
    const lapDone = Math.floor(this.total / GP_LAP_M);
    if (lapDone > this.lapTimes.length) {
      this.lapTimes.push((this.tickCount - this.lapStartTick) * GP_TICK_MS);
      this.lapStartTick = this.tickCount;
      if (lapDone >= GP_LAPS) {
        this.finished = true; this.over = true; this.outcome = "finished";
        this.finalPosition = this.position();
      }
    }
    if (!this.over && raceMs >= GP_RACE_CAP_MS) {
      this.over = true; this.outcome = "time_expired";
      this.finalPosition = this.position();
    }
    if (this.tickCount % 10 === 0 && this.snaps.length < 600) this.snaps.push(this.snapshot());
    if (this.over) this.snaps.push(this.snapshot());
  }
  private advance(): void {
    if (this.over) return;
    let guard = 0;
    while (guard++ < 4000) {
      if (this.now() - this.lastTickAt < GP_TICK_MS) break;
      this.lastTickAt += GP_TICK_MS;
      this.step();
      if (this.over) break;
    }
  }
  private snapshot(): GrandPrixState {
    const raceMs = this.tickCount * GP_TICK_MS;
    const lapIdx = Math.min(GP_LAPS, Math.floor(this.total / GP_LAP_M) + 1);
    const road: GpRoadSample[] = [];
    const base = this.sampleAt(this.total);
    const cx0 = this.centerArr[base];
    const lapDrift = this.centerArr[GP_SAMPLES - 1]; // centre-line drift over one full lap
    for (let k = 0; k < 40; k++) {
      const i = (base + k) % GP_SAMPLES;
      let dx = this.centerArr[i] - cx0;
      if (i < base) dx += lapDrift; // wrapped past the seam into the next lap
      road.push({ dx, curve: this.curveArr[i] });
    }
    return { slug: "grandprix", status: this.over ? "over" : "playing",
      score: this.currentScore(), kmh: Math.round(this.speed * 2.6), speed: Math.round(this.speed * 10) / 10,
      lat: Math.round(this.lat * 100) / 100, steer: this.steer, throttle: this.throttle,
      lap: lapIdx, laps: GP_LAPS, position: this.finished ? (this.finalPosition ?? this.position()) : this.position(),
      raceMs, lapMs: (this.tickCount - this.lapStartTick) * GP_TICK_MS,
      lastLapMs: this.lapTimes.length ? this.lapTimes[this.lapTimes.length - 1] : null,
      bestLapMs: this.lapTimes.length ? Math.min(...this.lapTimes) : null,
      lapTimes: [...this.lapTimes], overtakes: this.overtakes, crashes: this.crashes,
      offTrack: Math.abs(this.lat) > 1, finished: this.finished,
      ...(this.outcome ? { outcome: this.outcome } : {}),
      ...(this.finalPosition !== undefined ? { finalPosition: this.finalPosition } : {}),
      rivals: this.rivals.map((r, i) => {
        let rel = (r.total - this.total) % GP_LAP_M;
        if (rel > GP_LAP_M / 2) rel -= GP_LAP_M;
        if (rel < -GP_LAP_M / 2) rel += GP_LAP_M;
        return { id: i, relS: Math.round(rel), lat: Math.round(r.lat * 100) / 100, kmh: Math.round(r.speed * 2.6), color: RIVAL_COLORS[i] };
      }),
      road, seedCommit: this.seedCommitment };
  }
  state(): GrandPrixState { this.advance(); return this.snapshot(); }
  act(action: string): GrandPrixState {
    if (!(GP_ACTIONS as readonly string[]).includes(action)) throw new Error("unknown_action");
    this.log.push({ atMs: this.now() - this.bornAt, action });
    if (!this.over) {
      if (action === "left") this.steer = -1;
      else if (action === "right") this.steer = 1;
      else if (action === "center") this.steer = 0;
      else if (action === "accelerate") this.throttle = 1;
      else if (action === "brake") this.throttle = -1;
      else if (action === "coast") this.throttle = 0;
    }
    return this.state();
  }
  revealSeed(): string { return String(this.seedValue); }
  snapshots(): GrandPrixState[] { return this.snaps; }
  actionLog(): { atMs: number; action: string }[] { return this.log; }
  get isOver() { this.advance(); return this.over; }
  get finalScore() { this.advance(); return this.currentScore(); }
}
export const GRANDPRIX_MANIFEST = {
  slug: "grandprix", title: "GRAND PRIX", priceAtomic: "250000", asset: "USDC",
  tickMs: GP_TICK_MS, maxDurationSeconds: 600,
  actions: [...GP_ACTIONS],
  stateDescription: "3-lap circuit race vs 5 seeded house drivers. Controls are persistent: left/right/center set steering, accelerate/brake/coast set the pedal, until changed. state: speed + kmh, lat (-1..1 tarmac, beyond is grass), lap/position, lapMs/lastLapMs/bestLapMs, overtakes, crashes, offTrack, rivals[{relS metres ahead of you (wrapped), lat, kmh}], road[40 samples ahead: dx centre offset, curve]. Score: +1 per 8 units, +25 per overtake, -40 per crash; finish adds +100 per place above 6th and up to +900 for a fast race. Race clock caps at 6:00.",
  license: "Original — COINOP",
};
