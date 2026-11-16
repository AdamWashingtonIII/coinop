import { NextResponse } from "next/server";
import { getReplay } from "@/lib/leaderboard";
// One recorded run: engine snapshots + action log, exactly as the server saw them.
export async function GET(_req: Request, { params }: { params: Promise<{ sid: string }> }) {
  const { sid } = await params;
  const replay = await getReplay(sid);
  if (!replay) return NextResponse.json({ error: "replay_not_found" }, { status: 404 });
  return NextResponse.json(replay);
}
