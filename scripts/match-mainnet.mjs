// Versus-mode live test on production MAINNET: test agent (greedy) vs
// deployer wallet (drives straight, ~0) in a snake duel. Stakes settle
// through the CDP facilitator to the escrow wallet; the winner's quarter
// is refunded from escrow and the loser's quarter goes to the treasury.
// Run: node --env-file=.env.local scripts/match-mainnet.mjs
import { privateKeyToAccount } from 'viem/accounts';
import { randomBytes } from 'crypto';
const BASE = 'https://coinop-one.vercel.app';
const RPC = 'https://mainnet.base.org';
const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const TREASURY = '0x312e8Efd90C134f6E54A0B612dF4f55775eC2Bd7';
const ESCROW = '0x27501C6B06cA445579488b8d4E44998222171d74';
const agent = privateKeyToAccount(process.env.AGENT_TEST_PRIVATE_KEY);
const deployer = privateKeyToAccount(process.env.DEPLOYER_PRIVATE_KEY);
const check = (name, ok, detail = '') => console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
const RUN = Math.random().toString(36).slice(2, 7);

async function usdc(addr) {
  const r = await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to: USDC, data: '0x70a08231000000000000000000000000' + addr.slice(2).toLowerCase() }, 'latest'] }) });
  const j = await r.json(); return Number(BigInt(j.result)) / 1e6;
}
async function pay(account, url, body) {
  const first = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (first.status !== 402) throw new Error('expected 402 from ' + url + ', got ' + first.status + ': ' + (await first.text()).slice(0, 200));
  const reqs = (await first.json()).accepts[0];
  const now = Math.floor(Date.now() / 1000);
  const nonce = '0x' + randomBytes(32).toString('hex');
  const signature = await account.signTypedData({ domain: { name: 'USD Coin', version: '2', chainId: 8453, verifyingContract: reqs.asset },
    types: { TransferWithAuthorization: [ { name: 'from', type: 'address' }, { name: 'to', type: 'address' }, { name: 'value', type: 'uint256' }, { name: 'validAfter', type: 'uint256' }, { name: 'validBefore', type: 'uint256' }, { name: 'nonce', type: 'bytes32' } ] },
    primaryType: 'TransferWithAuthorization', message: { from: account.address, to: reqs.payTo, value: 250000n, validAfter: 0n, validBefore: BigInt(now + 3600), nonce } });
  const payload = { x402Version: 1, scheme: 'exact', network: reqs.network, payload: { signature, authorization: { from: account.address, to: reqs.payTo, value: '250000', validAfter: '0', validBefore: String(now + 3600), nonce } } };
  const paid = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-payment': Buffer.from(JSON.stringify(payload)).toString('base64') }, body: JSON.stringify(body) });
  return { status: paid.status, json: await paid.json(), payTo: reqs.payTo };
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function getState(H) {
  for (let k = 0; k < 15; k++) {
    const raw = await (await fetch(BASE + '/api/play/state', { headers: H })).json();
    const st = raw?.state ?? raw;
    if (st && Array.isArray(st.segments)) return st;
    await sleep(1500);
  }
  throw new Error('session state never became available');
}
async function playGreedy(token) {
  const H = { authorization: 'Bearer ' + token, 'content-type': 'application/json' };
  const DIRS = { right: { x: 1, y: 0 }, left: { x: -1, y: 0 }, down: { x: 0, y: 1 }, up: { x: 0, y: -1 } };
  for (let i = 0; i < 500; i++) {
    const st = await getState(H);
    if (st.status === 'over') return st.score ?? st.finalScore;
    const head = st.segments[0];
    const cur = { x: head.x - st.segments[1].x, y: head.y - st.segments[1].y };
    const target = st.bonus ?? st.orb; const prefs = [];
    if (target) { if (target.x > head.x) prefs.push('right'); if (target.x < head.x) prefs.push('left'); if (target.y > head.y) prefs.push('down'); if (target.y < head.y) prefs.push('up'); }
    prefs.push('right', 'down', 'left', 'up');
    let acted = false;
    for (const name of prefs) { const d = DIRS[name];
      if (d.x === -cur.x && d.y === -cur.y) continue;
      const nx = head.x + d.x, ny = head.y + d.y;
      if (nx < 0 || nx >= 20 || ny < 0 || ny >= 20) continue;
      if (st.segments.slice(0, -1).some(sg => sg.x === nx && sg.y === ny)) continue;
      await fetch(BASE + '/api/play/action', { method: 'POST', headers: H, body: JSON.stringify({ action: name, actionId: `mm-${RUN}-a-${i}` }) }); acted = true; break; }
    if (!acted) { const r = await fetch(BASE + '/api/play/action', { method: 'POST', headers: H, body: JSON.stringify({ action: 'right', actionId: `mm-${RUN}-ax-${i}` }) }); const rj = await r.json(); if (rj.gameOver) return rj.finalScore; }
    await sleep(110);
  }
  return null;
}
async function playStraight(token) {
  const H = { authorization: 'Bearer ' + token, 'content-type': 'application/json' };
  for (let i = 0; i < 60; i++) {
    const st = await getState(H);
    if (st.status === 'over') return st.score ?? st.finalScore;
    const head = st.segments[0];
    const d = { x: head.x - st.segments[1].x, y: head.y - st.segments[1].y };
    const name = d.x === 1 ? 'right' : d.x === -1 ? 'left' : d.y === 1 ? 'down' : 'up';
    const r = await fetch(BASE + '/api/play/action', { method: 'POST', headers: H, body: JSON.stringify({ action: name, actionId: `mm-${RUN}-b-${i}` }) });
    const rj = await r.json(); if (rj.gameOver) return rj.finalScore;
    await sleep(110);
  }
  return null;
}
const [a0, d0, t0, e0] = [await usdc(agent.address), await usdc(deployer.address), await usdc(TREASURY), await usdc(ESCROW)];
console.log(`before: AGENT ${a0} | DEPLOYER ${d0} | treasury ${t0} | escrow ${e0}`);
const created = await pay(agent, BASE + '/api/match', { gameSlug: 'snake' });
check('match payment goes to the escrow wallet', created.payTo.toLowerCase() === ESCROW.toLowerCase(), 'payTo ' + created.payTo);
const matchId = created.json.match?.id ?? created.json.id;
const tokA = created.json.sessionToken;
check('match created by AGENT', created.status < 300 && !!matchId && !!tokA, 'status ' + created.status + ', match ' + matchId);
const joined = await pay(deployer, `${BASE}/api/match/${matchId}/join`, {});
const tokB = joined.json.sessionToken;
check('DEPLOYER joined the match', joined.status < 300 && !!tokB, 'status ' + joined.status);
const [scoreA, scoreB] = [await playGreedy(tokA), await playStraight(tokB)];
console.log(`runs finished: AGENT ${scoreA} | DEPLOYER ${scoreB}`);
let m = null;
for (let i = 0; i < 24; i++) { const mj = await (await fetch(`${BASE}/api/match/${matchId}`)).json(); m = mj.match ?? mj;
  if (['settled', 'draw', 'forfeited', 'void', 'expired'].includes(m.status)) break; await sleep(5000); }
console.log('match state:', JSON.stringify(m).slice(0, 400));
check('match reached a terminal state', ['settled', 'draw', 'forfeited'].includes(m?.status), 'status ' + m?.status);
const [a1, d1, t1, e1] = [await usdc(agent.address), await usdc(deployer.address), await usdc(TREASURY), await usdc(ESCROW)];
console.log(`after: AGENT ${a1} (Δ ${(a1 - a0).toFixed(2)}) | DEPLOYER ${d1} (Δ ${(d1 - d0).toFixed(2)}) | treasury ${t1} (Δ ${(t1 - t0).toFixed(2)}) | escrow ${e1}`);
async function transferLog(txHash) {
  const r = await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_getTransactionReceipt', params: [txHash] }) });
  const j = await r.json();
  const log = (j.result?.logs ?? []).find(l => l.address.toLowerCase() === USDC.toLowerCase() && l.topics[0].startsWith('0xddf252ad'));
  if (!log) return null;
  return { from: '0x' + log.topics[1].slice(26), to: '0x' + log.topics[2].slice(26), value: Number(BigInt(log.data)) / 1e6 };
}
if (m?.status === 'settled' || m?.status === 'forfeited') {
  const refundTx = (Array.isArray(m.refundTx) ? m.refundTx[0] : (m.refundTx ?? m.refund_tx ?? '').split(',')[0]);
  const treasuryTx = m.treasuryTx ?? m.treasury_tx;
  check('settlement tx hashes recorded', !!refundTx && !!treasuryTx, JSON.stringify({ refundTx, treasuryTx }).slice(0, 170));
  const rl = await transferLog(refundTx); const tl = await transferLog(treasuryTx);
  check('refund leg: escrow -> winner (AGENT), 0.25 USDC', !!rl && rl.from.toLowerCase() === ESCROW.toLowerCase() && rl.to.toLowerCase() === agent.address.toLowerCase() && rl.value === 0.25, JSON.stringify(rl));
  check("treasury leg: escrow -> treasury, 0.25 USDC (the loser's quarter)", !!tl && tl.from.toLowerCase() === ESCROW.toLowerCase() && tl.to.toLowerCase() === TREASURY.toLowerCase() && tl.value === 0.25, JSON.stringify(tl));
  check('winner recorded as AGENT', (m.winner ?? m.winnerWallet ?? m.winner_wallet ?? '').toLowerCase() === agent.address.toLowerCase(), 'winner ' + (m.winner ?? m.winnerWallet ?? m.winner_wallet));
}
