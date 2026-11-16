import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import { facilitatorKind, facilitatorBaseUrl, x402ProtocolVersion } from "./config";
import { paymentRequirements, matchPaymentRequirements, verifyPayment, settlePayment, paymentRequiredBody, paymentRequiredHeaders } from "./facilitator";
// Facilitator selection + wire formats. A throwaway Ed25519 key stands in for
// the operator's CDP secret; fetch is mocked — nothing leaves the process.
const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const pkcs8 = privateKey.export({ format: "der", type: "pkcs8" }) as Buffer;
const spki = publicKey.export({ format: "der", type: "spki" }) as Buffer;
const CDP_SECRET = Buffer.concat([pkcs8.subarray(pkcs8.length - 32), spki.subarray(spki.length - 32)]).toString("base64");
const ENV_KEYS = ["CDP_API_KEY_ID", "CDP_API_KEY_SECRET", "X402_FACILITATOR_URL", "NEXT_PUBLIC_APP_URL", "NEXT_PUBLIC_CHAIN_ID"];
const saved: Record<string, string | undefined> = {};
beforeEach(() => {
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  process.env.TREASURY_ADDRESS = "0x312e8Efd90C134f6E54A0B612dF4f55775eC2Bd7";
  process.env.MATCH_ESCROW_ADDRESS = "0x27501C6B06cA445579488b8d4E44998222171d74";
  process.env.NEXT_PUBLIC_APP_URL = "https://example.test";
  delete process.env.CDP_API_KEY_ID; delete process.env.CDP_API_KEY_SECRET;
  delete process.env.X402_FACILITATOR_URL; delete process.env.NEXT_PUBLIC_CHAIN_ID;
});
afterEach(() => {
  for (const k of ENV_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  vi.unstubAllGlobals();
});
function cdpOn() { process.env.CDP_API_KEY_ID = "test-key-id"; process.env.CDP_API_KEY_SECRET = CDP_SECRET; }
function mockFetch(responseBody: unknown) {
  const fn = vi.fn(async () => new Response(JSON.stringify(responseBody), { status: 200, headers: { "content-type": "application/json" } }));
  vi.stubGlobal("fetch", fn);
  return fn;
}
const clientPayload = { x402Version: 1, scheme: "exact", network: "base-sepolia",
  payload: { signature: "0xsig", authorization: { from: "0xabc", to: "0x312e8Efd90C134f6E54A0B612dF4f55775eC2Bd7", value: "250000", validAfter: "0", validBefore: "9999999999", nonce: "0x00" } } };

describe("facilitator selection", () => {
  it("legacy when no CDP keys, CDP when both are set", () => {
    expect(facilitatorKind()).toBe("legacy");
    expect(facilitatorBaseUrl()).toBe("https://x402.org/facilitator");
    expect(x402ProtocolVersion()).toBe(1);
    cdpOn();
    expect(facilitatorKind()).toBe("cdp");
    expect(facilitatorBaseUrl()).toBe("https://api.cdp.coinbase.com/platform/v2/x402");
    expect(x402ProtocolVersion()).toBe(2);
  });
  it("a lone CDP key is a loud misconfiguration, and the URL override never redirects CDP", () => {
    process.env.CDP_API_KEY_ID = "only-id";
    expect(() => facilitatorKind()).toThrow(/cdp_keys_incomplete/);
    delete process.env.CDP_API_KEY_ID;
    cdpOn(); process.env.X402_FACILITATOR_URL = "https://x402.org/facilitator";
    expect(facilitatorBaseUrl()).toBe("https://api.cdp.coinbase.com/platform/v2/x402");
  });
});

describe("legacy wire format (unchanged)", () => {
  it("402 body is exactly the v1 body and carries no extra headers", () => {
    const reqs = paymentRequirements("stacker");
    expect(paymentRequiredBody(reqs, "payment_required")).toEqual({ x402Version: 1, accepts: [reqs], error: "payment_required" });
    expect(paymentRequiredHeaders(paymentRequiredBody(reqs, "payment_required"))).toEqual({});
  });
  it("verify posts the v1 body to x402.org with no auth header", async () => {
    const fn = mockFetch({ isValid: true, payer: "0xabc" });
    const reqs = paymentRequirements("stacker");
    const v = await verifyPayment(clientPayload, reqs);
    expect(v.isValid).toBe(true);
    const [url, init] = fn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://x402.org/facilitator/verify");
    expect((init.headers as Record<string, string>).authorization).toBeUndefined();
    const body = JSON.parse(init.body as string);
    expect(body).toEqual({ x402Version: 1, paymentPayload: clientPayload, paymentRequirements: reqs });
  });
});

describe("CDP wire format", () => {
  it("402 body is v2: CAIP-2 amount requirements, resource info, bazaar extension, PAYMENT-REQUIRED header", () => {
    cdpOn();
    const reqs = paymentRequirements("stacker");
    const body = paymentRequiredBody(reqs, "payment_required") as Record<string, any>;
    expect(body.x402Version).toBe(2);
    expect(body.resource.url).toBe("https://example.test/api/coin");
    expect(body.resource.description).toContain("COINOP arcade: pay 0.25 USDC");
    expect(body.resource.description.length).toBeLessThanOrEqual(500);
    const accepts = body.accepts[0];
    expect(accepts.network).toBe("eip155:84532");
    expect(accepts.amount).toBe("250000");
    expect(accepts.maxAmountRequired).toBeUndefined();
    expect(accepts.payTo).toBe("0x312e8Efd90C134f6E54A0B612dF4f55775eC2Bd7");
    expect(body.extensions.bazaar.info.input.body).toEqual({ gameSlug: "stacker" });
    expect(body.extensions.bazaar.info.output.example.sessionToken).toBe("<bearer token>");
    const headers = paymentRequiredHeaders(body);
    expect(JSON.parse(Buffer.from(headers["PAYMENT-REQUIRED"], "base64").toString())).toEqual(body);
  });
  it("match create is discoverable; match join (per-match URL) is not", () => {
    cdpOn();
    const create = paymentRequiredBody(matchPaymentRequirements("snake", "/api/match"), "payment_required") as Record<string, any>;
    expect(create.extensions?.bazaar.info.input.body).toEqual({ gameSlug: "snake" });
    expect(create.resource.description).toContain("versus duel");
    const join = paymentRequiredBody(matchPaymentRequirements("snake", "/api/match/abc123/join"), "payment_required") as Record<string, any>;
    expect(join.extensions).toBeUndefined();
    expect(join.resource.url).toBe("https://example.test/api/match/abc123/join");
  });
  it("verify sends a JWT-authed v2 body with the payload enriched for discovery", async () => {
    cdpOn();
    const fn = mockFetch({ isValid: true, payer: "0xabc" });
    const reqs = paymentRequirements("stacker");
    await verifyPayment(clientPayload, reqs);
    const [url, init] = fn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.cdp.coinbase.com/platform/v2/x402/verify");
    const auth = (init.headers as Record<string, string>).authorization;
    expect(auth?.startsWith("Bearer ")).toBe(true);
    const claims = JSON.parse(Buffer.from(auth!.slice(7).split(".")[1], "base64url").toString());
    expect(claims.uri).toBe("POST api.cdp.coinbase.com/platform/v2/x402/verify");
    const body = JSON.parse(init.body as string);
    expect(body.x402Version).toBe(2);
    expect(body.paymentRequirements.network).toBe("eip155:84532");
    expect(body.paymentPayload.x402Version).toBe(2);
    expect(body.paymentPayload.resource.url).toBe("https://example.test/api/coin");
    expect(body.paymentPayload.extensions.bazaar.info.input.body).toEqual({ gameSlug: "stacker" });
    expect(body.paymentPayload.accepted.amount).toBe("250000"); // synthesized for the v1-shaped client payload
    expect(body.paymentPayload.payload.authorization.value).toBe("250000"); // the signed authorization passes through untouched
  });
  it("settle posts to /settle with a settle-bound JWT and parses the v2 response", async () => {
    cdpOn();
    const fn = mockFetch({ success: true, transaction: "0xdeadbeef", network: "eip155:84532" });
    const reqs = paymentRequirements("stacker");
    const s = await settlePayment(clientPayload, reqs);
    expect(s).toEqual({ success: true, tx: "0xdeadbeef" });
    const [url, init] = fn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.cdp.coinbase.com/platform/v2/x402/settle");
    const claims = JSON.parse(Buffer.from((init.headers as Record<string, string>).authorization.slice(7).split(".")[1], "base64url").toString());
    expect(claims.uri).toBe("POST api.cdp.coinbase.com/platform/v2/x402/settle");
    const body = JSON.parse(init.body as string);
    expect(body.paymentPayload.resource).toBeDefined();
    expect(body.paymentPayload.extensions.bazaar).toBeDefined();
  });
});
