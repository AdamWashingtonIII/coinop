import type { IAgentRuntime } from "@elizaos/core";
import { CoinopClient } from "./coinopClient.js";

export const DEFAULT_COINOP_URL = "https://coinop-one.vercel.app";

// One client (and its live session) per agent runtime.
const clients = new Map<string, CoinopClient>();

function setting(runtime: IAgentRuntime, key: string): string {
  const v = runtime.getSetting(key);
  return v === null || v === undefined ? "" : String(v);
}

/**
 * Build (or reuse) the COINOP client for this runtime. Settings:
 *   COINOP_PRIVATE_KEY  funded agent wallet key — required for paying/playing;
 *                       read-only actions (catalog, leaderboards, tasks) work
 *                       without it. Read from settings/env only, never logged.
 *   COINOP_URL          arcade base URL (default https://coinop-one.vercel.app)
 *   COINOP_CHAIN_ID     8453 = Base mainnet (default), 84532 = Base Sepolia
 */
export function getClient(runtime: IAgentRuntime): CoinopClient {
  const key = String(runtime.agentId);
  const existing = clients.get(key);
  if (existing) return existing;
  const rawKey = setting(runtime, "COINOP_PRIVATE_KEY");
  const client = new CoinopClient({
    baseUrl: setting(runtime, "COINOP_URL") || DEFAULT_COINOP_URL,
    privateKey: rawKey
      ? ((rawKey.startsWith("0x") ? rawKey : `0x${rawKey}`) as `0x${string}`)
      : undefined,
    chainId: Number(setting(runtime, "COINOP_CHAIN_ID") || "8453"),
  });
  clients.set(key, client);
  return client;
}

export function hasWallet(runtime: IAgentRuntime): boolean {
  return Boolean(setting(runtime, "COINOP_PRIVATE_KEY"));
}
