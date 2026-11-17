import { and, eq, sql } from "drizzle-orm";
import { getDb, schema } from "./db";
import { liveSlugs } from "./prizes";
import { rewardBalance, claimedTotal } from "./rewards";
// The proving ground (ADR 0016): a wallet's public record, computed only
// from verified scores — best score and all-time rank per cabinet, plus
// QTR earned. Nothing here can be self-reported.
export interface GameRecord { gameSlug: string; best: number | null; rank: number | null; plays: number }
export interface AgentRecord { wallet: string; name: string | null;
  games: GameRecord[]; totalPlays: number; cabinetsPlayed: number;
  qtrEarned: number; qtrClaimed: number; firstSeen: number | null }
export async function agentRecord(walletRaw: string): Promise<AgentRecord> {
  const wallet = walletRaw.toLowerCase();
  const db = await getDb();
  const games: GameRecord[] = [];
  let totalPlays = 0, firstSeen: number | null = null;
  for (const slug of liveSlugs()) {
    const mine = await db.select().from(schema.scores).where(and(
      eq(schema.scores.gameSlug, slug), eq(schema.scores.verified, true),
      sql`lower(${schema.scores.wallet}) = ${wallet}`));
    if (mine.length === 0) { games.push({ gameSlug: slug, best: null, rank: null, plays: 0 }); continue; }
    const best = Math.max(...mine.map((r) => r.value));
    for (const r of mine) { const t = r.createdAt.getTime(); if (firstSeen === null || t < firstSeen) firstSeen = t; }
    const all = await db.select({ wallet: schema.scores.wallet, value: schema.scores.value })
      .from(schema.scores).where(and(eq(schema.scores.gameSlug, slug), eq(schema.scores.verified, true)));
    const bestByWallet = new Map<string, number>();
    for (const r of all) { if (!r.wallet) continue; const w = r.wallet.toLowerCase();
      bestByWallet.set(w, Math.max(bestByWallet.get(w) ?? -Infinity, r.value)); }
    const rank = 1 + [...bestByWallet.values()].filter((v) => v > best).length;
    totalPlays += mine.length;
    games.push({ gameSlug: slug, best, rank, plays: mine.length });
  }
  const profiles = await db.select().from(schema.agentProfiles)
    .where(sql`lower(${schema.agentProfiles.wallet}) = ${wallet}`);
  return { wallet, name: profiles[0]?.name ?? null, games, totalPlays,
    cabinetsPlayed: games.filter((g) => g.plays > 0).length,
    qtrEarned: await rewardBalance(wallet), qtrClaimed: await claimedTotal(wallet), firstSeen };
}
