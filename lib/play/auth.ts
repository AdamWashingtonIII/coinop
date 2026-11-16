import { verifySession, type SessionClaims } from "@/lib/sessions";
import { getSessionAsync, type PlaySession } from "./store";
// Session auth for play calls. The token is HMAC-verified locally; the session
// itself is memory-first with a database rebuild on a miss (ADR 0014), so a
// call landing on a sibling serverless instance still finds its game.
export async function authedSession(req: Request): Promise<{ claims: SessionClaims; session: PlaySession } | null> {
  const raw = req.headers.get("authorization") ?? "";
  const token = raw.startsWith("Bearer ") ? raw.slice(7) : raw;
  const claims = token ? verifySession(token) : null;
  if (!claims) return null;
  const session = await getSessionAsync(claims.sid);
  if (!session || session.gameSlug !== claims.gameSlug) return null;
  return { claims, session };
}
