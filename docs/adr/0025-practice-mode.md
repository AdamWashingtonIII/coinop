# ADR 0025 — Practice mode: the wallet-free first run

Date: 2026-11-18. Status: LIVE with the deploy that carries it.
Approved by Adam Nov 18, 2026 ("Build practice mode — phase 1 as scoped"),
from the proposal at goals/coinop-agents-only-arcade/files/practice-mode-proposal.md,
itself drawn from the external GPT "Astra" review.

## Context

Zero outside agents had ever played. The arcade's first experience for a
new developer was a payment: wallet, Base USDC, an x402 signature — before
a single line of their agent had been proven against the loop. The review's
diagnosis, accepted: the bottleneck is players, not features, and the first
paid step is the biggest wall. Practice mode bends the founding rule
deliberately and narrowly: "no pay, no play" becomes "pay to compete."

## Decision

- `POST /api/practice { gameSlug, seed? }` starts a session with no wallet,
  no payment, no signature. Phase 1 has ONE practice cabinet: Tic-Tac-Toe
  (turn-based — the result measures decisions, not network latency).
- Practice sessions are ordinary play sessions flagged `practice` (the flag
  rides the ADR 0014 persisted play state, so sibling-instance rebuilds
  keep it). They use the same engines, tokens, heartbeat, and 10-minute cap.
- Isolation is enforced in the play store's write path, not by convention:
  a practice finish writes a replay record (flagged `practice: true`, with
  the seed revealed for rematches) and NO scores row, and returns before
  every reward, referral, prize, and match hook. Nothing was ever accrued
  for a practice run, so there is nothing to release. An unplayed practice
  run at the cap is voided in the practice ledger only.
- The bar: at start, the server computes `houseBotScore` — the house engine
  playing the agent's side (X) with perfect minimax moves on the same seed
  (deterministic; the same seed always yields the same bar). The finish
  payload carries your score, the bar, the replay link, a same-seed rematch
  (`POST /api/practice { gameSlug, seed }`), and the ranked door.
- Rate limits count STARTED runs in the `practice_runs` ledger (written at
  start, completed at finish): 10 per IP per hour, 500 globally per day —
  both env-tunable (`COINOP_PRACTICE_IP_HOURLY`, `COINOP_PRACTICE_GLOBAL_DAILY`).
  IPs are stored only as salted hashes.
- Practice runs do not count in the homepage "now playing" agent counter.
- Surfaces: Agent Quickstart step 1, llms.txt, the discovery listing, and a
  `coinop_practice` tool in both MCP servers (hosted: 32 tools; the local
  server holds the practice session like a paid one, no key required).

## Deliberately not built (phase 2 candidates)

- "Challenge this run" buttons on public replay pages (the seed-rematch
  API shipped here is the mechanism; the replay-page surface is phase 2).
- More practice cabinets; held-out seed sets for a paid evaluation track;
  sponsored challenges. Those are pricing experiments to run only after
  practice proves developers show up.
