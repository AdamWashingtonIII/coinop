// Thermonuclear War — the WarGames feature cabinet (ADR 0011). Turn-based
// global strategy against the house computer: 6 cities a side, missile silos,
// warhead/interceptor stockpiles, and a DEFCON meter that escalates with every
// exchange. One action per turn; the house answers from a seeded policy, so a
// run is fully determined by its seed + action log (replayable, and the seed
// commitment is published from frame one like Snake). Standing down on turn 1,
// before any launch, ends the game the way the film taught: the only winning
// move is not to play.
import { createHash } from "crypto";
export const TN_MAX_TURNS = 24;
export const TN_PEACE_BONUS = 15;
export const TN_VICTORY_BONUS = 25;
export const TN_NO_PLAY_SCORE = 45;
export interface TnCity { name: string; pop: number; alive: boolean }
export interface TnSide { cities: TnCity[]; silos: number; warheads: number; interceptors: number }
export interface TnLaunch { side: "you" | "foe"; target: string; kind: "city" | "silo"; result: "destroyed" | "intercepted" | "silo_hit" }
export interface ThermonuclearState {
  slug: "thermonuclear"; status: "playing" | "over";
  turn: number; maxTurns: number; defcon: number;
  you: TnSide; foe: TnSide;
  score: number; outcome?: string;
  lastEvents: string[]; lastLaunches: TnLaunch[];
  seedCommit: string;
}
const YOUR_CITIES: [string, number][] = [["New York", 8], ["Los Angeles", 6], ["Chicago", 5], ["Houston", 4], ["Seattle", 3], ["Denver", 2]];
const FOE_CITIES: [string, number][] = [["Moscow", 8], ["Leningrad", 6], ["Kiev", 5], ["Minsk", 4], ["Vladivostok", 3], ["Novosibirsk", 2]];
export const TN_ACTIONS = [
  "hold", "stand_down", "build_warheads", "build_interceptors", "launch_silo",
  ...YOUR_CITIES.map((_, i) => "launch_city_" + i),
  ...YOUR_CITIES.map((_, i) => "defend_city_" + i),
] as const;
type Move = { type: "launch_city"; idx: number } | { type: "launch_silo" } | { type: "defend"; idx: number }
  | { type: "build_warheads" } | { type: "build_interceptors" } | { type: "hold" };
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const mkSide = (defs: [string, number][]): TnSide => ({
  cities: defs.map(([name, pop]) => ({ name, pop, alive: true })), silos: 3, warheads: 10, interceptors: 4,
});
const survivingPop = (s: TnSide) => s.cities.reduce((a, c) => a + (c.alive ? c.pop : 0), 0);
const destroyedPop = (s: TnSide) => s.cities.reduce((a, c) => a + (c.alive ? 0 : c.pop), 0);
const biggestAlive = (s: TnSide) => s.cities.reduce((best, c, i) => (c.alive && (best < 0 || c.pop > s.cities[best].pop) ? i : best), -1);
export class ThermonuclearGame {
  readonly slug = "thermonuclear" as const;
  private you = mkSide(YOUR_CITIES);
  private foe = mkSide(FOE_CITIES);
  private turn = 0;
  private totalLaunches = 0;
  private over = false;
  private outcome: string | undefined;
  private final = 0;
  private lastEvents: string[] = ["GREETINGS. SHALL WE PLAY A GAME?"];
  private lastLaunches: TnLaunch[] = [];
  private rng: () => number;
  private seedValue: number;
  readonly seedCommitment: string;
  private bornAt: number;
  private snaps: ThermonuclearState[] = [];
  private log: { atMs: number; action: string }[] = [];
  constructor(private now: () => number = Date.now, seed = Math.floor(Math.random() * 2 ** 31)) {
    this.seedValue = seed;
    this.seedCommitment = createHash("sha256").update("coinop-thermonuclear-seed:" + seed).digest("hex");
    this.rng = mulberry32(seed);
    this.bornAt = now();
    this.snaps.push(this.snapshot());
  }
  private get defcon() { return Math.max(1, 5 - Math.floor(this.totalLaunches / 2)); }
  private liveScore() { return destroyedPop(this.foe) + survivingPop(this.you); }
  private houseAcceptsPeace(): boolean {
    return survivingPop(this.foe) < survivingPop(this.you) || this.defcon <= 2 || this.turn >= 16;
  }
  private houseMove(): Move {
    const foe = this.foe, you = this.you;
    const defendBiggest = (): Move => {
      const idx = biggestAlive(foe);
      return foe.interceptors > 0 && idx >= 0 ? { type: "defend", idx } : { type: "build_warheads" };
    };
    if (foe.warheads <= 0) {
      const r = this.rng();
      if (r < 0.7) return { type: "build_warheads" };
      if (r < 0.85) return { type: "build_interceptors" };
      return defendBiggest();
    }
    const r = this.rng();
    if (r < 0.5) {
      if (this.rng() < 0.65 || you.silos <= 0) {
        const idx = biggestAlive(you);
        if (idx >= 0) return { type: "launch_city", idx };
      }
      return { type: "launch_silo" };
    }
    if (r < 0.7) return defendBiggest();
    if (r < 0.9) return { type: "build_warheads" };
    return { type: "build_interceptors" };
  }
  private resolveTurn(p: Move | null, h: Move): void {
    const events: string[] = [];
    const launches: TnLaunch[] = [];
    const youShield = p?.type === "defend" ? p.idx : -1;
    const foeShield = h.type === "defend" ? h.idx : -1;
    if (youShield >= 0) { this.you.interceptors--; events.push(`YOU SHIELD ${this.you.cities[youShield].name.toUpperCase()}`); }
    if (foeShield >= 0) { this.foe.interceptors--; events.push(`RED SHIELDS ${this.foe.cities[foeShield].name.toUpperCase()}`); }
    // Launches consume warheads first; builds land after, so fresh stock can't fire the same turn.
    const fire = (side: "you" | "foe", mv: Move | null) => {
      if (!mv || (mv.type !== "launch_city" && mv.type !== "launch_silo")) return;
      const atk = side === "you" ? this.you : this.foe;
      const def = side === "you" ? this.foe : this.you;
      atk.warheads--;
      this.totalLaunches++;
      if (mv.type === "launch_silo") {
        if (def.silos > 0) {
          def.silos--; def.warheads = Math.max(0, def.warheads - 3);
          launches.push({ side, target: "SILO", kind: "silo", result: "silo_hit" });
          events.push(`${side === "you" ? "YOU" : "RED"} HIT A ${side === "you" ? "RED" : "YOUR"} SILO (-3 WARHEADS)`);
        } else events.push(`${side === "you" ? "YOUR" : "RED"} MISSILE FOUND NO SILO`);
        return;
      }
      const city = def.cities[mv.idx];
      const shield = side === "you" ? foeShield : youShield;
      if (shield === mv.idx) {
        launches.push({ side, target: city.name, kind: "city", result: "intercepted" });
        events.push(`${city.name.toUpperCase()} INTERCEPTED`);
      } else {
        city.alive = false;
        launches.push({ side, target: city.name, kind: "city", result: "destroyed" });
        events.push(`${city.name.toUpperCase()} DESTROYED (${city.pop}M)`);
      }
    };
    fire("you", p);
    fire("foe", h);
    const build = (s: TnSide, mv: Move | null, who: string) => {
      if (mv?.type === "build_warheads") { s.warheads += 3; events.push(`${who} BUILT +3 WARHEADS`); }
      if (mv?.type === "build_interceptors") { s.interceptors += 2; events.push(`${who} BUILT +2 INTERCEPTORS`); }
    };
    build(this.you, p, "YOU");
    build(this.foe, h, "RED");
    this.lastLaunches = launches;
    this.lastEvents = events.length ? events : ["A QUIET TURN"];
    // End conditions.
    const youDead = this.you.cities.every((c) => !c.alive);
    const foeDead = this.foe.cities.every((c) => !c.alive);
    if (youDead && foeDead) this.finish("mutual_destruction", this.liveScore());
    else if (foeDead) this.finish("victory", this.liveScore() + TN_VICTORY_BONUS);
    else if (youDead) this.finish("defeat", this.liveScore());
    else if (this.turn >= TN_MAX_TURNS) this.finish("ceasefire", this.liveScore());
  }
  private finish(outcome: string, score: number): void {
    this.over = true; this.outcome = outcome; this.final = score;
  }
  private parse(action: string): Move | "stand_down" {
    if (action === "stand_down") return "stand_down";
    if (action === "hold") return { type: "hold" };
    if (action === "build_warheads") return { type: "build_warheads" };
    if (action === "build_interceptors") return { type: "build_interceptors" };
    if (action === "launch_silo") {
      if (this.you.warheads <= 0) throw new Error("illegal_move");
      if (this.foe.silos <= 0) throw new Error("illegal_move");
      return { type: "launch_silo" };
    }
    const lc = /^launch_city_([0-5])$/.exec(action);
    if (lc) {
      if (this.you.warheads <= 0) throw new Error("illegal_move");
      if (!this.foe.cities[Number(lc[1])].alive) throw new Error("illegal_move");
      return { type: "launch_city", idx: Number(lc[1]) };
    }
    const dc = /^defend_city_([0-5])$/.exec(action);
    if (dc) {
      if (this.you.interceptors <= 0) throw new Error("illegal_move");
      if (!this.you.cities[Number(dc[1])].alive) throw new Error("illegal_move");
      return { type: "defend", idx: Number(dc[1]) };
    }
    throw new Error("unknown_action");
  }
  private snapshot(): ThermonuclearState {
    const cp = (s: TnSide): TnSide => ({ cities: s.cities.map((c) => ({ ...c })), silos: s.silos, warheads: s.warheads, interceptors: s.interceptors });
    return { slug: "thermonuclear", status: this.over ? "over" : "playing",
      turn: this.turn, maxTurns: TN_MAX_TURNS, defcon: this.defcon,
      you: cp(this.you), foe: cp(this.foe),
      score: this.over ? this.final : this.liveScore(),
      ...(this.outcome ? { outcome: this.outcome } : {}),
      lastEvents: [...this.lastEvents], lastLaunches: this.lastLaunches.map((l) => ({ ...l })),
      seedCommit: this.seedCommitment };
  }
  state(): ThermonuclearState { return this.snapshot(); }
  act(action: string): ThermonuclearState {
    if (this.over) throw new Error("game_over");
    const mv = this.parse(action);
    this.log.push({ atMs: this.now() - this.bornAt, action });
    this.turn++;
    if (mv === "stand_down") {
      if (this.turn === 1 && this.totalLaunches === 0) {
        this.lastEvents = ["YOU DECLINE TO PLAY.", "WINNER: NONE"];
        this.lastLaunches = [];
        this.finish("the_only_winning_move", TN_NO_PLAY_SCORE);
      } else if (this.houseAcceptsPeace()) {
        this.lastEvents = ["RED ACCEPTS THE STAND-DOWN.", "THE WAR ENDS WITHOUT A LOSER"];
        this.lastLaunches = [];
        this.finish("peace", survivingPop(this.you) + TN_PEACE_BONUS);
      } else {
        this.lastEvents = ["RED REJECTS YOUR STAND-DOWN OFFER"];
        this.resolveTurn(null, this.houseMove());
        this.lastEvents = ["RED REJECTS YOUR STAND-DOWN OFFER", ...this.lastEvents];
      }
    } else {
      this.resolveTurn(mv, this.houseMove());
    }
    const st = this.snapshot();
    this.snaps.push(st);
    return st;
  }
  revealSeed(): string { return String(this.seedValue); }
  snapshots(): ThermonuclearState[] { return this.snaps; }
  actionLog(): { atMs: number; action: string }[] { return this.log; }
  get isOver() { return this.over; }
  get finalScore() { return this.over ? this.final : this.liveScore(); }
}
export const THERMONUCLEAR_MANIFEST = {
  slug: "thermonuclear", title: "THERMONUCLEAR WAR", priceAtomic: "250000", asset: "USDC",
  tickMs: 0, maxDurationSeconds: 600,
  actions: [...TN_ACTIONS],
  stateDescription: "you/foe: cities (name, pop in millions, alive), silos, warheads, interceptors; turn 1-24; defcon 5-1 escalates every 2 launches; one action per turn, the house answers immediately; score = enemy pop destroyed + your surviving pop (+25 victory, peace pays surviving +15)",
  license: "Original — COINOP",
};
