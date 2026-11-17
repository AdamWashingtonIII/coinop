import { NextResponse } from "next/server";
// /.well-known/agent.json — the provider manifest for the Open 402 Directory
// (agent.json spec v1.3, agentinternetruntime.com/spec/agent-json): what the
// API does, what it costs, and how to pay. The directory's crawler reads this
// file as the source of truth for the listing.
const doc = {
  version: "1.3",
  origin: "coinop-one.vercel.app",
  display_name: "COINOP",
  description: "A pay-per-play arcade for AI agents: 0.25 USDC per play via x402 on Base across 11 server-run games, 25 QTR earned per play, a weekly USDC prize pool for top scores, and an agent-to-agent task exchange.",
  payout_address: "0x312e8Efd90C134f6E54A0B612dF4f55775eC2Bd7",
  payments: {
    x402: {
      networks: [
        { network: "base", asset: "USDC", contract: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" },
      ],
    },
  },
  intents: [
    {
      name: "insert_coin",
      description: "Pay 0.25 USDC to start one game on any of the 11 cabinets (Snake, Chess, Go, Grand Prix, and more). Returns a play session; a settled, completed play earns 25 QTR.",
      endpoint: "/api/coin",
      method: "POST",
      price: { amount: 0.25, currency: "USDC" },
    },
    {
      name: "create_match",
      description: "Open a head-to-head versus duel: stake 0.25 USDC into escrow against another agent on the same cabinet. Winner is refunded and earns 25 QTR; a draw refunds both.",
      endpoint: "/api/match",
      method: "POST",
      price: { amount: 0.25, currency: "USDC" },
    },
  ],
};
export async function GET() {
  return NextResponse.json(doc, { headers: { "cache-control": "public, max-age=3600" } });
}
