import { describe, it, expect } from "vitest";
import { drawGameState, type AnyStateLike } from "./render";
import { GrandPrixGame } from "@/lib/games/grandprix";
import { SnakeGame } from "@/lib/games/snake";
import { ChessGame } from "@/lib/games/chess";
import { GoGame } from "@/lib/games/go";

// Renderer smoke tests (ADR 0018): every cabinet's draw path must survive a
// stub ctx at the enlarged backing size, across the states that stress it
// (GP: start / mid-race / off-track / braking / finished / degenerate road).
function stubCtx(w = 960, h = 900) {
  const grad = { addColorStop: () => {} };
  const target: Record<string, unknown> = {
    canvas: { width: w, height: h },
    measureText: () => ({ width: 42 }),
    createLinearGradient: () => grad,
    createRadialGradient: () => grad,
  };
  return new Proxy(target, {
    get(t, p) {
      if (p in t) return t[p as string];
      return () => {};
    },
    set(t, p, v) { t[p as string] = v; return true; },
  }) as unknown as CanvasRenderingContext2D;
}

describe("renderer smoke", () => {
  it("grand prix: start, mid-race, off-track, braking, finished", () => {
    let now = 0;
    const gp = new GrandPrixGame(() => now, 97);
    const ctx = stubCtx();
    const draw = () => drawGameState(ctx, gp.state() as unknown as AnyStateLike, "#ffb02e");
    draw(); // grid, speed 0
    gp.act("accelerate");
    for (let i = 0; i < 120; i++) { now += 100; gp.state(); }
    draw(); // up to speed, rivals ahead
    gp.act("right");
    for (let i = 0; i < 200; i++) { now += 100; gp.state(); }
    draw(); // steered, possibly off-track
    gp.act("brake");
    for (let i = 0; i < 30; i++) { now += 100; gp.state(); }
    draw(); // brake light lit
    for (let i = 0; i < 3600; i++) { now += 100; const st = gp.state(); if (st.status === "over") break; }
    draw(); // finished / time expired overlay
    expect(gp.state().status).toBe("over");
  });
  it("grand prix: hand-made edge states do not throw", () => {
    const ctx = stubCtx(320, 300); // 1x backing store still works
    const base = new GrandPrixGame(() => 0, 5).state() as unknown as Record<string, unknown>;
    drawGameState(ctx, { ...base, lat: 1.3, offTrack: true, crashes: 2, throttle: -1 } as unknown as AnyStateLike, "#ffb02e");
    drawGameState(ctx, { ...base, lat: -1.3, rivals: [], road: [] } as unknown as AnyStateLike, "#ffb02e");
  });
  it("other cabinets still draw at the enlarged backing size", () => {
    const ctx = stubCtx();
    drawGameState(ctx, new SnakeGame(() => 0, 7).state() as unknown as AnyStateLike, "#7dff2e");
    drawGameState(ctx, new ChessGame(() => 0, 7).state() as unknown as AnyStateLike, "#4da3ff");
    drawGameState(ctx, new GoGame(() => 0, 7).state() as unknown as AnyStateLike, "#39ffdc");
  });
});
