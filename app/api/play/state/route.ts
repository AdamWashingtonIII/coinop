import { NextResponse } from "next/server";
import { authedSession } from "@/lib/play/auth";
import { recordResult } from "@/lib/play/store";
import { engineActions } from "@/lib/games/engine";
export async function GET(req: Request) {
  const a = authedSession(req);
  if (!a) return NextResponse.json({ error: "invalid_or_expired_token" }, { status: 401 });
  const state = a.session.game.state();
  // Snake and Breaker can end between actions (wall hit, last ball lost) —
  // a state poll is often the first place the server sees the run is over.
  if (state.status === "over") await recordResult(a.session);
  return NextResponse.json({ sid: a.session.sid, state, legalActions: engineActions(a.session.gameSlug) });
}
