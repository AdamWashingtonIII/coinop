import { describe, it, expect } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { createCanvas } from "@napi-rs/canvas";
import { drawGameState, type AnyStateLike } from "./render";
import { GrandPrixGame, type GrandPrixState } from "@/lib/games/grandprix";

// Grand Prix proof-frame harness (ADR 0018 fix pass): renders the REAL
// drawGameState through a headless canvas at the production backing size
// (960x900) with scripted states and writes PNGs to ~/workspace/gp-frames/
// for visual review. Gated: only runs with GP_FRAMES=1 so the normal suite
// stays a pure test run.
//   GP_FRAMES=1 npx vitest run components/gp-frames.test.ts
const GP_ACCENT = "#ff3131"; // the cabinet accent production passes in
const OUT = path.join(homedir(), "workspace", "gp-frames");

function frame(state: GrandPrixState, name: string): void {
  const cv = createCanvas(960, 900);
  const ctx = cv.getContext("2d");
  drawGameState(ctx as unknown as CanvasRenderingContext2D, state as unknown as AnyStateLike, GP_ACCENT);
  writeFileSync(path.join(OUT, name), cv.toBuffer("image/png"));
}

describe.skipIf(process.env.GP_FRAMES !== "1")("grand prix proof frames", () => {
  it("renders start / midrace / corner / offtrack", () => {
    mkdirSync(OUT, { recursive: true });

    // start: a fresh grid — hero at a standstill, five rivals ahead.
    const start = new GrandPrixGame(() => 0, 97).state();
    frame(start, "start.png");

    // midrace: drive the real engine for 25 s, then compose the traffic —
    // one rival CLOSE on the right (relS 7), one mid-distance, one far.
    let now = 0;
    const gp = new GrandPrixGame(() => now, 97);
    gp.act("accelerate");
    for (let i = 0; i < 250; i++) { now += 100; gp.state(); }
    const mid = gp.state();
    if (mid.speed < 90) { mid.speed = 104; mid.kmh = Math.round(mid.speed * 2.6); }
    mid.rivals = [
      { id: 0, relS: 7, lat: 0.35, kmh: 262, color: "#ff2e63" },
      { id: 1, relS: 52, lat: -0.5, kmh: 255, color: "#ffb02e" },
      { id: 2, relS: 130, lat: 0.1, kmh: 240, color: "#4da3ff" },
    ];
    mid.position = 3;
    mid.score = 486; mid.crashes = 0; // the unsteered drive crashes; compose a clean race
    frame(mid, "midrace.png");

    // corner: a strong right-hander scripted into the road samples, car
    // committed at speed with the wheel turned in.
    const corner: GrandPrixState = {
      ...new GrandPrixGame(() => 0, 5).state(),
      road: Array.from({ length: 40 }, (_, k) => ({ dx: 80 * (k / 39) ** 2, curve: 1.1 })),
      rivals: [
        { id: 0, relS: 34, lat: -0.45, kmh: 250, color: "#4da3ff" },
        { id: 1, relS: 88, lat: 0.5, kmh: 245, color: "#b26bff" },
      ],
      speed: 102, kmh: 265, steer: 1, throttle: 1, lat: 0.15,
      raceMs: 96400, lapMs: 41200, lastLapMs: 44800, bestLapMs: 44100,
      lap: 2, position: 3, score: 812, crashes: 0, offTrack: false,
    };
    frame(corner, "corner.png");

    // offtrack: on the grass at the road's edge, correcting back, throttle on.
    const off: GrandPrixState = {
      ...new GrandPrixGame(() => 0, 5).state(),
      lat: 1.25, offTrack: true, steer: -1, throttle: 1,
      speed: 42, kmh: 109, raceMs: 51200, lapMs: 51200,
      score: 640, lap: 1, position: 5, crashes: 1,
    };
    frame(off, "offtrack.png");

    expect(true).toBe(true);
  });
});
