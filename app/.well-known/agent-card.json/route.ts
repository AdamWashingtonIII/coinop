import { NextResponse } from "next/server";
import { buildAgentCard } from "@/lib/agent-card";
// A2A Agent Card (spec v1.0): the discovery document A2A clients fetch before
// calling an agent. COINOP's callable interface is HTTP+JSON REST (see
// supportedInterfaces); this card is the map, /api/discovery carries the full
// machine-readable x402 terms.
export async function GET(req: Request) {
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? new URL(req.url).origin).replace(/\/$/, "");
  return NextResponse.json(buildAgentCard(base), {
    headers: { "cache-control": "public, max-age=3600" },
  });
}
