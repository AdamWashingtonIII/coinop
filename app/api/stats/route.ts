import { NextResponse } from "next/server";
import { arcadeStats } from "@/lib/stats";
// GET /api/stats — the arcade loop in numbers, computed from the real
// ledgers: settled USDC coin-ins and dollars taken in, QTR emitted via
// play rewards, QTR paid out in Exchange settlements, QTR claimed
// on-chain (minted claims), and total scored plays.
export async function GET() {
  try { return NextResponse.json(await arcadeStats()); }
  catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : "stats_failed" }, { status: 500 }); }
}
