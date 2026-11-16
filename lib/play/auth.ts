import { verifySession, type SessionClaims } from "@/lib/sessions";
import { getSession, type PlaySession } from "./store";
export function authedSession(req: Request): { claims: SessionClaims; session: PlaySession } | null {
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer /, "");
  const claims = token ? verifySession(token) : null;
  if (!claims) return null;
  const session = getSession(claims.sid);
  if (!session || session.gameSlug !== claims.gameSlug) return null;
  return { claims, session };
}
