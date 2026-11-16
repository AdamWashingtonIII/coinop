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
| `CDP_API_KEY_ID` | Coinbase CDP key id — when set with the secret, payments route through the CDP facilitator (mainnet) instead of the x402.org testnet facilitator |
| `CDP_API_KEY_SECRET` | CDP key private key (Ed25519) — Vercel Secret type only, never in the repo |
| `DATABASE_URL` | Neon Postgres connection string (injected by the Vercel Neon integration) |

## Data
Sessions' live state is in-memory; every durable record (rewards, scores,
boards, claims) is Postgres via the embedded PGlite store. For a multi-instance
or serverless host, swap `lib/db.ts` to the node-postgres driver against a
hosted Postgres (Neon/Supabase) — the Drizzle schema is identical.

## Hosts
- **Vercel**: LIVE since 2026-11-15 — https://coinop-one.vercel.app
  (project prj_A4PVIDmf4SYkaESgFPHdJ1nbAKVO, team <vercel-team-slug>).
  The MCP connector cannot deploy (identity-only scopes; team calls 403 and
  authorize_team_access is not exposed). Deploys go through the REST API with
  the operator's access token (custom.vercel-api connector):
  `~/workspace/custom-connectors/custom.vercel-api/bin/deploy_coinop.py`
  (verify token → create project + env → upload files → deploy → poll).
  Production data is on Neon Postgres (store neon-almond-feather, connected
  2026-11-15; persistence proven live). PGlite remains the local fallback
  when DATABASE_URL is absent.
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

## Mainnet — LIVE since 2026-11-15 (switch night)
- Chain: Base mainnet (NEXT_PUBLIC_CHAIN_ID=8453). Facilitator: Coinbase CDP
  (keys in Vercel env, Secret type). 402s are x402 v2 with the Bazaar
  discovery extension; the first CDP settlement triggers Bazaar indexing
  (public listing not yet confirmed — recheck via the CDP discovery API).
- QTR mainnet: 0x155dcad05188723216fb5782FFC51689A537611e (owner = treasury;
  minter = the claim-minter wallet, appointed by the operator 2026-11-15).
  Deploy tx 0xb6983cb0... Same address as the retired Sepolia v1 — same
  deployer, first mainnet deployment.
- Micro tests PASSED on production (scripts/funded-play-mainnet.mjs,
  claim-mainnet.mjs, match-mainnet.mjs): solo play settled 0.25 USDC to the
  treasury through CDP; 50 QTR claim minted (tx 0x46030d06...); a versus
  Snake duel settled 20-0 with both escrow legs receipt-traced (refund
  0x274cf045..., treasury leg 0xf5414461...). Treasury held 0.50 USDC after.
- LESSON (cost an hour): the USDC EIP-712 domain name differs per chain —
  Sepolia test USDC signs with name "USDC", mainnet USDC with "USD Coin"
  (both version "2"). Proven against the mainnet contract's
  DOMAIN_SEPARATOR. The per-chain value lives in CHAINS[].eip712Name in
  lib/x402/config.ts; a wrong name makes the facilitator's verify simulation
  revert with an opaque "execution reverted".
- Rollback (if ever needed): PATCH the two env vars back to 84532 +
  0x5Eb82d3B5F39C9CE7ccEa88241cda64bEb5B89e2 (Sepolia QTR v2) and redeploy;
  the CDP keys can stay — testnet config ignores them only if removed, so
  also delete CDP_API_KEY_ID/SECRET to return to the legacy facilitator.
