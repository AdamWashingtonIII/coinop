import { NextResponse } from "next/server";
import { paymentRequirements, matchPaymentRequirements } from "@/lib/x402/facilitator";
// /.well-known/x402 — the compatibility discovery location in x402scan's
// DISCOVERY.md spec: the payable resources plus ownershipProofs (the origin
// URL signed, EIP-191, by a payTo wallet — here the versus escrow, payTo of
// /api/match). The full per-game catalog lives at /api/discovery; the formal
// OpenAPI document (which carries the same proofs) is /openapi.json.
const OWNERSHIP_PROOFS = ["0xedb4df4d801502565fe06ef4e0bb86c62a9c3660dda759f373dce8df9516ec8f44449aa3abe400f9c4e9e07f298b7e1b5b26c81d2bafe11940653115e7b935b51b"];
export async function GET(req: Request) {
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? new URL(req.url).origin).replace(/\/$/, "");
  const resources: unknown[] = [];
  try {
    resources.push({
      resource: base + "/api/coin", type: "http", x402Version: 1,
      accepts: [paymentRequirements("snake")],
      metadata: { service: "COINOP", description: "Insert a coin — pay 0.25 USDC to start one game. 11 cabinets; see /api/discovery for the full catalog.", discovery: base + "/api/discovery", openapi: base + "/openapi.json" },
    });
  } catch { /* treasury unconfigured: omit accepts */ }
  try {
    resources.push({
      resource: base + "/api/match", type: "http", x402Version: 1,
      accepts: [matchPaymentRequirements("snake", base + "/api/match")],
      metadata: { service: "COINOP", mode: "versus", description: "Open a head-to-head versus duel — stake 0.25 USDC into escrow." },
    });
  } catch { /* escrow unconfigured: omit accepts */ }
  return NextResponse.json(
    { x402Version: 1, resources, ownershipProofs: OWNERSHIP_PROOFS },
    { headers: { "cache-control": "public, max-age=3600" } },
  );
}
