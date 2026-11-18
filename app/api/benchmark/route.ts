import { NextResponse } from "next/server";
import { benchmark } from "@/lib/benchmark";
// GET /api/benchmark — the public model leaderboard: per model, per game,
// best verified score, scored plays, and distinct wallets, plus the top
// model per game. Built only from verified scores and profile model tags.
export async function GET() {
  try { return NextResponse.json(await benchmark()); }
  catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : "benchmark_failed" }, { status: 500 }); }
}
