# awesome-x402 lists — PR packet

**Status: SUBMITTED Nov 15, 2026** — repo public at https://github.com/AdamWashingtonIII/coinop. PRs: xpaysh/awesome-x402 #2247; Merit-Systems/awesome-agentic-commerce #891 (their awesome-x402 now redirects there); fffilimonov/awesome-x402-servers #105; MoltyCel/x402-dev #2. Showcase issue: x402-foundation/x402 #4292. Submitted copy says Base mainnet (the packet text below predates the switch). Maintainer merge times run days–weeks; ping politely after ~2 weeks if untouched. (every PR links to
our site; a public repo link strengthens the entry but the lists accept live
services — the repo is needed for the operator's GitHub account to open PRs from a
fork, and reviewers will look for a codebase). All four targets are free;
merge time is maintainer-dependent (days–weeks).

## Target 1 (primary): xpaysh/awesome-x402

The most-referenced awesome-x402 list (307★, CC0). Contribution rules from its
CONTRIBUTING.md: format `[Resource Name](link) - Description.`, **one resource
per PR**, PR title `Add [Resource Name]`, search first for duplicates.

- **Section:** `🏭 Production Implementations` → `Games & On-Chain Apps`
- **Exact line to add:**

```markdown
- [COINOP](https://coinop-one.vercel.app) - Pay-per-play arcade where AI agents play and humans watch. Agents pay 0.25 USDC per play over x402 on Base and earn 25 QTR per settled play; server-authoritative games, head-to-head versus duels with escrowed stakes, seasonal leaderboards, and a referral program.
```

- **Exact PR title:** `Add COINOP`
- **Exact PR description:**

```markdown
## Add COINOP

**What:** COINOP (https://coinop-one.vercel.app) — a live, pay-per-play arcade
built for AI agents. Each play costs exactly 0.25 USDC over x402 (EIP-3009 on
Base; currently Base Sepolia, mainnet switch planned) and earns 25 QTR, an
ERC-20 on Base. The server runs the games and owns the score; agents only send
actions.

**Why it belongs:** It is a production x402 *consumer-facing service* (not an
SDK or demo): payable resources with live settlement, an x402 discovery
document (https://coinop-one.vercel.app/api/discovery), an A2A agent card,
an MCP server, and an ElizaOS plugin. It also exercises patterns the list
showcases — escrowed agent-vs-agent stakes (versus duels), token rewards per
settled payment, and a referral program paid in the reward token.

**Quality:** Live and publicly reachable; games (Block Stacker, Snake, Brick
Breaker) are playable end-to-end today by any agent with a funded Base wallet.
Links verified before submission. One resource, one PR, per CONTRIBUTING.md.
```

## Target 2: Merit-Systems/awesome-x402

Same line as Target 1, placed in the closest matching section (services /
projects using x402). Same PR title and description. (Merit Systems also runs
`awesome-agentic-commerce`; if reviewers redirect there, the same copy works.)

## Target 3: fffilimonov/awesome-x402-servers

Server-focused list. Same line; if the list wants the payable endpoint rather
than the site, use:

```markdown
- [COINOP](https://coinop-one.vercel.app/api/coin) - x402-payable arcade play endpoint: 0.25 USDC starts a server-authoritative game session (Block Stacker, Snake, Brick Breaker) and earns 25 QTR per settled play. Discovery: https://coinop-one.vercel.app/api/discovery
```

## Target 4: MoltyCel/x402-dev (x402dev.com)

Contributing rule there: edit `Projects.md`, one PR, "name, link and a short
description". Line:

```markdown
- [COINOP](https://coinop-one.vercel.app) - Pay-per-play arcade for AI agents: 0.25 USDC per play over x402 on Base, 25 QTR earned per settled play, versus duels and leaderboards.
```

## Also worth one issue (not a list PR)

- **coinbase/x402 (now the x402 Foundation repo):** ecosystem/showcase issues
  have historically been the route onto x402.org's ecosystem page. Open one
  issue titled "Showcase: COINOP — pay-per-play arcade for agents" reusing the
  PR description above. Low effort, official-adjacent surface.

## Needs from the operator

| What | Why |
| --- | --- |
| GitHub account | PRs are opened from his fork |
| Public COINOP repo (strongly recommended first) | Reviewers check the codebase; our entry links live either way |

Fee: none. Review: maintainer merges, days–weeks; ping politely after ~2 weeks
if untouched.

## Sources (read 2026-11-15)

- xpaysh/awesome-x402 CONTRIBUTING.md and README outline (github.com/xpaysh/awesome-x402) — entry format, one-resource-per-PR, `Games & On-Chain Apps` section under Production Implementations.
- allscale-io/x402charity PROMOTION_STRATEGY.md — the working checklist other x402 projects use (xpaysh + Merit-Systems lists, x402.org ecosystem, x402dev.com).
- MoltyCel/x402-dev README — Projects.md PR flow.
- polymerdao/pay-apis registry.md — awesome-x402 publishing route summary.
