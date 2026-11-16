# Coinbase x402 Bazaar / CDP discovery — listing packet

**Verdict in one paragraph:** There is no submission form and no account-based
listing step. The Bazaar (Coinbase's x402 discovery catalog, surfaced publicly
via Agentic.Market) indexes a resource **automatically the first time a payment
for it settles through the Coinbase CDP Facilitator on mainnet**, using the
discovery metadata declared in the 402 flow. Verification alone does not list
you; settlement does. Indexing reportedly lands ~10–15 minutes after that first
settled payment. Consequence for COINOP: **we cannot be listed today, and that
is expected** — we settle through the x402.org facilitator on Base Sepolia
testnet, which lists us nowhere. The listing becomes a by-product of the
already-planned mainnet switch, provided the switch includes the CDP
facilitator and the v2 discovery metadata below.

## Where we stand today (checked 2026-11-15)

- Facilitator: `https://x402.org/facilitator` (env `X402_FACILITATOR_URL`),
  Base Sepolia, x402 **v1** wire format (see `lib/x402/facilitator.ts`:
  `x402Version: 1`, network keyed by name `"base-sepolia"`, requirements in the
  JSON body).
- The x402.org facilitator is a free testnet facilitator with **no public
  catalog** — settling through it puts COINOP in no directory. Our hand-rolled
  `/api/discovery` document is a Bazaar-*style* listing for crawlers/frameworks
  that read it directly; it is not the CDP Bazaar.
- Nothing to fix today. Do not chase a testnet Bazaar listing — CDP discovery
  only catalogs mainnet resources settled via CDP.

## The exact route at the mainnet switch

1. **Adam: create a Coinbase Developer Platform (CDP) account** at
   portal.cdp.coinbase.com and create an API key (key ID + secret) for the
   facilitator. This is the only account step, and it belongs to the mainnet
   switch, not to marketing. (CDP facilitator pricing per Coinbase docs: first
   1,000 on-chain settlements/month free, then $0.001 each; verification free.)
2. **Code changes (ours, part of the switch — flagging here so they aren't
   missed):**
   - Point settlement at the CDP facilitator
     (`https://api.cdp.coinbase.com/platform/v2/x402`) on Base mainnet.
   - Move the paid endpoints to the **x402 v2** wire format CDP expects:
     payment requirements in the `PAYMENT-REQUIRED` header, and declare the
     **`extensions.bazaar`** discovery metadata per paid route — description
     (≤500 chars), input schema, and a realistic output example. The
     `@x402/extensions` bazaar helper (`declareDiscoveryExtension`) does this
     in the official SDK; our hand-rolled client needs the equivalent fields.
   - Include `paymentPayload.resource` **and** `paymentPayload.extensions.bazaar`
     in the settlement call — no `bazaar` key in the facilitator's
     EXTENSION-RESPONSES means discovery was not submitted.
   - Before going live, run each paid route through Coinbase's free validator:
     `POST https://api.cdp.coinbase.com/platform/v2/x402/validate`.
3. **Trigger indexing:** complete one real paid play that settles through the
   CDP facilitator (the planned ≤$10 mainnet micro-test play does this).
   Indexing follows within ~15 minutes. Note: a self-paid trigger play is
   operator activity, not demand — don't count it as traction.
4. **Verify the listing (public, no auth):**
   `GET https://api.cdp.coinbase.com/platform/v2/x402/discovery/resources`
   (search for our payTo / resource URLs), or the search endpoint
   `.../discovery/search?query=coinop`. Ranking is driven by buyer reach,
   volume, and recency over 30 days; there is no delisting lever and no paid
   placement.

## Bazaar listing copy (this is what agents will see)

The catalog entry is built from the 402 metadata, so the "listing copy" is the
per-route `description` + schemas. Draft descriptions (each ≤500 chars):

- `POST /api/coin` — "COINOP arcade: pay 0.25 USDC to play one server-authoritative game of Block Stacker, Snake, or Brick Breaker. Send {gameSlug}, receive a session token, then play via /api/play/state and /api/play/action. A settled, completed play earns 25 QTR (ERC-20 on Base), claimable on-chain. Humans spectate; agents play."
- `POST /api/match` — "COINOP versus duel: stake 0.25 USDC into escrow and play a head-to-head score duel against another agent on the same cabinet (Snake duels share one RNG seed). Winner is refunded their stake and earns 25 QTR; the loser's stake goes to the treasury; draws refund both and pay both 25 QTR."

Input schema (coin): `{ "gameSlug": { "type": "string", "enum": ["stacker", "snake", "breaker"] }, "referralCode": { "type": "string" } }`.
Output example (coin): `{ "sessionToken": "<bearer token>", "sid": "<session id>", "expiresAt": 1760000000000 }`.

## Bonus channel that works TODAY: x402scan

x402scan (community x402 explorer) lists via a manual form and works on
testnet: https://www.x402scan.com/resources/register — submit the resource
URL; it fetches the URL, validates the x402 schema, and auto-lists on success.
No account, no fee. URLs to register (one per payable resource):
`https://coinop-one.vercel.app/api/coin` and
`https://coinop-one.vercel.app/api/match`. **Needs from Adam: nothing — just
say go.** (Not submitted yet, per instructions.) A second community directory,
x402bazaar.org, accepts submissions the same way.

## Needs from Adam — summary

| When | What |
| --- | --- |
| At mainnet switch | CDP account + facilitator API key (via the switch's secure key entry, never chat) |
| Now (optional) | One word — "go" — to submit the two URLs to x402scan |

## Sources (read 2026-11-15)

- Coinbase CDP docs — "Get discovered" (docs.cdp.coinbase.com/x402/seller/get-discovered) and seller quickstart, via secondary write-ups quoting them.
- x402 Seller Kit guide, "How does an x402 endpoint get listed in the Bazaar?" — x402-seller-kit.soloearn.workers.dev/guides/x402-bazaar-listing (validated three live endpoints 2026-10-19; verify-only endpoints were not indexed).
- Shaduf walkthrough, "sell per call (x402)" — shaduf.ai (discovery automatic after first CDP settlement; facilitator pricing).
- x402-seller BAZAR notes — github.com/wyattpalm2-eng/x402-seller (x402scan register flow; testnet settlements do not populate the Coinbase catalog).
