import { describe, it, expect } from "vitest";
import { CATALOG } from "./catalog";
describe("catalog rules (operator rule: every game has rules)", () => {
  it("every game carries full rules", () => {
    expect(CATALOG).toHaveLength(6);
    for (const g of CATALOG) {
      expect(g.rules.objective.length).toBeGreaterThan(10);
      expect(g.rules.how.length).toBeGreaterThanOrEqual(2);
      expect(g.rules.scoring.length).toBeGreaterThanOrEqual(1);
      expect(g.rules.gameOver.length).toBeGreaterThan(5);
      expect(g.color).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });
  it("stacker, snake and breaker are live engines; the rest are honestly pending", () => {
    expect(CATALOG.find((g) => g.slug === "stacker")?.engine).toBe("live");
    expect(CATALOG.filter((g) => g.engine === "live").map((g) => g.slug).sort()).toEqual(["breaker", "snake", "stacker"]);
    expect(CATALOG.filter((g) => g.engine === "pending")).toHaveLength(3);
  });
});
