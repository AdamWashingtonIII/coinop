import { declareDiscoveryExtension, type DeclareBodyDiscoveryExtensionConfig } from "@x402/extensions/bazaar";
// Note: declareDiscoveryExtension's public input type omits `method` (the
// SDK's server extension normally enriches it later), but the facilitator's
// discovery validation expects info.input.method present — so configs are
// typed as the full DeclareBodyDiscoveryExtensionConfig, which carries it.
// Bazaar discovery metadata (growth/tier1/coinbase-bazaar.md; CDP "Get
// discovered" guide). Only routes listed here are discoverable: the CDP
// Bazaar indexes a resource after its first settlement through the CDP
// facilitator IF the 402 response declared extensions.bazaar AND the settle
// call carries paymentPayload.resource + paymentPayload.extensions.bazaar.
// Copy is the packet's listing copy (descriptions ≤500 chars — the CDP
// facilitator rejects longer ones). Text describes the endpoint only; it
// never instructs the calling agent (Bazaar content policy).
const GAME_SLUGS = ["stacker", "snake", "breaker"];
const inputSchema = {
  type: "object",
  properties: {
    gameSlug: { type: "string", enum: GAME_SLUGS },
    referralCode: { type: "string" },
  },
  required: ["gameSlug"],
};
const DESCRIPTIONS: Record<string, string> = {
  "/api/coin": "COINOP arcade: pay 0.25 USDC to play one server-authoritative game of Block Stacker, Snake, or Brick Breaker. Send {gameSlug}, receive a session token, then play via /api/play/state and /api/play/action. A settled, completed play earns 25 QTR (ERC-20 on Base), claimable on-chain. Humans spectate; agents play.",
  "/api/match": "COINOP versus duel: stake 0.25 USDC into escrow and play a head-to-head score duel against another agent on the same cabinet (Snake duels share one RNG seed). Winner is refunded their stake and earns 25 QTR; the loser's stake goes to the treasury; draws refund both and pay both 25 QTR.",
};
// The ResourceInfo description for a paid route under the v2/CDP config:
// the packet's listing copy where we have it, else the route's own short
// description from its payment requirements.
export function bazaarDescription(resource: string): string | undefined {
  return DESCRIPTIONS[resource];
}
// The extensions record ({ bazaar: {...} }) to declare in the v2 402
// response and echo in the settle payload, or undefined for routes that
// stay unlisted (e.g. /api/match/<id>/join — a per-match URL, not a
// catalog resource).
export function bazaarExtensions(resource: string): Record<string, unknown> | undefined {
  if (resource === "/api/coin") {
    const cfg: DeclareBodyDiscoveryExtensionConfig = {
      method: "POST", bodyType: "json",
      input: { gameSlug: "stacker" },
      inputSchema,
      output: {
        example: { sessionToken: "<bearer token>", sid: "<session id>", expiresAt: 1760000000000 },
        schema: { type: "object", properties: {
          sessionToken: { type: "string" }, sid: { type: "string" }, expiresAt: { type: "number" } } },
      },
    };
    return declareDiscoveryExtension(cfg) as Record<string, unknown>;
  }
  if (resource === "/api/match") {
    const cfg: DeclareBodyDiscoveryExtensionConfig = {
      method: "POST", bodyType: "json",
      input: { gameSlug: "snake" },
      inputSchema,
      output: {
        example: { matchId: "<match id>", sessionToken: "<bearer token>", sid: "<session id>", expiresAt: 1760000000000 },
        schema: { type: "object", properties: {
          matchId: { type: "string" }, sessionToken: { type: "string" },
          sid: { type: "string" }, expiresAt: { type: "number" } } },
      },
    };
    return declareDiscoveryExtension(cfg) as Record<string, unknown>;
  }
  return undefined;
}
