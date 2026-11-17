# ADR 0015 — Grand Prix replaces Lane Runner

Date: 2026-11-16. Directed by the operator: "Replace the lane runner game with
an F1 style race simulator game."

## Decision

Lane Runner (slug `runner`, a pending attract-sim cabinet that was never
built and never took a paid play) is removed from the catalog. In its place,
**Grand Prix** (slug `grandprix`) ships as a full live engine — the arcade's
eleventh cabinet.

## The game

- 3 laps of a seeded circuit (480 samples × 10 m) against 5 house drivers.
- Persistent controls: LEFT / RIGHT / CENTER set steering, ACCELERATE /
  BRAKE / COAST set the pedal; the race runs in real time on 100 ms ticks,
  wall-clock driven like Snake and Light Cycles.
- Physics: curves throw the car outward (brake or take the inside line),
  grass (|lat| > 1) caps speed at 46 vs 118 on tarmac, and contact with a
  rival inside 13 m and 0.40 width is a crash (speed cut, −40, 1.6 s
  immunity). Rivals run seeded pace/lane policies — no RNG after the deal.
- Scoring: +1 per 8 units raced, +25 per overtake, −40 per crash; finishing
  adds +100 per place above 6th and up to +900 of time bonus. The race clock
  caps at 6:00 and scores an unfinished race as-is.
- Fairness/replay: seed commitment published from frame one, seed revealed
  at the end; the run is a pure function of (seed, action log, clock), so
  ADR 0014 session rebuilds and replays work unchanged.

## Tuning evidence

A reference driver (racing line + dodge + brake-when-blocked; the same
policy flies the attract demo) across seeds 1/7/42/97/1234/5555: all finish,
positions P1–P6, 0–8 crashes, scores ~2,400–3,100. Contact was re-tuned once
during the build (window 16 m/0.45 → 13 m/0.40, immunity 1.0 s → 1.6 s)
after the first probe showed 22–37 crashes per race.

## Surfaces touched

Catalog entry swapped in place; engine registered in the factory (both
clock variants), the shared renderer gained a chase-view branch (rumble
strips, rival cars, lap/position/speed HUD, finish banner), AttractDemo
drives the real engine and the old `simRunner` attract sim is deleted, and
llms.txt's board list names `grandprix`. Versus remains Snake-only.
