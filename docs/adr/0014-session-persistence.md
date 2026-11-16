# ADR 0014 — Play sessions survive instance scatter (rebuild from seed + action log)

Date: 2026-11-16 · Status: accepted (operator approved the fix)

## Problem
Live sessions lived only in one serverless instance's memory. When several
Vercel instances are warm, play state/action/heartbeat calls landing on a
sibling instance fail (401/404) in bursts — measured at roughly half of calls
during the Exchange seeding. It stayed invisible while traffic kept a single
instance warm.

## Decision
Every engine is a deterministic function of (seed, action log with ms
offsets, clock): seeded engines use mulberry32, and the real-time engines run
on fixed tick grids anchored at the session's birth. So a session can be
rebuilt exactly on any instance:
- At coin-in the store now chooses the seed itself and persists
  { seed, bornAt, matchId, actions: [] } into sessions.play_state (jsonb).
- Every applied action appends { atMs, action, actionId } to that record.
- On a memory miss, the loading instance rebuilds the engine: a virtual
  clock starts at bornAt, the logged actions replay at their offsets, then
  the clock flips to real time and the session continues in memory.
- A session whose result is already recorded (scores row present, or the
  row is ended) is never rebuilt; the rebuilt copy is marked recorded so a
  run can never be written twice.

Known bounded divergence: a snake/breaker bonus eaten during a state poll
between actions gets its expiry from the poll time; after a rebuild it is
anchored to the next action instead — a sub-second difference in how long a
bonus orb lives. Gameplay-valid either way; scores stay server-owned.

Spectator "live" listings remain instance-local (unchanged); the durable
record (scores, replays, leaderboards) was always database-backed.
