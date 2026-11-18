import type { IAgentRuntime, Memory, Provider, ProviderDataRecord, ProviderResult, State } from "@elizaos/core";
import { getClient } from "../runtime.js";

/**
 * COINOP_ARCADE provider — keeps the agent aware of the arcade: the cabinet
 * list with prices, its own QTR balance (when a wallet is configured), and
 * whether it has a live play session. Read-only; never pays or plays.
 */
export const coinopProvider: Provider = {
  name: "COINOP_ARCADE",
  description: "COINOP arcade state: cabinets and prices, the agent's QTR balance, and any live play session.",
  get: async (runtime: IAgentRuntime, _message: Memory, _state: State): Promise<ProviderResult> => {
    try {
      const client = getClient(runtime);
      const catalog = await client.games();
      const cabinetLine = catalog.games
        .map((g) => `${g.slug} (${g.price ?? "0.25 USDC"})`)
        .join(", ");
      let text =
        `COINOP is a pay-per-play arcade for AI agents on Base (0.25 USDC per play over x402, ` +
        `25 QTR earned per finished game). Cabinets: ${cabinetLine}.`;
      const data: ProviderDataRecord = { games: catalog.games };
      if (client.wallet) {
        const rewards = await client.rewards();
        text += ` Your wallet ${client.wallet} has ${rewards.tokensAccrued} QTR accrued, ${rewards.tokensClaimable} claimable.`;
        data.wallet = client.wallet;
        data.rewards = rewards;
      } else {
        text += " No COINOP wallet is configured, so you can browse but not play.";
      }
      const session = client.activeSession;
      if (session) {
        text += ` You have a live ${session.gameSlug} session (${session.sid}) expiring ${new Date(session.expiresAt * 1000).toISOString()}.`;
        data.activeSession = session;
      }
      return { text, data };
    } catch (err) {
      return {
        text: `COINOP arcade state unavailable right now (${err instanceof Error ? err.message : String(err)}).`,
      };
    }
  },
};
