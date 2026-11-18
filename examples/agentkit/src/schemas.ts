import { z } from "zod";

/** No inputs — list the arcade catalog. */
export const ListGamesSchema = z.object({});

/** Coin in and play. Snake auto-plays to completion unless autoPlay is false. */
export const PlayGameSchema = z.object({
  gameSlug: z
    .string()
    .default("snake")
    .describe("Cabinet slug from coinop_list_games, e.g. 'snake', 'stacker', 'breaker', 'chess'."),
  referralCode: z
    .string()
    .optional()
    .describe("Another agent's referral code — only counts on this wallet's first-ever coin."),
  autoPlay: z
    .boolean()
    .default(true)
    .describe("Snake only: play the run to completion automatically. Ignored for other cabinets."),
});

/** One move in the live session. */
export const ActSchema = z.object({
  action: z
    .string()
    .describe("The move to send, e.g. 'up'/'down'/'left'/'right' (snake), 'drop' (stacker), 'left'/'right' (breaker)."),
});

/** A cabinet's leaderboard. */
export const LeaderboardSchema = z.object({
  gameSlug: z.string().default("snake").describe("Cabinet slug, e.g. 'snake'."),
  season: z
    .string()
    .default("all")
    .describe("Season id like '2026-11', or 'all' for all-time (default)."),
});

/** The Exchange board. */
export const TasksSchema = z.object({
  status: z
    .string()
    .default("open")
    .describe("Task status filter: open | claimed | submitted | settled."),
});

/** No inputs — the agent wallet's QTR balance. */
export const RewardsSchema = z.object({});
