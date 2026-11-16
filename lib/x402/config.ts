// Spec sections 2.1, 3, 5. Price is hardcoded — never floats.
export const PRICE_ATOMIC = "250000"; // 0.25 USDC, 6 decimals
export const CHAINS = {
  84532: { name: "base-sepolia", network: "eip155:84532", usdc: "0x036CbD53842c5426634e7929541eC2318f3dCF7e", eip712Name: "USDC" },
  8453: { name: "base", network: "eip155:8453", usdc: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", eip712Name: "USD Coin" },
} as const;
export type ChainId = keyof typeof CHAINS;
export function activeChain(): ChainId {
  const id = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 84532);
  if (id !== 84532 && id !== 8453) throw new Error("Unsupported chain " + id);
  return id;
}
export function treasury(): string {
  const a = process.env.TREASURY_ADDRESS ?? "";
  if (!/^0x[0-9a-fA-F]{40}$/.test(a)) throw new Error("TREASURY_ADDRESS missing/invalid");
  return a;
}
// Versus-match escrow (ADR 0009): both players' stakes settle here; settlement
// pays the winner's refund and forwards the loser's stake to the treasury.
export function escrowAddress(): string {
  const a = process.env.MATCH_ESCROW_ADDRESS ?? "";
  if (!/^0x[0-9a-fA-F]{40}$/.test(a)) throw new Error("MATCH_ESCROW_ADDRESS missing/invalid");
  return a;
}
// Facilitator selection (mainnet-switch prep): when BOTH CDP API key env vars
// are set, verify/settle go to the Coinbase CDP facilitator speaking x402 v2
// with per-request JWT auth; otherwise the legacy x402.org testnet facilitator
// speaks x402 v1 with no auth — byte-identical to the original integration.
// Selection is read from env on every call so tests and deploys can flip it
// without a code change. A lone CDP key is a misconfiguration: fail loud
// rather than silently settling through the wrong provider.
export const CDP_FACILITATOR_BASE = "https://api.cdp.coinbase.com/platform/v2/x402";
export const LEGACY_FACILITATOR_BASE = "https://x402.org/facilitator";
export interface CdpApiKeys { id: string; secret: string }
export function cdpApiKeys(): CdpApiKeys | null {
  const id = (process.env.CDP_API_KEY_ID ?? "").trim();
  const secret = (process.env.CDP_API_KEY_SECRET ?? "").trim();
  if (id && secret) return { id, secret };
  if (id || secret) throw new Error("cdp_keys_incomplete: set both CDP_API_KEY_ID and CDP_API_KEY_SECRET");
  return null;
}
export function facilitatorKind(): "cdp" | "legacy" { return cdpApiKeys() ? "cdp" : "legacy"; }
export function facilitatorBaseUrl(): string {
  // The X402_FACILITATOR_URL override applies to the legacy provider only;
  // the CDP base is fixed so a stale testnet override can never redirect
  // authenticated mainnet settlement.
  if (facilitatorKind() === "cdp") return CDP_FACILITATOR_BASE;
  return process.env.X402_FACILITATOR_URL ?? LEGACY_FACILITATOR_BASE;
}
export function x402ProtocolVersion(): 1 | 2 { return facilitatorKind() === "cdp" ? 2 : 1; }
// Public origin of the app, used for absolute resource URLs in v2 payment
// payloads and Bazaar discovery metadata.
export function appOrigin(): string {
  return (process.env.NEXT_PUBLIC_APP_URL ?? "https://coinop-one.vercel.app").replace(/\/+$/, "");
}
