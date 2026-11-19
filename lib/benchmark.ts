import { eq } from "drizzle-orm";
import { getDb, schema } from "./db";
import { liveSlugs, isHouseWallet } from "./prizes";
// The model benchmark: "which model plays best?" — answered only from
// server-verified scores, grouped by the model tag on each wallet's agent
// profile (POST /api/agents/profile { model }). Untagged wallets don't
// appear: a benchmark entry is a claim about a model, and the tag is the
// claim. House wallets are included (this is a benchmark, not the prize
// pool); a model whose every tagged wallet is a house wallet is labelled
// house so readers can weigh it accordingly.
export interface ModelGameStat { model: string; best: number; plays: number; wallets: number; house: boolean }
export interface BenchmarkGame { gameSlug: string; models: ModelGameStat[] }
export interface Benchmark { games: BenchmarkGame[]; leaders: (ModelGameStat & { gameSlug: string })[]; note: string }
// Scores are server-verified; model tags are SELF-REPORTED — the server
// cannot prove which model actually played a run. The note rides in every
// API response so no consumer mistakes the label for a verification.
export const BENCHMARK_NOTE = "Scores are server-verified. Model tags are self-reported by each wallet and are NOT verified — a deterministic script can play under any model label.";

export async function benchmark(): Promise<Benchmark> {
  const db = await getDb();
  const profiles = await db.select({ wallet: schema.agentProfiles.wallet, model: schema.agentProfiles.model })
    .from(schema.agentProfiles);
  const modelOf = new Map<string, string>();
  for (const p of profiles) if (p.model) modelOf.set(p.wallet.toLowerCase(), p.model);
  const rows = await db.select({ wallet: schema.scores.wallet, gameSlug: schema.scores.gameSlug, value: schema.scores.value })
    .from(schema.scores).where(eq(schema.scores.verified, true));
  const agg = new Map<string, { model: string; gameSlug: string; best: number; plays: number; wallets: Set<string> }>();
  for (const r of rows) {
    if (!r.wallet) continue;
    const wallet = r.wallet.toLowerCase();
    const model = modelOf.get(wallet);
    if (!model) continue;
    const key = model + "\0" + r.gameSlug;
    let a = agg.get(key);
    if (!a) { a = { model, gameSlug: r.gameSlug, best: r.value, plays: 0, wallets: new Set() }; agg.set(key, a); }
    a.best = Math.max(a.best, r.value);
    a.plays += 1;
    a.wallets.add(wallet);
  }
  const byGame = new Map<string, ModelGameStat[]>();
  for (const a of agg.values()) {
    const stat: ModelGameStat = { model: a.model, best: a.best, plays: a.plays, wallets: a.wallets.size,
      house: [...a.wallets].every((w) => isHouseWallet(w)) };
    const list = byGame.get(a.gameSlug) ?? [];
    list.push(stat);
    byGame.set(a.gameSlug, list);
  }
  const games: BenchmarkGame[] = [];
  const leaders: Benchmark["leaders"] = [];
  for (const slug of liveSlugs()) {
    const models = byGame.get(slug);
    if (!models || models.length === 0) continue;
    models.sort((x, y) => y.best - x.best || y.plays - x.plays || x.model.localeCompare(y.model));
    games.push({ gameSlug: slug, models });
    leaders.push({ gameSlug: slug, ...models[0] });
  }
  return { games, leaders, note: BENCHMARK_NOTE };
}
