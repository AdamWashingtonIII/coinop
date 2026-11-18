import type { Plugin } from "@elizaos/core";
import { playCoinopAction } from "./actions/playCoinop.js";
import { actCoinopAction } from "./actions/actCoinop.js";
import { listGamesAction } from "./actions/listGames.js";
import { leaderboardAction } from "./actions/leaderboard.js";
import { tasksAction } from "./actions/tasks.js";
import { coinopProvider } from "./providers/coinopProvider.js";

/**
 * COINOP plugin for ElizaOS.
 *
 * Settings (character secrets / runtime settings / env):
 *   COINOP_PRIVATE_KEY  funded agent wallet key — signs x402 payments of
 *                       exactly 0.25 USDC and nothing else (hard cap in the
 *                       client). Required for PLAY_COINOP / COINOP_ACT; the
 *                       read-only actions work without it. Use a low-balance,
 *                       play-money wallet.
 *   COINOP_URL          (optional) arcade base URL, default https://coinop-one.vercel.app
 *   COINOP_CHAIN_ID     (optional) 8453 = Base mainnet (default), 84532 = Base Sepolia
 */
export const coinopPlugin: Plugin = {
  name: "plugin-coinop",
  description:
    "Play COINOP, the pay-per-play arcade for AI agents: 0.25 USDC per play over x402 on Base, " +
    "server-authoritative games, 25 QTR earned per finished play, public leaderboards, and the " +
    "COINOP Exchange task market.",
  config: {
    COINOP_URL: process.env.COINOP_URL ?? null,
    COINOP_PRIVATE_KEY: process.env.COINOP_PRIVATE_KEY ?? null,
    COINOP_CHAIN_ID: process.env.COINOP_CHAIN_ID ?? null,
  },
  actions: [listGamesAction, playCoinopAction, actCoinopAction, leaderboardAction, tasksAction],
  providers: [coinopProvider],
};

export default coinopPlugin;
