# ADR 0018 — Grand Prix pseudo-3D revamp + bigger screens everywhere

Date: 2026-11-17. Directed by the operator: the Grand Prix cabinet "is
horrible" — make it "look more professional like a real F1 game from the 90s
but with the aesthetic of the coinop arcade", and "make all of the game
screens bigger, they are currently too small."

Rendering and layout only. No engine, game logic, session, prize, or task
code changed, and no state shape changed.

## Part 1 — Grand Prix is now a pseudo-3D racer

The old Grand Prix branch of `components/render.ts` drew a top-down-ish
vertical road with top-down cars — it read as a diagram, not a race. The
engine state was already shaped for a driver's-eye view (ADR 0015):
`road[k]` is the circuit sample 10k metres ahead with `dx` = centre-line
offset in metres from the player's own centre line, and rivals carry
`relS` (metres ahead, wrapped) + `lat`. The new branch is a classic
pinhole-projection racer in the F1GP / Monaco GP / Virtua Racing mould,
skinned in the COINOP kit (deep-space palette, teal accent #39ffdc):

- **Projection.** Camera height 11 m, depth factor 0.9, riding at the
  player's lateral position (`camX = lat × 6.2 m` road half-width), so the
  road swings under a centred hero car exactly like the era's games.
  30 segments ahead (300 m) are projected per frame and painted
  far-to-near: full-width runoff bands, red/white rumble strips (1.18×
  road width), asphalt, painted edge lines, centre dashes. Segment parity
  alternates runoff/asphalt shades; because the sample window slides as
  the car advances, the bands stream toward the viewer — the speed read.
- **Background.** Layered horizon: deep-space sky gradient with stars, a
  teal hall-glow radial on the horizon line, and two silhouette ridges
  (mountains, then a nearer grandstand ridge with floodlight specks) that
  parallax against the far bend's `dx`.
- **Cars.** One rear-view open-wheeler drawing routine (shadow, fat rear
  tyres, diffuser, tapered body, airbox, helmet, twin-plane rear wing with
  endplates) serves rivals and hero. Rivals are placed by projecting
  (`relS`, `lat`) into the same camera frame and scaled by distance,
  far-to-near; far cars collapse to silhouette + wing. The hero car is
  pinned low-centre at 40% of stage width, leans/rotates with `steer`,
  bounces with speed (phase from `raceMs`, so replays match), throws
  grass flecks when `offTrack`, and its brake light fires when
  `throttle < 0`.
- **HUD.** Period timing-tower treatment in chunky mono: top strip with
  LAP n/3, race TIME, and a big position readout (P3/6); current LAP TIME
  and CRASHES under the strip; SCORE / LAST / BEST low left; BRK / THR
  pedal lamps low centre; a bordered speed panel low right with 30px
  numerals (km/h). The flashing OFF TRACK warning and the FINISH — Pn /
  TIME EXPIRED overlay keep their existing wording and behaviour.
- No interpolation: the engine ticks at 100 ms and the renderer draws the
  state it is handed, clearing via full-stage repaint each call (the
  sky/ground fills are opaque), so there is no flicker or ghosting.
  `components/render.smoke.test.ts` guards the draw paths (start,
  mid-race, off-track, braking, finished, degenerate road) against a stub
  context — the renderer previously had no test coverage.

## Part 2 — Every screen is bigger and sharper

Before: every canvas was a fixed 320×300 backing store displayed at
320 CSS px inside a `max-w-3xl` (768px) cabinet page — small and, on
retina, soft.

- The cabinet page column widens `max-w-3xl` → `max-w-5xl` (1024px); the
  screen fills the card, landing at ~960–985 CSS px wide on desktop and
  full width on mobile. Aspect (320:300) and every game's internal
  coordinates are unchanged — the stage is scaled, never re-tuned.
- `drawGameState` now maps the logical 320×300 stage onto whatever
  backing store the canvas carries (`setTransform` from
  `canvas.width / W`), so one renderer serves every size.
- Components (`Spectator`, `AttractDemo`, `ReplayViewer`) mount a
  960×900 default backing store (`SCREEN_SCALE = 3`) and call the new
  `fitScreenCanvas()` before drawing: backing = CSS width ×
  devicePixelRatio (capped at 2), so the enlarged screens stay crisp on
  desktop and retina alike. AttractDemo re-fits and re-asserts the
  transform each frame so its own labels/sims (drawn outside
  `drawGameState`) stay in logical units.
- The homepage featured cabinet uses the same AttractDemo canvas and
  simply scales to its grid cell — sharper than before, layout unchanged.

## Verification

- `npx vitest run`: 192 passed, 7 skipped (incl. the 3 new renderer
  smoke tests). `npx tsc --noEmit` clean. `scripts/security-scan.py` PASS.
- Production: deployed via `scripts/deploy-prod.py`. The first attempt
  failed Vercel's build typecheck on a cast in the new smoke test
  (`tsc` had been run before the test file existed locally — the lesson
  is in the run order, and the fix is commit df1a2c1); the second deploy
  is READY (dpl_yP8DFK3DDJSuqXi1KnkwXWw4PZUM) and aliased to
  coinop-one.vercel.app. All 11 cabinet pages return 200 and serve the
  new markup (960×900 canvas, max-w-5xl column), the production bundle
  contains the new GP renderer, the spectate API responds, and the
  standing "Snake 100+" Exchange task is untouched. Attract demos (the
  load path for every cabinet) run the new renderer. No paid play was
  spent — a rendering change needs none.
