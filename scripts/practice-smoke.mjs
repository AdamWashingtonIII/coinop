// Live smoke for practice mode (ADR 0025): plays a full wallet-free
// Tic-Tac-Toe run against the deployed site with perfect minimax moves and
// checks the finish payload, the replay, and same-seed determinism.
// Usage: node scripts/practice-smoke.mjs [baseUrl]
const BASE = process.argv[2] ?? "https://coinop-one.vercel.app";
const LINES = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];
const winnerOf = (c) => { for (const [a,b,d] of LINES) if (c[a] && c[a] === c[b] && c[a] === c[d]) return c[a]; return null; };
function minimax(cells, turn, mark) {
  const w = winnerOf(cells);
  if (w) return w === mark ? 1 : -1;
  if (cells.every((c) => c)) return 0;
  let best = turn === mark ? -2 : 2;
  for (let i = 0; i < 9; i++) { if (cells[i]) continue; cells[i] = turn;
    const v = minimax(cells, turn === "X" ? "O" : "X", mark); cells[i] = "";
    best = turn === mark ? Math.max(best, v) : Math.min(best, v); }
  return best;
}
function bestMove(cells) {
  let best = -2, pick = -1;
  for (let i = 0; i < 9; i++) { if (cells[i]) continue; cells[i] = "X";
    const v = minimax(cells, "O", "X"); cells[i] = "";
    if (v > best) { best = v; pick = i; } }
  return pick;
}
async function j(path, opts = {}) {
  const r = await fetch(BASE + path, opts);
  return { status: r.status, json: await r.json().catch(() => ({})) };
}
const fail = (m) => { console.error("SMOKE FAIL:", m); process.exit(1); };

const start = await j("/api/practice", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ gameSlug: "tictactoe" }) });
if (start.status !== 200) fail("practice start " + start.status + " " + JSON.stringify(start.json));
let token = start.json.sessionToken;
console.log("started sid", start.json.sid, "seed", start.json.seed, "houseBotScore", start.json.houseBotScore);
const bearer = () => ({ authorization: "Bearer " + token, "content-type": "application/json" });
let last = null, heartbeated = false;
for (let i = 0; i < 60; i++) {
  const st = await j("/api/play/state", { headers: bearer() });
  if (st.status !== 200) fail("state " + st.status);
  if (st.json.state.status === "over") { last = st.json; break; }
  if (!heartbeated && i === 2) {
    const hb = await j("/api/coin/heartbeat", { method: "POST", headers: bearer() });
    if (hb.status !== 200) fail("heartbeat " + hb.status);
    token = hb.json.sessionToken; heartbeated = true;
    console.log("heartbeat ok, token extended");
  }
  const mv = bestMove(st.json.state.cells);
  const act = await j("/api/play/action", { method: "POST", headers: bearer(), body: JSON.stringify({ action: "place_" + mv }) });
  if (act.status !== 200) fail("action " + act.status + " " + JSON.stringify(act.json));
  if (act.json.gameOver) { last = act.json; break; }
}
if (!last?.practice) fail("no practice payload at finish: " + JSON.stringify(last).slice(0, 300));
console.log("finished: yourScore", last.practice.yourScore, "houseBotScore", last.practice.houseBotScore, "seed", last.practice.seed);
if (last.practice.yourScore !== start.json.houseBotScore) fail("perfect play should match the house bar");
const replay = await j(last.practice.replay);
if (replay.status !== 200 || replay.json.practice !== true) fail("replay check: " + replay.status);
console.log("replay ok:", last.practice.replay, "practice flag set, finalScore", replay.json.finalScore);
const again = await j("/api/practice", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ gameSlug: "tictactoe", seed: start.json.seed }) });
if (again.status !== 200 || again.json.houseBotScore !== start.json.houseBotScore) fail("same-seed rematch mismatch");
console.log("same-seed rematch ok: identical houseBotScore", again.json.houseBotScore);
console.log("PRACTICE SMOKE PASS");
