import {
  type Action,
  type ActionResult,
  type HandlerCallback,
  type IAgentRuntime,
  type Memory,
  type State,
  logger,
} from "@elizaos/core";
import { CoinopClient } from "../coinopClient.js";

const DEFAULT_COINOP_URL = "https://coinop-one.vercel.app";
const LIVE_GAMES = ["stacker", "snake", "breaker"] as const;

// One client (and its live session) per agent runtime.
const clients = new Map<string, CoinopClient>();

function getClient(runtime: IAgentRuntime): CoinopClient {
  const key = String(runtime.agentId);
  const existing = clients.get(key);
  if (existing) return existing;
  const privateKey = runtime.getSetting("COINOP_PRIVATE_KEY");
  if (!privateKey) throw new Error("COINOP_PRIVATE_KEY is not set in the agent settings");
  const client = new CoinopClient({
    baseUrl: runtime.getSetting("COINOP_URL") || DEFAULT_COINOP_URL,
    privateKey: (privateKey.startsWith("0x") ? privateKey : `0x${privateKey}`) as `0x${string}`,
    chainId: Number(runtime.getSetting("COINOP_CHAIN_ID") || "84532"),
  });
  clients.set(key, client);
  return client;
}

function pickGame(message: Memory, options?: Record<string, unknown>): string {
  const fromOptions = typeof options?.gameSlug === "string" ? options.gameSlug.toLowerCase() : "";
  if ((LIVE_GAMES as readonly string[]).includes(fromOptions)) return fromOptions;
  const text = (message.content?.text ?? "").toLowerCase();
  for (const g of LIVE_GAMES) if (text.includes(g)) return g;
  if (text.includes("stack")) return "stacker";
  if (text.includes("brick")) return "breaker";
  return "stacker";
}

/**
 * PLAY_COINOP — pay exactly 0.25 USDC (x402, Base) to start a play session at
 * the COINOP agent arcade, then report the opening state. This is a stub-level
 * integration: it coins in and reads state; a full auto-player loop (strategy
 * per game) is the natural next step — use client.act()/heartbeat() from your
 * own action or service to keep playing the session this action opens.
 */
export const playCoinopAction: Action = {
  name: "PLAY_COINOP",
  similes: ["PLAY_GAME", "INSERT_COIN", "PLAY_ARCADE", "COINOP_PLAY", "START_GAME"],
  description:
    "Pay 0.25 USDC over x402 to play a game at COINOP, the arcade where AI agents play and humans watch. " +
    "Starts a server-authoritative session on a cabinet (stacker, snake, or breaker) and returns the opening " +
    "state. A settled, completed play earns 25 QTR. Use when asked to play a game, insert a coin, or try the arcade.",
  validate: async (runtime: IAgentRuntime, message: Memory) => {
    if (!runtime.getSetting("COINOP_PRIVATE_KEY")) return false;
    const text = (message.content?.text ?? "").toLowerCase();
    return /coinop|arcade|insert coin|play (a )?(game|stacker|snake|breaker)/.test(text);
  },
  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state?: State,
    options?: Record<string, unknown>,
    callback?: HandlerCallback,
  ): Promise<ActionResult> => {
    try {
      const client = getClient(runtime);
      const gameSlug = pickGame(message, options);
      const referralCode = typeof options?.referralCode === "string" ? options.referralCode : undefined;
      const session = await client.insertCoin(gameSlug, referralCode);
      // Optionally take one immediate action (e.g. options.action = "drop").
      let lastState: unknown = await client.state();
      if (typeof options?.action === "string" && options.action) {
        lastState = await client.act(options.action);
      }
      const text =
        `Coined into COINOP ${gameSlug} as ${client.wallet}. Session ${session.sid} is live ` +
        `(expires ${new Date(session.expiresAt).toISOString()}; heartbeat extends it, 10 min max per coin). ` +
        `Opening state: ${JSON.stringify(lastState).slice(0, 500)} ` +
        `Finish the game to earn 25 QTR.`;
      logger.info(`[coinop] session ${session.sid} started on ${gameSlug}`);
      if (callback) await callback({ text, action: "PLAY_COINOP" });
      return { success: true, text, data: { session, state: lastState } };
    } catch (err) {
      const text = `COINOP play failed: ${err instanceof Error ? err.message : String(err)}`;
      logger.error(`[coinop] ${text}`);
      if (callback) await callback({ text });
      return { success: false, text, error: err instanceof Error ? err : new Error(String(err)) };
    }
  },
  examples: [
    [
      {
        name: "{{user}}",
        content: { text: "Go play a game of Snake at the COINOP arcade." },
      },
      {
        name: "{{agent}}",
        content: {
          text: "Coined into COINOP snake for 0.25 USDC. The session is live — I'll steer with up/down/left/right and finish the run to earn 25 QTR.",
          actions: ["PLAY_COINOP"],
        },
      },
    ],
    [
      {
        name: "{{user}}",
        content: { text: "Insert a coin and play some Block Stacker." },
      },
      {
        name: "{{agent}}",
        content: {
          text: "Paid exactly 0.25 USDC via x402 and started a Block Stacker session. Sending DROP actions to build the tower.",
          actions: ["PLAY_COINOP"],
        },
      },
    ],
  ],
};
