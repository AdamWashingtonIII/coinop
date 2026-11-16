// First-external-player watch: compares the live leaderboards against a
// baseline snapshot. Prints NONE, or FOUND with the new player's details.
// "Us" = every wallet we control (keys in .env.local + treasury + the
// one-time referral-smoke wallet in scripts/referral-smoke.mjs).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url)) + "/..";
const BASELINE_PATH = path.join(ROOT, ".data", "first-external-baseline.json");
const SITE = "https://coinop-one.vercel.app";
const GAMES = ["stacker", "snake", "breaker", "thermonuclear", "tictactoe"];

const OURS = new Set([
  "0x312e8efd90c134f6e54a0b612df4f55775ec2bd7", // treasury
  "0x2d3f3f16ef47a8345d65b277217b5b6dcb2386ff", // test agent
  "0x981d3e7eb61a0929e7c39eb2b47d2c3febcaf511", // PIXEL (watch agent 1)
  "0xcce4b63cee66f05e23f85198be73df897ee2a209", // QUARTERBACK (watch agent 2)
  "0xb84509b2e8fa95cb666197a59f933096b76bf315", // deployer
  "0xc5a8c37f9383978e48460c6626cb0ab08d8f7bf4", // claim minter
  "0x27501c6b06ca445579488b8d4e44998222171d74", // match escrow
  "0xe67f65450e53306db97dbeb5d1545a645d3b5af1", // referral-smoke one-time wallet
]);

async function boards() {
  const out = {}; // key game|wallet -> {game, wallet, score, achievedAt}
  for (const slug of GAMES) {
    try {
      const r = await fetch(`${SITE}/api/leaderboard?slug=${slug}&season=all`);
      if (!r.ok) continue;
      const d = await r.json();
      for (const e of d.entries ?? []) {
        out[`${slug}|${e.wallet.toLowerCase()}`] = {
          game: slug, wallet: e.wallet, score: e.score, achievedAt: e.achievedAt,
        };
      }
    } catch { /* game not live yet or network blip: skip */ }
  }
  return out;
}

const current = await boards();
if (process.argv.includes("--init")) {
  fs.mkdirSync(path.dirname(BASELINE_PATH), { recursive: true });
  fs.writeFileSync(BASELINE_PATH, JSON.stringify(current, null, 2));
  console.log(`BASELINE_SET ${Object.keys(current).length} entries`);
  process.exit(0);
}
const baseline = JSON.parse(fs.readFileSync(BASELINE_PATH, "utf8"));
const found = [];
for (const [key, e] of Object.entries(current)) {
  if (OURS.has(e.wallet.toLowerCase())) continue;
  const b = baseline[key];
  if (!b || e.achievedAt > b.achievedAt) found.push(e);
}
if (found.length === 0) console.log("NONE");
else for (const e of found) console.log("FOUND " + JSON.stringify(e));
