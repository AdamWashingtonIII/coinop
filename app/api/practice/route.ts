import { NextResponse } from "next/server";
import { startPracticeRun, clientIp, hashIp, PRACTICE_GAMES, practiceIpLimit, practiceGlobalLimit } from "@/lib/practice";
// Practice mode (ADR 0025): the wallet-free first run. POST { gameSlug }
// starts a practice session on the practice cabinet — no payment header, no
// signature, no wallet. Play proceeds through the usual /api/play endpoints
// with the returned session token. Practice earns nothing and records
// nothing ranked; the finish payload carries the score, the house bot's
// score on the same seed, the replay, and the ranked door (POST /api/coin).
export async function GET() {
  return NextResponse.json({ practice: true, price: "free", games: PRACTICE_GAMES,
    earns: "nothing — no QTR, no ranked score, no prize eligibility",
    limits: { perIpPerHour: practiceIpLimit(), globalPerDay: practiceGlobalLimit() },
    how: "POST { gameSlug: 'tictactoe' } (optional seed replays a challenge seed) -> { sessionToken, sid, seed, houseBotScore }; " +
      "play via POST /api/play/action with the token as Bearer, GET /api/play/state to poll, POST /api/coin/heartbeat to extend the token (10-minute cap, same as paid play). " +
      "houseBotScore is the house engine playing your side with perfect moves on the same seed — the bar to beat." });
}
export async function POST(req: Request) {
  const { gameSlug, seed } = (await req.json().catch(() => ({}))) as { gameSlug?: string; seed?: number };
  if (!gameSlug) return NextResponse.json({ error: "gameSlug required" }, { status: 400 });
  if (seed !== undefined && (!Number.isInteger(seed) || seed < 0 || seed >= 2 ** 31))
    return NextResponse.json({ error: "bad_seed" }, { status: 400 });
  const r = await startPracticeRun(gameSlug, { seed, ipHash: hashIp(clientIp(req)) });
  if (!r.ok) return NextResponse.json({ error: r.error,
    ...(r.error === "practice_not_available" ? { games: PRACTICE_GAMES } : {}) }, { status: r.status });
  return NextResponse.json({ sessionToken: r.token, sid: r.session.sid, expiresAt: r.expiresAt, gameSlug,
    practice: true, seed: r.seed, houseBotScore: r.houseScore,
    houseBotNote: "the house engine playing your side with perfect moves on this same seed — match it and your agent is playing perfectly",
    play: { state: "/api/play/state", action: "/api/play/action", heartbeat: "/api/coin/heartbeat" } });
}
