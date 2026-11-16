# mcp.so — listing packet

**Status: ready once the repo is public on GitHub.** mcp.so is the largest
community MCP directory (~20k servers). A listing is built from the repo URL:
mcp.so auto-pulls the name/description from the README, the install snippet
from the first ` ```bash ` block, and the tool list from a `## Tools` section.
Our `examples/mcp-server/README.md` now has all three (prepared 2026-11-15).

## Submission steps

1. Sign in at https://mcp.so (account required).
2. Open https://mcp.so/submit → tab **MCP Server**.
3. Fill the form (only the repository URL is strictly required):
   - **Repository URL:** `https://github.com/<github-owner>/coinop`
     (the listing will point at the monorepo; the README it parses is
     `examples/mcp-server/README.md` — if the parser reads only the root
     README, the fallback is submitting from a dedicated MCP repo or asking
     support; flag, don't block on it.)
   - **Name:** COINOP MCP Server
   - **Description (1–2 sentences):** Play the COINOP agent arcade from any MCP client — 0.25 USDC per play over x402 on Base, server-authoritative games, versus duels, and 25 QTR earned per settled play.
   - **Tags:** games, x402, base, usdc, ai-agents
   - **Category:** pick the closest match (Games / Entertainment if offered,
     else Developer Tools).
4. Choose the publication lane (see fee note) and submit.

## Fee — conflicting reports, verify at submit time

- Older guides (through mid-2026) describe a **free lane with human review**
  (minutes–2 days) and mcp.so also inherits listings from awesome-mcp-servers.
- SubmitMap's check on **2026-09-01** reports the free lane is **gone**: the
  form offers a single **$39 one-time** paid submission (immediate publication,
  verified badge, featured placement, followed link).
- **Plan for $39** and treat a free option, if it reappears, as a bonus. This
  is a payment only Adam can make (his account, his card).

## Listing copy

- **Name:** COINOP MCP Server
- **Short description (≤140 chars):** Pay-per-play arcade for AI agents: 0.25 USDC a play over x402 on Base, 25 QTR per settled play, versus duels included.
- **Long description:** canonical (see folder README).
- **Icon:** square PNG ≥512×512 at a stable URL — **TODO, does not exist yet.**
- Note: mcp.so re-fetches the README about weekly; re-submission is not
  needed for updates.

## Needs from Adam

| What | Why |
| --- | --- |
| Public GitHub repo | The listing is built from the repo URL |
| mcp.so account + submit the form | Owner account action |
| Possibly $39 one-time | Paid lane may be the only lane (see above) |

Review time: minutes (automated parse) to ~2 days (human spot-check), per
community guides.

## Sources (read 2026-11-15)

- SubmitMap, "How to submit to MCP.so" (submitmap.com/platform/mcp-so, checked 2026-09-01) — form fields, $39-only lane.
- Studio Meyer Academy, "MCP marketplaces" (studiomeyer.academy) — form fields and README auto-pull behavior, ~24h indexing.
- NeCL guide, "How to Publish MCP Servers in 2026" (neclco.com) — submit flow, review times, cost table.
- mcpize/alivemcp mcp.so guides — card fields and README parsing.
