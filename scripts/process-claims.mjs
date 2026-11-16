// Trigger the COINOP claim processor: mints all queued QTR claims in one batch.
// Usage: node --env-file=.env.local scripts/process-claims.mjs [baseUrl]
// Requires INTERNAL_JOB_SECRET in env and NEXT_PUBLIC_APP_URL (or pass baseUrl).
const base = process.argv[2] ?? process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
const secret = process.env.INTERNAL_JOB_SECRET;
if (!secret) { console.error("INTERNAL_JOB_SECRET missing"); process.exit(1); }
const r = await fetch(base.replace(/\/$/, "") + "/api/internal/process-claims", {
  method: "POST", headers: { "x-internal-secret": secret } });
console.log(r.status, JSON.stringify(await r.json(), null, 2));
