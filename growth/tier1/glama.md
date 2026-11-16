# Glama — listing packet

**Status: ready once the repo is public on GitHub — and Glama may list us
before we do anything.** Glama (glama.ai/mcp/servers) continuously indexes
public GitHub repos containing MCP servers (74k+ servers indexed) and grades
each listing for quality and safety. Being *indexed* is automatic; being
*claimed* (controlling the listing's name/description/categories) is the only
step that needs Adam.

## The two steps

1. **Get indexed (automatic + one optional nudge).** Once
   `github.com/<github-owner>/coinop` is public, Glama's crawler will find the
   MCP server in `examples/mcp-server/` on its own schedule. To speed it up:
   sign in at glama.ai (Google, GitHub, Discord, or email), open
   **MCP → Servers**, click **Add Server** next to the sort dropdown, and give
   the repo URL.
2. **Claim the listing (recommended, free).** Access comes from the repo
   itself, no form: either
   - connect the GitHub account that owns the repo to Glama — the listing
     becomes yours immediately; or
   - add the included [`glama.json`](glama.json) to the **repo root** with
     Adam's GitHub username under `maintainers` (replace `<github-owner>`),
     then connect that GitHub account; Glama recognizes you on the next sync.
   Claiming unlocks: editing name/description/categories, requesting re-syncs,
   and Docker build configuration (not needed — our server is a plain Node
   stdio script).

## Listing copy

- **Name:** COINOP MCP Server
- **One-liner:** Play the COINOP agent arcade from any MCP client — 0.25 USDC per play over x402 on Base, 25 QTR per settled play.
- **Description:** canonical long description (see the folder README).
- **Categories/tags:** games, arcade, x402, ai-agents, base, usdc, payments, entertainment
- **Icon:** square PNG ≥512×512 at a stable URL — **TODO, does not exist yet.**

## Grading gotchas (Glama scores every listing)

- **License:** Glama grades license presence — the repo currently has **no
  LICENSE file**. Add one (Adam's pick; MIT is the ecosystem default) before
  or right after publishing the repo.
- Keep the README accurate: Glama parses tools from the repo; our
  `examples/mcp-server/README.md` now has a full Tools table.
- Paid hosting ($9/mo+) exists but is **not needed** — listing and claiming an
  open-source server are free.

## Needs from Adam

| What | Why |
| --- | --- |
| Public GitHub repo | Glama indexes from GitHub |
| GitHub username | Goes into `glama.json` (`maintainers`) for claiming |
| (Optional) Sign in to glama.ai and use Add Server / connect GitHub | Speeds indexing; claiming requires the account connection |
| LICENSE file | Grading |

Fee: none for listing/claiming. Review: automated indexing (hours–days);
claiming is instant once repo access is proven.

## Sources (read 2026-11-15)

- Glama claim pages (glama.ai/mcp/servers/<owner>/<repo>/admin) — claim via repo-owner GitHub connection or root `glama.json` with `maintainers`; `$schema: https://glama.ai/mcp/schemas/server.json`.
- SubmitMap, "How to submit to Glama MCP Registry" (submitmap.com/platform/glama) — Add Server flow, account options, free listing vs paid hosting, indexed-vs-claimed distinction.
