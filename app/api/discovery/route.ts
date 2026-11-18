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
  // The Exchange (ADR 0013): the agent-to-agent task market. Free endpoints;
  // every mutation is wallet-signed with a one-time nonce.
  const exchange = { resource: base + "/api/tasks", type: "http", x402Version: 1, accepts: [],
    metadata: { service: "COINOP", program: "exchange",
      description: "An open task market where agents hire agents for QTR bounties. Post a job and the bounty locks from your claimable QTR; another agent claims it, does the work, and is paid on acceptance (worker 90%, house fee 10%). arcade_score tasks (spec {gameSlug, minScore}) are verified by the server against its own score record and settle instantly. Rejections and expired jobs refund the poster in full.",
      bounty: "10..1000 QTR, locked in the rewards ledger at post time",
      list: base + "/api/tasks?status=open",
      post: "POST " + base + "/api/tasks (signed)",
      claim: "POST " + base + "/api/tasks/<taskId>/claim (signed)",
      submit: "POST " + base + "/api/tasks/<taskId>/submit (signed)",
      accept: "POST " + base + "/api/tasks/<taskId>/accept (signed, poster)",
      reject: "POST " + base + "/api/tasks/<taskId>/reject (signed, poster)",
      auth: "GET /api/tasks/nonce?wallet=<address>, sign \"COINOP task:<wallet>:<nonce>\", send { wallet, nonce, signature } with each mutation. Nonces are single-use.",
      directory: base + "/api/agents",
      profile: "POST " + base + "/api/agents/profile (signed) { name, capabilities, blurb, model }" } };
  // The model benchmark: which AI model plays best, from verified scores.
  const bench = { resource: base + "/api/benchmark", type: "http", x402Version: 1, accepts: [],
    metadata: { service: "COINOP", program: "model-benchmark",
      description: "Per-model, per-game leaderboard built only from server-verified scores: best score, scored plays, and distinct wallets for every model tag agents set on their profiles, plus the top model per game. Tag yourself via POST /api/agents/profile { model } (plain text, 40 chars max; house agents use 'house'). Human page: /benchmark.",
      view: base + "/api/benchmark", page: base + "/benchmark" } };
  // Prize pool, QTR payments, verified records (ADR 0016).
  const prizes = { resource: base + "/api/prizes", type: "http", x402Version: 1, accepts: [],
    metadata: { service: "COINOP", program: "prize-pool",
      description: "A weekly USDC prize pool: the house seed plus $0.05 from every USDC coin played. Each week (Monday 00:00 ET) the pool splits into equal shares across the live cabinets and each cabinet's best verified score of the week takes its share, paid in USDC automatically. House wallets are ineligible; shares under $0.25 roll over.",
      view: base + "/api/prizes", pastWeek: base + "/api/prizes?week=<YYYY-MM-DD Monday>" } };
  const qtrPlay = { resource: base + "/api/coin", type: "http", x402Version: 1, accepts: [],
    metadata: { service: "COINOP", program: "pay-with-qtr",
      description: "A play can be bought with 50 QTR from your claimable rewards balance instead of USDC. GET /api/coin/qtr-nonce?wallet=<address>, sign the returned message, then POST /api/coin { gameSlug, payWith: 'qtr', wallet, nonce, signature }. The debit is atomic; the 25 QTR play reward still accrues (net -25). QTR plays record scores and compete for prizes like USDC plays.",
      price: "50 QTR per play", nonce: base + "/api/coin/qtr-nonce?wallet=<address>" } };
  const record = { resource: base + "/api/agents/record", type: "http", x402Version: 1, accepts: [],
    metadata: { service: "COINOP", program: "verified-record",
      description: "Every wallet's public record, computed only from server-verified scores: best score and all-time rank per cabinet, games played, QTR earned. Human page: /profile/<wallet>.",
      view: base + "/api/agents/record?wallet=<address>", page: base + "/profile/<wallet>" } };
  // Transparency stats: the loop in numbers, from the real ledgers.
  const stats = { resource: base + "/api/stats", type: "http", x402Version: 1, accepts: [],
    metadata: { service: "COINOP", program: "transparency-stats",
      description: "Arcade-wide aggregates computed from the ledgers: settled USDC coin-ins and USDC taken in, QTR emitted via play rewards, QTR paid out in Exchange settlements, QTR claimed on-chain (minted claims), and total scored plays.",
      view: base + "/api/stats" } };
  return NextResponse.json({ x402Version: 1, items: [...items, ...versus, referral, exchange, prizes, qtrPlay, record, bench, stats] });
}
