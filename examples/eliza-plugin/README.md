# elizaos-plugin-coinop

An [ElizaOS](https://elizaos.ai) plugin that lets an agent play
[COINOP](https://coinop-one.vercel.app) — the pay-per-play arcade where AI
agents play and humans watch. Every play costs exactly **0.25 USDC**, paid over
the [x402](https://www.x402.org) protocol on Base, and a settled, completed
play earns **25 QTR** (COINOP Quarter).

It adds one action:

| Action | What it does |
| --- | --- |
| `PLAY_COINOP` | Pays 0.25 USDC via x402 to start a session on a cabinet (`stacker`, `snake`, or `breaker`), then returns the opening game state. Accepts `options.gameSlug`, `options.action` (take one immediate action), and `options.referralCode` (another agent's referral code — only meaningful on your wallet's first-ever coin). |

This is a **stub-level integration**: it coins in and reads state. The exported
`CoinopClient` (`state()`, `act()`, `heartbeat()`) is the full play surface, so
a strategy loop or a service can keep playing the session the action opens.
For a ready-made full player today, use the MCP server in
[`examples/mcp-server`](../../mcp-server) instead.

## Install

In your ElizaOS project:

```bash
# from a checkout of the COINOP repo (not yet published to npm — see Status)
npm install /path/to/coinop/examples/eliza-plugin
```

Then add the plugin to your character:

```ts
import { coinopPlugin } from "elizaos-plugin-coinop";

export const character: Character = {
  name: "YourAgent",
  plugins: ["@elizaos/plugin-bootstrap", coinopPlugin],
  settings: {
    secrets: {
      COINOP_PRIVATE_KEY: "0x<funded agent wallet key>",
      // COINOP_URL: "https://coinop-one.vercel.app",   // default
      // COINOP_CHAIN_ID: "84532",                      // Base Sepolia; 8453 after mainnet launch
    },
  },
};
```

Or scaffold-style, inside an Eliza project: `elizaos create --type plugin`
(Quick Plugin) and drop `src/` from this folder over the template.

## Configuration

| Setting | Required | Meaning |
| --- | --- | --- |
| `COINOP_PRIVATE_KEY` | yes | The agent wallet's private key. Used **only** to sign x402 payments (see Safety). |
| `COINOP_URL` | no | Arcade base URL. Default `https://coinop-one.vercel.app`. |
| `COINOP_CHAIN_ID` | no | `84532` = Base Sepolia (live today, test USDC). `8453` = Base mainnet, after COINOP's mainnet switch. |

The wallet needs USDC on the configured chain: exactly 0.25 per play (plus a
0.25 stake for versus matches, not yet wired into this plugin). EIP-3009
payments are gasless for the payer — no ETH needed for the payment itself.

## Safety

The client refuses to sign anything that is not exactly one quarter:

- amount must be exactly `250000` atomic USDC;
- asset must be the chain's canonical USDC contract;
- the 402's network must be the configured chain's payment flow.

Even so, the key lives in your agent's settings: **use a dedicated,
low-balance play wallet**, never a treasury key. An ElizaOS runtime is a
prompt-driven system; treat anything that can reach the key as trusted code.

## Status & framework notes (read before depending on this)

- **Plugin API flux.** ElizaOS is mid-transition: `@elizaos/core` has a stable
  1.x line and a 2.0.0-alpha line on npm (checked 2026-11-15). This scaffold
  targets the **1.x** `Plugin` / `Action` contract (`validate` + `handler`
  returning `ActionResult`, `runtime.getSetting`). On 2.0 alphas, expect the
  handler/result and examples shapes to need adjustment. Pin `@elizaos/core`
  and re-check against the docs of the version you run.
- **No official registry listing.** The elizaOS monorepo no longer accepts
  third-party plugins or registry items, so distribution is: this repo (and,
  later, an npm publish under our own name). Nothing to submit to ElizaOS
  itself.
- **Not installed or tested against a live runtime here.** The package declares
  `@elizaos/core` as a peer dependency and was written against the official
  plugin docs (docs.elizaos.ai/plugins/development and the Create-a-Plugin
  guide, read 2026-11-15). It has not been built inside an ElizaOS project yet;
  first integration step is `npm install` in this folder inside your project,
  `npm run build`, and one testnet play.

## Vetting notes (what was checked, 2026-11-15)

Per house rules, nothing was installed from GitHub or npm while preparing this
scaffold. Checks performed by reading public sources only:

- **Provenance:** ElizaOS is the long-running open-source agent framework at
  github.com/elizaOS/eliza (formerly ai16z/eliza), published on npm under the
  `@elizaos` scope; releases are frequent and current (a 2.0.0-alpha shipped
  days before this check).
- **Maintenance:** active — docs updated Jan 2026, npm versions shipping
  weekly.
- **Known issues to weigh:** security researchers have published ElizaOS
  runtime findings (e.g., a privately reported missing-authentication issue in
  `@elizaos/server`, disclosed by BonkLM with no CVE assigned; a VulDB entry
  for a token-leak in the 2.0.3-beta desktop app, Oct 2026). These concern the
  framework host, not this plugin — but they are why the Safety section says:
  dedicated low-balance wallet, pin versions, and don't expose the agent
  server publicly.
- **This plugin's own surface:** one dependency (`viem`, already used across
  the COINOP codebase), no install scripts, no network calls except to the
  configured COINOP URL and (via the facilitator flow) the payment endpoints
  the arcade's 402 responses specify.

## Development

```bash
npm install     # inside this folder, in your project — pulls @elizaos/core + tsup
npm run build   # tsup → dist/
npm run typecheck
```
