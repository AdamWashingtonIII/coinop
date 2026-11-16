import { createPrivateKey, randomBytes, sign as cryptoSign, type KeyObject } from "node:crypto";
import { cdpApiKeys } from "./config";
// CDP API JWT auth, following Coinbase's documented generateJwt flow
// (docs.cdp.coinbase.com — API Authentication / CDP SDK generateJwt):
//   header: { alg, kid: keyId, typ: "JWT", nonce }
//   claims: { iss: "cdp", sub: keyId, aud: ["cdp_service"], nbf, exp (120s),
//             uri: "<METHOD> <host><path>" }
// The current CDP SDK (typescript/src/auth/utils/jwt.ts) emits the request-URI
// claim as `uris` (an array holding the same string); older CDP docs show the
// singular `uri`. We emit BOTH — verifiers check the claim they know and
// ignore the other — so the token is accepted by either generation.
// Key types: CDP "Secret API Keys" are Ed25519 by default — the secret is a
// base64 string decoding to 64 bytes (32-byte seed || 32-byte public key);
// a bare 32-byte seed is also accepted. ECDSA keys arrive as PEM and sign
// ES256. Implemented on node:crypto only: Ed25519 keys are rebuilt as PKCS#8
// DER from the raw seed (fixed RFC 8410 prefix, no hand-rolled ASN.1 beyond
// the constant header), and ECDSA signatures use dsaEncoding "ieee-p1363"
// (raw R||S, as JWS requires).
const ED25519_PKCS8_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");
function b64url(data: Buffer | string): string {
  return Buffer.from(data).toString("base64url");
}
interface ParsedKey { key: KeyObject; alg: "EdDSA" | "ES256" }
export function parseCdpSecret(secret: string): ParsedKey {
  const s = secret.trim();
  if (s.includes("-----BEGIN")) {
    const key = createPrivateKey(s);
    if (key.asymmetricKeyType === "ed25519") return { key, alg: "EdDSA" };
    if (key.asymmetricKeyType === "ec") {
      const details = key.asymmetricKeyDetails as { namedCurve?: string } | undefined;
      if (details?.namedCurve && details.namedCurve !== "prime256v1" && details.namedCurve !== "P-256")
        throw new Error("cdp_secret_unsupported_curve: ES256 requires a P-256 key");
      return { key, alg: "ES256" };
    }
    throw new Error("cdp_secret_unsupported_key_type");
  }
  const raw = Buffer.from(s.replace(/\s+/g, ""), "base64");
  if (raw.length === 64 || raw.length === 32) {
    const seed = raw.subarray(0, 32);
    const key = createPrivateKey({ key: Buffer.concat([ED25519_PKCS8_PREFIX, seed]), format: "der", type: "pkcs8" });
    return { key, alg: "EdDSA" };
  }
  throw new Error("cdp_secret_unrecognized_format: expected base64 Ed25519 (64 or 32 bytes) or a PEM key");
}
export interface CdpJwtRequest { method: string; host: string; path: string }
export interface CdpJwtOptions extends CdpJwtRequest {
  keyId?: string; secret?: string; expiresInSeconds?: number; nowSeconds?: number; nonce?: string;
}
// Generate one JWT for one CDP REST request. Key id/secret default to the
// CDP_API_KEY_ID / CDP_API_KEY_SECRET env pair; tests inject throwaway keys.
export function generateCdpJwt(opts: CdpJwtOptions): string {
  const keys = opts.keyId && opts.secret ? { id: opts.keyId, secret: opts.secret } : cdpApiKeys();
  if (!keys) throw new Error("cdp_keys_not_configured");
  const { key, alg } = parseCdpSecret(keys.secret);
  const now = opts.nowSeconds ?? Math.floor(Date.now() / 1000);
  const uri = `${opts.method.toUpperCase()} ${opts.host}${opts.path}`;
  const header = { alg, kid: keys.id, typ: "JWT", nonce: opts.nonce ?? randomBytes(16).toString("hex") };
  const claims = {
    iss: "cdp", sub: keys.id, aud: ["cdp_service"],
    nbf: now, exp: now + (opts.expiresInSeconds ?? 120),
    uri, uris: [uri],
  };
  const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(claims))}`;
  const signature = alg === "EdDSA"
    ? cryptoSign(null, Buffer.from(signingInput), key)
    : cryptoSign("sha256", Buffer.from(signingInput), { key, dsaEncoding: "ieee-p1363" });
  return `${signingInput}.${b64url(signature)}`;
}
