# ADR 0001 — Lean launch: single-play only, Tier A only
Date: 2026-11-14. Decided by the operator ("Start M0 lean: single-play + Tier A only").
Context: spec s5 gates bulk behind proven single-play; s6 orders tiers A→B→C; Tier C adds
license homework + emulator weight. Decision: launch M0-M3 on single-play + 6 original
Tier A games. credit_ledger stays in schema, unused. Tier B returns in M3, Tier C needs a
new ADR. Consequences: faster to the s13 definition of done; no credit reconciliation risk
in v1.
