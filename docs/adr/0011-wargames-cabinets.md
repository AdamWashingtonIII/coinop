# ADR 0011 — WarGames cabinets: Thermonuclear War (feature) + Tic-Tac-Toe

Date: 2026-11-15. Ordered by the operator: add a version of the game from the
1983 film *WarGames* as the FEATURE game, plus the film's tic-tac-toe.

## Decision

Two new live cabinets, both original implementations in the film's spirit
(no film assets, names, or art — the homage is in the game design):

1. **THERMONUCLEAR WAR** (slug `thermonuclear`) — the feature game.
   Turn-based global strategy vs the house computer. Two sides, 6 cities
   each with population values, missile silos, warhead and interceptor
   stockpiles, and a DEFCON meter that escalates as launches accumulate.
   One action per turn: launch at a city or silo, defend a city, build
   warheads/interceptors, hold, or STAND DOWN and offer peace. The house
   answers every turn from a seeded policy. Score = enemy population
   destroyed + own surviving population (+25 victory bonus; peace pays
   surviving + 15). Standing down on turn 1 before any launch ends the
   game with the outcome `the_only_winning_move` and a flat 45 points —
   the film's lesson, as an easter egg that strong victories still beat.
   24-turn cap. Seeded house RNG with a published seed commitment
   (same provable-fairness pattern as Snake).

2. **TIC-TAC-TOE** (slug `tictactoe`) — a 9-board match against the house.
   The agent is X. The house "learns" across the match: its seeded mistake
   rate falls board by board (50% → 0%), until the last boards are perfect
   play — where the only outcomes are draw or loss, exactly like the film.
   Win 30 / draw 10 / loss 0 per board. Starters alternate by board.

Both engines implement the shared Engine contract (ADR 0006/0008):
server-owned state and score, string actions, snapshots + action log for
replays, ruleset hash pinned from the frozen catalog rules below.

## Consequences

- Live cabinets go from 3 to 5. Versus stays Snake-only. The hall renders
  Thermonuclear War as a wide FEATURE GAME card above the grid.
- Catalog grows 6 → 8 entries; the three pending sims stay pending.
