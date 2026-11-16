import { describe, it, expect } from "vitest";
import { buildAgentCard, X402_EXTENSION_URI } from "./agent-card";

// Validation against the A2A Agent Card schema, spec v1.0 (protobuf-derived JSON
// form). Required top-level fields: name, description, supportedInterfaces,
// version, capabilities, defaultInputModes, defaultOutputModes, skills.
const card = buildAgentCard("https://coinop.example");

describe("A2A agent card (v1.0)", () => {
  it("carries every required top-level field with the right type", () => {
    expect(typeof card.name).toBe("string");
    expect(card.name.length).toBeGreaterThan(0);
    expect(typeof card.description).toBe("string");
    expect(card.description.length).toBeGreaterThanOrEqual(20); // routers can't match a stub
    expect(Array.isArray(card.supportedInterfaces)).toBe(true);
    expect(card.supportedInterfaces.length).toBeGreaterThan(0);
    expect(typeof card.version).toBe("string");
    expect(card.capabilities).toBeTypeOf("object");
    expect(Array.isArray(card.defaultInputModes)).toBe(true);
    expect(card.defaultInputModes).toContain("application/json");
    expect(Array.isArray(card.defaultOutputModes)).toBe(true);
    expect(card.defaultOutputModes).toContain("application/json");
    expect(Array.isArray(card.skills)).toBe(true);
    expect(card.skills.length).toBeGreaterThan(0);
  });

  it("has no legacy v0.x fields (url / preferredTransport moved into supportedInterfaces)", () => {
    const raw = card as unknown as Record<string, unknown>;
    expect(raw.url).toBeUndefined();
    expect(raw.preferredTransport).toBeUndefined();
    expect(raw.additionalInterfaces).toBeUndefined();
    expect(raw.protocolVersion).toBeUndefined();
  });

  it("every interface declares url, protocolBinding, and protocolVersion", () => {
    for (const iface of card.supportedInterfaces) {
      expect(iface.url).toMatch(/^https:\/\//);
      expect(["JSONRPC", "GRPC", "HTTP+JSON"]).toContain(iface.protocolBinding);
      expect(iface.protocolVersion).toBe("1.0");
    }
  });

  it("provider, when present, has both organization and url", () => {
    expect(card.provider?.organization).toBeTruthy();
    expect(card.provider?.url).toMatch(/^https:\/\//);
  });

  it("every skill has id, name, description, and non-empty tags; ids are unique", () => {
    const ids = new Set<string>();
    for (const s of card.skills) {
      expect(s.id).toBeTruthy();
      expect(ids.has(s.id)).toBe(false);
      ids.add(s.id);
      expect(s.name).toBeTruthy();
      expect(s.description.length).toBeGreaterThanOrEqual(20);
      expect(Array.isArray(s.tags)).toBe(true);
      expect(s.tags.length).toBeGreaterThan(0);
    }
  });

  it("covers the four headline skills: play, versus, referrals, leaderboards", () => {
    const ids = card.skills.map((s) => s.id);
    expect(ids).toContain("play-games");
    expect(ids).toContain("versus-matches");
    expect(ids).toContain("referrals");
    expect(ids).toContain("leaderboards-and-spectating");
  });

  it("declares the x402 payment extension as a note (not required: COINOP settles over plain HTTP x402)", () => {
    const ext = card.capabilities.extensions?.find((e) => e.uri === X402_EXTENSION_URI);
    expect(ext).toBeDefined();
    expect(ext?.required).toBe(false);
    expect(ext?.description).toContain("x402");
    const params = ext?.params as Record<string, unknown>;
    expect(params.pricePerPlay).toContain("0.25 USDC");
    expect(params.rewardPerSettledPlay).toContain("25 QTR");
    expect(String(params.discoveryUrl)).toMatch(/\/api\/discovery$/);
  });

  it("states the economics consistently: 0.25 USDC per play, 25 QTR per settled play", () => {
    expect(card.description).toContain("0.25 USDC");
    expect(card.description).toContain("25 QTR");
  });

  it("serializes to JSON and back without loss of required fields", () => {
    const round = JSON.parse(JSON.stringify(card)) as typeof card;
    expect(round.name).toBe(card.name);
    expect(round.skills.length).toBe(card.skills.length);
    expect(round.supportedInterfaces[0].url).toBe(card.supportedInterfaces[0].url);
  });
});
