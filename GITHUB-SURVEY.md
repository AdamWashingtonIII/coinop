# COINOP — GitHub Survey & Vetting Report

**Date:** 2026-11-14 · **Scope:** LEAN launch only — single-play, Tier A original HTML5 games.
Bulk "roll of quarters" and Tier C emulation were **not** researched (deferred per
`DECISIONS-BEFORE-M0.md`); no candidate below was selected for them.
**Method:** Read-only web / GitHub research only. **Nothing was downloaded, cloned,
installed, or run.** GitHub connector was **not connected**
(`/opt/hatch/bin/github status` → `auth_status: not_connected`), so all data comes from
public web search, GitHub pages/READMEs, npm/OSV/advisory reporting, and third-party
indexes (ethereum.org, star-history, ecosyste.ms) cross-checked on 2026-11-14.
Star counts are as of the cited observation date and drift.

> **Standing gap for EVERY candidate (per `github_open_source_vetting` skill):**
> Because nothing was cloned, no candidate's `package.json` install scripts
> (`preinstall`/`postinstall`), lockfile, or full dependency tree was audited, and no
> `pnpm audit` / OSV scan of a resolved lockfile exists yet. Verdicts below are
> *adoption* verdicts. Before any of these is installed at M0, the vetting gate still
> requires: inspect install scripts, pin exact versions, run `pnpm audit` + OSV scan
> on the lockfile, and record the result. Do not treat "CLEAR" here as "install-script
> clean."

## Summary table

| Repo | Use in COINOP | Milestone | Verdict |
|---|---|---|---|
| [x402-foundation/x402](https://github.com/x402-foundation/x402) | Canonical x402 v2 SDK: `@x402/core`, `@x402/evm`, `@x402/next` (`withX402`/`paymentProxy`), fullstack Next example | M0–M1 (core payment rail) | **CAUTION** — pin ≥2.28.0, v2 only (see critical note) |
| [coinbase/x402](https://github.com/coinbase/x402) | `@coinbase/x402` CDP facilitator package for mainnet only; historical `x402-next` v1 docs | M1 (testnet) / M5 (mainnet) | **CAUTION** — fork, not the canonical repo; facilitator package only |
| [creativetimofficial/x402-creative-tim](https://www.github.com/creativetimofficial/x402-creative-tim) | Worked Next.js + Base + OnchainKit paywall example using `x402-next` | M1 reference | **CAUTION** — reference only; Next 14 + legacy v1 packages |
| [rainbow-me/rainbowkit](https://github.com/rainbow-me/rainbowkit) | Wallet connect modal (spec §3); `with-next-app` App Router example + `create-rainbowkit` Next template | M0–M1 | **CLEAR** — with wagmi v2 pin (see note) |
| [wevm/wagmi](https://github.com/wevm/wagmi) | Wallet/chain hooks under RainbowKit (spec §3, with viem) | M0–M1 | **CLEAR** — v3 is out; RainbowKit still targets v2 |
| [scaffold-eth/scaffold-eth-2](https://github.com/scaffold-eth/scaffold-eth-2) | Next.js + RainbowKit + wagmi + viem wiring pattern | M0 reference | **CAUTION** — reference only; contract tooling baggage, slowing cadence |
| [coinbase/onchainkit-app-template](https://github.com/coinbase/onchainkit-app-template) | Base/CDP provider + checkout patterns (alternative wallet UX reference) | M1 reference | **CAUTION** — reference only; spec mandates RainbowKit, not OnchainKit |
| [Aaronius/penpal](https://github.com/Aaronius/penpal) | Promise-based iframe `postMessage` handshake/origin-restriction pattern for `lib/bridge-protocol.ts` | M0 reference | **CLEAR** — pattern reference only; bridge stays custom/frozen (§7) |
| [dmcinnes/HTML5-Asteroids](https://github.com/dmcinnes/HTML5-Asteroids) | Asteroid-shooter mechanics reference (split physics, vector ship) | M2–M3 (Tier A game 2) | **CAUTION** — reference only; unmaintained since 2016, bundles jQuery 1.4.1 |
| [patorjk/JavaScript-Snake](https://github.com/patorjk/JavaScript-Snake) | Snake mechanics/scoring reference | M2–M3 (Tier A game 4) | **CLEAR** — reference only, we write our own |
| [dionyziz/canvas-tetris](https://github.com/dionyziz/canvas-tetris) | Falling-block stacker mechanics reference | M2–M3 (Tier A game 1) | **CLEAR** — reference only; rename, do not ship "Tetris" branding |
| [michelpereira/awesome-open-source-games](https://github.com/michelpereira/awesome-open-source-games) | Curated index to source breaker / lane-runner / whack-a-mole references with licenses | M3 curation | **CLEAR** — index only; verify each game's license individually |

**BLOCKED (do not install, any milestone):**
- **Any x402 v1 package line** — legacy `x402-next` / `x402-express` 1.x and Python
  `x402` 0.2.1: OSV records **GHSA-QR2G-P6Q7-W82M** against `x402` (PyPI) 0.2.1, and the
  v1 envelope is superseded by v2. COINOP builds on v2 only.
- **Any `@x402/*` TypeScript package < 2.23.0**, and server packages **< 2.27.0** —
  see the critical x402 note below. These versions scan "clean" in OSV/npm audit
  because no advisory was ever filed; they are not clean.
- **jQuery 1.4.1** bundled in HTML5-Asteroids — ancient, covered by multiple later
  jQuery XSS advisories (the <3.5.0 line). Never ship it; reference the game logic only.
- **`@massnerder/x402-scraper-mcp`** — malicious npm package, GitHub malware advisory
  **GHSA-whr8-5pp9-f7v2 / MAL-2026-18780** (flagged 2026-11-09). Not a candidate; listed
  because name-similar "x402" packages are an active typosquat/malware risk — install
  only packages named in the foundation repo's README.

---

## ⚠️ Critical finding — x402 SDK vulnerabilities with no advisory (affects verdicts 1–3)

Security firm **V12 reported 25 findings (3 critical, 13 high) on 2026-08-12**.
Fixes shipped **2026-08-18 in `@x402/*` 2.23.0** (TypeScript): (1) default client had
**no spending limit** — a hostile API could ask an auto-signing client to sign away its
full token balance; 2.23.0 adds `spendControls` ($1 default cap, recognized USD
stablecoins only); (2) a Solana facilitator bug counted token *approvals* as payments
(Solana-only, not COINOP's Base path); (3) SIWx logins could be signed for the wrong
site. A separate **server-side paid-route bypass** (encoded path, e.g. `/api%2Fpremium`)
was fixed in **2.27.0**. Latest observed: **2.28.0** (2026-10-23 checks).
**The x402 Foundation published no CVE, no GHSA, and no security advisory**, and its
changelogs do not call these security fixes — so as of 2026-10-23 `npm audit` and OSV
returned *nothing* for the vulnerable releases. No exploitation in the wild has been
reported. **Implication for COINOP:** scanners will not protect us here. Pin
`@x402/core`, `@x402/evm`, `@x402/next` **≥ 2.28.0**, keep client `spendControls` on,
set the client max to exactly 0.25 USDC in our own code (spec §2.1), and re-check the
foundation changelog — not just OSV — at every dependency bump.

---

## Per-repo vetting notes

### 1. x402-foundation/x402 — CAUTION (adopt, pinned)
- **URL / stars / license / language:** https://github.com/x402-foundation/x402 —
  **6,797 stars, 2,273 forks** (GitHub API read 2026-11-11); **Apache-2.0**;
  TypeScript ~50%, Python ~29%, Go ~19%. `@x402/core` had **1,940,555 npm downloads
  2026-10-11 → 2026-11-09**.
- **Last activity:** Active. v2 spec released 2025-12-11; package published 2026-11-04
  in the observation window; 401 commits after 2026-08-13; 379 contributors.
- **Provenance:** Originated at Coinbase (open-sourced May 2025); governance moved to
  the **x402 Foundation under the Linux Foundation** (announced 2026-04-02, operational
  launch 2026-07-14, 40+ members incl. Coinbase, Cloudflare, Stripe, Google, Visa).
  This is now the **canonical** repo — a material change from the COINOP spec, which
  names `coinbase/x402`. Spec/ADR update needed at M0: build against the foundation
  repo and `@x402/*` v2 packages (`@x402/next` replaces the v1 `x402-next` name).
- **Reuse:** Code (npm packages, not vendored source): `@x402/core` + `@x402/evm` for
  the `POST /api/coin` verify/settle flow, `@x402/next` `withX402` for the route guard,
  and `examples/typescript/fullstack/next` as the M1 reference implementation.
  COINOP's own session-token, nonce, and heartbeat logic (§5) is not in this repo and
  remains ours to write.
- **Advisories:** The V12 findings above (no GHSA/CVE exists — gap is in the advisory
  system itself, documented 2026-10-22/23 by V12, The Hacker News, and independent
  checkers). GHSA-QR2G-P6Q7-W82M touches only the old PyPI `x402` 0.2.1 line.
- **Suspicious-behavior signals:** None observed from repo structure — pnpm monorepo,
  published npm packages, foundation governance. Install scripts **not audited** (gap,
  see header).

### 2. coinbase/x402 — CAUTION (facilitator package only)
- **URL / stars / license:** https://github.com/coinbase/x402 — GitHub API object says
  `fork=true, parent=x402-foundation/x402`; **182 stars** (2026-11-11 read);
  Apache-2.0; TypeScript/Python/Go.
- **Reuse:** Only the **`@coinbase/x402`** npm package (312,060 downloads in the
  2026-10-11→11-09 window), which wires the **CDP mainnet facilitator**
  (`https://api.cdp.coinbase.com/platform/v2/x402`, spec §3) — needed at M5, and for
  sepolia only if we choose CDP over a public testnet facilitator at M1.
- **Why caution:** It is a downstream fork; its examples and the v1 `x402-next`
  documentation floating around the web describe the superseded v1 flow. Do not copy
  example code from this repo or from v1-era blog posts. Facilitator credentials remain
  Adam-only, secure entry, never in the repo (spec §2.10/§14).

### 3. creativetimofficial/x402-creative-tim — CAUTION (reference only)
- **URL / license / language:** https://www.github.com/creativetimofficial/x402-creative-tim —
  Next.js (TypeScript) paywall demo: three priced content routes, browser flow via
  OnchainKit, API flow via middleware, Base mainnet + Base Sepolia, `@coinbase/x402`
  facilitator. **Stars and license not verified** from the pages read (gap — check the
  repo sidebar/LICENSE before copying any code; pattern-reading needs no license).
- **Reuse:** Pattern only, M1: how a browser (non-agent) x402 payment page is sequenced
  — presentation page → payment page → middleware 402 → wallet → settle. Closest public
  analogue to COINOP's human-player flow (most x402 demos target AI agents).
- **Why caution:** Built on **Next.js 14** (COINOP is Next 15) and the **v1 `x402-next`**
  package line (BLOCKED above). Read it for UX sequencing; write COINOP's version on
  `@x402/next` v2.

### 4. rainbow-me/rainbowkit — CLEAR
- **URL / stars / license / language:** https://github.com/rainbow-me/rainbowkit —
  **~2,836–2,839 stars** (GitHub starred-list crawls, updated 2026-10-01), ~801 forks;
  **MIT**; MDX/TypeScript monorepo (pnpm workspace). ethereum.org listing (reviewed
  Sep 2026): 2.8K stars, ~225K weekly npm downloads, MIT.
- **Last release:** **2.2.11, May 2026** (patch: Base connector renamed to canonical
  Base naming, `baseAccount`/`coinbaseWallet` aliases preserved). Repo updated
  2026-10-01.
- **Reuse:** Code (npm package `@rainbow-me/rainbowkit`, spec-mandated): connect modal,
  `getDefaultConfig`, Base + Base Sepolia chains. Its `examples/with-next-app`
  (App Router) and `packages/create-rainbowkit/templates/next-app` are the M0 wallet
  wiring reference.
- **Advisories / signals:** No GHSA/OSV advisory for `@rainbow-me/rainbowkit` surfaced
  in search on 2026-11-14 (absence noted, not proof — lockfile scan still required at
  M0). **Compatibility caution:** 2.2.x supports **wagmi v2 only** — pin wagmi v2 even
  though wagmi v3 has shipped (see #5). Maintained by Rainbow, long provenance.

### 5. wevm/wagmi — CLEAR
- **URL / stars / license / language:** https://github.com/wevm/wagmi —
  **6,774 stars, 1,462 forks** (observed 2026-11-09); **MIT**; TypeScript.
  Releases page active within days of this survey (e.g. `@wagmi/core` 3.6.9 /
  `@wagmi/connectors` 8.2.4 patch train for the v3 line).
- **Reuse:** Code (npm): the React hooks layer under RainbowKit + viem (spec §3) —
  account, chain-switch (wrong-network state, §9), and signing for the x402 client.
- **Advisories / signals:** No advisory surfaced in search 2026-11-14 (same caveat as
  #4). **Version decision for the ADR:** wagmi **v3** is current, but RainbowKit
  2.2.11 targets **v2** — COINOP M0 should pin the wagmi v2 line that RainbowKit's
  template pins, and treat a wagmi v3 + RainbowKit-compatible release as a later bump,
  rather than mixing majors.

### 6. scaffold-eth/scaffold-eth-2 — CAUTION (reference only)
- **URL / stars / license / language:** https://github.com/scaffold-eth/scaffold-eth-2 —
  **~2,040 stars, MIT, last commit 2026-07-29** (boilerplates.directory, crawled
  2026-11-13); an independent top-100 index read last commit 2026-05-22 at 2,023 stars.
  TypeScript; NextJS + RainbowKit + Hardhat/Foundry + wagmi + viem (BuidlGuidl).
- **Reuse:** Pattern only, M0: a battle-tested `packages/nextjs` wagmi/RainbowKit
  provider + hooks layout. COINOP has no smart contracts of its own, so the
  Hardhat/Foundry half, debug-contracts UI, and burner-wallet tooling are dead weight
  and extra install surface — do not scaffold COINOP from it.
- **Why caution:** Commit cadence has slowed through 2026 vs. its 2023–24 pace, and
  adopting the monorepo wholesale would import contract tooling COINOP's spec (§3)
  does not include. No advisories checked beyond the repo level (gap — moot if
  reference-only).

### 7. coinbase/onchainkit-app-template — CAUTION (reference only)
- **URL:** https://github.com/coinbase/onchainkit-app-template (clone URL published in
  official Base docs for the Commerce + OnchainKit cookbook). Coinbase-maintained
  Next.js template: OnchainKit provider on Base, CDP API key env pattern.
  **Stars / last-commit not verified** from pages read (gap).
- **Reuse:** Pattern only, M1: CDP key handling and Base provider setup; its Checkout
  components are a fallback reference if RainbowKit's modal proves awkward for the
  mobile QR/deep-link coin slot (§2.5).
- **Why caution:** Spec §3 mandates RainbowKit for the connect modal — OnchainKit is a
  second wallet stack; running both doubles bundle and audit surface. Reference, don't
  adopt, unless an ADR changes §3.

### 8. Aaronius/penpal — CLEAR (pattern reference only)
- **URL / stars / license / language:** https://github.com/Aaronius/penpal —
  ~540 stars on the maintainer-profile crawl (stale, 2026-05; treat as approximate);
  TypeScript; license MIT per npm listing history (**re-verify LICENSE file at M0** —
  not read directly in this survey, gap). **v7.0.0** is the current major (npm build
  7.0.6 seen on unpkg): `WindowMessenger` + unified `connect`, origin restriction by
  default on both sides, handshake first, then MessagePort transport; v7 parent is
  compatible with a v6 child.
- **Reuse:** Pattern only, M0: handshake + strict-origin design for
  `lib/bridge-protocol.ts`. COINOP's bridge protocol is **frozen** (spec §7) with its
  own message set (`INIT`/`SESSION_GRANTED`/`GAME_OVER`/…), so Penpal itself should
  **not** become a dependency inside the sandboxed iframe — the games must stay
  dependency-free and <400KB (§6). Borrow the handshake/origin discipline, hand-roll
  the rest.
- **Advisories / signals:** No GHSA/OSV hit for `penpal` surfaced in search 2026-11-14
  (absence noted, not proof). Single-maintainer provenance (Aaron Hardy) — acceptable
  for a reference; another reason not to hard-depend on it in the payment path.

### 9. dmcinnes/HTML5-Asteroids — CAUTION (reference only)
- **URL / stars / license / language:** https://github.com/dmcinnes/HTML5-Asteroids —
  **353 stars, 332 forks** (maintainer profile crawl); **MIT** (Copyright © 2010 Doug
  McInnes; LICENSE verified byte-identical by an independent ingestion audit,
  2026-09-24, at commit `930301c`); pure JavaScript.
- **Last activity:** **2016-01-13** (commit `930301cbda83ed…`). Unmaintained for a
  decade — fine for a mechanics reference, disqualifying as a dependency.
- **Reuse:** Reference only, Tier A asteroid shooter: asteroid split physics
  (large→medium→small), vector ship, sprite/sound structure. We write our own (§6).
- **Risks:** Repo bundles **jQuery 1.4.1** and old `.wav`/typeface assets — jQuery
  1.4.1 is BLOCKED (see table note); asset licenses beyond the MIT code license were
  not audited (gap). Copy no files from this repo.

### 10. patorjk/JavaScript-Snake — CLEAR (reference only)
- **URL / stars / license / language:** https://github.com/patorjk/JavaScript-Snake —
  **591 stars, 674 forks** (maintainer profile crawl); **MIT** (confirmed by multiple
  downstream redistributors pinning it as MIT); JavaScript, DOM-based (not canvas).
- **Last activity:** Created 2012-09-09; README carries a 2025 note — sporadically
  tended, effectively feature-complete. Current commit `5702346…` on the repo page.
- **Reuse:** Reference only, Tier A snake: board/speed/scoring structure and game-over
  handling. COINOP's version will be canvas + touch (§6), so this is a rules
  reference, not a port.
- **Advisories / signals:** Zero dependencies, no install scripts in the repo itself —
  lowest-risk class of candidate. Nothing to install.

### 11. dionyziz/canvas-tetris — CLEAR (reference only)
- **URL / stars / license / language:** https://github.com/dionyziz/canvas-tetris —
  **452 stars, 237 forks**; **MIT** (Copyright © 2012 Dionysis Zindros; LICENSE.md in
  repo); JavaScript, HTML5 canvas, single small codebase.
- **Last activity:** Repo updated **2023-12-13**. Dormant but complete.
- **Reuse:** Reference only, Tier A falling-block **stacker**: grid, rotation, line
  clear, scoring in ~45-minute-codebase simplicity — the right complexity ceiling for
  a <400KB Tier A game.
- **Naming caution (spec §6):** generic names only, no trademarked titles in the UI —
  ship as e.g. "Block Stacker," never "Tetris," regardless of the reference's name.
- **Advisories / signals:** Zero dependencies. Nothing to install.

### 12. michelpereira/awesome-open-source-games — CLEAR (index only)
- **URL / license:** https://github.com/michelpereira/awesome-open-source-games —
  curated, long-maintained index of open-source games (browser/arcade sections),
  synced within 17 days of this survey on ecosyste.ms.
- **Reuse:** Curation index, M3: its arcade list is where the remaining Tier A
  references (brick breaker, lane runner, whack-a-mole) should be sourced — it already
  catalogues e.g. a pure-JS Asteroids (356★), an HTML5 Breakout (32★), and multiple
  Snake variants with source links.
- **Caution baked in:** An "awesome list" entry is **not** a license verification.
  Spec §2.8/§13 require each game's `license` field verified as commercially usable
  before it ships — check the actual repo LICENSE for any game picked from this index,
  exactly as was done above for #9–#11.

---

## Notable non-findings

- **No public GitHub repo implements COINOP's actual product** — a human-facing,
  pay-per-*play* (0.25 USDC) browser arcade with session tokens — that could be found
  by web search on 2026-11-14. "402 Arcade" (AndreasBrageJivrell/M2M, via
  402arcade.com / Product Hunt) is six $0.10 agent micro-services, not browser games,
  and its repo's stars/license/maintenance **could not be verified** from public pages
  read — excluded rather than guessed. "penny402" and "Common Arcade"
  (arcade.agentcommons.io) are live x402 arcade-flavoured services (testnet/agent
  oriented) with no verified public repo found. COINOP's session/heartbeat/credit
  design (§5) appears to be original work; the repos above supply the payment rail,
  wallet stack, bridge discipline, and game-mechanics references only.
- **Tier C / bulk:** not researched, per scope. Note only: nothing in the adopted
  x402 v2 packages bundles a credit ledger or emulation, so deferring them costs
  nothing in rework.

## Recommended M0 actions (from this survey)

1. ADR: canonical x402 source is **x402-foundation/x402**, packages `@x402/*` **v2,
   pinned ≥ 2.28.0**; supersedes the spec's `coinbase/x402` + `x402-next` naming.
   `@coinbase/x402` appears only as the mainnet facilitator wiring (M5).
2. Pin **RainbowKit 2.2.11 + wagmi v2 line + viem** exactly as RainbowKit's Next App
   template does; do not let a scaffold pull wagmi v3.
3. Before first `pnpm install` of any of the above: complete the vetting-skill gate —
   inspect install scripts, `pnpm audit`, OSV lockfile scan, record counts by severity
   in this file. The x402 no-advisory episode (§⚠️) is why the changelog check is in
   the loop too.
4. Tier A games: write originals using #9–#11 as mechanics references and #12 as the
   sourcing index for the other three; record each in `LICENSES.md` as "original,
   mechanics referenced from <repo> (MIT)" — no vendored game code, no jQuery.
