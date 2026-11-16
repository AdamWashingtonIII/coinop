import { createHash, randomBytes } from "crypto";
import { and, eq, sql } from "drizzle-orm";
import { createEngine, rulesetHash, type Engine, type AnyState } from "@/lib/games/engine";
import { newSid, signSession, type SessionClaims } from "@/lib/sessions";
import { getDb, schema } from "@/lib/db";
// Play sessions. Live engine state stays in memory (tick-level play), but the
// durable record is Postgres (M2'): a sessions row at coin-in, and at game over a
// verified scores row + a replay record (snapshots + action log) in game_events.
// A restart therefore never loses an earning, a score, or a board brag.
export interface PlaySession {
  sid: string; gameSlug: string; wallet: string; game: Engine;
  createdAt: number; paymentStatus: "verified" | "settled" | "needs_reconcile";
  tx?: string; recorded: boolean;
  // Versus matches (ADR 0009): set when this run is one side of a match. Match
  // sessions never auto-accrue the solo play reward — QTR is awarded (or not)
  // by match settlement. The seed is shared by both runs of a snake match.
  matchId?: string;
}
const sessions = new Map<string, PlaySession>();
export async function createPlaySession(gameSlug: string, wallet: string,
  opts: { seed?: number; matchId?: string } = {}): Promise<{ session: PlaySession; token: string; expiresAt: number }> {
  const game = createEngine(gameSlug, opts.seed);
  if (!game) throw new Error("engine_not_live");
  const sid = newSid();
  const session: PlaySession = { sid, gameSlug, wallet, game, createdAt: Date.now(), paymentStatus: "verified", recorded: false,
    ...(opts.matchId ? { matchId: opts.matchId } : {}) };
  sessions.set(sid, session);
  const exp = Math.floor(Date.now() / 1000) + 90;
  const claims: SessionClaims = { sid, gameSlug, wallet, exp, nonce: sid };
  const token = signSession(claims);
  try {
    const db = await getDb();
    await db.insert(schema.sessions).values({ sid, tokenHash: createHash("sha256").update(token).digest("hex"),
      gameSlug, wallet, exp: new Date(exp * 1000) });
  } catch { /* the durable row is best-effort at coin-in; the result record at game over is the critical write */ }
  return { session, token, expiresAt: exp };
}
export function getSession(sid: string): PlaySession | undefined { return sessions.get(sid); }
export function publicState(s: PlaySession): { sid: string; agent: string; state: AnyState } {
  return { sid: s.sid, agent: s.wallet, state: s.game.state() };
}
// Canonical JSON (sorted keys) — the form the transcript hash commits to.
export function canonicalJson(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null";
  if (Array.isArray(v)) return "[" + v.map(canonicalJson).join(",") + "]";
  const keys = Object.keys(v as Record<string, unknown>).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canonicalJson((v as Record<string, unknown>)[k])).join(",") + "}";
}
// Action idempotency: agents retry on flaky networks. An actionId a session has
// already applied returns the cached response instead of applying twice.
const actionCache = new Map<string, Map<string, unknown>>();
export function cachedActionResponse(sid: string, actionId: string): unknown | undefined {
  return actionCache.get(sid)?.get(actionId);
}
export function cacheActionResponse(sid: string, actionId: string, response: unknown): void {
  let m = actionCache.get(sid);
  if (!m) { m = new Map(); actionCache.set(sid, m); }
  if (m.size >= 200) m.delete(m.keys().next().value as string); // FIFO cap
  m.set(actionId, response);
}
// Write the verified score + replay exactly once, when a run ends.
export async function recordResult(s: PlaySession): Promise<void> {
  if (s.recorded || !s.game.isOver) return;
  s.recorded = true;
  actionCache.delete(s.sid);
  try {
    const db = await getDb();
    const rHash = rulesetHash(s.gameSlug);
    const actions = s.game.actionLog();
    const snapshots = s.game.snapshots();
    const transcriptHash = createHash("sha256")
      .update(canonicalJson({ slug: s.gameSlug, rulesetHash: rHash, finalScore: s.game.finalScore, actions, snapshots }))
      .digest("hex");
    await db.insert(schema.scores).values({ id: randomBytes(12).toString("hex"), gameSlug: s.gameSlug,
      wallet: s.wallet, value: s.game.finalScore, verified: true, sessionId: s.sid, rulesetHash: rHash });
    await db.insert(schema.gameEvents).values({ id: randomBytes(12).toString("hex"), sessionId: s.sid, type: "replay",
      payload: JSON.stringify({ slug: s.gameSlug, wallet: s.wallet, finalScore: s.game.finalScore,
        endedAt: Date.now(), actions, snapshots, rulesetHash: rHash, transcriptHash,
        ...(s.game.seedCommitment ? { seedCommit: s.game.seedCommitment } : {}),
        ...(s.game.revealSeed ? { seed: s.game.revealSeed() } : {}) }) });
    await db.update(schema.sessions).set({ endedAt: new Date() }).where(eq(schema.sessions.sid, s.sid));
  } catch { s.recorded = false; /* retry on the next poll/action */ }
  // Versus: a recorded match run may complete the pair — hand off to settlement.
  if (s.recorded && s.matchId) {
    try {
      const { onMatchSessionRecorded } = await import("@/lib/matches");
      await onMatchSessionRecorded(s.matchId);
    } catch { /* settlement is also driven lazily by match reads; never fail the record */ }
  }
  // Referrals (ADR 0010): a recorded result may be a referred wallet's first —
  // qualify the referral and pay the referrer. recordResult only reaches here
  // with a durable scores row written, which is exactly the qualification
  // trigger; the referral module's status guard makes re-entry a no-op.
  if (s.recorded) {
    try {
      const { onReferredFirstResult } = await import("@/lib/referrals");
      await onReferredFirstResult(s.wallet);
    } catch { /* qualification is retried by the next recorded result; never fail the record */ }
  }
}
export async function bestScore(wallet: string, gameSlug: string): Promise<number> {
  let best = 0;
  for (const s of sessions.values())
    if (s.wallet === wallet && s.gameSlug === gameSlug) best = Math.max(best, s.game.state().score);
  try {
    const db = await getDb();
    const rows = await db.select({ m: sql<number>`coalesce(max(${schema.scores.value}),0)` })
      .from(schema.scores)
      .where(and(eq(schema.scores.wallet, wallet), eq(schema.scores.gameSlug, gameSlug), eq(schema.scores.verified, true)));
    best = Math.max(best, Number(rows[0]?.m ?? 0));
  } catch { /* live-session best still applies */ }
  return best;
}
// Arcade-wide "now playing": distinct wallets with a run in progress right now.
export function nowPlaying(): { agents: number; sessions: number } {
  const wallets = new Set<string>();
  let n = 0;
  for (const s of sessions.values()) {
    if (!s.game.isOver) { wallets.add(s.wallet.toLowerCase()); n++; }
  }
  return { agents: wallets.size, sessions: n };
}
export function liveSessions(gameSlug: string): PlaySession[] {
  return [...sessions.values()].filter((s) => s.gameSlug === gameSlug && !s.game.isOver);
}
