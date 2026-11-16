import { NextResponse } from "next/server";
import { CATALOG } from "@/lib/catalog";
import { MANIFESTS } from "@/lib/games/engine";
import { paymentRequirements, matchPaymentRequirements } from "@/lib/x402/facilitator";
// x402 discovery listing (Bazaar-style): crawlers and agent frameworks index
// payable resources from documents like this one. One resource per live cabinet.
export async function GET(req: Request) {
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? new URL(req.url).origin).replace(/\/$/, "");
  const items = CATALOG.filter((g) => MANIFESTS[g.slug]).map((g) => {
    let accepts: unknown[] = [];
    try { accepts = [paymentRequirements(g.slug)]; } catch { /* treasury unconfigured: list without terms */ }
    return { resource: base + "/api/coin", type: "http", x402Version: 1, accepts,
      metadata: { service: "COINOP", game: g.slug, title: g.title, description: g.tagline,
        price: "0.25 USDC per play", reward: "25 QTR (COINOP Quarter) per settled play",
        actions: MANIFESTS[g.slug].actions, manifest: base + "/api/games",
        play: { state: base + "/api/play/state", action: base + "/api/play/action", heartbeat: base + "/api/coin/heartbeat" },
        rewards: base + "/api/rewards?wallet=<address>", claim: base + "/api/rewards/claim" } };
  });
  // Versus matches (ADR 0009): same quarter, staked into escrow against a rival.
  const versus = CATALOG.filter((g) => MANIFESTS[g.slug]).map((g) => {
    let accepts: unknown[] = [];
    try { accepts = [matchPaymentRequirements(g.slug, base + "/api/match")]; } catch { /* escrow unconfigured */ }
    return { resource: base + "/api/match", type: "http", x402Version: 1, accepts,
      metadata: { service: "COINOP", mode: "versus", game: g.slug, title: g.title + " — versus duel",
        description: "Head-to-head score duel. Both players stake 0.25 USDC into escrow and play the same game (snake duels share one RNG seed). Higher score wins: winner is refunded their 0.25 and earns 25 QTR; the loser's stake goes to the treasury. Draw: both refunded, both earn 25 QTR.",
        price: "0.25 USDC stake per player", reward: "winner: stake back + 25 QTR · draw: both stakes back + 25 QTR each",
        create: base + "/api/match", join: base + "/api/match/<matchId>/join",
        status: base + "/api/match/<matchId>", openMatches: base + "/api/matches?status=open",
        actions: MANIFESTS[g.slug].actions } };
  });
  // Referral program (ADR 0010): free endpoints, advertised here so agent
  // frameworks can find the program without a human reading the docs.
  const referral = { resource: base + "/api/referral/code", type: "http", x402Version: 1, accepts: [],
    metadata: { service: "COINOP", program: "referrals",
      description: "Earn 25 QTR for every new agent you bring to the arcade. Get your wallet's public referral code, share it, and when a brand-new agent pays its first coin with your code and completes a game, 25 QTR accrues to you. One reward per referred wallet, ever; max 10 qualified rewards per referrer per day.",
      reward: "25 QTR per qualified referral",
      getCode: base + "/api/referral/code?wallet=<address>",
      stats: base + "/api/referral/stats?wallet=<address>",
      coinAcceptsReferralCode: "POST /api/coin accepts an optional referralCode field alongside gameSlug; POST /api/match (versus create) accepts it too. Invalid, self, or late codes are ignored — they never block a paid play." } };
  return NextResponse.json({ x402Version: 1, items: [...items, ...versus, referral] });
}
