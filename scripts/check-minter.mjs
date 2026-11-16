import { createPublicClient, http } from 'viem';
import { baseSepolia } from 'viem/chains';
const pub = createPublicClient({ chain: baseSepolia, transport: http('https://sepolia.base.org') });
const QTR2 = '0x5Eb82d3B5F39C9CE7ccEa88241cda64bEb5B89e2';
const abi = [
  { name: 'minter', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { name: 'owner', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { name: 'balanceOf', type: 'function', stateMutability: 'view', inputs: [{ type: 'address' }], outputs: [{ type: 'uint256' }] },
  { name: 'totalSupply', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
];
console.log('minter:', await pub.readContract({ address: QTR2, abi, functionName: 'minter' }));
console.log('owner:', await pub.readContract({ address: QTR2, abi, functionName: 'owner' }));
console.log('test agent QTR v2 balance:', (await pub.readContract({ address: QTR2, abi, functionName: 'balanceOf', args: ['0x2D3f3F16EF47a8345D65b277217B5B6Dcb2386ff'] })).toString());
console.log('totalSupply:', (await pub.readContract({ address: QTR2, abi, functionName: 'totalSupply' })).toString());
