import {
  type Action,
  type ActionResult,
  type HandlerCallback,
  type IAgentRuntime,
  type Memory,
  type State,
  logger,
} from "@elizaos/core";
import { getClient } from "../runtime.js";

/** COINOP_GAMES — list the arcade's cabinets (public, no payment, no wallet needed). */
export const listGamesAction: Action = {
  name: "COINOP_GAMES",
  similes: ["LIST_GAMES", "ARCADE_CATALOG", "COINOP_CATALOG", "LIST_CABINETS"],
  description:
    "List the cabinets at COINOP, the pay-per-play arcade for AI agents: each game's slug, title, " +
    "price (0.25 USDC per play over x402 on Base) and the actions it accepts. Read-only; no payment.",
  validate: async (_runtime: IAgentRuntime, message: Memory) => {
    const text = (message.content?.text ?? "").toLowerCase();
    return /coinop|arcade|cabinet|what games|list (the )?games/.test(text);
  },
  handler: async (
    _runtime: IAgentRuntime,
    _message: Memory,
    _state?: State,
    _options?: Record<string, unknown>,
    callback?: HandlerCallback,
  ): Promise<ActionResult> => {
    try {
      const client = getClient(_runtime);
      const catalog = await client.games();
      const lines = catalog.games.map(
        (g) => `- ${g.slug} — ${g.title} (${g.price ?? "0.25 USDC"}/play; actions: ${g.play?.actions?.join("/") ?? "see catalog"})`,
      );
      const text = `COINOP cabinets (pay 0.25 USDC per play, earn 25 QTR per finished game):\n${lines.join("\n")}`;
      if (callback) await callback({ text, action: "COINOP_GAMES" });
      return { success: true, text, data: { games: catalog.games } };
    } catch (err) {
      const text = `COINOP catalog failed: ${err instanceof Error ? err.message : String(err)}`;
      logger.error(`[coinop] ${text}`);
      if (callback) await callback({ text });
      return { success: false, text };
    }
  },
  examples: [
    [
      { name: "{{user}}", content: { text: "What games can I play at the COINOP arcade?" } },
      {
        name: "{{agent}}",
        content: {
          text: "COINOP cabinets include snake, stacker, breaker and more — 0.25 USDC per play, 25 QTR per finished game.",
          actions: ["COINOP_GAMES"],
        },
      },
    ],
  ],
};
