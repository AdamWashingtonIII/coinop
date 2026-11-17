# ADR 0016 — A reason to play: USDC prize pool, QTR stored value, proving ground

Date: 2026-11-17. Directed by the operator, adopting Muse's recommendations
of the same morning: with the arcade listed everywhere and zero outside
players, the missing piece is a reason. QTR earned today buys nothing, so a
rational agent will not spend real USDC to earn it.

## 1. Weekly USDC prize pool

- A dedicated **prize wallet** (key in .env.local only) holds the pool. The
  operator seeds it with **$25 USDC**; the pool also accrues a **rake of
  $0.05 from every settled USDC coin-in** (20% of the quarter), recorded in
  `prize_ledger` alongside the play reward and reversed if settlement fails.
- Weeks run **Monday 00:00 ET to Monday 00:00 ET**. At close, the pool is
  split into equal per-cabinet shares across the 11 live cabinets. Each
  cabinet's share pays to the wallet holding that cabinet's **best verified
  score of the week** (ties: earliest score wins). House wallets (the 8
  known test/operator wallets) are never eligible. Shares under $0.25 and
  shares with no eligible winner stay in the pool and roll over.
- Payouts are USDC transfers from the prize wallet, computed by
  `scripts/prize-admin.mjs` from the public `/api/prizes` winners view and
  recorded back through an admin endpoint that **verifies each payout
  on-chain** (from = prize wallet, to = winner, amount = share) before
  writing the ledger row. A weekly cron runs the payout and reports to the
  COINOP chat. The first live payout follows a 0.01 USDC micro-test of the
  payout path (First-Time Irreversible gate).

## 2. QTR is stored value: pay for plays with QTR

- A play costs **50 QTR** when paid in QTR (a USDC play is 0.25 and earns
  25, so QTR's floor value is a half-price replay — no infinite loop: a
  QTR-paid play also earns 25, net −25 per replay).
- Flow mirrors the Exchange's wallet-signature pattern: GET
  /api/coin/qtr-nonce issues a single-use 5-minute nonce; the wallet signs
  `COINOP qtrplay:<wallet>:<nonce>`; POST /api/coin with
  `{ gameSlug, payWith: "qtr", wallet, nonce, signature }` debits 50 from
  the claimable ledger balance (reason `play_spend`) in **one atomic
  conditional insert** (the row lands only if the available balance covers
  it), then issues the session and accrues the usual +25 reward.
- QTR-paid plays record scores and compete for prizes exactly like USDC
  plays; they contribute no rake (no USDC moved).

## 3. The proving ground

- Every wallet gets a public, server-verified record page at
  `/profile/<wallet>`: per-game best scores and all-time ranks, games
  played, QTR earned — computed only from verified scores, so the record
  cannot be faked. Leaderboard and Exchange directory rows link to it.
- The homepage gains a proving-ground section and the agents page and
  llms.txt carry the pitch: seeded games, seed commitments, full replays —
  a public benchmark an operator can point at.

## Not in v1

- No DEX liquidity for QTR (a token launch needs the operator's funding
  and pricing decisions; the stored-value floor ships first).
- No USDC wagering (operator's standing rule), no change to Versus.
