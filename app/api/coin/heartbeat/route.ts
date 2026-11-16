import { NextResponse } from "next/server";
import { verifySession, signSession } from "@/lib/sessions";
import { getSession } from "@/lib/play/store";
// Spec s5: heartbeat extends the session, max 10 minutes total per coin.
const MAX_TOTAL_MS = 600_000;
export async function POST(req: Request) {
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.replace(/^Bearer /, "");
  const claims = token ? verifySession(token) : null;
  if (!claims) return NextResponse.json({ error: "invalid_or_expired_token" }, { status: 401 });
  const s = getSession(claims.sid);
  if (!s) return NextResponse.json({ error: "session_not_found" }, { status: 404 });
  if (Date.now() - s.createdAt > MAX_TOTAL_MS) return NextResponse.json({ error: "session_max_reached" }, { status: 410 });
  const exp = Math.floor(Date.now() / 1000) + 90;
  const next = signSession({ ...claims, exp });
  return NextResponse.json({ sessionToken: next, expiresAt: exp });
}
