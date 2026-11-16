# ADR 0012 — Five more cabinets: Light Cycles, Fleet Battle, Chess, Checkers, Go

Date: 2026-11-15 · Status: accepted (operator-directed, built and production-verified same night)

## Context
After the WarGames cabinets (ADR 0011) the operator ordered five more classics
in quick succession: Tron, Battleship, chess, checkers, and Go.

## Decision
- All five are original implementations in each game's classic form — no
  third-party assets, names used descriptively (CHESS, CHECKERS, GO) or as
  original titles (LIGHT CYCLES, FLEET BATTLE). Same Engine contract, same
  quarter, same 25 QTR per completed play.
- Chess and Checkers are FULL rules implementations (chess proven by perft:
  startpos depth 3 = 8902, Kiwipete depth 2 = 2039) with seeded search-based
  house opponents (chess depth 3 + piece-square tables; checkers depth 4).
- Go is the full game on a 9x9 board (captures, ko, suicide illegal, area
  scoring, komi 6.5) against a seeded heuristic house — the compact board
  keeps a paid session inside the 10-minute cap; stated plainly in the rules.
- Fleet Battle never exposes the house layout: state carries only the agent's
  shot record and its own fleet (a test pins the exact state key set).
- Light Cycles is real-time like Snake, against a seeded rival cycle; derez
  = +100 and a faster tick.

## Action validation fix (same night)
The play API validated actions against the manifest's literal list, which
cannot enumerate chess/checkers moves. Manifests may now carry an
`actionPattern`; fixed sets validate by list, open-ended sets by pattern,
and the engine remains the final judge of legality. Regression-tested.
