import { z } from "zod";
import { ActionProvider, CreateAction, EvmWalletProvider, Network } from "@coinbase/agentkit";
import { CoinopClient, type CoinopSigner } from "./coinopClient.js";
import {
  ActSchema,
  LeaderboardSchema,
  ListGamesSchema,
  PlayGameSchema,
  RewardsSchema,
  TasksSchema,
} from "./schemas.js";

const DEFAULT_COINOP_URL = "https://coinop-one.vercel.app";

// One client (and its live session) per signer address.
const clients = new Map<string, CoinopClient>();

/**
 * Build (or reuse) a COINOP client for this call. Signing, in order:
 *  1. COINOP_PRIVATE_KEY env var, if set — a dedicated play wallet (the key
 *     is read from the environment only, never logged, and only signs the
 *     hard-capped 0.25 USDC x402 authorization).
 *  2. Otherwise the AgentKit wallet itself, via EvmWalletProvider.signTypedData
 *     — fund that wallet with USDC on Base.
 * Read-only actions (list games, leaderboard, tasks) need neither.
 */
function clientFor(walletProvider: EvmWalletProvider): CoinopClient {
  const baseUrl = (process.env.COINOP_URL ?? DEFAULT_COINOP_URL).replace(/\/$/, "");
  const chainId = Number(process.env.COINOP_CHAIN_ID ?? "8453");
  const envKey = process.env.COINOP_PRIVATE_KEY;
  const cacheKey = envKey ? `env:${baseUrl}:${chainId}` : `${walletProvider.getAddress()}:${baseUrl}:${chainId}`;
  const existing = clients.get(cacheKey);
  if (existing) return existing;
  let client: CoinopClient;
  if (envKey) {
    client = new CoinopClient({
      baseUrl,
      chainId,
      privateKey: (envKey.startsWith("0x") ? envKey : `0x${envKey}`) as `0x${string}`,
    });
  } else {
    const signer: CoinopSigner = {
      address: walletProvider.getAddress() as `0x${string}`,
      signTypedData: (data) => walletProvider.signTypedData(data),
    };
    client = new CoinopClient({ baseUrl, chainId, signer });
  }
  clients.set(cacheKey, client);
  return client;
}

/** Read-only client (no signer) for the public endpoints. */
function readClient(): CoinopClient {
  const baseUrl = (process.env.COINOP_URL ?? DEFAULT_COINOP_URL).replace(/\/$/, "");
  const chainId = Number(process.env.COINOP_CHAIN_ID ?? "8453");
  const cacheKey = `read:${baseUrl}:${chainId}`;
  const existing = clients.get(cacheKey);
  if (existing) return existing;
  const client = new CoinopClient({ baseUrl, chainId });
  clients.set(cacheKey, client);
  return client;
}

/**
 * CoinopActionProvider — lets a Coinbase AgentKit agent play COINOP, the
 * pay-per-play arcade for AI agents on Base: list cabinets, pay exactly
 * 0.25 USDC per play over x402 and play (the client hard-caps the payment and
 * refuses any other terms before signing), read leaderboards and its QTR
 * balance, and browse the COINOP Exchange task market.
 *
 * Env:
 *   COINOP_URL          (optional) arcade base URL, default https://coinop-one.vercel.app
 *   COINOP_CHAIN_ID     (optional) 8453 = Base mainnet (default), 84532 = Base Sepolia
 *   COINOP_PRIVATE_KEY  (optional) dedicated play-wallet key; when unset, the
 *                       AgentKit wallet signs the x402 payments itself.
 */
export class CoinopActionProvider extends ActionProvider<EvmWalletProvider> {
  constructor() {
    super("coinop", []);
  }

  @CreateAction({
    name: "coinop_list_games",
    description:
      "List the cabinets at COINOP, the pay-per-play arcade for AI agents: each game's slug, title, " +
      "price (0.25 USDC per play over x402 on Base) and the actions it accepts. Read-only.",
    schema: ListGamesSchema,
  })
  async listGames(
    _walletProvider: EvmWalletProvider,
    _args: z.infer<typeof ListGamesSchema>,
  ): Promise<string> {
    const catalog = await readClient().games();
    const lines = catalog.games.map(
      (g) => `- ${g.slug} — ${g.title} (${g.price ?? "0.25 USDC"}/play; actions: ${g.play?.actions?.join("/") ?? "see catalog"})`,
    );
    return `COINOP cabinets (pay 0.25 USDC per play, earn 25 QTR per finished game):\n${lines.join("\n")}`;
  }

  @CreateAction({
    name: "coinop_play_game",
    description:
      "Pay exactly 0.25 USDC over x402 (Base) and play a game at COINOP. Snake runs are played to " +
      "completion automatically and the finished game earns 25 QTR; other cabinets open a live session " +
      "you steer with coinop_act. The payment is hard-capped at 0.25 USDC to the arcade — any other " +
      "402 terms are refused before signing.",
    schema: PlayGameSchema,
  })
  async playGame(
    walletProvider: EvmWalletProvider,
    args: z.infer<typeof PlayGameSchema>,
  ): Promise<string> {
    const client = clientFor(walletProvider);
    const session = await client.insertCoin(args.gameSlug, args.referralCode);
    if (args.gameSlug === "snake" && args.autoPlay) {
      const final = await client.playSnakeToCompletion();
      await new Promise((r) => setTimeout(r, 1500)); // let the server record the result
      const rewards = await client.rewards();
      return (
        `Played COINOP snake as ${client.wallet}: game over — score ${final.score ?? "?"}, ` +
        `length ${final.length ?? "?"} (${final.overReason ?? "finished"}). ` +
        `QTR accrued: ${rewards.tokensAccrued}, claimable: ${rewards.tokensClaimable} (a finished game releases 25 QTR).`
      );
    }
    const opening = await client.state();
    return (
      `Coined into COINOP ${args.gameSlug} as ${client.wallet}. Session ${session.sid} is live ` +
      `(token expires ${new Date(session.expiresAt * 1000).toISOString()}; 10 min max per coin). ` +
      `Opening state: ${JSON.stringify(opening).slice(0, 500)} Steer it with coinop_act and finish the game to earn 25 QTR.`
    );
  }

  @CreateAction({
    name: "coinop_act",
    description:
      "Send one action to the agent's live COINOP session (opened by coinop_play_game) and return the " +
      "new state. Examples: 'up'/'down'/'left'/'right' (snake), 'drop' (stacker), 'left'/'right' (breaker).",
    schema: ActSchema,
  })
  async act(walletProvider: EvmWalletProvider, args: z.infer<typeof ActSchema>): Promise<string> {
    const client = clientFor(walletProvider);
    const session = client.activeSession;
    if (!session) return "No live COINOP session — coin in first with coinop_play_game.";
    if (session.expiresAt * 1000 - Date.now() < 30_000) await client.heartbeat();
    await client.act(args.action);
    const state = await client.state();
    return `Sent "${args.action}" to COINOP ${session.gameSlug}. State: ${JSON.stringify(state).slice(0, 500)}`;
  }

  @CreateAction({
    name: "coinop_leaderboard",
    description:
      "Fetch the COINOP leaderboard for a cabinet: ranked agents by verified best score. " +
      "season 'all' (default) is all-time. Read-only.",
    schema: LeaderboardSchema,
  })
  async leaderboard(
    _walletProvider: EvmWalletProvider,
    args: z.infer<typeof LeaderboardSchema>,
  ): Promise<string> {
    const board = await readClient().leaderboard(args.gameSlug, args.season);
    if (!board.entries.length) return `No verified scores on the COINOP ${args.gameSlug} leaderboard (${args.season}) yet.`;
    const lines = board.entries.slice(0, 10).map((e, i) => `${i + 1}. ${e.wallet ?? "?"} — ${e.score ?? "?"}`);
    return `COINOP ${args.gameSlug} leaderboard (${args.season}):\n${lines.join("\n")}`;
  }

  @CreateAction({
    name: "coinop_tasks",
    description:
      "List tasks on the COINOP Exchange, the agent task market: work other agents posted, paid in QTR " +
      "bounties. Defaults to open tasks. Read-only.",
    schema: TasksSchema,
  })
  async tasks(_walletProvider: EvmWalletProvider, args: z.infer<typeof TasksSchema>): Promise<string> {
    const board = await readClient().tasks(args.status);
    if (!board.tasks.length) return `No ${args.status} tasks on the COINOP Exchange right now.`;
    const lines = board.tasks.map((t) => `- ${t.bounty} QTR — ${t.title} [${t.type}] id ${t.id}`);
    return `COINOP Exchange — ${args.status} tasks:\n${lines.join("\n")}`;
  }

  @CreateAction({
    name: "coinop_rewards",
    description: "Read the agent wallet's COINOP QTR balance: total accrued and claimable amounts.",
    schema: RewardsSchema,
  })
  async rewards(
    walletProvider: EvmWalletProvider,
    _args: z.infer<typeof RewardsSchema>,
  ): Promise<string> {
    const client = clientFor(walletProvider);
    const rewards = await client.rewards();
    return `COINOP QTR for ${client.wallet}: accrued ${rewards.tokensAccrued}, claimable ${rewards.tokensClaimable}.`;
  }

  supportsNetwork = (network: Network): boolean => network.protocolFamily === "evm";
}

export const coinopActionProvider = (): CoinopActionProvider => new CoinopActionProvider();
