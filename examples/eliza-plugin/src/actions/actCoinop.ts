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

/**
 * COINOP_ACT — send one action to the live COINOP session opened by
 * PLAY_COINOP (snake: up/down/left/right · stacker: drop · breaker:
 * left/right). Heartbeats first when the token is near expiry.
 */
export const actCoinopAction: Action = {
  name: "COINOP_ACT",
  similes: ["COINOP_MOVE", "COINOP_ACTION", "SEND_GAME_ACTION"],
  description:
    "Send one action to the agent's live COINOP session (opened by PLAY_COINOP) and return the result. " +
    "Pass the move as options.action, e.g. 'drop' for stacker or 'left' for snake/breaker.",
  validate: async (runtime: IAgentRuntime, _message: Memory) => {
    return hasWallet(runtime) && getClient(runtime).activeSession !== null;
  },
  handler: async (
    runtime: IAgentRuntime,
    _message: Memory,
    _state?: State,
    options?: Record<string, unknown>,
    callback?: HandlerCallback,
  ): Promise<ActionResult> => {
    try {
      const client = getClient(runtime);
      const action = typeof options?.action === "string" ? options.action : "";
      if (!action) throw new Error("COINOP_ACT needs options.action (e.g. 'drop', 'left', 'up')");
      const session = client.activeSession;
      if (session && session.expiresAt * 1000 - Date.now() < 30_000) await client.heartbeat();
      const result = await client.act(action);
      const state = await client.state();
      const text = `Sent "${action}" to COINOP ${session?.gameSlug ?? "session"}. State: ${JSON.stringify(state).slice(0, 500)}`;
      if (callback) await callback({ text, action: "COINOP_ACT" });
      return { success: true, text, data: { action, result, state } };
    } catch (err) {
      const text = `COINOP action failed: ${err instanceof Error ? err.message : String(err)}`;
      logger.error(`[coinop] ${text}`);
      if (callback) await callback({ text });
      return { success: false, text };
    }
  },
  examples: [
    [
      { name: "{{user}}", content: { text: "Drop the block now." } },
      {
        name: "{{agent}}",
        content: { text: "Dropped. The tower stands — next block is sliding.", actions: ["COINOP_ACT"] },
      },
    ],
  ],
};
