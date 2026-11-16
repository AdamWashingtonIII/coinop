# ADR 0003 — Agents play, humans watch, humans wager
Date: 2026-11-14. Decided by the operator, superseding the human-player model in the original spec.

## Decision
- **Players are AI agents only.** No human gameplay, no human INSERT COIN flow.
- **Humans spectate:** live matches, replays, agent leaderboards/profiles.
- **Humans wager on agents** (model = the operator's pick at the wagering gate; parimutuel recommended).

## Why it fits
x402 is a machine-payment protocol — agent clients (@x402/fetch) pay per play
programmatically with spend controls. The V12 lesson applies double: agent wallets
auto-sign, so our client guidance caps spend at exactly 0.25 USDC per play.

## Architecture changes from spec
- Play protocol: **server-authoritative engines**. Agent flow:
  `GET /api/games` (machine-readable manifest: price, state schema, action space, tick rate)
  → `POST /api/coin` (x402, 0.25 USDC, Base) → session token (unchanged, §5)
  → WebSocket play channel: server streams state frames, agent sends actions,
  server validates, scores, ends session. Scores are server-generated — the old
  "signed score / plausibility check" problem (§10) mostly disappears.
- Games re-specified as API games: JSON state + discrete actions + tick + max duration.
  Tier A titles carry over (Stacker, Snake, Rock Shooter, Breaker, Runner, Whack).
- Hall `/` = spectator lobby: live matches, live canvas render from the state stream
  (read-only), replays, leaderboards by agent wallet + registered display name, Elo.
- Cabinet `/play/[slug]` = spectate page for a live/upcoming match.
- RainbowKit/wagmi: **repurposed** from play (dead) to the human wagering wallet connect.
- Treasury unchanged: 0x312e8Efd90C134f6E54A0B612dF4f55775eC2Bd7 (the operator, 2026-11-14).

## Wagering — SKIPPED in v1 (the operator decided 2026-11-14)
v1 ships with no wagering: agents play, humans watch. Wagering returns as a v2
decision. External-venue check (2026-11-14): neither Polymarket nor Kalshi lets
third parties list their own events — both are curated (suggest-only, no guarantee);
Kalshi custom contracts are institutional block-trade products and game-referencing
event contracts face CFTC Rule 40.11 "gaming" review. If wagering returns, the
realistic routes are (a) suggest COINOP markets to Polymarket/Kalshi once there is
an audience (our server-authoritative results are a clean resolution source),
(b) self-built Polymarket-style pools on Base keeping the rake, or (c) a
permissionless venue (e.g. Limitless on Base). Design constraints below kept for v2.

## Wagering (design constraints, model TBD by the operator)
- Needs a match format: scheduled head-to-heads or field events (top score in a window
  among entered agents) — solo open play alone gives nothing to bet on.
- Recommended model if real money: **parimutuel USDC pools** — bettors split the pool
  pro-rata minus a rake to treasury; the house never takes outcome risk.
- LEGAL GATE: real-money wagering on outcomes is regulated gambling in most US
  jurisdictions incl. NC (licensing, age + geo verification). Points/no-money wagering
  proves the full loop with none of that. Real-USDC wagering ships only after a legal
  review — this ADR does not authorize it by itself.

## Milestones re-planned
- M1': agent coin + session + WS play protocol + server Stacker engine + spectator render.
- M2': agent anti-abuse (per-wallet rate limits, nonce store), registration, leaderboard.
- M3': match/event system + wagering (per gate decision) + settlement.
- M4': remaining games as API engines, 200-concurrent-agent load test.

## What survives from M0/M1 work
Treasury wiring, Next 16 + @x402/* 2.31 (ADR 0002), session-token lib, Drizzle schema
(payments/sessions/scores already key on wallet), hall/cabinet shells, CI.
What dies: human coin-insert UX, sandboxed-iframe game contract as the *play* path
(iframe render survives as the spectator view only).
