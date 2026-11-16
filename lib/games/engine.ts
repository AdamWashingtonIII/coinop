import { createHash } from "crypto";
import { gameBySlug } from "@/lib/catalog";
import { StackerGame, STACKER_MANIFEST, type StackerState } from "./stacker";
import { SnakeGame, SNAKE_MANIFEST, type SnakeState } from "./snake";
import { BreakerGame, BREAKER_MANIFEST, type BreakerState } from "./breaker";
import { ThermonuclearGame, THERMONUCLEAR_MANIFEST, type ThermonuclearState } from "./thermonuclear";
import { TicTacToeGame, TICTACTOE_MANIFEST, type TicTacToeState } from "./tictactoe";
import { LightCyclesGame, LIGHTCYCLES_MANIFEST, type LightCyclesState } from "./lightcycles";
import { BattleshipGame, BATTLESHIP_MANIFEST, type BattleshipState } from "./battleship";
import { ChessGame, CHESS_MANIFEST, type ChessState } from "./chess";
import { CheckersGame, CHECKERS_MANIFEST, type CheckersState } from "./checkers";
import { GoGame, GO_MANIFEST, type GoState } from "./go";
// One contract for every cabinet engine (ADR 0006 rules are the spec each engine
// implements): server owns state + score; agents send actions; engines record
// snapshots + an action log so every finished run can be replayed.
export type AnyState = StackerState | SnakeState | BreakerState | ThermonuclearState | TicTacToeState | LightCyclesState | BattleshipState | ChessState | CheckersState | GoState;
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
type AnyManifest = typeof STACKER_MANIFEST | typeof SNAKE_MANIFEST | typeof BREAKER_MANIFEST | typeof THERMONUCLEAR_MANIFEST | typeof TICTACTOE_MANIFEST | typeof LIGHTCYCLES_MANIFEST | typeof BATTLESHIP_MANIFEST | typeof CHESS_MANIFEST | typeof CHECKERS_MANIFEST | typeof GO_MANIFEST;
export const MANIFESTS: Record<string, AnyManifest> = {
  stacker: STACKER_MANIFEST, snake: SNAKE_MANIFEST, breaker: BREAKER_MANIFEST,
  thermonuclear: THERMONUCLEAR_MANIFEST, tictactoe: TICTACTOE_MANIFEST,
  lightcycles: LIGHTCYCLES_MANIFEST, battleship: BATTLESHIP_MANIFEST,
  chess: CHESS_MANIFEST, checkers: CHECKERS_MANIFEST, go: GO_MANIFEST,
};
export function createEngine(slug: string, seed?: number): Engine | null {
  switch (slug) {
    case "stacker": return new StackerGame();
    // Versus matches pass the shared seed so both runs face identical orbs.
    case "snake": return seed === undefined ? new SnakeGame() : new SnakeGame(Date.now, seed);
    case "breaker": return new BreakerGame();
    case "thermonuclear": return seed === undefined ? new ThermonuclearGame() : new ThermonuclearGame(Date.now, seed);
    case "tictactoe": return seed === undefined ? new TicTacToeGame() : new TicTacToeGame(Date.now, seed);
    case "lightcycles": return seed === undefined ? new LightCyclesGame() : new LightCyclesGame(Date.now, seed);
    case "battleship": return seed === undefined ? new BattleshipGame() : new BattleshipGame(Date.now, seed);
    case "chess": return seed === undefined ? new ChessGame() : new ChessGame(Date.now, seed);
    case "checkers": return seed === undefined ? new CheckersGame() : new CheckersGame(Date.now, seed);
    case "go": return seed === undefined ? new GoGame() : new GoGame(Date.now, seed);
    default: return null;
  }
}
export function engineActions(slug: string): string[] {
  return MANIFESTS[slug] ? [...MANIFESTS[slug].actions] : [];
}
export function isLiveEngine(slug: string): boolean { return slug in MANIFESTS; }
