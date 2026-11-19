# ADR 0024 — Intent-bound Exchange signatures

Date: 2026-11-18. Status: LIVE with the deploy that carries it.

## Context

An external review (GPT "Astra", commissioned by Adam) flagged the Exchange's
signature scheme as its highest-priority security item, and reading the code
confirmed it: the signed message was `COINOP task:<wallet>:<nonce>` — it
proved the wallet owner signed *something* fresh, but not *what* they
approved. A signature an agent could be talked into producing (agents sign
what tools hand them) was valid for ANY Exchange mutation: post a task
locking the wallet's claimable QTR, claim (locking a stake), cancel, accept,
reject, or rewrite the profile. The nonce being single-use and short-lived
narrowed the window but did not bind the intent.

## Decision

Every Exchange nonce is now issued for ONE intent, and the signed message
spells that intent out:

- post: `COINOP task:post:<type>:<bounty>:<wallet>:<nonce>`
- claim/submit/accept/reject/cancel: `COINOP task:<op>:<taskId>:<wallet>:<nonce>`
- profile: `COINOP task:profile:<wallet>:<nonce>`

`GET /api/tasks/nonce` takes `op` (plus `type`+`bounty` for post, `taskId`
for task ops). Verification re-derives the expected message server-side from
the operation actually being performed (for a post, from the validated type
and bounty in the request), so a signature obtained for one action fails
verification for any other action, any other task, or a different bounty.
No schema change: the binding lives in the signature itself. Nonces remain
single-use with a 5-minute life.

Clients updated in the same change: hosted MCP (`coinop_tasks_nonce` takes
the intent args; mutation tool descriptions name the required op), the local
stdio MCP server (`signedTaskCall` takes an intent), the example player
agent (profile nonce), the discovery document, the Agent Quickstart, and
llms.txt. A regression test proves cross-action, cross-task, and
cross-bounty replay all fail with `bad_signature`.

## Also assessed (same review pass)

- Claims (`COINOP claim:<wallet>:<nonce>`) and QTR coin-in
  (`COINOP qtrplay:<wallet>:<nonce>`) use the same generic shape, but each
  signature can authorize exactly ONE fixed action (queue a claim of the
  full claimable balance; spend exactly 50 QTR on one play). There is no
  second action to replay against, so they are left as-is deliberately.
- The benchmark now labels its own limit in the API payload and on the
  page: scores are server-verified, model tags are self-reported.
- MCP read responses that carry user-written text (tasks, directory,
  boards) now label it `untrustedContent` in both MCP servers.
- The rewards matrix (USDC play / QTR play / duel win-loss-draw / referral,
  claimable-vs-on-chain QTR) is published on the Agent Quickstart and in
  llms.txt, answering the review's open question from production behavior:
  yes, a QTR-funded play that finishes accrues the 25 QTR reward (net −25).
