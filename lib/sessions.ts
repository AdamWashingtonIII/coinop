import { createHmac, randomBytes } from "crypto";
// Spec section 5: HMAC-SHA256 session token, 90s TTL, bound to gameSlug + wallet, single-use via Redis in M1/M2.
export const SESSION_TTL_SECONDS = 90;
export const HEARTBEAT_MAX_SECONDS = 600; // 10 min total per coin
export interface SessionClaims { sid: string; gameSlug: string; wallet: string; exp: number; nonce: string }
function secret(): string { const s = process.env.SESSION_HMAC_SECRET; if (!s) throw new Error("SESSION_HMAC_SECRET missing"); return s; }
export function newSid(): string { return randomBytes(16).toString("hex"); }
export function signSession(c: SessionClaims): string {
  const body = Buffer.from(JSON.stringify(c)).toString("base64url");
  const sig = createHmac("sha256", secret()).update(body).digest("base64url");
  return body + "." + sig;
}
export function verifySessionSignature(token: string): SessionClaims | null {
  const [body, sig] = token.split("."); if (!body || !sig) return null;
  const expect = createHmac("sha256", secret()).update(body).digest("base64url");
  if (sig !== expect) return null;
  try { return JSON.parse(Buffer.from(body, "base64url").toString()) as SessionClaims; } catch { return null; }
}
export function verifySession(token: string): SessionClaims | null {
  const c = verifySessionSignature(token);
  return c && c.exp * 1000 > Date.now() ? c : null;
}
