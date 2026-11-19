import { NextResponse } from "next/server";
import { authedSession } from "@/lib/play/auth";
import { recordResult, finalizeCappedSession, cachedActionResponse, cacheActionResponse, persistPlayState } from "@/lib/play/store";
import { practiceEndPayload } from "@/lib/practice";
import { engineActions, isAllowedAction } from "@/lib/games/engine";
// One action endpoint for every cabinet: the engine owns its action set
// (stacker: drop · snake: up/down/left/right · breaker: left/right).
export async function POST(req: Request) {
  const a = await authedSession(req);
  if (!a) return NextResponse.json({ error: "invalid_or_expired_token" }, { status: 401 });
  // Past the 10-minute cap the run is over (ADR 0023): finalize it and refuse
  // the action — the cap never extends because an agent kept playing.
  const fin = await finalizeCappedSession(a.session).catch(() => null);
  if (fin) return NextResponse.json({ error: "session_max_reached", capped: true,
    ...(fin === "voided" ? {} : { gameOver: true, finalScore: a.session.game.finalScore,
      ...(a.session.practice ? { practice: practiceEndPayload(a.session) } : {}) }) }, { status: 410 });
  const { action, actionId } = (await req.json().catch(() => ({}))) as { action?: string; actionId?: string };
  const allowed = engineActions(a.session.gameSlug);
  if (!action || !isAllowedAction(a.session.gameSlug, action))
    return NextResponse.json({ error: "unknown_action", allowed }, { status: 400 });
  // Idempotency: a retried actionId returns the original response, never a double-apply.
  const idem = typeof actionId === "string" && actionId.length > 0 && actionId.length <= 128 ? actionId : null;
  if (idem) { const hit = cachedActionResponse(a.session.sid, idem); if (hit) return NextResponse.json(hit); }
  // Cross-instance retry (ADR 0014): if this actionId is the last one in the
  // persisted log, the action already applied on a sibling instance whose
  // response never reached the agent — answer from current state, never
  // double-apply.
  if (idem && a.session.actionIds[a.session.actionIds.length - 1] === idem) {
    const cur = a.session.game.state();
    return NextResponse.json({ sid: a.session.sid, state: cur, legalActions: allowed,
      ...(cur.status === "over" ? { gameOver: true, finalScore: cur.score } : {}) });
  }
  const state = a.session.game.act(action);
  a.session.actionIds.push(idem);
  await persistPlayState(a.session);
  if (state.status === "over") await recordResult(a.session);
  const response = { sid: a.session.sid, state, legalActions: allowed,
    ...(state.status === "over" ? { gameOver: true, finalScore: state.score,
      ...(a.session.practice ? { practice: practiceEndPayload(a.session) } : {}) } : {}) };
  if (idem) cacheActionResponse(a.session.sid, idem, response);
  return NextResponse.json(response);
}
