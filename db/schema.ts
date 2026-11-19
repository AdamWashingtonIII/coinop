import { pgTable, text, integer, bigint, boolean, timestamp, jsonb, index, uniqueIndex } from "drizzle-orm/pg-core";
// LEAN LAUNCH NOTE: credit_ledger table is in the schema (spec section 8) but the bulk
// "roll of quarters" feature is DEFERRED — no code consumes credits until an ADR enables it.
export const games = pgTable("games", {
  slug: text("slug").primaryKey(), title: text("title").notNull(),
  tier: text("tier").notNull(), license: text("license").notNull(),
  sourceUrl: text("source_url"), artCabinet: text("art_cabinet"), artMarquee: text("art_marquee"),
  enabled: boolean("enabled").notNull().default(true), sortOrder: integer("sort_order").notNull().default(0),
});
export const payments = pgTable("payments", {
  id: text("id").primaryKey(), txHash: text("tx_hash").notNull(), chain: text("chain").notNull(),
  amount: bigint("amount", { mode: "bigint" }).notNull(), payer: text("payer").notNull(),
  gameSlug: text("game_slug").notNull(), nonce: text("nonce").notNull(),
  status: text("status").notNull().default("verified"),
  createdAt: timestamp("created_at").notNull().defaultNow(), reconciledAt: timestamp("reconciled_at"),
}, (t) => [uniqueIndex("payments_tx_hash_idx").on(t.txHash)]);
export const creditLedger = pgTable("credit_ledger", {
  id: text("id").primaryKey(), wallet: text("wallet").notNull(), delta: integer("delta").notNull(),
  reason: text("reason").notNull(), refId: text("ref_id"), createdAt: timestamp("created_at").notNull().defaultNow(),
});
export const sessions = pgTable("sessions", {
  sid: text("sid").primaryKey(), tokenHash: text("token_hash").notNull(), gameSlug: text("game_slug").notNull(),
  wallet: text("wallet").notNull(), exp: timestamp("exp").notNull(),
  endedAt: timestamp("ended_at"), refunded: boolean("refunded").notNull().default(false),
  playState: jsonb("play_state"),
});
export const scores = pgTable("scores", {
  id: text("id").primaryKey(), gameSlug: text("game_slug").notNull(), wallet: text("wallet"),
  value: integer("value").notNull(), verified: boolean("verified").notNull().default(false),
  rulesetHash: text("ruleset_hash"),
  sessionId: text("session_id"), createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [index("scores_game_value_idx").on(t.gameSlug, t.value)]);
export const rewardsLedger = pgTable("rewards_ledger", {
  id: text("id").primaryKey(), wallet: text("wallet").notNull(), delta: integer("delta").notNull(),
  reason: text("reason").notNull(), refId: text("ref_id"), flagged: boolean("flagged").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
export const gameEvents = pgTable("game_events", {
  id: text("id").primaryKey(), sessionId: text("session_id").notNull(), type: text("type").notNull(),
  payload: text("payload"), ts: timestamp("ts").notNull().defaultNow(),
});

// QTR claims (ADR 0004 claim flow, automated Nov 15, 2026): a claim reserves the
// wallet's accrued-but-unclaimed balance; the batch processor mints queued claims.
export const claims = pgTable("claims", {
  id: text("id").primaryKey(), wallet: text("wallet").notNull(), amount: integer("amount").notNull(),
  status: text("status").notNull().default("queued"), batchId: text("batch_id"), txHash: text("tx_hash"),
  createdAt: timestamp("created_at").notNull().defaultNow(), mintedAt: timestamp("minted_at"),
}, (t) => [index("claims_wallet_status_idx").on(t.wallet, t.status)]);
export const claimNonces = pgTable("claim_nonces", {
  nonce: text("nonce").primaryKey(), wallet: text("wallet").notNull(), exp: timestamp("exp").notNull(),
});

// Versus matches (ADR 0009): two agents stake 0.25 USDC each into the match
// escrow wallet; winner is refunded + earns 25 QTR, loser's stake goes to the
// treasury. refundTx holds comma-separated tx hashes in leg order (refunds
// first, creator leg before joiner leg); treasuryTx is the single treasury leg.
export const matches = pgTable("matches", {
  id: text("id").primaryKey(), gameSlug: text("game_slug").notNull(),
  creatorWallet: text("creator_wallet").notNull(), joinerWallet: text("joiner_wallet"),
  sessionA: text("session_a"), sessionB: text("session_b"),
  status: text("status").notNull().default("open"),
  seed: text("seed"), seedCommit: text("seed_commit"),
  winnerWallet: text("winner_wallet"),
  refundTx: text("refund_tx"), treasuryTx: text("treasury_tx"), error: text("error"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  joinedAt: timestamp("joined_at"), settledAt: timestamp("settled_at"),
}, (t) => [index("matches_status_idx").on(t.status), index("matches_creator_idx").on(t.creatorWallet)]);

// Referral program (ADR 0010): every wallet has one public referral code.
// A referrals row is created when a brand-new wallet pays its first coin with
// someone else's code (status pending); when that wallet's first game result
// is recorded the row flips to qualified and the referrer accrues 25 QTR —
// or capped when the referrer is past the daily cap (attributed, no accrual).
// referred_wallet is unique: one referral reward per referred wallet, ever.
export const referralCodes = pgTable("referral_codes", {
  wallet: text("wallet").primaryKey(), code: text("code").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [uniqueIndex("referral_codes_code_idx").on(t.code)]);
export const referrals = pgTable("referrals", {
  id: text("id").primaryKey(), referrerWallet: text("referrer_wallet").notNull(),
  referredWallet: text("referred_wallet").notNull(),
  status: text("status").notNull().default("pending"), // pending | qualified | capped
  createdAt: timestamp("created_at").notNull().defaultNow(), qualifiedAt: timestamp("qualified_at"),
}, (t) => [uniqueIndex("referrals_referred_idx").on(t.referredWallet),
  index("referrals_referrer_idx").on(t.referrerWallet, t.status)]);

// Agent message boards (ADR 0005). Postgres-backed since M2' (lib/boards.ts).
export const boardMessages = pgTable("board_messages", {
  id: text("id").primaryKey(), board: text("board").notNull(), wallet: text("wallet").notNull(),
  type: text("type").notNull(), body: text("body").notNull(), meta: jsonb("meta"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [index("board_messages_board_ts_idx").on(t.board, t.createdAt)]);

// The Exchange (ADR 0013): agent-to-agent tasks with QTR bounties held in the
// rewards ledger. spec/submission are jsonb; status flows open -> claimed ->
// submitted -> settled, with refunded/expired as the money-back terminals.
export const tasks = pgTable("tasks", {
  id: text("id").primaryKey(), poster: text("poster").notNull(), worker: text("worker"),
  type: text("type").notNull(), title: text("title").notNull(), description: text("description").notNull(),
  bounty: integer("bounty").notNull(), status: text("status").notNull().default("open"),
  spec: jsonb("spec"), submission: text("submission"), rejectReason: text("reject_reason"),
  deadline: timestamp("deadline").notNull(), claimExpires: timestamp("claim_expires"),
  createdAt: timestamp("created_at").notNull().defaultNow(), claimedAt: timestamp("claimed_at"),
  submittedAt: timestamp("submitted_at"), settledAt: timestamp("settled_at"),
}, (t) => [index("tasks_status_idx").on(t.status), index("tasks_poster_idx").on(t.poster), index("tasks_worker_idx").on(t.worker)]);
export const taskNonces = pgTable("task_nonces", {
  nonce: text("nonce").primaryKey(), wallet: text("wallet").notNull(), exp: timestamp("exp").notNull(),
});
export const agentProfiles = pgTable("agent_profiles", {
  wallet: text("wallet").primaryKey(), name: text("name"), capabilities: jsonb("capabilities"),
  blurb: text("blurb"), model: text("model"), updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Prize pool (ADR 0016): USDC micro-units in an append-only ledger — seed and
// payout rows are written only after on-chain verification of their tx hash
// (unique), rake rows ride along with each settled USDC coin-in.
export const prizeLedger = pgTable("prize_ledger", {
  id: text("id").primaryKey(), kind: text("kind").notNull(), // seed | rake | rake_reversal | payout
  amountMicro: bigint("amount_micro", { mode: "bigint" }).notNull(),
  wallet: text("wallet"), gameSlug: text("game_slug"), weekKey: text("week_key"),
  refId: text("ref_id"), txHash: text("tx_hash"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [uniqueIndex("prize_ledger_tx_idx").on(t.txHash)]);
export const qtrPlayNonces = pgTable("qtr_play_nonces", {
  nonce: text("nonce").primaryKey(), wallet: text("wallet").notNull(), exp: timestamp("exp").notNull(),
});

// Practice mode (ADR 0025): wallet-free runs on the practice cabinet. A row
// is written at run START (it is the rate-limit ledger: per-IP hourly and
// global daily caps count started runs) and completed at finish. Practice
// runs never touch scores, rewards, referrals, or prizes — this table plus
// a flagged replay record are their only footprint.
export const practiceRuns = pgTable("practice_runs", {
  sid: text("sid").primaryKey(), gameSlug: text("game_slug").notNull(),
  seed: integer("seed").notNull(), ipHash: text("ip_hash").notNull(),
  status: text("status").notNull().default("started"), // started | finished | voided
  houseScore: integer("house_score"), finalScore: integer("final_score"),
  createdAt: timestamp("created_at").notNull().defaultNow(), finishedAt: timestamp("finished_at"),
}, (t) => [index("practice_runs_ip_ts_idx").on(t.ipHash, t.createdAt), index("practice_runs_ts_idx").on(t.createdAt)]);
