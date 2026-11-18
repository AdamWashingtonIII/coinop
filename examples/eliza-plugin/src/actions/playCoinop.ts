import {
  type Action,
  type ActionResult,
  type HandlerCallback,
  type IAgentRuntime,
  type Memory,
  type State,
  logger,
} from "@elizaos/core";
import { getClient, hasWallet } from "../runtime.js";

function pickGame(message: Memory, options?: Record<string, unknown>): string {
  if (typeof options?.gameSlug === "string" && options.gameSlug) return options.gameSlug.toLowerCase();
  const text = (message.content?.text ?? "").toLowerCase();
  if (text.includes("snake")) return "snake";
  if (text.includes("stack")) return "stacker";
  if (text.includes("brick") || text.includes("breaker")) return "breaker";
  if (text.includes("chess")) return "chess";
  if (text.includes("checkers")) return "checkers";
  if (text.includes("grand prix")) return "grand-prix";
  return "snake";
}

/**
 * PLAY_COINOP — pay exactly 0.25 USDC (x402, Base) with the agent's own wallet
 * to start a session at the COINOP arcade. For Snake it then plays the run to
 * completion with the simple safe strategy from examples/player-agent; a
 * finished game releases the 25 QTR reward. For other cabinets it opens the
 * session and returns the opening state — steer it with COINOP_ACT.
 * The client hard-caps every payment at exactly 250000 atomic USDC to the
 * arcade's stated payTo on the canonical USDC contract; anything else is
 * refused before signing.
 */
export const playCoinopAction: Action = {
  name: "PLAY_COINOP",
  similes: ["PLAY_GAME", "INSERT_COIN", "PLAY_ARCADE", "COINOP_PLAY", "START_GAME"],
  description:
    "Pay 0.25 USDC over x402 to play a game at COINOP, the arcade where AI agents play and humans watch. " +
    "Snake runs are played to completion automatically; other cabinets open a live session you steer with " +
    "COINOP_ACT. A finished game earns 25 QTR. Requires COINOP_PRIVATE_KEY (the agent's funded wallet).",
  validate: async (runtime: IAgentRuntime, message: Memory) => {
    if (!hasWallet(runtime)) return false;
    const text = (message.content?.text ?? "").toLowerCase();
    return /coinop|arcade|insert coin|play (a )?(game|snake|stacker|breaker|chess|checkers)/.test(text);
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
      logger.info(`[coinop] session ${session.sid} started on ${gameSlug} for ${client.wallet}`);

      if (gameSlug === "snake" && options?.autoPlay !== false) {
        const final = await client.playSnakeToCompletion();
        await new Promise((r) => setTimeout(r, 1500)); // let the server record the result
        const rewards = client.wallet ? await client.rewards() : null;
        const text =
          `Played COINOP snake as ${client.wallet}: game over — score ${final.score ?? "?"}, ` +
          `length ${final.length ?? "?"} (${final.overReason ?? "finished"}). ` +
          (rewards
            ? `QTR accrued: ${rewards.tokensAccrued}, claimable: ${rewards.tokensClaimable} (a finished game releases 25 QTR).`
            : "A finished game releases 25 QTR.");
        if (callback) await callback({ text, action: "PLAY_COINOP" });
        return { success: true, text, data: { session, finalState: final, rewards } };
      }

      const opening = await client.state();
      const text =
        `Coined into COINOP ${gameSlug} as ${client.wallet}. Session ${session.sid} is live ` +
        `(token expires ${new Date(session.expiresAt * 1000).toISOString()}; heartbeat extends it, 10 min max per coin). ` +
        `Opening state: ${JSON.stringify(opening).slice(0, 500)} ` +
        `Steer with COINOP_ACT and finish the game to earn 25 QTR.`;
      if (callback) await callback({ text, action: "PLAY_COINOP" });
      return { success: true, text, data: { session, state: opening } };
    } catch (err) {
      const text = `COINOP play failed: ${err instanceof Error ? err.message : String(err)}`;
      logger.error(`[coinop] ${text}`);
      if (callback) await callback({ text });
      return { success: false, text };
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
          text: "Paid 0.25 USDC via x402 and played a full Snake run at COINOP. The finished game released 25 QTR.",
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
          text: "Coined into COINOP stacker for exactly 0.25 USDC. The session is live — I'll steer it with COINOP_ACT drop moves.",
          actions: ["PLAY_COINOP"],
        },
      },
    ],
  ],
};
