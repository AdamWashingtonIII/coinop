# ADR 0020 — Grand Prix daytime rebuild (the 90s reference look)

Date: 2026-11-17. Supersedes the look of ADR 0018/0019 (the dark pseudo-3D
revamp). The projection, HUD, and enlarged screens from ADR 0018 stand;
this ADR records the art-direction rebuild on top of them.

## Why

The operator reviewed the ADR 0018 night build live and rejected it
("still horrible"), then supplied reference screenshots of actual 90s F1
games (an itch.io "90s GRAND PRIX" in the F1GP mould, SNES-era F1 titles)
and later rejected the frame-reviewed ADR 0019 fix on the same grounds.
The references define the target precisely, and our night scene missed it
on every axis:

- **Bright daytime** — blue sky, clouds, daylight colours everywhere.
  Ours was a dark night scene; that was the core miss.
- **Sprite-rich cars** — the reference hero is a detailed rear view:
  named rear wing, very wide treaded tyres, visible exhaust/engine
  machinery, mirror stalks, livery stripes.
- **A populated world** — grandstands, sponsor billboards, skyline,
  trees. Ours was an empty gradient.
- **A wide, light road** — light grey asphalt, BROAD red/white kerbs.

COINOP's identity moved to the branding layer instead of the lighting:
billboards and banners carry COINOP / QTR / BASE / x402 / INSERT COIN
(never real brands or team names), the hero livery is deep teal with the
QTR roundel, and the existing HUD is unchanged.

## What shipped

All work is in the Grand Prix branch of `components/render.ts` only.
Engines, logic, state shapes, HUD text/positions, and all other games
untouched throughout.

- **v3 — daytime rebuild (f50ced7).** Bright blue sky with flat clouds,
  hazy skyline and stand silhouettes, daytime-green grass; light grey
  asphalt with a racing-line sheen; kerbs widened ~3× (1.30× half-width);
  deterministic trackside scenery (billboards, trees, floodlight poles)
  anchored by a renderer odometer (`gpDistance()`, keyed by seedCommit)
  because long straights make the road samples bit-identical and a pure
  road fingerprint cannot anchor scenery; a tiered grandstand with a
  COINOP banner on the start/finish stretch; sprite-detail car pass
  (named wings, treaded tyres, machinery panel, twin exhausts).
- **Polish 1 — machinery + gantry (4697dc3).** Layered engine/airbox
  detail, a proper four-tip exhaust cluster replacing the ring-like
  pair, suspension arms, number roundels; a real tiered grandstand
  (crowd, roof, timing tower); a start/finish gantry reading
  "COINOP GRAND PRIX" over a chequered start line; asphalt speckle and
  racing-line wear; QTR coin billboard; apex tyre stacks; city skyline
  gated to the start/finish window.
- **Polish 2 — shading + density (dfe3e6c).** Gradient body shading,
  wing shadow on the engine cover, chunkier four-stop-shaded tyres,
  specular streaks; per-rival livery schemes (centre stripe / twin
  stripes / sidepod block / pinstripe) with contrasting accents; catch
  fencing along the start/finish stretch and scattered runs; pit wall
  with COINOP lettering and pit-box canopies opposite the stand;
  painted start grid slots; puffier clouds; grass mow patches.
- **Polish 3 — clutter + furniture (54baecc).** House-brand livery
  micro-text (QTR / x402 / BASE / COINOP) on sidepods, cover flanks and
  wing endplates; carbon weave on the wing; T-cam and antenna; tyre
  sidewall lettering; heat-tinted exhausts; brake marker boards
  (150 / 100 / 50) counting down to strong-corner apexes with a
  red/white chevron board at each apex; a second mini grandstand,
  spectator banks with crowd speckle, marshal posts; kerb drop shadows
  and distance haze; a worn COINOP word ghost-painted on the asphalt
  past the start line.

## Verification — the frame gate

Every version was proven before deploy by frames rendered from the real
`drawGameState` at production size (960×900) via the `GP_FRAMES=1`
harness (`components/gp-frames.test.ts`, @napi-rs/canvas): start,
mid-race, corner, off-track. Muse reviewed all four frames at each
round; the operator reviewed them too and drove three polish rounds
("Much better but keep polishing" → "Keep polishing" → "Ship it",
2026-11-17) before authorising this deploy. Nothing in this rebuild
reached production on a builder's word alone.

Ship gates (54baecc): `npx vitest run` 192 passed / 8 skipped;
`npx tsc --noEmit` clean; `python3 scripts/security-scan.py` PASS.
Pushed ffac974..54baecc. Deployed `dpl_DJvwZUdBRCSN9nYZ4jj97LyoJ2V6`,
READY at https://coinop-one.vercel.app. Production verified: all 11
cabinet pages return 200; the Grand Prix page's live JS bundle contains
the new renderer ("INSERT COIN", "COINOP GRAND PRIX", the billboard
palette); the spectate API responds (default and `?slug=grandprix`);
the only open Exchange task is the standing "Snake 100+" challenge.

## Known compromises (carried from the build reports)

- Scenery rides the renderer odometer, not a pure state fingerprint:
  exact for sequential playback (live, demo, replay); scrubbing a
  replay mid-race can shift scenery phase until the next reset.
- The grandstand / pit wall / skyline are gated to a lap-clock window
  (~first 3.2 s of each lap) because the state exposes no lap distance;
  the gantry is odometer-anchored at 45 m and the two can drift a few
  metres apart in edge cases.
- Brake boards are apex-relative (150/100/50 m before the apex, not
  the braking zone) — a simplification that keeps the countdown correct
  in-window.
- No render interpolation: the 100 ms tick stepping is the period feel,
  and segment streaming carries the motion.
