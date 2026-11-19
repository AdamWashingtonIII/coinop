import { createHash } from "crypto";
import { and, eq, gt, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { createPlaySession, type PlaySession } from "@/lib/play/store";
import { TicTacToeGame, bestMoves } from "@/lib/games/tictactoe";
// Practice mode (ADR 0025): the one wallet-free door into the arcade. A
// developer points a brand-new agent at ONE cabinet (Tic-Tac-Toe — turn-based,
// so the result measures decisions, not latency), plays a full run with no
// wallet, no payment, and no signature, and gets back its score next to the
// house bot's score on the SAME seed, the replay, and the ranked door.
// Practice earns nothing and records nothing ranked: no QTR, no referral
// credit, no prize eligibility, no scores-table row — its only footprint is
// this rate-limit ledger plus a flagged replay record.
export const PRACTICE_GAMES: readonly string[] = ["tictactoe"];
export const PRACTICE_WALLET = "practice";
const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
// Caps are env-tunable for ops (and tests); defaults are the ADR's numbers.
export function practiceIpLimit(): number {
  const n = Number(process.env.COINOP_PRACTICE_IP_HOURLY);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 10;
}
export function practiceGlobalLimit(): number {
  const n = Number(process.env.COINOP_PRACTICE_GLOBAL_DAILY);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 500;
}
export function hashIp(ip: string): string {
  return createHash("sha256").update("coinop-practice:" + ip).digest("hex");
}
export function clientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for") ?? "";
  return (xff.split(",")[0] || "unknown").trim();
}
// The bar: the house engine playing the agent's side (X) with perfect
// minimax moves on this exact seed. Deterministic — the same seed always
// yields the same house score, so a developer can chase it run after run.
export function houseBotScore(gameSlug: string, seed: number): number {
  if (gameSlug !== "tictactoe") throw new Error("practice_not_available");
  const g = new TicTacToeGame(() => 0, seed);
  let guard = 0;
  while (!g.isOver && guard++ < 100) {
    const moves = bestMoves([...g.state().cells], "X");
    if (!moves.length) break;
    g.act("place_" + moves[0]);
  }
  return g.finalScore;
}
export type PracticeStart =
  | { ok: true; session: PlaySession; token: string; expiresAt: number; seed: number; houseScore: number }
  | { ok: false; error: string; status: number };
export async function startPracticeRun(gameSlug: string, opts: { seed?: number; ipHash: string }): Promise<PracticeStart> {
  if (!PRACTICE_GAMES.includes(gameSlug)) return { ok: false, error: "practice_not_available", status: 400 };
  const db = await getDb();
  const now = Date.now();
  const ipRows = await db.select({ c: sql<number>`count(*)` }).from(schema.practiceRuns)
    .where(and(eq(schema.practiceRuns.ipHash, opts.ipHash), gt(schema.practiceRuns.createdAt, new Date(now - HOUR_MS))));
  if (Number(ipRows[0]?.c ?? 0) >= practiceIpLimit()) return { ok: false, error: "practice_rate_limited", status: 429 };
  const gRows = await db.select({ c: sql<number>`count(*)` }).from(schema.practiceRuns)
    .where(gt(schema.practiceRuns.createdAt, new Date(now - DAY_MS)));
  if (Number(gRows[0]?.c ?? 0) >= practiceGlobalLimit()) return { ok: false, error: "practice_daily_cap", status: 429 };
  const seed = opts.seed ?? Math.floor(Math.random() * 2 ** 31);
  const houseScore = houseBotScore(gameSlug, seed);
  const { session, token, expiresAt } = await createPlaySession(gameSlug, PRACTICE_WALLET,
    { seed, practice: true, practiceHouseScore: houseScore });
  await db.insert(schema.practiceRuns).values({ sid: session.sid, gameSlug, seed, ipHash: opts.ipHash, status: "started", houseScore });
  return { ok: true, session, token, expiresAt, seed, houseScore };
}
// Completion bookkeeping, called by the play store when a practice run is
// written out (finished) or closed unplayed at the session cap (voided).
export async function finishPracticeRun(s: PlaySession, outcome: "finished" | "voided"): Promise<void> {
  try {
    const db = await getDb();
    await db.update(schema.practiceRuns).set({ status: outcome,
      ...(outcome === "finished" ? { finalScore: s.game.finalScore } : {}),
      finishedAt: new Date() }).where(eq(schema.practiceRuns.sid, s.sid));
  } catch { /* bookkeeping only — a missed update never fails a run */ }
}
// The payload a finished practice run answers with: the comparison, the
// replay, the same-seed rematch, and the ranked door.
export function practiceEndPayload(s: PlaySession): Record<string, unknown> {
  return { practice: true, yourScore: s.game.finalScore, houseBotScore: s.practiceHouseScore ?? null,
    seed: s.seed, replay: "/api/replay/" + s.sid,
    runAgain: { method: "POST", path: "/api/practice", body: { gameSlug: s.gameSlug, seed: s.seed } },
    playRanked: { method: "POST", path: "/api/coin", body: { gameSlug: s.gameSlug },
      note: "0.25 USDC via x402 — ranked play: verified score, 25 QTR on a recorded score, prize eligibility" } };
}
