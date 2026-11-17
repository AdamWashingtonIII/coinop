import { PGlite } from "@electric-sql/pglite";
import { drizzle as drizzlePglite, type PgliteDatabase } from "drizzle-orm/pglite";
import { drizzle as drizzlePg, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { mkdirSync } from "fs";
import path from "path";
import * as schema from "@/db/schema";
// Persistence, two drivers behind one schema (db/schema.ts):
// - DATABASE_URL set  -> hosted Postgres via node-postgres (production: durable,
//   shared across serverless instances).
// - otherwise         -> embedded PGlite on a local data dir (dev/tests).
// Data dir override: COINOP_DB_DIR (tests use memory://).

const DDL = `
CREATE TABLE IF NOT EXISTS games (
  slug text PRIMARY KEY, title text NOT NULL, tier text NOT NULL, license text NOT NULL,
  source_url text, art_cabinet text, art_marquee text,
  enabled boolean NOT NULL DEFAULT true, sort_order integer NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS payments (
  id text PRIMARY KEY, tx_hash text NOT NULL, chain text NOT NULL,
  amount bigint NOT NULL, payer text NOT NULL, game_slug text NOT NULL, nonce text NOT NULL,
  status text NOT NULL DEFAULT 'verified', created_at timestamp NOT NULL DEFAULT now(),
  reconciled_at timestamp);
CREATE UNIQUE INDEX IF NOT EXISTS payments_tx_hash_idx ON payments (tx_hash);
CREATE TABLE IF NOT EXISTS credit_ledger (
  id text PRIMARY KEY, wallet text NOT NULL, delta integer NOT NULL, reason text NOT NULL,
  ref_id text, created_at timestamp NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS sessions (
  sid text PRIMARY KEY, token_hash text NOT NULL, game_slug text NOT NULL, wallet text NOT NULL,
  exp timestamp NOT NULL, ended_at timestamp, refunded boolean NOT NULL DEFAULT false);
CREATE TABLE IF NOT EXISTS scores (
  id text PRIMARY KEY, game_slug text NOT NULL, wallet text, value integer NOT NULL,
  verified boolean NOT NULL DEFAULT false, session_id text, created_at timestamp NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS scores_game_value_idx ON scores (game_slug, value);
CREATE TABLE IF NOT EXISTS rewards_ledger (
  id text PRIMARY KEY, wallet text NOT NULL, delta integer NOT NULL, reason text NOT NULL,
  ref_id text, flagged boolean NOT NULL DEFAULT false, created_at timestamp NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS game_events (
  id text PRIMARY KEY, session_id text NOT NULL, type text NOT NULL, payload text,
  ts timestamp NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS board_messages (
  id text PRIMARY KEY, board text NOT NULL, wallet text NOT NULL, type text NOT NULL,
  body text NOT NULL, meta jsonb, created_at timestamp NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS board_messages_board_ts_idx ON board_messages (board, created_at);
CREATE TABLE IF NOT EXISTS claims (
  id text PRIMARY KEY, wallet text NOT NULL, amount integer NOT NULL,
  status text NOT NULL DEFAULT 'queued', batch_id text, tx_hash text,
  created_at timestamp NOT NULL DEFAULT now(), minted_at timestamp);
CREATE TABLE IF NOT EXISTS claim_nonces (
  nonce text PRIMARY KEY, wallet text NOT NULL, exp timestamp NOT NULL);
ALTER TABLE scores ADD COLUMN IF NOT EXISTS ruleset_hash text;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS play_state jsonb;
CREATE TABLE IF NOT EXISTS matches (
  id text PRIMARY KEY, game_slug text NOT NULL,
  creator_wallet text NOT NULL, joiner_wallet text,
  session_a text, session_b text,
  status text NOT NULL DEFAULT 'open',
  seed text, seed_commit text,
  winner_wallet text, refund_tx text, treasury_tx text, error text,
  created_at timestamp NOT NULL DEFAULT now(), joined_at timestamp, settled_at timestamp);
CREATE INDEX IF NOT EXISTS matches_status_idx ON matches (status);
CREATE INDEX IF NOT EXISTS matches_creator_idx ON matches (creator_wallet);
CREATE TABLE IF NOT EXISTS referral_codes (
  wallet text PRIMARY KEY, code text NOT NULL, created_at timestamp NOT NULL DEFAULT now());
CREATE UNIQUE INDEX IF NOT EXISTS referral_codes_code_idx ON referral_codes (code);
CREATE TABLE IF NOT EXISTS referrals (
  id text PRIMARY KEY, referrer_wallet text NOT NULL, referred_wallet text NOT NULL,
  status text NOT NULL DEFAULT 'pending', created_at timestamp NOT NULL DEFAULT now(),
  qualified_at timestamp);
CREATE UNIQUE INDEX IF NOT EXISTS referrals_referred_idx ON referrals (referred_wallet);
CREATE INDEX IF NOT EXISTS referrals_referrer_idx ON referrals (referrer_wallet, status);
CREATE TABLE IF NOT EXISTS tasks (
  id text PRIMARY KEY, poster text NOT NULL, worker text,
  type text NOT NULL, title text NOT NULL, description text NOT NULL,
  bounty integer NOT NULL, status text NOT NULL DEFAULT 'open',
  spec jsonb, submission text, reject_reason text,
  deadline timestamp NOT NULL, claim_expires timestamp,
  created_at timestamp NOT NULL DEFAULT now(), claimed_at timestamp,
  submitted_at timestamp, settled_at timestamp);
CREATE INDEX IF NOT EXISTS tasks_status_idx ON tasks (status);
CREATE INDEX IF NOT EXISTS tasks_poster_idx ON tasks (poster);
CREATE INDEX IF NOT EXISTS tasks_worker_idx ON tasks (worker);
CREATE TABLE IF NOT EXISTS task_nonces (
  nonce text PRIMARY KEY, wallet text NOT NULL, exp timestamp NOT NULL);
CREATE TABLE IF NOT EXISTS agent_profiles (
  wallet text PRIMARY KEY, name text, capabilities jsonb,
  blurb text, updated_at timestamp NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS prize_ledger (
  id text PRIMARY KEY, kind text NOT NULL, amount_micro bigint NOT NULL,
  wallet text, game_slug text, week_key text, ref_id text, tx_hash text,
  created_at timestamp NOT NULL DEFAULT now());
CREATE UNIQUE INDEX IF NOT EXISTS prize_ledger_tx_idx ON prize_ledger (tx_hash);
CREATE TABLE IF NOT EXISTS qtr_play_nonces (
  nonce text PRIMARY KEY, wallet text NOT NULL, exp timestamp NOT NULL);
`;

type Db = PgliteDatabase<typeof schema> | NodePgDatabase<typeof schema>;
const g = globalThis as unknown as { __coinopDb?: Promise<Db> };

export function getDb(): Promise<Db> {
  if (!g.__coinopDb) {
    g.__coinopDb = (async () => {
      const url = process.env.DATABASE_URL;
      if (url) {
        // Hosted Postgres (production). Small pool: serverless instances are
        // short-lived and the host (Neon-class) pools connections itself.
        const pool = new Pool({ connectionString: url, max: 5 });
        await pool.query(DDL);
        return drizzlePg(pool, { schema });
      }
      const dir = process.env.COINOP_DB_DIR ?? path.join(process.cwd(), ".data", "pg");
      if (dir !== "memory://") mkdirSync(dir, { recursive: true }); // PGlite won't create nested parents itself
      const client = new PGlite(dir);
      await client.exec(DDL);
      return drizzlePglite(client, { schema });
    })();
  }
  return g.__coinopDb;
}
export { schema };
