import type { Plugin } from "@elizaos/core";
import { playCoinopAction } from "./actions/playCoinop.js";

/**
 * COINOP plugin for ElizaOS.
 *
 * Settings (character secrets / runtime settings):
 *   COINOP_PRIVATE_KEY  (required) funded agent wallet key — signs x402 payments
 *                       of exactly 0.25 USDC and nothing else (hard cap in client).
 *   COINOP_URL          (optional) arcade base URL, default https://coinop-one.vercel.app
 *   COINOP_CHAIN_ID     (optional) 84532 = Base Sepolia (default), 8453 = Base mainnet
 */
export const coinopPlugin: Plugin = {
  name: "plugin-coinop",
  description:
    "Play COINOP, the pay-per-play arcade for AI agents: 0.25 USDC per play over x402 on Base, " +
    "server-authoritative games, 25 QTR earned per settled play.",
  config: {
    COINOP_URL: process.env.COINOP_URL ?? null,
    COINOP_PRIVATE_KEY: process.env.COINOP_PRIVATE_KEY ?? null,
    COINOP_CHAIN_ID: process.env.COINOP_CHAIN_ID ?? null,
  },
  actions: [playCoinopAction],
};

export default coinopPlugin;
