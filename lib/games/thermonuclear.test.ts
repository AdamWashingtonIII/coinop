import { describe, it, expect } from "vitest";
import { ThermonuclearGame, TN_NO_PLAY_SCORE } from "./thermonuclear";

describe("thermonuclear war (WarGames feature cabinet)", () => {
  it("standing down on turn 1 is the only winning move", () => {
    const g = new ThermonuclearGame(() => 0, 99);
    const st = g.act("stand_down");
    expect(st.status).toBe("over");
    expect(st.outcome).toBe("the_only_winning_move");
    expect(g.finalScore).toBe(TN_NO_PLAY_SCORE);
  });

  it("is deterministic: same seed + same orders = same war", () => {
    const play = () => {
      const g = new ThermonuclearGame(() => 0, 7);
      for (const a of ["build_warheads", "launch_city_0", "build_interceptors", "launch_silo", "hold", "launch_city_1"]) {
        if (g.isOver) break;
        g.act(a);
      }
      return g.state();
    };
    expect(play()).toEqual(play());
  });

  it("a silo strike lands: silo lost, warheads burned", () => {
    const g = new ThermonuclearGame(() => 0, 3);
    const st = g.act("launch_silo");
    expect(st.foe.silos).toBe(2);
    expect(st.you.warheads).toBe(9);
    expect(st.lastLaunches.some((l) => l.kind === "silo" && l.result === "silo_hit")).toBe(true);
  });

  it("a city strike either destroys the city or is intercepted — never both, never neither", () => {
    const g = new ThermonuclearGame(() => 0, 11);
    const st = g.act("launch_city_0");
    const moscow = st.foe.cities[0];
    const hit = st.lastLaunches.find((l) => l.side === "you" && l.kind === "city");
    expect(hit).toBeTruthy();
    if (hit!.result === "destroyed") expect(moscow.alive).toBe(false);
    else { expect(hit!.result).toBe("intercepted"); expect(moscow.alive).toBe(true); }
    expect(st.turn).toBe(1);
    expect(st.defcon).toBeGreaterThanOrEqual(1);
    expect(st.defcon).toBeLessThanOrEqual(5);
  });

  it("illegal orders are rejected", () => {
    const g = new ThermonuclearGame(() => 0, 5);
    expect(() => g.act("launch_city_9")).toThrow("unknown_action");
    expect(() => g.act("nuke_everything")).toThrow("unknown_action");
    g.act("launch_city_0");
    // Moscow is either dead (illegal to re-target) or alive (fine) — only assert the dead case.
    if (!g.state().foe.cities[0].alive) expect(() => g.act("launch_city_0")).toThrow("illegal_move");
  });

  it("the war always ends by the turn cap with a scored outcome", () => {
    const g = new ThermonuclearGame(() => 0, 21);
    let guard = 0;
    while (!g.isOver && guard++ < 30) g.act("hold");
    expect(g.isOver).toBe(true);
    expect(["victory", "defeat", "mutual_destruction", "ceasefire"]).toContain(g.state().outcome);
    expect(g.finalScore).toBeGreaterThanOrEqual(0);
  });

  it("a late stand-down is accepted once the war has ground on", () => {
    let accepted = false;
    for (let seed = 1; seed <= 300 && !accepted; seed++) {
      const g = new ThermonuclearGame(() => 0, seed);
      let guard = 0;
      while (!g.isOver && g.state().turn < 16 && guard++ < 20) {
        const st = g.state();
        const biggest = st.you.cities.reduce((b, c, i) => (c.alive && (b < 0 || c.pop > st.you.cities[b].pop) ? i : b), -1);
        g.act(st.you.interceptors > 0 && biggest >= 0 ? "defend_city_" + biggest : "build_interceptors");
      }
      if (g.isOver) continue;
      const st = g.act("stand_down");
      if (st.outcome === "peace") accepted = true;
    }
    expect(accepted).toBe(true);
  });
});
