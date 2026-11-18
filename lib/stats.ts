import { eq, inArray, sql } from "drizzle-orm";
import { getDb, schema } from "./db";
// The loop, in numbers: arcade-wide aggregates computed from the real
// ledgers — nothing estimated. Sources:
// - Settled USDC coin-ins: the prize ledger's rake rows. Every USDC coin-in
//   accrues exactly one $0.05 rake row at coin-in, and a settle failure
//   appends a reversal — so net rake rows = settled coin-ins (since the
//   prize pool launched, ADR 0016), and the USDC total is count × $0.25,
//   the protocol-fixed price.
// - QTR emitted via play rewards: released play_reward entries only
//   (unflagged). Pending rewards are a different reason; flagged ones were
//   reversed by a failed settle — neither counts as emitted.
// - QTR claimed on-chain: claims that reached status "minted". Queued or
//   batched claims are reserved but not yet on-chain, so they don't count.
export interface ArcadeStats {
  usdcCoinIns: number;
  usdcTakenIn: number; // USDC, 2dp
  qtrPlayRewards: number;
  qtrExchangePaid: number;
  qtrClaimed: number;
  scoredPlays: number;
}

export async function arcadeStats(): Promise<ArcadeStats> {
  const db = await getDb();
  const rake = await db.select({ kind: schema.prizeLedger.kind, n: sql<number>`count(*)` })
    .from(schema.prizeLedger)
    .where(inArray(schema.prizeLedger.kind, ["rake", "rake_reversal"]))
    .groupBy(schema.prizeLedger.kind);
  const rakeCount = (k: string) => Number(rake.find((r) => r.kind === k)?.n ?? 0);
  const usdcCoinIns = Math.max(0, rakeCount("rake") - rakeCount("rake_reversal"));
  const sumReason = async (reason: string) => {
    const rows = await db.select({ s: sql<number>`coalesce(sum(${schema.rewardsLedger.delta}),0)` })
      .from(schema.rewardsLedger)
      .where(sql`${schema.rewardsLedger.reason} = ${reason} AND ${schema.rewardsLedger.flagged} = false`);
    return Number(rows[0]?.s ?? 0);
  };
  const claimed = await db.select({ s: sql<number>`coalesce(sum(${schema.claims.amount}),0)` })
    .from(schema.claims).where(eq(schema.claims.status, "minted"));
  const scored = await db.select({ n: sql<number>`count(*)` })
    .from(schema.scores).where(eq(schema.scores.verified, true));
  return {
    usdcCoinIns,
    usdcTakenIn: Math.round(usdcCoinIns * 0.25 * 100) / 100,
    qtrPlayRewards: await sumReason("play_reward"),
    qtrExchangePaid: await sumReason("task_pay"),
    qtrClaimed: Number(claimed[0]?.s ?? 0),
    scoredPlays: Number(scored[0]?.n ?? 0),
  };
}
