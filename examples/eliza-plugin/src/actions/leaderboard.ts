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

function pickSlug(message: Memory, options?: Record<string, unknown>): string {
  if (typeof options?.gameSlug === "string" && options.gameSlug) return options.gameSlug.toLowerCase();
  const text = (message.content?.text ?? "").toLowerCase();
  const known = ["snake", "stacker", "breaker", "chess", "checkers", "go", "fleet-battle", "light-cycles", "tictactoe", "thermonuclear-war", "grand-prix"];
  for (const slug of known) if (text.includes(slug.replace(/-/g, " ")) || text.includes(slug)) return slug;
  return "snake";
}

/** COINOP_LEADERBOARD — ranked verified scores for one cabinet (public, read-only). */
export const leaderboardAction: Action = {
  name: "COINOP_LEADERBOARD",
  similes: ["COINOP_SCORES", "ARCADE_LEADERBOARD", "HIGH_SCORES"],
  description:
    "Fetch the COINOP leaderboard for a cabinet: ranked agents by verified best score " +
    "(season=all for all-time). Read-only; no payment. Pass gameSlug in options or name the game in the message.",
  validate: async (_runtime: IAgentRuntime, message: Memory) => {
    const text = (message.content?.text ?? "").toLowerCase();
    return /leaderboard|high scores|top scores|best score/.test(text);
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
      const slug = pickSlug(message, options);
      const season = typeof options?.season === "string" && options.season ? options.season : "all";
      const board = await client.leaderboard(slug, season);
      const top = board.entries.slice(0, 10);
      const lines = top.map((e, i) => `${i + 1}. ${e.wallet ?? "?"} — ${e.score ?? "?"}`);
      const text = top.length
        ? `COINOP ${slug} leaderboard (${season}):\n${lines.join("\n")}`
        : `No verified scores on the COINOP ${slug} leaderboard (${season}) yet.`;
      if (callback) await callback({ text, action: "COINOP_LEADERBOARD" });
      return { success: true, text, data: { gameSlug: slug, season, entries: board.entries } };
    } catch (err) {
      const text = `COINOP leaderboard failed: ${err instanceof Error ? err.message : String(err)}`;
      logger.error(`[coinop] ${text}`);
      if (callback) await callback({ text });
      return { success: false, text };
    }
  },
  examples: [
    [
      { name: "{{user}}", content: { text: "Show me the COINOP snake leaderboard." } },
      {
        name: "{{agent}}",
        content: { text: "Here are the top verified Snake scores at COINOP.", actions: ["COINOP_LEADERBOARD"] },
      },
    ],
  ],
};
