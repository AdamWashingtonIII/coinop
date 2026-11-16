# Smithery — listing packet

**Status: ready the moment the repo is public on GitHub.** Everything Smithery
needs from the codebase already exists (prepared 2026-11-15):

- `examples/mcp-server/smithery.yaml` — stdio start command + config schema
  (COINOP_URL / AGENT_PRIVATE_KEY / COINOP_CHAIN_ID) + commandFunction.
- `examples/mcp-server/package.json` — server metadata (name, description,
  bin, `viem` dependency).
- `examples/mcp-server/README.md` — description, install snippet, Tools table.

## How Smithery listing works

Smithery's registry is GitHub-driven: you sign in with GitHub, submit the
repository URL, and its scanner reads `smithery.yaml` (plus `package.json`)
to build the listing and the generated install/config UI. There is no fee.
Verification is automated (the crawler exercises the server), and listings are
re-crawled roughly weekly — a server that regresses can lose its verified
badge, so keep the MCP server working after listing.

One wrinkle: `smithery.yaml` is expected at the **repository root**. Our MCP
server lives in `examples/mcp-server/` of a monorepo. Two ways through:

1. In Smithery's add-server flow, submit the repo and select the
   `examples/mcp-server` subdirectory when prompted (Smithery supports
   monorepo subdirectory servers).
2. Or copy `examples/mcp-server/` (with its `smithery.yaml`) into a small
   dedicated repo later. Option 1 first; fall back only if the scanner balks.

Note: Smithery has been steering toward hosted/remote servers; stdio listings
via GitHub scan remain the documented path for local servers like ours, but
confirm the flow on the submit page at submission time.

## Submission steps (5 minutes, once the repo is public)

1. Go to https://smithery.ai and sign in with GitHub (the operator's account — the one
   that owns the repo).
2. Add server → paste `https://github.com/AdamWashingtonIII/coinop` → select the
   `examples/mcp-server` subdirectory if asked.
3. Confirm the parsed config matches `smithery.yaml` (three config fields,
   only the private key without a default).
4. Submit. Automated verification typically completes in minutes to a few
   hours.

## Listing copy

- **Name:** COINOP MCP Server
- **One-liner:** Play the COINOP agent arcade from any MCP client — 0.25 USDC per play over x402 on Base, 25 QTR per settled play.
- **Description:** (canonical long description — see ../README.md in this folder; the server README's first paragraph is what most surfaces show.)
- **Tags:** games, arcade, x402, ai-agents, base, usdc, payments, entertainment
- **Icon:** square PNG ≥512×512 at a stable URL — **TODO, does not exist yet.**

## Needs from the operator

| What | Why |
| --- | --- |
| Public GitHub repo (see folder README) | Smithery lists from the repo URL |
| Sign in to smithery.ai with that GitHub account and click through the add-server flow | Account action only the owner can do; we cannot submit for you |
| A LICENSE file in the repo (recommended) | Registry quality signals |

Fee: none. Review: automated, minutes–hours.

## Sources (read 2026-11-15)

- Smithery publishing docs via DeepWiki (smithery-ai/sdk, "Publishing Servers") — smithery.yaml + package metadata requirements, GitHub-webhook publishing.
- AliveMCP registry guides (alivemcp.com) — smithery.yaml format, submit at smithery.ai, crawler verification and weekly re-crawls.
- Community submission guides on GitHub (e.g., a-ariff/canvas-student-mcp-server SMITHERY_SUBMISSION.md) — smithery.yaml must be at repo root / pointed subdirectory.
