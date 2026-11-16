# ADR 0002 — x402 Foundation v2 + Next 16
Date: 2026-11-14. Architect decision per spec §14 (deviation via ADR, not silently).

- The spec's `coinbase/x402` + `x402-next` (v1) are superseded: canonical source is
  x402-foundation/x402, packages `@x402/core|evm|next|fetch` v2. Installed: **2.31.0**
  exact-pinned (security floor ≥2.28.0 per GITHUB-SURVEY.md — V12 findings fixed
  2.23.0/2.27.0, no CVE/GHSA filed).
- `@x402/next` ≥2.28 requires peer `next >=16.2.6`; staying on Next 15 would force a
  below-floor x402. Therefore **Next 15.5.29 → 16.4.6** (React 19.2 unchanged).
  `next lint` is removed in Next 16 — lint script becomes `eslint .`.
- Wallet stack per survey: RainbowKit 2.2.11 + **wagmi v2** (2.19.5) + viem 2.57.19.
  (Post-ADR-0003: this stack serves the human *wagering* connect, not play.)
- Vetting gate record (2026-11-14): `npm view` showed **no preinstall/postinstall/
  prepare install hooks** in @x402/*, @rainbow-me/rainbowkit, wagmi, or viem.
  Full lockfile audit still owed before any production deploy.
