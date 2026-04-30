// SPDX-License-Identifier: Apache-2.0

import { expect } from 'chai';
import { ethers } from 'ethers';

import MirrorClient from '../server/clients/mirrorClient';
import RelayClient from '../server/clients/relayClient';
import parentContractJson from '../server/contracts/Parent.json';
import Assertions from '../server/helpers/assertions';
import Address from '../server/helpers/constants';
import RelayCalls from '../server/helpers/constants';
import { Utils } from '../server/helpers/utils';
import { AliasAccount } from '../server/types/AliasAccount';
import { resolveAccountEvmAddresses } from './helpers/mirrorNodeHelpers';
import { ALL_PROTOCOL_CLIENTS } from './helpers/protocolClient';

describe('@release @protocol-acceptance eth_getBlockByHash', async function () {
  this.timeout(240 * 1000);
  const METHOD_NAME = 'eth_getBlockByHash';

  const FAKE_TX_HASH = `0x${'00'.repeat(20)}`;
  const INVALID_PARAMS: any[][] = [
    [],
    ['0xhbar', false],
    ['0xhedera', true],
    [FAKE_TX_HASH],
    [FAKE_TX_HASH, '54'],
    [FAKE_TX_HASH, '0xhbar'],
    [FAKE_TX_HASH, true, 39],
    [FAKE_TX_HASH, false, 39],
  ];

  // @ts-ignore
  const {
    mirrorNode,
    relay,
    initialBalance,
  }: { mirrorNode: MirrorClient; relay: RelayClient; initialBalance: string } = global;

  const accounts: AliasAccount[] = [];
  let mirrorBlock: any;
  const mirrorTransactions: any[] = [];
  let expectedGasPrice: string;

  before(async () => {
    expectedGasPrice = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_GAS_PRICE, []);

    accounts.push(...(await Utils.createMultipleAliasAccounts(mirrorNode, global.accounts[0], 1, initialBalance)));
    global.accounts.push(...accounts);

    const parentContract = await Utils.deployContract(
      parentContractJson.abi,
      parentContractJson.bytecode,
      accounts[0].wallet,
    );

    const fundTx = await accounts[0].wallet.sendTransaction({
      to: parentContract.target as string,
      value: ethers.parseEther('1'),
    });
    await relay.pollForValidTransactionReceipt(fundTx.hash);

    const createChildTx = await (parentContract as any).createChild(1);
    await relay.pollForValidTransactionReceipt(createChildTx.hash);

    const mirrorContractDetails = await mirrorNode.get(`/contracts/results/${createChildTx.hash}`);
    mirrorContractDetails.from = accounts[0].address;

    mirrorBlock = (await mirrorNode.get(`/blocks?block.number=${mirrorContractDetails.block_number}`)).blocks[0];
    const timestampQuery = `timestamp=gte:${mirrorBlock.timestamp.from}&timestamp=lte:${mirrorBlock.timestamp.to}`;
    const mirrorContractResults = (await mirrorNode.get(`/contracts/results?${timestampQuery}`)).results;

    for (const res of mirrorContractResults) {
      mirrorTransactions.push(await mirrorNode.get(`/contracts/${res.contract_id}/results/${res.timestamp}`));
    }

    for (const mirrorTx of mirrorTransactions) {
      const resolvedAddresses = await resolveAccountEvmAddresses(mirrorNode, mirrorTx);
      mirrorTx.from = resolvedAddresses.from;
      mirrorTx.to = resolvedAddresses.to;
    }
  });

  after(async () => {
    if (global?.socketServer) {
      expect(global.socketServer._connections).to.eq(0);
    }
  });

  for (const client of ALL_PROTOCOL_CLIENTS) {
    describe(client.label, () => {
      it('should execute "eth_getBlockByHash", hydrated transactions = false', async () => {
        const blockResult = await client.call(METHOD_NAME, [mirrorBlock.hash.substring(0, 66), false]);
        Assertions.block(blockResult, mirrorBlock, mirrorTransactions, expectedGasPrice, false);
      });

      it('@release should execute "eth_getBlockByHash", hydrated transactions = true', async () => {
        const blockResult: any = await client.call(METHOD_NAME, [mirrorBlock.hash.substring(0, 66), true]);
        // Remove synthetic transactions
        blockResult.transactions = blockResult.transactions.filter(
          (transaction: any) => transaction.value !== '0x1234',
        );
        Assertions.block(blockResult, mirrorBlock, mirrorTransactions, expectedGasPrice, true);
      });

      it('should execute "eth_getBlockByHash" for non-existing block hash and hydrated transactions = false', async () => {
        const blockResult = await client.call(METHOD_NAME, [Address.NON_EXISTING_BLOCK_HASH, false]);
        expect(blockResult).to.be.null;
      });

      it('should execute "eth_getBlockByHash" for non-existing block hash and hydrated transactions = true', async () => {
        const blockResult = await client.call(METHOD_NAME, [Address.NON_EXISTING_BLOCK_HASH, true]);
        expect(blockResult).to.be.null;
      });

      for (const params of INVALID_PARAMS) {
        it(`Should fail eth_getBlockByHash and throw INVALID_PARAMETERS if the request's params variable is invalid. params=[${params}]`, async () => {
          const response = await client.callRaw(METHOD_NAME, params);
          expect(response.error).to.exist;
          expect(response.error!.code).to.be.oneOf([-32000, -32602, -32603]);
        });
      }
    });
  }
});
