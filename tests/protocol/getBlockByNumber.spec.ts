// SPDX-License-Identifier: Apache-2.0

import { ContractFunctionParameters } from '@hashgraph/sdk';
import { expect } from 'chai';
import { ethers } from 'ethers';

import { formatTransactionId, numberTo0x } from '../../src/relay/formatters';
import MirrorClient from '../server/clients/mirrorClient';
import RelayClient from '../server/clients/relayClient';
import ServicesClient from '../server/clients/servicesClient';
import parentContractJson from '../server/contracts/Parent.json';
import Assertions from '../server/helpers/assertions';
import Address from '../server/helpers/constants';
import RelayCalls from '../server/helpers/constants';
import { Utils } from '../server/helpers/utils';
import { AliasAccount } from '../server/types/AliasAccount';
import { resolveAccountEvmAddresses } from './helpers/mirrorNodeHelpers';
import { ALL_PROTOCOL_CLIENTS } from './helpers/protocolClient';

describe('@release @protocol-acceptance eth_getBlockByNumber', async function () {
  this.timeout(240 * 1000);
  const METHOD_NAME = 'eth_getBlockByNumber';

  const INVALID_PARAMS: any[][] = [
    [],
    ['0x36'],
    ['0x36', '0xhbar'],
    ['0x36', '54'],
    ['0x36', 'true', 39],
    ['0xhedera', true],
    ['0xhbar', false],
    ['0xnetwork', false],
  ];

  // @ts-ignore
  const {
    mirrorNode,
    relay,
    servicesNode,
    initialBalance,
  }: {
    mirrorNode: MirrorClient;
    relay: RelayClient;
    servicesNode: ServicesClient;
    initialBalance: string;
  } = global;

  const accounts: AliasAccount[] = [];
  let mirrorBlock: any;
  let mirrorContractDetails: any;
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

    mirrorContractDetails = await mirrorNode.get(`/contracts/results/${createChildTx.hash}`);
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
      it('should execute "eth_getBlockByNumber", hydrated transactions = false', async () => {
        const blockResult: any = await client.call(METHOD_NAME, [numberTo0x(mirrorBlock.number), false]);
        // Remove synthetic transactions
        blockResult.transactions = blockResult.transactions.filter(
          (transaction: any) => transaction.value !== '0x1234',
        );
        Assertions.block(blockResult, mirrorBlock, mirrorTransactions, expectedGasPrice, false);
      });

      it('should not cache "latest" block in "eth_getBlockByNumber" ', async () => {
        const blockResult = await client.call(METHOD_NAME, ['latest', false]);
        await Utils.wait(2000);

        const blockResult2 = await client.call(METHOD_NAME, ['latest', false]);
        expect(blockResult).to.not.deep.equal(blockResult2);
      });

      it('should not cache "finalized" block in "eth_getBlockByNumber" ', async () => {
        const blockResult = await client.call(METHOD_NAME, ['finalized', false]);
        await Utils.wait(2000);

        const blockResult2 = await client.call(METHOD_NAME, ['finalized', false]);
        expect(blockResult).to.not.deep.equal(blockResult2);
      });

      it('should not cache "safe" block in "eth_getBlockByNumber" ', async () => {
        const blockResult = await client.call(METHOD_NAME, ['safe', false]);
        await Utils.wait(2000);

        const blockResult2 = await client.call(METHOD_NAME, ['safe', false]);
        expect(blockResult).to.not.deep.equal(blockResult2);
      });

      it('should not cache "pending" block in "eth_getBlockByNumber" ', async () => {
        const blockResult = await client.call(METHOD_NAME, ['pending', false]);
        await Utils.wait(2000);

        const blockResult2 = await client.call(METHOD_NAME, ['pending', false]);
        expect(blockResult).to.not.deep.equal(blockResult2);
      });

      it('@release should execute "eth_getBlockByNumber", hydrated transactions = true', async () => {
        const blockResult: any = await client.call(METHOD_NAME, [numberTo0x(mirrorBlock.number), true]);
        // Remove synthetic transactions
        blockResult.transactions = blockResult.transactions.filter(
          (transaction: any) => transaction.value !== '0x1234',
        );
        Assertions.block(blockResult, mirrorBlock, mirrorTransactions, expectedGasPrice, true);
      });

      it('should execute "eth_getBlockByNumber" for non existing block number and hydrated transactions = true', async () => {
        const blockResult = await client.call(METHOD_NAME, [Address.NON_EXISTING_BLOCK_NUMBER, true]);
        expect(blockResult).to.be.null;
      });

      it('should execute "eth_getBlockByNumber" for non existing block number and hydrated transactions = false', async () => {
        const blockResult = await client.call(METHOD_NAME, [Address.NON_EXISTING_BLOCK_NUMBER, false]);
        expect(blockResult).to.be.null;
      });

      it('should execute "eth_getBlockByNumber", hydrated transactions = true for a block that contains a call with CONTRACT_NEGATIVE_VALUE status', async () => {
        let transactionId;
        let hasContractNegativeValueError = false;
        try {
          await servicesNode.executeContractCallWithAmount(
            mirrorContractDetails.contract_id,
            '',
            new ContractFunctionParameters(),
            500_000,
            -100,
          );
        } catch (e: any) {
          // regarding the docs and HederaResponseCodes.sol the CONTRACT_NEGATIVE_VALUE code equals 96;
          expect(e.status._code).to.equal(96);
          hasContractNegativeValueError = true;
          transactionId = e.transactionId;
        }
        expect(hasContractNegativeValueError).to.be.true;

        // waiting for at least one block time for data to be populated in the mirror node
        // because on the step above we sent a sdk call
        await new Promise((r) => setTimeout(r, 2100));
        const mirrorResult = await mirrorNode.get(
          `/contracts/results/${formatTransactionId(transactionId.toString())}`,
        );
        const txHash = mirrorResult.hash;
        const blockResult: any = await client.call(METHOD_NAME, [numberTo0x(mirrorResult.block_number), true]);
        expect(blockResult.transactions).to.not.be.empty;
        expect(blockResult.transactions.map((tx: any) => tx.hash)).to.contain(txHash);
        expect(blockResult.transactions.filter((tx: any) => tx.hash == txHash)[0].value).to.equal('0xffffff172b5af000');
      });

      for (const params of INVALID_PARAMS) {
        it(`Should fail eth_getBlockByNumber and throw INVALID_PARAMETERS if the request's params variable is invalid. params=[${params}]`, async () => {
          const response = await client.callRaw(METHOD_NAME, params);
          expect(response.error).to.exist;
          expect(response.error!.code).to.be.oneOf([-32000, -32602, -32603]);
        });
      }
    });
  }
});
