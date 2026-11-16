import { PRICE_ATOMIC, CHAINS, activeChain, treasury, escrowAddress, facilitatorKind, facilitatorBaseUrl, appOrigin } from "./config";
import { generateCdpJwt } from "./cdp-auth";
import { bazaarDescription, bazaarExtensions } from "./bazaar";
// x402 facilitator HTTP client (verify + settle). Verify-pass is enough to play;
// settlement is submitted asynchronously (spec s4 step 6, s5 failure handling).
// Two providers, selected by env (see config.facilitatorKind):
//  - legacy: x402.org testnet facilitator, x402 v1 wire format, no auth.
//    Everything below reduces to the original behavior when CDP keys are
//    absent — the requirements objects, request bodies, and 402 responses
//    are byte-identical to the pre-CDP integration.
//  - cdp: Coinbase CDP facilitator (https://api.cdp.coinbase.com/platform/v2/x402),
//    x402 v2 wire format (CAIP-2 network, `amount`), per-request JWT auth,
//    and Bazaar discovery metadata declared in the 402 response and echoed
//    in the settle payload (paymentPayload.resource + .extensions.bazaar),
//    which is what gets the resource indexed after its first settlement.
export interface PaymentRequirements {
  scheme: "exact"; network: string; maxAmountRequired: string; asset: string;
  payTo: string; resource: string; description: string; maxTimeoutSeconds: number; mimeType: string;
  extra: { name: string; version: string }; // EIP-712 domain of the token — the facilitator requires it (verified live 2026-11-15)
}
export function paymentRequirements(gameSlug: string): PaymentRequirements {
  const chain = CHAINS[activeChain()];
  // x402 v1 facilitator keys networks by name ("base-sepolia"), not CAIP id, and
  // rejects payloads whose requirements lack the token's EIP-712 domain in `extra`.
  return { scheme: "exact", network: chain.name, maxAmountRequired: PRICE_ATOMIC, asset: chain.usdc,
    payTo: treasury(), resource: "/api/coin", description: "COINOP: one play of " + gameSlug,
    maxTimeoutSeconds: 60, mimeType: "application/json", extra: { name: chain.eip712Name, version: "2" } };
}
// Versus matches (ADR 0009): identical terms to a solo coin, except the stake
// settles to the match escrow wallet instead of the treasury.
export function matchPaymentRequirements(gameSlug: string, resource: string): PaymentRequirements {
  const chain = CHAINS[activeChain()];
  return { scheme: "exact", network: chain.name, maxAmountRequired: PRICE_ATOMIC, asset: chain.usdc,
    payTo: escrowAddress(), resource, description: "COINOP versus match: one stake for " + gameSlug,
    maxTimeoutSeconds: 60, mimeType: "application/json", extra: { name: chain.eip712Name, version: "2" } };
}
// ---- v2 (CDP) wire translation -------------------------------------------
// The internal PaymentRequirements above stays the canonical form every
// caller (precheck, sessions, discovery) works with; only the bytes sent to
// the facilitator and returned in a 402 are translated, and only in CDP mode.
export interface PaymentRequirementsV2 {
  scheme: string; network: string; asset: string; amount: string;
  payTo: string; maxTimeoutSeconds: number; extra: { name: string; version: string };
}
export function wireRequirements(req: PaymentRequirements): PaymentRequirements | PaymentRequirementsV2 {
  if (facilitatorKind() !== "cdp") return req;
  const chain = CHAINS[activeChain()];
  return { scheme: req.scheme, network: chain.network, asset: req.asset, amount: req.maxAmountRequired,
    payTo: req.payTo, maxTimeoutSeconds: req.maxTimeoutSeconds, extra: req.extra };
}
export interface ResourceInfo { url: string; description: string; mimeType: string }
export function resourceInfo(req: PaymentRequirements): ResourceInfo {
  return { url: appOrigin() + req.resource,
    description: bazaarDescription(req.resource) ?? req.description, mimeType: req.mimeType };
}
// The body of a 402 Payment Required response for these requirements.
// Legacy: the original v1 body. CDP: the v2 body — resource info, CAIP-2
// requirements, and the bazaar extension block for discoverable routes.
export function paymentRequiredBody(req: PaymentRequirements, error: string): Record<string, unknown> {
  if (facilitatorKind() !== "cdp") return { x402Version: 1, accepts: [req], error };
  const extensions = bazaarExtensions(req.resource);
  return { x402Version: 2, error, resource: resourceInfo(req), accepts: [wireRequirements(req)],
    ...(extensions ? { extensions } : {}) };
}
// Extra response headers for a 402. x402 v2 servers also carry the payment
// requirements base64-encoded in the PAYMENT-REQUIRED header (the Bazaar
// validator probes for it); legacy mode adds nothing.
export function paymentRequiredHeaders(body: Record<string, unknown>): Record<string, string> {
  if (facilitatorKind() !== "cdp") return {};
  return { "PAYMENT-REQUIRED": Buffer.from(JSON.stringify(body)).toString("base64") };
}
// Enrich a client payment payload for the CDP facilitator: v2 envelope,
// the resource being paid for, and the bazaar extension — the settle call
// only submits discovery when both are present. A payload missing the v2
// `accepted` block (e.g. a hand-rolled v1-shaped payload) is completed from
// the wire requirements so the facilitator sees a fully-typed payload.
function enrichPayload(payload: unknown, req: PaymentRequirements): Record<string, unknown> {
  const p = (typeof payload === "object" && payload !== null ? payload : {}) as Record<string, unknown>;
  const extensions = bazaarExtensions(req.resource);
  return { ...p, x402Version: 2,
    accepted: p.accepted ?? wireRequirements(req),
    resource: resourceInfo(req),
    ...(extensions ? { extensions: { ...(typeof p.extensions === "object" && p.extensions !== null ? p.extensions as Record<string, unknown> : {}), ...extensions } } : {}) };
}
export interface VerifyResult { isValid: boolean; invalidReason?: string; payer?: string }
async function facilitatorFetch(path: string, init: { method: string; body?: unknown }, attempts = 3): Promise<Response> {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      const url = facilitatorBaseUrl() + path;
      const headers: Record<string, string> = { "content-type": "application/json" };
      if (facilitatorKind() === "cdp") {
        const u = new URL(url);
        headers.authorization = "Bearer " + generateCdpJwt({ method: init.method, host: u.host, path: u.pathname });
      }
      const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 8000);
      const r = await fetch(url, { method: init.method, headers,
        body: init.body === undefined ? undefined : JSON.stringify(init.body), signal: ctrl.signal });
      clearTimeout(t); return r;
    } catch (e) { last = e; await new Promise((res) => setTimeout(res, 250 * (i + 1))); }
  }
  throw last instanceof Error ? last : new Error("facilitator_unreachable");
}
export async function verifyPayment(paymentPayload: unknown, req: PaymentRequirements): Promise<VerifyResult> {
  const body = facilitatorKind() === "cdp"
    ? { x402Version: 2, paymentPayload: enrichPayload(paymentPayload, req), paymentRequirements: wireRequirements(req) }
    : { x402Version: 1, paymentPayload, paymentRequirements: req };
  const r = await facilitatorFetch("/verify", { method: "POST", body });
  if (!r.ok) { let t = ""; try { t = await r.text(); } catch { /* body unreadable */ }
    return { isValid: false, invalidReason: "facilitator_" + r.status + ": " + t.slice(0, 300) }; }
  const j = (await r.json()) as VerifyResult; return j;
}
export async function settlePayment(paymentPayload: unknown, req: PaymentRequirements): Promise<{ success: boolean; tx?: string }> {
  const body = facilitatorKind() === "cdp"
    ? { x402Version: 2, paymentPayload: enrichPayload(paymentPayload, req), paymentRequirements: wireRequirements(req) }
    : { x402Version: 1, paymentPayload, paymentRequirements: req };
  const r = await facilitatorFetch("/settle", { method: "POST", body });
  if (!r.ok) return { success: false };
  const j = (await r.json()) as { success?: boolean; transaction?: string; txHash?: string };
  return { success: !!j.success, tx: j.transaction ?? j.txHash };
}
// GET /supported — the facilitator's own capability list (schemes × networks
// × extensions). Used by switch-night diagnostics to prove CDP auth works
// before any payment flows; not on the play path.
export async function getSupported(): Promise<unknown> {
  const r = await facilitatorFetch("/supported", { method: "GET" }, 1);
  if (!r.ok) throw new Error("facilitator_" + r.status);
  return r.json();
}
// Local checks that must hold before the facilitator is even asked (spec s5).
export function precheckPayload(payload: unknown, req: PaymentRequirements): string | null {
  if (typeof payload !== "object" || payload === null) return "bad_payload";
  const p = payload as { network?: string; payload?: { authorization?: { to?: string; value?: string } } };
  const auth = p.payload?.authorization;
  if (!auth) return "missing_authorization";
  if (auth.to?.toLowerCase() !== req.payTo.toLowerCase()) return "wrong_payto";
  try { if (BigInt(auth.value ?? "0") < BigInt(req.maxAmountRequired)) return "insufficient_amount"; } catch { return "bad_amount"; }
  return null;
}
