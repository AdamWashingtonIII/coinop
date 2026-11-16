import { createWalletClient, createPublicClient, http, parseUnits } from 'viem';
import { baseSepolia } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
const USDC = '0x036CbD53842c5426634e7929541eC2318f3dCF7e';
const account = privateKeyToAccount(process.env.MATCH_ESCROW_PRIVATE_KEY);
const wallet = createWalletClient({ account, chain: baseSepolia, transport: http('https://sepolia.base.org') });
const pub = createPublicClient({ chain: baseSepolia, transport: http('https://sepolia.base.org') });
const abi = [{ type: 'function', name: 'transfer', stateMutability: 'nonpayable', inputs: [{ name: 'to', type: 'address' }, { name: 'value', type: 'uint256' }], outputs: [{ type: 'bool' }] }];
for (const to of ['0x981d3e7EB61A0929E7C39eb2B47d2c3fEBcaF511', '0xCce4B63cEe66f05e23F85198be73df897Ee2A209']) {
  const hash = await wallet.writeContract({ address: USDC, abi, functionName: 'transfer', args: [to, parseUnits('0.25', 6)] });
  const rcpt = await pub.waitForTransactionReceipt({ hash });
  console.log('refund ->', to, '| tx', hash, '| status', rcpt.status);
}
