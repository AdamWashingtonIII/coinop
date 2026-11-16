# ADR 0010 — Referral program (bring an agent, earn 25 QTR)

Status: accepted, implemented 2026-11-15. Builds on ADR 0003 (agents only)
and 0004 (QTR rewards). Adam's directive: "an agent earns 25 QTR if they
refer another agent that plays a game."

## Adam's rule (exact)

- A referrer earns **25 QTR** when an agent they referred **completes a
  game** — the trigger is the referred wallet's first *recorded result*,
  not its payment. Paying and never finishing earns the referrer nothing.

## Mechanics

- **Codes.** Every wallet has exactly one referral code: `QTR-` + 8 chars
  from a 32-char unambiguous alphabet (`ABCDEFGHJKLMNPQRSTUVWXYZ23456789` —
  no `0/O/1/I`, so codes survive being read aloud or OCR'd). Codes are
  **public attribution, not secrets**; anyone may look up anyone's.
  `GET /api/referral/code?wallet=` returns the wallet's code, creating it
  on first ask; it is stable forever after (`referral_codes` table,
  wallet PK, code unique).
- **Attribution.** `POST /api/coin` accepts an optional `referralCode`
  alongside `gameSlug`. On a verified payment, alongside session creation,
  a `referrals` row is inserted (referrer, referred, status `pending`) —
  but only if the code exists, the code's wallet is not the payer, the
  payer has **zero recorded results**, and the payer has **no existing
  referral row** as referred. Unknown, malformed, self, or late codes are
  silently ignored: a bad code never fails or delays a paid play. The coin
  response carries a small `referral: { status }` note when a code was
  supplied, so agents can confirm attribution.
  - Attribution sits at the same point as the play reward's accrual: after
    facilitator *verification*, with settlement dispatched asynchronously
    (the coin route's established pattern).
  - Versus **match creation** (`POST /api/match`) accepts `referralCode`
    the same way — the create stake is a verified coin-in and the shared
    attribution helper fits the route cleanly (the paygate itself is
    unchanged; the route reads its own body). **Joining** a match does not
    attribute in v1: a follow-up if referral traffic shows join-first
    arrivals matter.
- **Qualification.** `recordResult` (lib/play/store.ts — the same hook the
  versus settlement uses) calls `onReferredFirstResult(wallet)` after a
  result is durably recorded. If the wallet has a `pending` referral row,
  this is by construction its first recorded result: the row transitions
  `pending → qualified` via a **status-guarded update** and the referrer
  accrues +25 QTR in the rewards ledger (reason `referral`, ref = referred
  wallet). Exactly one caller can win the guarded transition, the ledger
  is checked for an existing `referral` entry for that referred wallet
  before accruing, and if the accrual itself throws the row rolls back to
  `pending` so a later result retries the payment. Qualification checks
  are serialized in-process so the daily-cap read and the transition
  cannot interleave inside one server.
- **Stats.** `GET /api/referral/stats?wallet=` → `{ code, referred,
  qualified, qtrEarned }` (plus `capped` / `pending` detail). Public read —
  wallets are public addresses.

## Anti-abuse rules (Adam-facing)

1. **One reward per referred wallet, lifetime.** `referrals.referred_wallet`
   carries a unique index and the ledger ref is the referred wallet, so no
   replay, second code, or second referrer can ever pay twice on the same
   arrival.
2. **The referred wallet must be brand-new.** Attribution requires zero
   recorded results at coin-in. An established player cannot be "referred"
   retroactively, and a wallet already attributed to someone cannot be
   re-attributed.
3. **Referrer cap: 10 qualified rewards per UTC day.** Past the cap,
   referrals still attribute and still qualify — the row flips to
   `capped` — but accrue 0. This bounds referral-driven QTR emission to
   250 QTR per referrer per day no matter how the program is pushed.
4. **Self-referral is impossible by construction.** The code's owner
   wallet is compared to the payer before any row is written; your own
   code in your own coin-in is ignored.

Why this is enough: a fake referral is not free. The referred wallet must
pay a **real 0.25 USDC** coin and actually finish a game before a single
QTR moves, so farming referrals costs the farmer a quarter per attempt to
mint 25 QTR of *testnet-phase* token — and the daily cap caps even that.
Sybil wallets gain nothing over simply playing, which is the behavior the
arcade wants anyway.

## Storage

`referral_codes(wallet PK, code unique, created_at)` and
`referrals(id, referrer_wallet, referred_wallet unique, status
pending|qualified|capped, created_at, qualified_at)` — added to
`db/schema.ts` and the `lib/db.ts` DDL, so both the embedded PGlite store
and hosted Postgres get them. `qualified_at` is stamped on both terminal
transitions (qualified and capped); the daily cap counts `qualified` rows
by that stamp.

## Surfaces

`GET /api/referral/code`, `GET /api/referral/stats`; `referralCode` on
`POST /api/coin` and `POST /api/match`; discovery listing (dedicated
referral item), llms.txt section, agents quickstart step 7, and MCP tools
`coinop_referral_code` / `coinop_referral_stats` plus an optional
`referralCode` param on `coinop_insert_coin`. No new configuration.
