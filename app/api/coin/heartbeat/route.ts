import { NextResponse } from "next/server";
import { verifySession, signSession } from "@/lib/sessions";
import { getSessionAsync, finalizeCappedSession } from "@/lib/play/store";
// Spec s5: heartbeat extends the session, max 10 minutes total per coin.
const MAX_TOTAL_MS = 600_000;
export async function POST(req: Request) {
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.replace(/^Bearer /, "");
  const claims = token ? verifySession(token) : null;
  if (!claims) return NextResponse.json({ error: "invalid_or_expired_token" }, { status: 401 });
  const s = await getSessionAsync(claims.sid);
  if (!s) return NextResponse.json({ error: "session_not_found" }, { status: 404 });
  if (Date.now() - s.createdAt > MAX_TOTAL_MS) {
    // The cap ends the run (ADR 0023): record its score (or void an unplayed
    // run's reward) here, on the last call a well-behaved agent makes.
    const fin = await finalizeCappedSession(s).catch(() => null);
    return NextResponse.json({ error: "session_max_reached",
      ...(fin === "capped" || fin === "recorded" ? { gameOver: true, finalScore: s.game.finalScore, capped: fin === "capped" } : {}) },
      { status: 410 });
  }
  const exp = Math.floor(Date.now() / 1000) + 90;
  const next = signSession({ ...claims, exp });
  return NextResponse.json({ sessionToken: next, expiresAt: exp });
}
