import { describe, it, expect } from "vitest";
import { isGameMessage, HANDSHAKE_TIMEOUT_MS } from "./bridge-protocol";
import { PRICE_ATOMIC } from "./x402/config";
describe("bridge protocol (frozen, spec s7)", () => {
  it("accepts game messages, rejects junk", () => {
    expect(isGameMessage({ type: "READY" })).toBe(true);
    expect(isGameMessage({ type: "GAME_OVER", finalScore: 10 })).toBe(true);
    expect(isGameMessage({ type: "INIT" })).toBe(false);
    expect(isGameMessage(null)).toBe(false);
  });
  it("handshake timeout is 3s", () => { expect(HANDSHAKE_TIMEOUT_MS).toBe(3000); });
});
describe("price (spec s2.1)", () => { it("is hardcoded 0.25 USDC", () => { expect(PRICE_ATOMIC).toBe("250000"); }); });
