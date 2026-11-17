import { describe, expect, it } from "vitest";
import { GrandPrixGame, GP_OFFTRACK_MAX, type GrandPrixState } from "./grandprix";
// The reference driver: racing line into corners, wide dodge window, and it
// brakes instead of rear-ending a slower rival. The same policy drives the
// attract-mode demo.
function driveBot(g: GrandPrixGame, st: GrandPrixState) {
  let curveAhead = 0;
  for (let k = 4; k < 18; k++) { const c = st.road[k]?.curve ?? 0; if (Math.abs(c) > Math.abs(curveAhead)) curveAhead = c; }
  let targetLat = Math.max(-0.72, Math.min(0.72, curveAhead * 2.4));
  let blocked = false;
  for (const r of st.rivals) {
    if (r.relS > 4 && r.relS < 72 && Math.abs(r.lat - st.lat) < 0.6)
      targetLat = Math.max(-0.82, Math.min(0.82, r.lat + (st.lat >= r.lat ? 0.75 : -0.75)));
    if (r.relS > 0 && r.relS < 30 && Math.abs(r.lat - st.lat) < 0.62 && r.kmh < st.kmh) blocked = true;
  }
  const wantSteer = targetLat > st.lat + 0.07 ? 1 : targetLat < st.lat - 0.07 ? -1 : 0;
  if (wantSteer !== st.steer) g.act(wantSteer === 1 ? "right" : wantSteer === -1 ? "left" : "center");
  const wantThrottle = blocked || (Math.abs(curveAhead) > 0.5 && st.speed > 76) ? -1 : 1;
  if (wantThrottle !== st.throttle) g.act(wantThrottle === 1 ? "accelerate" : "brake");
}
function runRace(seed: number) {
  let now = 0;
  const g = new GrandPrixGame(() => now, seed);
  g.act("accelerate");
  while (!g.isOver && now < 400_000) {
    now += 100;
    const st = g.state();
    if (st.status === "playing") driveBot(g, st);
  }
  return g;
}
describe("grand prix", () => {
  it("rejects unknown actions", () => {
    const g = new GrandPrixGame(() => 0, 5);
    expect(() => g.act("warp")).toThrowError("unknown_action");
    expect(() => g.act("up")).toThrowError("unknown_action");
  });
  it("is deterministic: same seed and driver, same race", () => {
    const a = runRace(42).state();
    const b = runRace(42).state();
    expect(a.score).toBe(b.score);
    expect(a.lapTimes).toEqual(b.lapTimes);
    expect(a.overtakes).toBe(b.overtakes);
    expect(a.crashes).toBe(b.crashes);
    expect(a.finalPosition).toBe(b.finalPosition);
  });
  it("the reference driver finishes 3 laps with a real score", () => {
    const st = runRace(42).state();
    expect(st.finished).toBe(true);
    expect(st.outcome).toBe("finished");
    expect(st.lapTimes).toHaveLength(3);
    expect(st.finalPosition).toBeGreaterThanOrEqual(1);
    expect(st.finalPosition).toBeLessThanOrEqual(6);
    expect(st.score).toBeGreaterThan(1500);
    expect(st.bestLapMs).toBe(Math.min(...st.lapTimes));
  });
  it("a parked car never finishes: the 6-minute clock scores it as-is", () => {
    let now = 0;
    const g = new GrandPrixGame(() => now, 9);
    while (!g.isOver && now < 400_000) { now += 1000; g.state(); }
    const st = g.state();
    expect(st.status).toBe("over");
    expect(st.finished).toBe(false);
    expect(st.outcome).toBe("time_expired");
    expect(st.raceMs).toBe(360_000);
    expect(st.score).toBe(0);
  });
  it("off track caps speed hard", () => {
    let now = 0;
    const g = new GrandPrixGame(() => now, 3);
    g.act("accelerate"); g.act("right");
    let st = g.state();
    for (let i = 0; i < 300 && now < 30_000; i++) { now += 100; st = g.state(); }
    expect(st.offTrack).toBe(true);
    expect(Math.abs(st.lat)).toBeGreaterThan(1);
    expect(st.speed).toBeLessThanOrEqual(GP_OFFTRACK_MAX + 1);
  });
  it("publishes a seed commitment from the first frame", () => {
    const g = new GrandPrixGame(() => 0, 77);
    expect(g.state().seedCommit).toMatch(/^[0-9a-f]{64}$/);
    expect(g.revealSeed()).toBe("77");
  });
});
