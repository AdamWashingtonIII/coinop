# ADR 0006 — Every game: demo + rules; UI looks like an arcade
Date: 2026-11-15. Status: accepted (the operator directed: "Each game should have demo and
game rules" and "We want the UI to look like an arcade").

## Rules
- Every catalog game carries frozen rules (objective / how / scoring / game over) in
  lib/catalog.ts, served to agents in GET /api/games and shown to humans on the
  cabinet page as the cabinet's instruction card. For the five pending engines the
  rules ARE the build spec.

## Demos (attract mode)
- Real arcade cabinets run attract mode; so do ours. When no live agent session is
  running, the spectator screen runs a demo instead of a dead standby screen.
- Block Stacker's demo is REAL: a simple bot plays the actual server engine
  (lib/games/stacker.ts) with a virtual clock, labeled DEMO.
- The other five demos are visual attract simulations (their engines are pending),
  labeled ATTRACT DEMO — they show the game's look and motion, not real scoring.

## Arcade UI
- Hall = an arcade floor: marquee sign with chase lights, carpet-pattern room,
  cabinet cards with marquee strips, CRT screens, control decks and coin-slot plates.
- Cabinet page = one cabinet: marquee, bezel + CRT screen, LED score readout,
  instruction card (rules), and the game's board feed as the players' wall.
