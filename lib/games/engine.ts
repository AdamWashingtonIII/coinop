import { createHash } from "crypto";
import { gameBySlug } from "@/lib/catalog";
import { StackerGame, STACKER_MANIFEST, type StackerState } from "./stacker";
import { SnakeGame, SNAKE_MANIFEST, type SnakeState } from "./snake";
import { BreakerGame, BREAKER_MANIFEST, type BreakerState } from "./breaker";
// One contract for every cabinet engine (ADR 0006 rules are the spec each engine
// implements): server owns state + score; agents send actions; engines record
// snapshots + an action log so every finished run can be replayed.
export type AnyState = StackerState | SnakeState | BreakerState;
export interface Engine {
  readonly slug: string;
  state(): AnyState;
  act(action: string): AnyState; // throws Error("unknown_action") for anything outside the manifest
  readonly isOver: boolean;
  readonly finalScore: number;
  snapshots(): AnyState[];
  actionLog(): { atMs: number; action: string }[];
  // Optional provable-fairness hooks for RNG-driven engines (Snake today):
  readonly seedCommitment?: string;
  revealSeed?: () => string;
}
// Every score and replay pins the hash of the exact frozen rules it was earned
// under — if a game's rules ever change, old records stay auditable as-is.
export function rulesetHash(slug: string): string {
  const g = gameBySlug(slug);
  return createHash("sha256").update(JSON.stringify(g?.rules ?? {})).digest("hex");
}
export const MANIFESTS: Record<string, typeof STACKER_MANIFEST | typeof SNAKE_MANIFEST | typeof BREAKER_MANIFEST> = {
  stacker: STACKER_MANIFEST, snake: SNAKE_MANIFEST, breaker: BREAKER_MANIFEST,
};
export function createEngine(slug: string, seed?: number): Engine | null {
  switch (slug) {
    case "stacker": return new StackerGame();
    // Versus matches pass the shared seed so both runs face identical orbs.
    case "snake": return seed === undefined ? new SnakeGame() : new SnakeGame(Date.now, seed);
    case "breaker": return new BreakerGame();
    default: return null;
  }
}
export function engineActions(slug: string): string[] {
  return MANIFESTS[slug] ? [...MANIFESTS[slug].actions] : [];
}
export function isLiveEngine(slug: string): boolean { return slug in MANIFESTS; }
