import { NextResponse } from "next/server";
import { authedSession } from "@/lib/play/auth";
import { recordResult, finalizeCappedSession } from "@/lib/play/store";
import { engineActions } from "@/lib/games/engine";
export async function GET(req: Request) {
  const a = await authedSession(req);
  if (!a) return NextResponse.json({ error: "invalid_or_expired_token" }, { status: 401 });
  // A session past its 10-minute cap is finalized on touch (ADR 0023) — this
  // poll may be the first place the server can close the run out.
  const fin = await finalizeCappedSession(a.session).catch(() => null);
  if (fin) {
    return NextResponse.json({ sid: a.session.sid, state: a.session.game.state(), legalActions: engineActions(a.session.gameSlug),
      capped: true, ...(fin === "voided" ? { expired: true } : { gameOver: true, finalScore: a.session.game.finalScore }) });
  }
  const state = a.session.game.state();
  // Snake and Breaker can end between actions (wall hit, last ball lost) —
  // a state poll is often the first place the server sees the run is over.
  if (state.status === "over") await recordResult(a.session);
  return NextResponse.json({ sid: a.session.sid, state, legalActions: engineActions(a.session.gameSlug) });
}
