import { describe, it, expect } from "vitest";
import { generateKeyPairSync, createPublicKey, verify as cryptoVerify } from "node:crypto";
import { generateCdpJwt, parseCdpSecret } from "./cdp-auth";
// Throwaway keys only — generated fresh per run, never near production secrets.
function ed25519Secret(format: "seed+pub" | "seed"): { secret: string; publicKey: ReturnType<typeof createPublicKey> } {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const pkcs8 = privateKey.export({ format: "der", type: "pkcs8" }) as Buffer;
  const seed = pkcs8.subarray(pkcs8.length - 32);
  const spki = publicKey.export({ format: "der", type: "spki" }) as Buffer;
  const pub = spki.subarray(spki.length - 32);
  const raw = format === "seed+pub" ? Buffer.concat([seed, pub]) : seed;
  return { secret: raw.toString("base64"), publicKey };
}
function decode(jwt: string) {
  const [h, c, s] = jwt.split(".");
  return {
    header: JSON.parse(Buffer.from(h, "base64url").toString()),
    claims: JSON.parse(Buffer.from(c, "base64url").toString()),
    signingInput: `${h}.${c}`,
    signature: Buffer.from(s, "base64url"),
  };
}
describe("CDP JWT (Ed25519 secret API key)", () => {
  it("emits the documented header + claims and a signature that verifies", () => {
    const { secret, publicKey } = ed25519Secret("seed+pub");
    const jwt = generateCdpJwt({ method: "POST", host: "api.cdp.coinbase.com", path: "/platform/v2/x402/settle",
      keyId: "test-key-id", secret, nowSeconds: 1760000000, nonce: "abc123" });
    const { header, claims, signingInput, signature } = decode(jwt);
    expect(header).toEqual({ alg: "EdDSA", kid: "test-key-id", typ: "JWT", nonce: "abc123" });
    expect(claims.iss).toBe("cdp");
    expect(claims.sub).toBe("test-key-id");
    expect(claims.aud).toEqual(["cdp_service"]);
    expect(claims.exp - claims.nbf).toBe(120);
    expect(claims.uri).toBe("POST api.cdp.coinbase.com/platform/v2/x402/settle");
    expect(claims.uris).toEqual(["POST api.cdp.coinbase.com/platform/v2/x402/settle"]);
    expect(cryptoVerify(null, Buffer.from(signingInput), publicKey, signature)).toBe(true);
  });
  it("accepts a bare 32-byte seed secret too", () => {
    const { secret, publicKey } = ed25519Secret("seed");
    const jwt = generateCdpJwt({ method: "GET", host: "api.cdp.coinbase.com", path: "/platform/v2/x402/supported",
      keyId: "k2", secret, nowSeconds: 1760000000 });
    const { claims, signingInput, signature } = decode(jwt);
    expect(claims.uri).toBe("GET api.cdp.coinbase.com/platform/v2/x402/supported");
    expect(cryptoVerify(null, Buffer.from(signingInput), publicKey, signature)).toBe(true);
  });
});
describe("CDP JWT (ECDSA PEM key)", () => {
  it("signs ES256 with a raw R||S signature that verifies", () => {
    const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
    const pem = privateKey.export({ format: "pem", type: "pkcs8" }) as string;
    expect(parseCdpSecret(pem).alg).toBe("ES256");
    const jwt = generateCdpJwt({ method: "POST", host: "api.cdp.coinbase.com", path: "/platform/v2/x402/verify",
      keyId: "ec-key", secret: pem, nowSeconds: 1760000000 });
    const { header, signingInput, signature } = decode(jwt);
    expect(header.alg).toBe("ES256");
    expect(signature.length).toBe(64); // ieee-p1363 R||S, not DER
    expect(cryptoVerify("sha256", Buffer.from(signingInput), { key: publicKey, dsaEncoding: "ieee-p1363" }, signature)).toBe(true);
  });
  it("rejects an unrecognized secret instead of guessing", () => {
    expect(() => parseCdpSecret("not-a-key")).toThrow(/cdp_secret_/);
  });
});
