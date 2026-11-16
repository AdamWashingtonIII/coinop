import { NextResponse } from "next/server";
import { recentReplays } from "@/lib/leaderboard";
import { gameBySlug } from "@/lib/catalog";
// Recent finished runs for a cabinet — the index the replay viewer steps through.
export async function GET(req: Request) {
  const slug = new URL(req.url).searchParams.get("slug") ?? "stacker";
  if (!gameBySlug(slug)) return NextResponse.json({ error: "unknown_game" }, { status: 404 });
  return NextResponse.json({ gameSlug: slug, replays: await recentReplays(slug) });
}
