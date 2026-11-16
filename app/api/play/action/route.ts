import { NextResponse } from "next/server";
import { authedSession } from "@/lib/play/auth";
import { recordResult, cachedActionResponse, cacheActionResponse } from "@/lib/play/store";
import { engineActions, isAllowedAction } from "@/lib/games/engine";
// One action endpoint for every cabinet: the engine owns its action set
// (stacker: drop · snake: up/down/left/right · breaker: left/right).
export async function POST(req: Request) {
  const a = authedSession(req);
  if (!a) return NextResponse.json({ error: "invalid_or_expired_token" }, { status: 401 });
  const { action, actionId } = (await req.json().catch(() => ({}))) as { action?: string; actionId?: string };
  const allowed = engineActions(a.session.gameSlug);
  if (!action || !isAllowedAction(a.session.gameSlug, action))
    return NextResponse.json({ error: "unknown_action", allowed }, { status: 400 });
  // Idempotency: a retried actionId returns the original response, never a double-apply.
  const idem = typeof actionId === "string" && actionId.length > 0 && actionId.length <= 128 ? actionId : null;
  if (idem) { const hit = cachedActionResponse(a.session.sid, idem); if (hit) return NextResponse.json(hit); }
  const state = a.session.game.act(action);
  if (state.status === "over") await recordResult(a.session);
  const response = { sid: a.session.sid, state, legalActions: allowed,
    ...(state.status === "over" ? { gameOver: true, finalScore: state.score } : {}) };
  if (idem) cacheActionResponse(a.session.sid, idem, response);
  return NextResponse.json(response);
}
