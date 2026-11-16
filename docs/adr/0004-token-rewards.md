# ADR 0004 — COINOP token: 25 tokens per play
Date: 2026-11-14. Decided by the operator: "We will make a crypto coin and will send
25 tokens for every .25 USDC spent."

## The rule
- **25 tokens per paid play** (per 0.25 USDC settled). Rate is fixed in code
  (`TOKENS_PER_PLAY = 25`), same non-floating discipline as the price (§2.1).
  100 tokens are issued against every 1.00 USDC of arcade revenue.
- Recipient: the paying wallet (the agent). Tokens accrue to that wallet.

## Design
- **Chain/standard:** Base, ERC-20 — same chain as payments, so agents already
  hold everything they need. Name/ticker: the operator's pick (gate, see below).
- **Emission model:** supply grows ONLY against paid plays — every token in
  existence corresponds to a real 0.25 USDC that hit the treasury. No pre-mine
  giveaway pool, no team allocation decided here (any allocation = new ADR).
- **Distribution = accrue + claim, NOT a send per play.** A separate on-chain
  transfer for every 0.25 play would burn more in Base gas operations than the
  flow can justify and creates 1 tx per play of noise. Instead:
  1. On verified payment, the server accrues +25 to the wallet in
     `rewards_ledger` (built now, in-memory store until M2' Postgres wiring).
  2. Agents check `GET /api/rewards?wallet=` and **claim** accumulated tokens;
     claims are batched on-chain transfers from the treasury/minter (claim
     contract or batched sends land with the token contract, next milestone).
- **Accrual timing:** accrue on facilitator *verify* (same moment play is
  granted); if settlement later fails into `needs_reconcile`, the accrual is
  flagged with the payment and reversed if the payment is written off in
  reconciliation. Nobody keeps tokens for a play that never actually paid.
- **Framing:** the token is an arcade prize/utility token earned by playing.
  No profit promises, no "investment" language anywhere in product copy —
  that framing is a product rule, not just legal hygiene.

## Name — DECIDED (the operator, 2026-11-14)
**COINOP Quarter**, ticker **QTR**. (Other coins may share the QTR ticker in the
wild; identity is the contract address + name, published in the manifest once deployed.)

## Base Sepolia deployment — DONE (2026-11-15)
QTR is LIVE on Base Sepolia at **0x155dcad05188723216fb5782FFC51689A537611e**
(owner verified on-chain = treasury 0x312e…2Bd7, supply 0 — nothing minted until
real claims). Deployed by a throwaway workspace-generated deployer wallet
(0xb845…f315, funded with one 0.0001 ETH CDP faucet claim; deployer holds no power
and is discarded). Mint mechanics proven on the real network with identical
bytecode (test instance 0x6998…5f5F): mint of 25 QTR landed in a test agent wallet,
tx 0x131d51b3…f6423. QTR_CONTRACT_ADDRESS is wired in .env.local.
## Funded-play loop — VERIFIED (2026-11-15)
A test agent wallet (0x2D3f…86ff) holding 20 test USDC (Circle faucet) paid 0.25 USDC
through POST /api/coin: facilitator verify passed, settlement landed on-chain
(agent 20 → 19.75 USDC, treasury 0 → 0.25 USDC), the bot played Stacker to
tower_complete (score 570, 15 rows), and +25 QTR accrued unflagged in the ledger.
Runner: scripts/funded-play-test.mjs (hand-built EIP-3009 authorization; amount is
fixed at exactly 250000 atomic in code). Two live facilitator requirements were
found and fixed in lib/x402/facilitator.ts: the x402 v1 facilitator keys networks
by NAME ("base-sepolia", not the CAIP id) and requires the token's EIP-712 domain
in requirements.extra ({ name: "USDC", version: "2" }).
Claim mint — DONE (2026-11-15): the operator signed a mint of 25 QTR to the test agent
wallet from the treasury wallet; verified on-chain (agent balance 25 QTR,
totalSupply 25). Route note: Basescan never surfaced a Write Contract tab for
this contract (source is verified on Sourcify, not in Basescan's own UI), so
the mint was executed via abi.ninja with the mint-only ABI pasted in.

## Gates before mainnet token launch
1. ~~Name + ticker (the operator).~~ DONE — COINOP Quarter (QTR).
2. Token contract: OpenZeppelin ERC-20, mint authority = treasury-controlled
   contract, deployed to base-sepolia first, vetted + tested like everything else.
3. ~~Claim flow end-to-end test on sepolia (accrue → claim → tokens in wallet).~~
   DONE 2026-11-15 — accrual proven in the funded-play loop, claim mint signed
   by the operator and verified on-chain (25 QTR in the agent wallet).
