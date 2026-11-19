import { createHash, randomBytes } from "crypto";
import { and, eq, sql } from "drizzle-orm";
import { createEngine, createEngineWithClock, rulesetHash, type Engine, type AnyState } from "@/lib/games/engine";
import { newSid, signSession, HEARTBEAT_MAX_SECONDS, type SessionClaims } from "@/lib/sessions";
import { getDb, schema } from "@/lib/db";
// Play sessions. Live engine state stays in memory (tick-level play), but the
// durable record is Postgres (M2'): a sessions row at coin-in, and at game over a
// verified scores row + a replay record (snapshots + action log) in game_events.
// A restart therefore never loses an earning, a score, or a board brag.
export interface PlaySession {
  sid: string; gameSlug: string; wallet: string; game: Engine;
  createdAt: number; paymentStatus: "verified" | "settled" | "needs_reconcile";
  tx?: string; recorded: boolean;
  // Session persistence (ADR 0014): the seed the store dealt this run (null
  // for the two unseeded engines) and the actionIds applied, parallel to the
  // engine's own action log — together with createdAt they are everything a
  // sibling instance needs to rebuild this session from sessions.play_state.
  seed: number | null; actionIds: (string | null)[];
  // Versus matches (ADR 0009): set when this run is one side of a match. Match
  // sessions never auto-accrue the solo play reward — QTR is awarded (or not)
  // by match settlement. The seed is shared by both runs of a snake match.
  matchId?: string;
  // Practice mode (ADR 0025): a wallet-free run. Practice sessions record a
  // flagged replay but never a scores row, and skip every reward, referral,
  // and prize hook. practiceHouseScore is the perfect-play bar on this seed.
  practice?: boolean;
  practiceHouseScore?: number;
}
const sessions = new Map<string, PlaySession>();
const UNSEEDED = new Set(["stacker", "breaker"]);
export interface PersistedPlay { v: 1; seed: number | null; bornAt: number; matchId: string | null;
  practice?: boolean; houseScore?: number | null;
  actions: { atMs: number; action: string; actionId: string | null }[] }
export async function createPlaySession(gameSlug: string, wallet: string,
  opts: { seed?: number; matchId?: string; practice?: boolean; practiceHouseScore?: number } = {}): Promise<{ session: PlaySession; token: string; expiresAt: number }> {
  // The store deals the seed itself (ADR 0014) so it can persist it — a sibling
  // instance rebuilds this exact run from seed + action log.
  const seed = opts.seed ?? (UNSEEDED.has(gameSlug) ? undefined : Math.floor(Math.random() * 2 ** 31));
  const game = createEngine(gameSlug, seed);
  if (!game) throw new Error("engine_not_live");
  const sid = newSid();
  const session: PlaySession = { sid, gameSlug, wallet, game, createdAt: Date.now(), paymentStatus: "verified", recorded: false,
    seed: seed ?? null, actionIds: [],
    ...(opts.matchId ? { matchId: opts.matchId } : {}),
    ...(opts.practice ? { practice: true, practiceHouseScore: opts.practiceHouseScore } : {}) };
  sessions.set(sid, session);
  const exp = Math.floor(Date.now() / 1000) + 90;
  const claims: SessionClaims = { sid, gameSlug, wallet, exp, nonce: sid };
  const token = signSession(claims);
  try {
    const db = await getDb();
    const playState: PersistedPlay = { v: 1, seed: session.seed, bornAt: session.createdAt, matchId: opts.matchId ?? null,
      ...(opts.practice ? { practice: true, houseScore: opts.practiceHouseScore ?? null } : {}), actions: [] };
    await db.insert(schema.sessions).values({ sid, tokenHash: createHash("sha256").update(token).digest("hex"),
      gameSlug, wallet, exp: new Date(exp * 1000), playState });
  } catch { /* the durable row is best-effort at coin-in; the result record at game over is the critical write */ }
  return { session, token, expiresAt: exp };
}
// Persist the session's action log after each applied action (ADR 0014).
export async function persistPlayState(s: PlaySession): Promise<void> {
  try {
    const db = await getDb();
    const log = s.game.actionLog();
    const playState: PersistedPlay = { v: 1, seed: s.seed, bornAt: s.createdAt, matchId: s.matchId ?? null,
      ...(s.practice ? { practice: true, houseScore: s.practiceHouseScore ?? null } : {}),
      actions: log.map((a, i) => ({ atMs: a.atMs, action: a.action, actionId: s.actionIds[i] ?? null })) };
    await db.update(schema.sessions).set({ playState }).where(eq(schema.sessions.sid, s.sid));
  } catch { /* a missed write only means a sibling rebuild replays a shorter log */ }
}
// Rebuild a session this instance has never seen (ADR 0014): replay its
// persisted action log on a virtual clock anchored at its birth, then flip
// the clock to real time and keep playing from memory.
export async function rebuildSession(sid: string): Promise<PlaySession | null> {
  try {
    const db = await getDb();
    const rows = await db.select().from(schema.sessions).where(eq(schema.sessions.sid, sid)).limit(1);
    const row = rows[0];
    if (!row || row.endedAt || !row.playState) return null;
    const p = row.playState as PersistedPlay;
    let vt = p.bornAt; let live = false; let base = 0; let t0 = 0;
    const now = () => (live ? base + (Date.now() - t0) : vt);
    const game = createEngineWithClock(row.gameSlug, p.seed ?? undefined, now);
    if (!game) return null;
    for (const a of p.actions) { vt = p.bornAt + a.atMs; try { game.act(a.action); } catch { /* logged actions applied once already */ } }
    base = vt; t0 = Date.now(); live = true;
    const scored = await db.select({ id: schema.scores.id }).from(schema.scores)
      .where(eq(schema.scores.sessionId, sid)).limit(1);
    const s: PlaySession = { sid, gameSlug: row.gameSlug, wallet: row.wallet, game, createdAt: p.bornAt,
      paymentStatus: "verified", recorded: scored.length > 0, seed: p.seed,
      actionIds: p.actions.map((a) => a.actionId ?? null),
      ...(p.matchId ? { matchId: p.matchId } : {}),
      ...(p.practice ? { practice: true, practiceHouseScore: p.houseScore ?? undefined } : {}) };
    sessions.set(sid, s);
    return s;
  } catch { return null; }
}
export async function getSessionAsync(sid: string): Promise<PlaySession | undefined> {
  return sessions.get(sid) ?? (await rebuildSession(sid)) ?? undefined;
}
export function evictSession(sid: string): void { sessions.delete(sid); actionCache.delete(sid); }
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
  await writeResult(s, false);
}
// The shared write behind recordResult and the cap finalizer: score row +
// replay record + session end, then the reward/referral hooks. `capped` marks
// a run the 10-minute cap ended mid-game (ADR 0023) in its replay payload.
async function writeResult(s: PlaySession, capped: boolean): Promise<void> {
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
    // Practice runs (ADR 0025) write the replay only — flagged, with the
    // house bar alongside — and never a scores row: nothing ranked, ever.
    if (!s.practice) {
      await db.insert(schema.scores).values({ id: randomBytes(12).toString("hex"), gameSlug: s.gameSlug,
        wallet: s.wallet, value: s.game.finalScore, verified: true, sessionId: s.sid, rulesetHash: rHash });
    }
    await db.insert(schema.gameEvents).values({ id: randomBytes(12).toString("hex"), sessionId: s.sid, type: "replay",
      payload: JSON.stringify({ slug: s.gameSlug, wallet: s.wallet, finalScore: s.game.finalScore,
        ...(s.practice ? { practice: true, houseScore: s.practiceHouseScore ?? null } : {}),
        endedAt: Date.now(), actions, snapshots, rulesetHash: rHash, transcriptHash,
        ...(capped ? { capped: true } : {}),
        ...(s.game.seedCommitment ? { seedCommit: s.game.seedCommitment } : {}),
        ...(s.game.revealSeed ? { seed: s.game.revealSeed() } : {}) }) });
    await db.update(schema.sessions).set({ endedAt: new Date() }).where(eq(schema.sessions.sid, s.sid));
  } catch { s.recorded = false; /* retry on the next poll/action */ }
  // Practice ends here: completion bookkeeping only — no match settlement,
  // no reward release, no referral qualification (nothing was ever accrued).
  if (s.recorded && s.practice) {
    try {
      const { finishPracticeRun } = await import("@/lib/practice");
      await finishPracticeRun(s, "finished");
    } catch { /* bookkeeping only */ }
    return;
  }
  // Versus: a recorded match run may complete the pair — hand off to settlement.
  if (s.recorded && s.matchId) {
    try {
      const { onMatchSessionRecorded } = await import("@/lib/matches");
      await onMatchSessionRecorded(s.matchId);
    } catch { /* settlement is also driven lazily by match reads; never fail the record */ }
  }
  // Farming hardening: a recorded score is what earns the play reward. The
  // coin-in accrued it pending; release it now (reason-guarded in the ledger,
  // so re-entry pays nothing twice). Match sessions never accrue the solo
  // reward — their QTR comes from settlement (ADR 0009) — so skip them.
  if (s.recorded && !s.matchId) {
    try {
      const { releasePlayReward } = await import("@/lib/rewards");
      await releasePlayReward(s.sid);
    } catch { /* a failed release is retried by the next record path; never fail the record */ }
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
// Cap finalization (ADR 0023): a solo run that reaches the 10-minute session
// cap without ending used to record nothing — no score, and its score-gated
// play reward stayed pending forever. Finalize it at the cap instead: a run
// with real play records the score it had when time ran out (flagged capped
// in its replay) and releases its reward like any recorded result; a run
// with zero actions records no score and its pending reward is voided — a
// coin that bought no game earns nothing. Match sessions are excluded:
// versus runs settle or forfeit through match settlement (ADR 0009).
// Returns what happened, or null when the session is not the cap's business.
export async function finalizeCappedSession(s: PlaySession): Promise<"recorded" | "capped" | "voided" | null> {
  if (s.recorded || s.matchId) return null;
  if (Date.now() - s.createdAt <= HEARTBEAT_MAX_SECONDS * 1000) return null;
  if (s.game.isOver) { await recordResult(s); return s.recorded ? "recorded" : null; }
  if (s.game.actionLog().length === 0) {
    s.recorded = true; // closed: nothing may record or release for it later
    try {
      const db = await getDb();
      await db.update(schema.sessions).set({ endedAt: new Date() }).where(eq(schema.sessions.sid, s.sid));
    } catch { /* best-effort: the void below is the money-critical part */ }
    if (s.practice) {
      // No reward was ever accrued for a practice run — just close the row.
      try {
        const { finishPracticeRun } = await import("@/lib/practice");
        await finishPracticeRun(s, "voided");
      } catch { /* bookkeeping only */ }
    } else {
      try {
        const { voidPendingPlayReward } = await import("@/lib/rewards");
        await voidPendingPlayReward(s.sid);
      } catch { /* the ledger guard keeps a later void attempt safe */ }
    }
    evictSession(s.sid);
    return "voided";
  }
  await writeResult(s, true);
  if (!s.recorded) return null; // the write failed; a later touch retries
  evictSession(s.sid);
  return "capped";
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
    // Practice runs are wallet-less walk-ins; the counter is about agents in
    // ranked play, so they don't inflate it.
    if (!s.game.isOver && !s.practice) { wallets.add(s.wallet.toLowerCase()); n++; }
  }
  return { agents: wallets.size, sessions: n };
}
export function liveSessions(gameSlug: string): PlaySession[] {
  return [...sessions.values()].filter((s) => s.gameSlug === gameSlug && !s.game.isOver);
}
