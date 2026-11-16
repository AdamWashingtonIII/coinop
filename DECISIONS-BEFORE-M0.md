# COINOP — Decisions before M0
Prepared 2026-11-14 from the operator's spec (sections cited).

## Recommendation: lean launch (2-week path)

**1. Single-play only at launch. Defer "ROLL OF QUARTERS".**
- Spec §5 already gates bulk: "Implement this only after single-play is rock solid."
- Bulk adds `credit_ledger` (§8) + reconciliation surface (§5, §10 admin queue) before
  the core rail is proven. That is the exact failure mode §2.3 forbids: losing / double-
  counting a player's money.
- Ship M0-M3 on single-play. Add bulk as M3.5 ADR once: one real sepolia payment
  completes (§13), replay is rejected, and settle-failure reconciliation is live.

**2. Tier A only at launch. Cut Tier C for v1, defer Tier B to curation pass.**
- Spec §6 ships in order A → B → C. Tier C (js-dos / Ruffle, Wolf3D / DOOM / Keen
  shareware) carries the license-verification homework (§2.8, §13 LICENSES.md complete),
  lazy emulator loading, and likely forces the Fly.io fallback in §3 if emulator
  processes get long-lived — that alone blows a 2-week timeline.
- Launch catalog: 6 original Tier A games (§6: stacker, asteroid shooter, brick
  breaker, snake, lane runner, whack-a-mole), each <400KB, manifest with license field.
- Tier B: add 3 curated MIT/js13k games in M3 as spec already plans. Tier C: ADR after
  launch, not a silent cut.

**What this does NOT cut:** x402 on base-sepolia first (§2.2), HMAC session tokens +
heartbeat + single-use nonce (§5), sandboxed iframe + frozen bridge (§7), rate limits /
score signing (§10), admin reconciliation (§10), Playwright happy/reject/wrong-network/
expired/replay/mobile (§13).

## Still needed from the operator to start M0 (spec §14 — only these three)
1. Treasury address — fresh wallet, payTo for 0.25 USDC on Base (§5, §10: never a hot
   wallet holding more than operating float). Address only, never a key in chat.
2. Domain — for CSP / frame-ancestors (§10) and R2/S3 CDN + Vercel project naming.
   A placeholder (coinop.local / vercel preview) works for M0-M1 sepolia if undecided.
3. Facilitator credentials — CDP API keys for mainnet facilitator
   https://api.cdp.coinbase.com/platform/v2/x402 (§3). NOT needed for M0/M1:
   sepolia can use any testnet facilitator. Do not paste keys in chat — secure entry only.

## M0 ready to build without waiting on 1-3
Scaffold (Next 15 / TS strict / React 19), Drizzle schema for §8 tables, CI with
`pnpm lint && typecheck && test && build` (§2.9), hall page with fake cabinets,
`lib/bridge-protocol.ts` frozen per §7, one stub game, `.env.example` documenting
every variable (§2.10) with treasury/domain/facilitator as placeholders.
