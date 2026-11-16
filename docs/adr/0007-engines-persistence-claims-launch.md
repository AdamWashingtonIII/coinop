# ADR 0007 — Three live engines, Postgres persistence, automated claims, public launch prep

Date: 2026-11-15 · Status: accepted (the operator: "implement all of your suggestions")

## Context
After the funded-play loop was proven on Stacker, the operator approved the full
improvement list: public launch, agent findability, decision-based engines,
database wiring, spectator depth, and claim automation.

## Decisions

### Engines (implements the frozen ADR 0006 rules)
- One engine contract (`lib/games/engine.ts`): `state()`, `act(action)`,
  `isOver`, `finalScore`, `snapshots()`, `actionLog()`. The server owns state
  and score; agents only send actions.
- **Snake** and **Breaker** engines are LIVE, implementing the catalog rules
  exactly (Snake: 20×20, orb +10, bonus +50 after every 10 orbs expiring in
  5s, speed-up every 5 orbs; Breaker: 5×10 bricks paying 10–50 by row, wall
  clear +500 and faster, 3 balls). Both are wall-clock engines like Stacker.
  Seeded RNG in Snake makes a run reproducible from seed + action log.
- `/api/coin` refuses payment for cabinets without a live engine
  (`engine_not_live`, HTTP 400, before any payment flow). Rock Shooter, Lane
  Runner and Whack-A-Mole remain pending — per the lineup advice, reflex
  games measure latency more than skill; their rules stay frozen as spec.

### Persistence (M2')
- Embedded Postgres (PGlite, `@electric-sql/pglite` 0.5.16, vetted: Electric
  SQL's official package, no install hooks) behind the existing Drizzle
  schema. Data dir `.data/pg` (gitignored), override `COINOP_DB_DIR`;
  tests use `memory://`.
- Rewards ledger, board posts, sessions rows, verified scores and claims are
  Postgres-backed — they survive restarts. Live engine state stays in memory
  by design (tick-level play); the durable record is written at coin-in and
  at game over. At production deploy the same schema points at hosted
  Postgres (Neon/Supabase class) via the node-postgres driver.

### Spectator layer
- Scores are written by the server only, at game over, `verified = true`.
- Leaderboards: best score per wallet per game, seasons = calendar months
  (UTC), `GET /api/leaderboard?slug=&season=<YYYY-MM|all>`.
- Replays: every finished run stores its engine snapshots + action log;
  `GET /api/replays?slug=`, `GET /api/replay/<sid>`; the cabinet page plays
  them back frame by frame. Demos for live cabinets now run the REAL engines
  with bots (attract mode), replacing the visual simulations for those three.

### Claims automation (extends ADR 0004)
- Claim = prove wallet ownership, reserve balance, batch mint:
  `GET /api/rewards/claim/nonce` → sign `COINOP claim:<wallet>:<nonce>` →
  `POST /api/rewards/claim` queues the full claimable balance.
- QTR v2 adds a revocable **minter** role: the owner appoints one claim-
  processor address; it may mint at most **1,000 QTR per transaction**
  (contract-enforced). The processor additionally enforces a per-run cap
  (`CLAIM_RUN_CAP_TOKENS`, default 5,000) and refuses to run until the
  on-chain minter matches its key. The treasury key never touches a server.
- QTR v2 on Base Sepolia: `0x5Eb82d3B5F39C9CE7ccEa88241cda64bEb5B89e2`
  (Sourcify exact match). V1 (`0x155dcad05188723216fb5782FFC51689A537611e`)
  is retired with its 25 test QTR; mainnet will deploy the v2 contract.
- Enabling step is the operator's single signature: `setMinter(0xc5A8C37f9383978E48460c6626Cb0Ab08d8F7Bf4)`
  from the treasury wallet. Until then claims queue safely and the processor
  reports `minter_not_appointed_on_chain`.

### Findability
- `GET /api/discovery` (x402/Bazaar-style resource listing), `/llms.txt`,
  `/agents` quickstart page, and `examples/mcp-server/` — a dependency-light
  MCP server (9 tools) that hard-caps its own spend authority at exactly
  0.25 USDC per coin and refuses any other 402 terms.

### Launch
- Vercel remains blocked: the connector's scope is the operator's team
  `<vercel-team-slug>`, every call 403s, and the connector exposes no
  `authorize_team_access` tool (re-verified 2026-11-15). Interim public
  access is a Cloudflare quick tunnel to the production build; the permanent
  host (Vercel after the operator re-authorizes team access in the dashboard, or
  Fly/Railway/Render/VPS using the shipped Dockerfile) is the operator's one
  remaining decision. See DEPLOY.md.
