# Deploying COINOP

The app is a standard Next.js production build (`npm run build`, `npx next start`).
A `Dockerfile` is included for container hosts.

## Environment (all server-side, never commit)
| Var | Purpose |
|---|---|
| `TREASURY_ADDRESS` | COINOP treasury wallet (receives the quarters) |
| `SESSION_HMAC_SECRET` | session token signing secret |
| `NEXT_PUBLIC_CHAIN_ID` | 84532 (Base Sepolia) or 8453 (Base mainnet) |
| `NEXT_PUBLIC_APP_URL` | public base URL of the deployment |
| `QTR_CONTRACT_ADDRESS` | QTR v2 contract on the active chain |
| `X402_FACILITATOR_URL` | facilitator endpoint (default https://x402.org/facilitator) |
| `CLAIM_MINTER_PRIVATE_KEY` | claim-processor wallet key (mint-capped by contract) |
| `MATCH_ESCROW_ADDRESS` | versus-match escrow wallet (duel stakes settle here) |
| `MATCH_ESCROW_PRIVATE_KEY` | escrow wallet key — signs settlement payouts; keep a little ETH on it for gas |
| `INTERNAL_JOB_SECRET` | guards POST /api/internal/process-claims |
| `COINOP_DB_DIR` | Postgres data dir (default ./.data/pg) |
| `CLAIM_RUN_CAP_TOKENS` | per-run mint cap (default 5000) |

## Data
Sessions' live state is in-memory; every durable record (rewards, scores,
boards, claims) is Postgres via the embedded PGlite store. For a multi-instance
or serverless host, swap `lib/db.ts` to the node-postgres driver against a
hosted Postgres (Neon/Supabase) — the Drizzle schema is identical.

## Hosts
- **Vercel**: LIVE since 2026-11-15 — https://coinop-one.vercel.app
  (project prj_A4PVIDmf4SYkaESgFPHdJ1nbAKVO, team adamwashingtoniii-7118).
  The MCP connector cannot deploy (identity-only scopes; team calls 403 and
  authorize_team_access is not exposed). Deploys go through the REST API with
  Adam's access token (custom.vercel-api connector):
  `~/workspace/custom-connectors/custom.vercel-api/bin/deploy_coinop.py`
  (verify token → create project + env → upload files → deploy → poll).
  NOTE: production currently runs PGlite with COINOP_DB_DIR=/tmp/coinop-pg —
  works, but NOT durable across instance recycles. Before real traffic,
  swap lib/db.ts to the node-postgres driver against a hosted Postgres
  (Neon/Supabase) per the Data section above.
- **Fly.io / Railway / Render**: deploy the Dockerfile, mount a volume at
  /app/.data, set env vars, done.
- **VPS**: Docker, or plain Node 22 with the build output + a process manager.

## After deploy
1. `POST /api/coin` with no payment should return 402; `/api/games` lists 3 live engines.
2. Treasury wallet signs `setMinter(<CLAIM_MINTER address>)` on QTR once —
   claims then mint automatically in batches (`scripts/process-claims.mjs`
   or any cron hitting the internal endpoint).
3. Mainnet: deploy QTR v2 to Base (scripts/deploy-qtr.js --network base),
   set NEXT_PUBLIC_CHAIN_ID=8453, use CDP facilitator keys.
