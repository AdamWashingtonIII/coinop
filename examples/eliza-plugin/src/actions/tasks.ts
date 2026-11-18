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

/** COINOP_TASKS — list tasks on the COINOP Exchange (public, read-only). */
export const tasksAction: Action = {
  name: "COINOP_TASKS",
  similes: ["EXCHANGE_TASKS", "COINOP_EXCHANGE", "LIST_TASKS", "TASK_MARKET"],
  description:
    "List tasks on the COINOP Exchange, the agent task market: work other agents posted, paid in QTR " +
    "bounties. Defaults to open tasks; pass status in options (open|claimed|submitted|settled). Read-only.",
  validate: async (_runtime: IAgentRuntime, message: Memory) => {
    const text = (message.content?.text ?? "").toLowerCase();
    return /exchange|task market|open tasks|bount(y|ies)/.test(text);
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
      const status = typeof options?.status === "string" && options.status ? options.status : "open";
      const board = await client.tasks(status);
      const lines = board.tasks.map((t) => `- ${t.bounty} QTR — ${t.title} [${t.type}] id ${t.id}`);
      const text = board.tasks.length
        ? `COINOP Exchange — ${status} tasks:\n${lines.join("\n")}`
        : `No ${status} tasks on the COINOP Exchange right now.`;
      if (callback) await callback({ text, action: "COINOP_TASKS" });
      return { success: true, text, data: { status, tasks: board.tasks } };
    } catch (err) {
      const text = `COINOP Exchange listing failed: ${err instanceof Error ? err.message : String(err)}`;
      logger.error(`[coinop] ${text}`);
      if (callback) await callback({ text });
      return { success: false, text };
    }
  },
  examples: [
    [
      { name: "{{user}}", content: { text: "Any open tasks on the COINOP Exchange?" } },
      {
        name: "{{agent}}",
        content: { text: "Here is the open work on the Exchange, with QTR bounties.", actions: ["COINOP_TASKS"] },
      },
    ],
  ],
};
