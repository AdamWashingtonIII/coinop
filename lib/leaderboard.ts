import { and, desc, eq, gte, lt, sql } from "drizzle-orm";
import { getDb, schema } from "./db";
// Leaderboards + seasons + replays, all read from the durable record (M2').
// A season is a calendar month (UTC). Every score on the board is server-verified
// by construction: scores rows are only written by the server at game over.
export function currentSeason(d = new Date()): string {
  return d.getUTCFullYear() + "-" + String(d.getUTCMonth() + 1).padStart(2, "0");
}
function seasonWindow(season: string): { from: Date; to: Date } | null {
  const m = /^(\d{4})-(\d{2})$/.exec(season);
  if (!m) return null;
  const y = Number(m[1]), mo = Number(m[2]);
  if (mo < 1 || mo > 12) return null;
  return { from: new Date(Date.UTC(y, mo - 1, 1)), to: new Date(Date.UTC(y, mo, 1)) };
}
export interface BoardEntry { wallet: string; score: number; achievedAt: number }
export async function getLeaderboard(gameSlug: string, season: string, limit = 20): Promise<BoardEntry[]> {
  const db = await getDb();
  const conds = [eq(schema.scores.gameSlug, gameSlug), eq(schema.scores.verified, true), sql`${schema.scores.wallet} is not null`];
  if (season !== "all") {
    const w = seasonWindow(season);
    if (!w) return [];
    conds.push(gte(schema.scores.createdAt, w.from), lt(schema.scores.createdAt, w.to));
  }
  const rows = await db.select({ wallet: schema.scores.wallet,
      score: sql<number>`max(${schema.scores.value})`, achievedAt: sql<number>`max(${schema.scores.createdAt})` })
    .from(schema.scores).where(and(...conds))
    .groupBy(schema.scores.wallet)
    .orderBy(desc(sql`max(${schema.scores.value})`)).limit(Math.min(limit, 100));
  return rows.map((r) => ({ wallet: r.wallet ?? "", score: Number(r.score),
    achievedAt: new Date(r.achievedAt).getTime() }));
}
export interface ReplaySummary { sid: string; slug: string; wallet: string; finalScore: number; endedAt: number }
export async function recentReplays(gameSlug: string, limit = 10): Promise<ReplaySummary[]> {
  const db = await getDb();
  const rows = await db.select().from(schema.gameEvents)
    .where(eq(schema.gameEvents.type, "replay"))
    .orderBy(desc(schema.gameEvents.ts)).limit(100);
  const out: ReplaySummary[] = [];
  for (const r of rows) {
    try {
      const p = JSON.parse(r.payload ?? "{}") as { slug?: string; wallet?: string; finalScore?: number; endedAt?: number };
      if (p.slug === gameSlug) out.push({ sid: r.sessionId, slug: p.slug ?? gameSlug, wallet: p.wallet ?? "",
        finalScore: p.finalScore ?? 0, endedAt: p.endedAt ?? r.ts.getTime() });
      if (out.length >= limit) break;
    } catch { /* skip malformed rows */ }
  }
  return out;
}
export async function getReplay(sid: string): Promise<unknown | null> {
  const db = await getDb();
  const rows = await db.select().from(schema.gameEvents)
    .where(and(eq(schema.gameEvents.type, "replay"), eq(schema.gameEvents.sessionId, sid))).limit(1);
  if (!rows.length) return null;
  try { return { sid, ...JSON.parse(rows[0].payload ?? "{}") }; } catch { return null; }
}
