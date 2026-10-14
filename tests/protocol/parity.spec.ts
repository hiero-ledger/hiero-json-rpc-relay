// SPDX-License-Identifier: Apache-2.0

import { expect } from 'chai';
import { ethers } from 'ethers';

import { numberTo0x } from '../../src/relay/formatters';
import basicContractJson from '../server/contracts/Basic.json';
import Address from '../server/helpers/constants';
import { Utils } from '../server/helpers/utils';
import { type AliasAccount } from '../server/types/AliasAccount';
import { ALL_PROTOCOL_CLIENTS, type RpcRawResponse } from './helpers/protocolClient';

interface ParityCase {
  method: string;
  description: string;
  // A function that returns the params array, so rows can use values that `before()` sets up after the table is built.
  params: () => unknown[];
}

// Every error message carries a per-request ID, so it never matches across two requests.
const REQUEST_ID_PREFIX = /^\[Request ID: [^\]]+\] /;

const toComparable = ({ result, error }: RpcRawResponse): Pick<RpcRawResponse, 'result' | 'error'> =>
  error
    ? { error: { code: error.code, message: error.message.replace(REQUEST_ID_PREFIX, ''), data: error.data } }
    : { result };

describe('@protocol-acceptance @protocol-acceptance-eth-plain HTTP/WebSocket parity', async function () {
  this.timeout(240 * 1000);

  let account: AliasAccount;
  let contractAddress: string;
  let blockBeforeDeploy: string;
  let txHash: string;
  let txBlockNumber: string;

  before(async () => {
    [account] = await Utils.createMultipleAliasAccounts(
      global.mirrorNode,
      global.accounts[0],
      1,
      global.initialBalance.toString(),
    );
    global.accounts.push(account);

    blockBeforeDeploy = numberTo0x((await global.mirrorNode.get(`/blocks?limit=1&order=desc`)).blocks[0].number);
    const contract = await Utils.deployContract(basicContractJson.abi, basicContractJson.bytecode, account.wallet);
    contractAddress = contract.target as string;

    const tx = await account.wallet.sendTransaction({ to: contractAddress, value: ethers.parseEther('1') });
    const receipt = await global.relay.pollForValidTransactionReceipt(tx.hash);
    txHash = tx.hash;
    txBlockNumber = receipt.blockNumber;
  });

  after(async () => {
    if (global?.socketServer) {
      expect(global.socketServer._connections).to.eq(0);
    }
  });

  const CASES: ParityCase[] = [
    { method: 'eth_chainId', description: 'chain id', params: () => [] },
    { method: 'eth_parityUnknownMethod', description: 'unknown method', params: () => [] },

    { method: 'eth_getBlockByNumber', description: 'pinned block', params: () => [txBlockNumber, false] },
    { method: 'eth_getBlockByNumber', description: 'pinned block, hydrated', params: () => [txBlockNumber, true] },
    { method: 'eth_getBlockByNumber', description: 'invalid block number', params: () => ['0xhedera', true] },

    { method: 'eth_getTransactionReceipt', description: 'known hash', params: () => [txHash] },
    {
      method: 'eth_getTransactionReceipt',
      description: 'non-existing hash',
      params: () => [Address.NON_EXISTING_TX_HASH],
    },
    { method: 'eth_getTransactionReceipt', description: 'malformed hash', params: () => ['0xhbar'] },

    { method: 'eth_getBalance', description: 'pinned block', params: () => [account.address, txBlockNumber] },
    { method: 'eth_getBalance', description: 'invalid address', params: () => ['0xhbar', 'latest'] },

    { method: 'eth_getCode', description: 'deployed contract', params: () => [contractAddress, 'latest'] },
    {
      method: 'eth_getCode',
      description: 'block before deployment',
      params: () => [contractAddress, blockBeforeDeploy],
    },
    { method: 'eth_getCode', description: 'invalid address', params: () => ['0xhbar', 'latest'] },
  ];

  for (const { method, description, params } of CASES) {
    it(`${method}: ${description}`, async () => {
      const [http, ws] = await Promise.all(ALL_PROTOCOL_CLIENTS.map((client) => client.callRaw(method, params())));

      expect(toComparable(ws), 'WebSocket response differs from HTTP').to.deep.equal(toComparable(http));
    });
  }
});
