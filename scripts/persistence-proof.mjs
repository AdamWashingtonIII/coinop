// Post-Neon persistence proof: write once, read many times — data must be there EVERY time.
import { privateKeyToAccount } from 'viem/accounts';
import { randomBytes } from 'crypto';
const BASE = 'https://coinop-one.vercel.app';
const tester = privateKeyToAccount(process.env.AGENT_TEST_PRIVATE_KEY);
const MARKER = 'PERSISTENCE-PROOF-' + randomBytes(3).toString('hex').toUpperCase();
async function coin(account, gameSlug) {
  const first = await fetch(BASE + '/api/coin', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ gameSlug }) });
  const reqs = (await first.json()).accepts[0];
  const now = Math.floor(Date.now() / 1000);
  const nonce = '0x' + randomBytes(32).toString('hex');
  const signature = await account.signTypedData({ domain: { name: 'USDC', version: '2', chainId: 84532, verifyingContract: reqs.asset },
    types: { TransferWithAuthorization: [ { name: 'from', type: 'address' }, { name: 'to', type: 'address' }, { name: 'value', type: 'uint256' }, { name: 'validAfter', type: 'uint256' }, { name: 'validBefore', type: 'uint256' }, { name: 'nonce', type: 'bytes32' } ] },
    primaryType: 'TransferWithAuthorization',
    message: { from: account.address, to: reqs.payTo, value: 250000n, validAfter: 0n, validBefore: BigInt(now + 3600), nonce } });
  const payload = { x402Version: 1, scheme: 'exact', network: reqs.network, payload: { signature, authorization: { from: account.address, to: reqs.payTo, value: '250000', validAfter: '0', validBefore: String(now + 3600), nonce } } };
  const paid = await fetch(BASE + '/api/coin', { method: 'POST', headers: { 'content-type': 'application/json', 'x-payment': Buffer.from(JSON.stringify(payload)).toString('base64') }, body: JSON.stringify({ gameSlug }) });
  const j = await paid.json();
  if (!j.sessionToken) throw new Error('coin failed: ' + JSON.stringify(j).slice(0, 160));
  return j.sessionToken;
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const tok = await coin(tester, 'stacker');
const H = { authorization: 'Bearer ' + tok, 'content-type': 'application/json' };
let score = null;
for (let i = 0; i < 60; i++) {
  const a = await fetch(BASE + '/api/play/action', { method: 'POST', headers: H, body: JSON.stringify({ action: 'drop', actionId: 'persist-' + i }) });
  const aj = await a.json();
  if (aj.gameOver) { score = aj.finalScore; break; }
  await sleep(120);
}
console.log('played stacker, recorded score:', score);
const pr = await fetch(BASE + '/api/boards/general', { method: 'POST', headers: H, body: JSON.stringify({ type: 'chat', body: MARKER + ' — if you can read this on every load, the database is permanent.' }) });
console.log('board post status:', pr.status, '| marker:', MARKER);
let boardHits = 0, lbHits = 0;
for (let i = 0; i < 6; i++) {
  const posts = (await (await fetch(BASE + '/api/boards/general')).json()).posts ?? [];
  if (posts.some(p => (p.body ?? '').includes(MARKER))) boardHits++;
  const lb = await (await fetch(BASE + '/api/leaderboard')).json();
  if ((lb.entries ?? []).some(e => (e.wallet ?? e.agent ?? '').toLowerCase() === tester.address.toLowerCase())) lbHits++;
  await sleep(3000);
}
console.log(`board marker found on ${boardHits}/6 reads`);
console.log(`leaderboard entry found on ${lbHits}/6 reads`);
console.log(boardHits === 6 ? 'PERSISTENCE: PROVEN — no flicker' : 'PERSISTENCE: STILL FLICKERING');
