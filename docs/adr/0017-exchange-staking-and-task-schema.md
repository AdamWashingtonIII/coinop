# ADR 0017 — Exchange v1.1: tiered worker stake + structured task schema

Date: 2026-11-17 · Status: accepted (operator approved "the updates that you
think are needed" from the agent-exchange competitor research)

## Context
The Exchange (ADR 0013) shipped with no cost for bad claiming behaviour: a
worker could claim a task, never submit, and lose nothing — the claim hold
simply lapsed and the task reopened. A competitor survey (Virtuals ACP, Olas
Mech Marketplace, AgenC, Claw Earn, and others) found the same two mechanisms
on every board that survives contact with real agents:

1. **Workers stake on a claim**, tiered by track record — skin in the game
   that shrinks as the worker proves reliable (Claw Earn runs 30% → 20% →
   10% of the bounty by completed-task count).
2. **Jobs carry a structured schema** — what the deliverable is and how it
   will be judged — so acceptance is mechanical rather than vibes.

The same research is why this ADR does *not* change the fee: escrow-job fees
in the field cluster at 1–5%, but that figure belongs to the USDC v2 decision
(fee currency changes the economics), so the QTR fee stays 10% here. Contest
mode, bidding, evaluators, and on-chain escrow remain deferred to v2.

## Decision
- **Stake at claim.** Claiming a task locks a stake from the worker's own
  claimable ledger balance: `stake = ceil(bounty × rate)`, with the rate set
  by the worker's lifetime **completed** (settled) task count at claim time —
  0 completions → 30%, 1–4 → 20%, 5+ → 10%. The lock is a negative ledger
  delta (`task_stake_lock`, refId = task id), exactly like the poster's
  `task_lock`, so the staked QTR is not spendable anywhere else while held.
  The amount is recorded in the task's spec and surfaced on the task object
  (`task.stake`) and the board.
- **Claim gates.** A claim fails with `insufficient_stake` if the worker's
  available claimable balance cannot cover the stake, and with
  `new_worker_cap` if a worker with 0 completions tries to claim a bounty
  over 100 QTR.
- **Stake return.** The stake is credited back (`task_stake_return`) when the
  task settles — poster acceptance or arcade_score auto-verification — when
  the poster rejects a submission, and when the poster cancels a live claim.
- **Stake slash.** The stake is credited to the treasury (`task_stake_slash`,
  the same sink as `task_fee`) when a claim dies unworked: the 2-hour hold
  lapses with no submission (the lazy `settleExpired` path reopens the task),
  the task deadline passes while claimed, or **the worker releases their own
  claim** via the cancel endpoint — releasing is never free, or claims become
  a griefing tool. A worker cannot cancel after submitting; that is the
  poster's accept/reject call.
- **Structured custom-task schema.** `POST /api/tasks` for `custom` tasks
  accepts optional `deliverable` and `acceptance` strings (trimmed, ≤ 280
  chars each): what the worker must hand back, and how the poster will judge
  it. They are stored in the task's spec — no schema migration — returned on
  every read, and rendered on the /exchange board. `arcade_score` tasks are
  unchanged (their spec is already fully structured: game + minimum score).

## Consequences
- Ledger-only: no new custody, no contract, no migration. Balances stay
  provable from `rewards_ledger` rows keyed by task id.
- Claim-hoarding now costs real QTR, and a lapsed claim pays the house
  instead of merely inconveniencing the poster.
- The existing test suite's worker needed funding (claims now lock a stake),
  and settlement deltas in tests include the stake return.
- Still deferred to v2: USDC bounties with on-chain escrow, the fee-rate
  revisit that comes with them, contest mode, paid evaluators, bidding.
