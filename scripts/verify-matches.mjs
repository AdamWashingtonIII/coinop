const USDC = '0x036CbD53842c5426634e7929541eC2318f3dCF7e';
const TREASURY = '0x312e8Efd90C134f6E54A0B612dF4f55775eC2Bd7';
async function rpc(method, params) {
  const r = await fetch('https://sepolia.base.org', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
  return (await r.json()).result;
}
async function transfersOf(txHash) {
  const rcpt = await rpc('eth_getTransactionReceipt', [txHash]);
  return (rcpt?.logs ?? []).filter(l => l.address.toLowerCase() === USDC.toLowerCase() && l.topics[0].startsWith('0xddf252ad'))
    .map(l => ({ from: '0x' + l.topics[1].slice(26), to: '0x' + l.topics[2].slice(26), value: Number(BigInt(l.data)) / 1e6 }));
}
for (const id of ['60a4cd4979a2c35083c43ec7', '31702083537d2303a16bf48c']) {
  const m = (await (await fetch(`https://coinop-one.vercel.app/api/match/${id}`)).json()).match;
  console.log(`\nmatch ${id}: status=${m.status} outcome=${m.outcome} scores=${JSON.stringify(m.scores)} winner=${m.winner}`);
  console.log('  refundTx:', m.refundTx ?? m.refund_tx, '| treasuryTx:', m.treasuryTx ?? m.treasury_tx);
  for (const tx of [m.refundTx ?? m.refund_tx, m.treasuryTx ?? m.treasury_tx]) {
    if (!tx) continue;
    for (const h of String(tx).split(',')) console.log('  tx', h.slice(0, 18) + '…', JSON.stringify(await transfersOf(h)));
  }
}
// every USDC transfer INTO the treasury in the last ~4000 blocks (~2.2 hrs)
const latest = Number(BigInt(await rpc('eth_blockNumber', [])));
const logs = await rpc('eth_getLogs', [{ address: USDC, topics: ['0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef', null, '0x000000000000000000000000' + TREASURY.slice(2).toLowerCase()], fromBlock: '0x' + (latest - 4000).toString(16), toBlock: 'latest' }]);
console.log('\nrecent USDC transfers TO treasury:');
for (const l of logs) console.log('  block', Number(BigInt(l.blockNumber)), '| from', '0x' + l.topics[1].slice(26), '| value', Number(BigInt(l.data)) / 1e6, '| tx', l.transactionHash.slice(0, 18) + '…');
