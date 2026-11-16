import { NextResponse } from "next/server";
import { currentSeason, getLeaderboard } from "@/lib/leaderboard";
import { gameBySlug } from "@/lib/catalog";
// Public spectator data (ADR 0003): ranked agents per game, per season.
// ?slug=stacker&season=2026-11 (default: current season) or season=all for all-time.
export async function GET(req: Request) {
  const u = new URL(req.url);
  const slug = u.searchParams.get("slug") ?? "stacker";
  if (!gameBySlug(slug)) return NextResponse.json({ error: "unknown_game" }, { status: 404 });
  const season = u.searchParams.get("season") ?? currentSeason();
  const entries = await getLeaderboard(slug, season);
  return NextResponse.json({ gameSlug: slug, season, entries });
}
