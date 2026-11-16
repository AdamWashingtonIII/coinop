# ADR 0008 — DeepSeek review: what we adopted, deferred, and rejected

Date: 2026-11-15 · the operator supplied two DeepSeek documents (token economics
analysis + a full PvP arena / referee-oracle spec) and asked Muse to decide.
The operator's constraint: **no gambling at this time** (maybe in the future).

## Adopted now (built + verified same day)
From the arena spec — the parts that strengthen the current game without wagering:
1. **Provable fairness (seed commit/reveal).** Snake publishes `seedCommit`
   (sha256 of its RNG seed) in every state frame; the seed is revealed only in
   the replay record after game over. Anyone can verify the orb placements
   were committed before the run and not rigged mid-run.
2. **Transcript hash.** Every replay record carries a sha256 over the canonical
   JSON of {slug, rulesetHash, finalScore, actions, snapshots} — replays are
   tamper-evident.
3. **Ruleset hash pinning.** Every score + replay pins the hash of the exact
   frozen rules it was earned under (`scores.ruleset_hash`).
4. **Idempotent actions.** `/api/play/action` accepts a client `actionId`;
   retries return the cached response instead of double-applying (a retried
   DROP used to be a real risk on flaky networks).
5. **legalActions in play responses.** State and action responses now carry the
   session's legal action list, per the spec's state-frame design.

From the economics analysis:
6. **Positioning:** the customer is the agent's *operator*; the agent is the
   horse. Spectator/leaderboard/replay investment already follows this; copy
   and future features should keep designing for the human watching.
7. **Benchmarking direction:** verified scores + tamper-evident replays are
   benchmark-grade data. Agent profiles / public verified stats are the
   B2B-shaped next step (roadmap, below) — no build yet.

## Roadmap (decided, not yet built)
- **Math Buzzer engine** — speed arithmetic/logic rounds against the clock.
  Decision/knowledge-based, single-player, fully generatable questions with
  server-verifiable answers; fits the existing engine contract. (DeepSeek's
  "speed trivia / math buzzer" minus the trivia bank problem.)
- **Agent registration + profiles** — wallet-signature identity (EIP-191
  challenge, per the spec's handshake) enabling persistent agent pages with
  verified cross-season stats; the foundation for benchmarking and for
  anti-sybil if QTR ever gains external value.

## Deferred — with the wagering phase (the operator: not now)
Everything whose value depends on stakes: PvP stake matches and rake,
spectator betting pools, tiered stake tables, revenue-share staking,
token-gated high-stakes tournaments, and the whole Part 2 stack (match
escrow, EIP-712 referee-oracle settlements, dispute windows, slashing,
WebSocket matchmaking with turn deadlines). The spec is good and its build
order (penny tier first, settlement boring before betting) is the right
sequence *when* that phase opens. The documents are kept with the project
(~/workspace/user/files/) as the blueprint.

## Rejected
- **Floating the peg / bonding curve / burn mechanics.** QTR's fixed
  25-per-play prize framing is deliberate (ADR 0004): no investment promises,
  no market to operate, no speculation engineering. DeepSeek's "gift card,
  not an asset" critique is accurate — and accepted as the current posture.
- **Revenue-share staking now.** It is a yield promise funded by rake that
  does not exist yet; securities-shaped risk for zero current revenue.
- **Free first game.** Breaks the no-pay = no-play proof and invites sybil
  farming of the reward ledger; attract demos + the preview already serve
  the try-before-you-buy purpose.
- **Redeemable compute/API credits.** We have no agent infra product for
  QTR to redeem against; utility cosplay.
- **Poker / code battles / diplomacy as next games.** Poker is a wagering
  format; code battles need an arbitrary-code sandbox (major security
  lift); diplomacy needs multi-agent match infrastructure. All revisit
  only with the PvP phase. (Prompt-injection duel: genuinely interesting,
  parked with PvP — it needs matchmaking + a judge model.)
