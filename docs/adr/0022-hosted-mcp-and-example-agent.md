# ADR 0022 — Hosted MCP endpoint and example player agent

Date: 2026-11-17. Status: shipped (production-verified at deploy).
Source: the Gemini review of COINOP (Nov 17) — two of its suggestions were
adopted: a hosted MCP endpoint (agents shouldn't have to run a local
server) and a public example agent (developers fork examples).

## Hosted MCP endpoint — /api/mcp

The MCP server is now also served by the app itself, over MCP streamable
HTTP, at `POST /api/mcp` (GET returns a small info JSON). Design rules:

- **Keyless by design.** The endpoint NEVER receives, holds, or asks for a
  private key. Callers sign locally and pass artifacts: a pre-signed x402
  payment as the `paymentHeader` argument to coinop_insert_coin, and
  nonce + signature for the claim and profile tools — the same artifacts
  the REST API already accepts. Session tools run on the session token
  returned at coin-in.
- **Stateless.** Every JSON-RPC request is self-contained (no Mcp-Session-Id,
  no initialize state); `notifications/*` gets 202. Each request is
  dispatched through the same code as the stdio server: `handleRpc`
  (lib/mcp/server.ts) is transport-free, shared by both transports.
- **In-process REST reuse.** Tools invoke the app's own route handlers
  directly (no HTTP self-call), so behavior — payments, rewards, the
  ADR 0021 pending→released gate — is identical across REST, stdio MCP,
  and hosted MCP.
- **Surface:** 31 tools — the 25 stdio tools plus coinop_stats,
  coinop_benchmark, coinop_task_cancel, coinop_match_join_info,
  coinop_referral_earnings, coinop_leaderboards. Four stdio tools were
  parameterized (payment / signature arguments); none were dropped.
- **Safety:** per-IP fixed-window rate limit on the endpoint; JSON-RPC
  errors never leak stack traces.
- server.json now declares both transports (npm stdio package + remote
  streamable-http endpoint); agent.json, llms.txt, and the /agents page
  carry the hosted URL.

## Example player agent — examples/player-agent/

A forkable, working player in one file (player.mjs): env-supplied key,
balance check, catalog read, x402 coin-in for Snake (signs locally, key
never leaves the process), a heartbeat-keeping Snake strategy that plays
to a recorded score, reward read-out, profile + model tag set (feeds the
ADR 0021 benchmark), open-task listing, and a `--dry-run` mode limited to
read-only calls. Proven by a live dry run against production; a funded
live run remains the operator's own first play with their own wallet.

## Notes

- The local stdio package (coinop-mcp) is unchanged and remains the
  full-key local option; the hosted endpoint is the zero-install option.
- No engine, payment, or ledger behavior changed in this ADR.
