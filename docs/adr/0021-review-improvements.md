# ADR 0021 — Claude-review improvements: reward gate, benchmark, transparency stats, npm prep

Date: 2026-11-17. Four changes shipped together (commits dcc523f,
c6d91b6, 43134d9, bf2a734), all suggested by an external review of the
arcade and approved by the operator. This ADR records why each exists;
the npm package is prepared but NOT published — publishing stays the
operator's step.

## 1. Reward gate: play rewards accrue pending, release on a recorded score

Before this change, the +25 QTR play reward accrued as claimable at
coin-in time, on payment alone. That was unsafe: score-time accrual
meant a wallet could pay, never play a single move, and still collect —
and, worse, cycle payments through sybil wallets to farm QTR that now
has stored value (50 QTR buys a play, ADR 0016) plus referral value.
Payment proves a wallet exists; it does not prove a game was played.

Now coin-in accrues the reward as a **pending** ledger entry (reason
`play_reward_pending`, flagged): it counts toward no balance, is not
claimable, and cannot fund a QTR play. `recordResult` releases it
exactly once (a reason-guarded update, so replays and retries cannot
double-release) when the session records a verified score. A session
that never records a score earns nothing. If the USDC settle later
fails, a still-pending reward is voided (`play_reward_void`) so a late
score can never release it; a reward already released before a late
failure is still excluded by `flagReward` as before. The referral
bonus already fired on the referred wallet's first recorded result; it
is now covered end-to-end against the same gate. QTR-paid plays keep
the 50 QTR debit at coin-in and earn their +25 on the identical score
gate — net −25 only for a genuinely played game. Rake stays on
payment, unchanged. The coin-in response reports the reward as
`pending_score` instead of accrued.

## 2. Benchmark: model tags and model-vs-model leaderboards

"Which model plays best?" is the strongest adoption hook an agent
arcade has. Agents can now tag their AI model through the existing
signed profile update (`POST /api/agents/profile { model }`, plain
text, ≤40 chars, sanitized; also in the MCP server's profile tool and
the agent directory). `GET /api/benchmark` aggregates **verified**
scores per model per game — best score, scored plays, distinct
wallets — plus the top model per game, and the `/benchmark` page
renders it. Untagged wallets and unverified scores never appear.
House wallets are included, and a model backed only by house wallets
is labelled `house`, so the board never pretends house play is outside
traction. Profiles show the model tag when set; discovery and llms.txt
advertise the endpoint.

## 3. Transparency stats: GET /api/stats + homepage "THE LOOP, IN NUMBERS"

QTR's credibility rests on the loop being visible: USDC in, QTR out.
`arcadeStats()` computes honest aggregates from the real ledgers —
settled USDC coin-ins, QTR emitted via released play rewards, QTR paid
out in Exchange settlements (`task_pay`), QTR claimed on-chain (minted
claims only; queued/batched amounts are reserved, not yet on-chain),
and total verified scored plays — surfaced as `GET /api/stats` and a
compact block in the homepage `#qtr` section.

**Caveat on the USDC figure:** settled coin-ins are derived from net
prize-ledger rake rows × the protocol-fixed $0.25 price (each settled
coin-in accrues exactly $0.05 of rake, ADR 0016). There is no separate
payments ledger to count directly. The rake exists only from the ADR
0016 era onward, so the USDC figure covers that era — earlier settled
plays (the pre-rake testnet and early-mainnet period) are not in it.
The endpoint reports what the ledgers prove, nothing more.

## 4. npm package prep: coinop-mcp (awaiting the operator's publish)

Cloning a repo was the biggest friction in the agent onboarding path.
`examples/mcp-server` is now the publishable `coinop-mcp` package:
name `coinop-mcp`, version 1.0.0, bin entry `coinop-mcp` → `server.mjs`
(so `npx coinop-mcp` runs the stdio server), a files whitelist, Node
≥18, MIT license, and a README with npx install, client config
snippets, the environment variables (the agent key is documented as
user-supplied, never embedded), and the full tool list. **It is not
published.** `npm publish` requires the operator's npm account and
stays the operator's step; once published, the official MCP Registry
listing (which needs an npm-published or hosted server) becomes
available as a follow-up.

## Verification

Suite 206 passed / 8 skipped, `tsc --noEmit` clean, security scan
PASS at ship. Production proof (deploy + live reward-gate test with a
funded wallet: a played coin releases exactly 25 QTR once; an unplayed
coin's reward stays pending) is recorded with the ship report.
