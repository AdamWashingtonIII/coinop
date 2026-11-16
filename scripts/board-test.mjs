// Board system test against production (Adam-requested). Testnet funds only.
import { privateKeyToAccount } from 'viem/accounts';
import { randomBytes } from 'crypto';
const BASE = 'https://coinop-one.vercel.app';
const tester = privateKeyToAccount(process.env.AGENT_TEST_PRIVATE_KEY);
const qb = privateKeyToAccount(process.env.WATCH_AGENT_2_PRIVATE_KEY);
const results = [];
const check = (name, ok, detail = '') => { results.push([name, ok, detail]); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`); };

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
const post = (board, token, body) => fetch(`${BASE}/api/boards/${board}`, { method: 'POST',
  headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: JSON.stringify(body) });

// 1) tester session
const tok = await coin(tester, 'stacker');
check('paid session for board test', !!tok);
// 2) chat post on general
let r = await post('general', tok, { type: 'chat', body: 'Board test — hall check-in from the test desk. If you can read this, the boards work.' });
let j = await r.json(); check('chat post accepted', r.status === 201, 'status ' + r.status);
// 3) challenge post
r = await post('general', tok, { type: 'challenge', body: 'Open challenge: best Stacker score in the next hour takes the bragging rights.' });
j = await r.json(); const challengeId = j.post?.id; check('challenge post accepted', r.status === 201 && !!challengeId, 'status ' + r.status);
// 4) quick stacker game for a verified score
const H = { authorization: 'Bearer ' + tok, 'content-type': 'application/json' };
let over = false, finalScore = null;
for (let i = 0; i < 60 && !over; i++) {
  const a = await fetch(BASE + '/api/play/action', { method: 'POST', headers: H, body: JSON.stringify({ action: 'drop', actionId: 'boardtest-' + i }) });
  const aj = await a.json();
  if (aj.gameOver) { over = true; finalScore = aj.finalScore; }
  await new Promise(res => setTimeout(res, 120));
}
check('stacker game completed', over, 'score ' + finalScore);
// 5) brag post — server must attach the verified score
r = await post('stacker', tok, { type: 'brag', body: 'Test desk brag — the score attached to this post was verified by the server, not typed by me.' });
j = await r.json();
check('brag post carries server-verified score', r.status === 201 && (j.post?.meta?.verifiedScore ?? -1) >= 0, 'status ' + r.status + ', meta ' + JSON.stringify(j.post?.meta ?? {}));
// 6) QUARTERBACK accepts the challenge
const tok2 = await coin(qb, 'stacker');
r = await post('general', tok2, { type: 'challenge_accept', body: 'Challenge accepted. See you on the leaderboard.', meta: { challengeId } });
check('challenge_accept from second agent', r.status === 201, 'status ' + r.status);
// 7) negative tests
r = await post('general', tok, { type: 'chat', body: 'x'.repeat(501) });
check('over-length post refused', r.status === 400, 'status ' + r.status);
r = await post('general', tok, { type: 'bogus', body: 'hello' });
check('unknown post type refused', r.status === 400, 'status ' + r.status);
r = await post('general', null, { type: 'chat', body: 'no token here' });
check('posting without a paid session refused', r.status === 401, 'status ' + r.status);
r = await post('snake', tok, { type: 'brag', body: 'Bragging about a snake score I do not have.' });
check('brag without a verified score refused (422)', r.status === 422, 'status ' + r.status);
// 8) public read-back
async function readBoard(b) { const rr = await fetch(`${BASE}/api/boards/${b}`); return (await rr.json()).posts ?? []; }
let gen = [], stk = [];
for (let i = 0; i < 4; i++) { gen = await readBoard('general'); stk = await readBoard('stacker');
  if (gen.length >= 3 && stk.length >= 1) break; await new Promise(res => setTimeout(res, 4000)); }
const types = gen.map(p => p.type);
check('public read: general board shows chat + challenge + accept', ['chat', 'challenge', 'challenge_accept'].every(t => types.includes(t)), types.join(','));
check('public read: stacker board shows the brag', stk.some(p => p.type === 'brag'), stk.length + ' posts');
const failed = results.filter(([, ok]) => !ok).length;
console.log(failed === 0 ? 'BOARD TEST: ALL PASS' : `BOARD TEST: ${failed} FAILURE(S)`);
