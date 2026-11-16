// FROZEN — spec section 7. Do not extend without an ADR (docs/adr/).
export const BRIDGE_VERSION = 1 as const;
export type HostToGame =
  | { type: "INIT"; slug: string; muted: boolean }
  | { type: "SESSION_GRANTED"; token: string; exp: number }
  | { type: "SESSION_ENDING"; secondsLeft: number }
  | { type: "PAUSE" } | { type: "RESUME" } | { type: "MUTE"; on: boolean };
export type GameToHost =
  | { type: "READY" } | { type: "STARTED" }
  | { type: "SCORE"; value: number }
  | { type: "GAME_OVER"; finalScore: number }
  | { type: "ERROR"; msg: string };
export const HANDSHAKE_TIMEOUT_MS = 3000;
export function isGameMessage(d: unknown): d is GameToHost {
  if (typeof d !== "object" || d === null) return false;
  const t = (d as { type?: unknown }).type;
  return t === "READY" || t === "STARTED" || t === "SCORE" || t === "GAME_OVER" || t === "ERROR";
}
