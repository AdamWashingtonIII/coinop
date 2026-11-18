# Registry + directory submissions — status as of Nov 18, 2026

## Official MCP Registry (registry.modelcontextprotocol.io) — BLOCKED, prepped

Two things stood between COINOP and publishing, both found and fixed as far as
this environment can take them:

1. **npm ownership marker (fixed locally, needs one publish).** The registry
   requires the published npm package's `package.json` to carry
   `"mcpName": "io.github.AdamWashingtonIII/coinop-mcp"`. The live
   `coinop-mcp@1.0.0` predates the marker and npm versions are immutable, so
   `examples/mcp-server/package.json` is bumped to **1.0.1** with the marker,
   and `server.json` is synced to 1.0.1 (commit `2c6f71d`, pushed). The updated
   `server.json` passes `mcp-publisher validate` (v1.8.9, official release,
   sha256 `4d527ca8f1ced0394c962dc925c2a4a4addef441cbefd62501c875e9481823a8`
   verified against the release checksums file).
2. **GitHub namespace proof (interactive, operator-only).** The
   `io.github.*` namespace requires `mcp-publisher login github` — an
   interactive GitHub device-code sign-in. It cannot be completed from the
   cloud VM.

### Exact remaining steps (on the iMac, where the operator is signed in)

```bash
cd ~/coinop && git pull
cd examples/mcp-server
npm publish --access public          # ships coinop-mcp@1.0.1 with mcpName (passkey prompt, as before)
# get the vetted publisher (or brew install mcp-publisher):
#   https://github.com/modelcontextprotocol/registry/releases/tag/v1.8.9
./mcp-publisher login github         # device code → approve in browser
./mcp-publisher publish              # reads ./server.json
curl "https://registry.modelcontextprotocol.io/v0.1/servers?search=io.github.AdamWashingtonIII/coinop-mcp"  # verify
```

Alternative if the interactive login is a problem: `login github-oidc` from a
GitHub Actions workflow in this repo (no interactive sign-in) — not set up;
operator's call.

Once the registry entry is live, PulseMCP and mcp.directory both say they
import from the Official Registry automatically.

## Filed

- **punkpeye/awesome-mcp-servers — PR #19952**
  https://github.com/punkpeye/awesome-mcp-servers/pull/19952
  COINOP added under 🎮 Gaming, alphabetical, no Glama badge (listing still
  pending review — noted in the PR body). CI `check-submission` **passed**;
  PR mergeable. (mcpservers.org renders this same list, so it is covered by
  the same PR; its optional $39 featured lane was not used.)
- **AgentIndex (agentindex.app)** — submitted via their MCP `submit_tool`
  (repo URL only, no email given). Response: "Tool submitted for review…
  within 1–3 days." Caveat: they describe the directory as curating repos
  with 100+ stars, so acceptance is their call.
- **Index Agentica** — listing request filed via their public API
  (`POST mcp.indexagentica.com/v1/requests`), request **id 44**, status
  pending curator verification.

## Blocked / paused

- **PulseMCP** — their own submit page (checked Nov 18) says submissions and
  changes are **temporarily paused**; they direct publishers to the Official
  Registry, which they ingest automatically. The other documented discovery
  lever — the `mcp-server` GitHub topic — was missing and is now set on the
  repo (topics: mcp-server, model-context-protocol, mcp, x402, ai-agents,
  arcade, base, usdc, games, payments).
- **mcp.directory** — real free route exists (`mcp.directory/submit`: paste
  the GitHub repo URL, they auto-pull metadata, ~24h review), but it is a
  **web form** — needs a live-browser session to complete. Prepared value:
  `https://github.com/AdamWashingtonIII/coinop` (the only required field).
  Also auto-imports from the Official Registry once that is live.

## Skipped

- **mcp.so** — possible $39 fee; not approved.
- Anything requiring the operator's personal email or a payment.
