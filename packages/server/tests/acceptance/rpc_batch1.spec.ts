// SPDX-License-Identifier: Apache-2.0

// External resources
import { ConfigService } from '@hashgraph/json-rpc-config-service/dist/services';
// Other imports
import { formatTransactionId, numberTo0x, prepend0x } from '@hashgraph/json-rpc-relay/dist/formatters';
import Constants from '@hashgraph/json-rpc-relay/dist/lib/constants';
// Errors and constants from local resources
import { predefined } from '@hashgraph/json-rpc-relay/dist/lib/errors/JsonRpcError';
import { RequestDetails } from '@hashgraph/json-rpc-relay/dist/lib/types';
import {
  AccountCreateTransaction,
  ContractFunctionParameters,
  FileInfo,
  FileInfoQuery,
  Hbar,
  PrivateKey,
  TransferTransaction,
} from '@hashgraph/sdk';
import { expect } from 'chai';
import { ethers } from 'ethers';

import { ConfigServiceTestHelper } from '../../../config-service/tests/configServiceTestHelper';
import { BLOCK_PARAMS_ERROR } from '../../src/validator/constants';
import basicContract from '../../tests/contracts/Basic.json';
import RelayCalls from '../../tests/helpers/constants';
import MirrorClient from '../clients/mirrorClient';
import RelayClient from '../clients/relayClient';
import ServicesClient from '../clients/servicesClient';
import logsContractJson from '../contracts/Logs.json';
// Local resources from contracts directory
import parentContractJson from '../contracts/Parent.json';
// Assertions from local resources
import Assertions from '../helpers/assertions';
import { Utils } from '../helpers/utils';
import { AliasAccount } from '../types/AliasAccount';

const Address = RelayCalls;

describe('@api-batch-1 RPC Server Acceptance Tests', function () {
  this.timeout(240 * 1000); // 240 seconds

  const accounts: AliasAccount[] = [];

  // @ts-ignore
  const {
    servicesNode,
    mirrorNode,
    relay,
    initialBalance,
  }: { servicesNode: ServicesClient; mirrorNode: MirrorClient; relay: RelayClient; initialBalance: string } = global;

  // cached entities
  let parentContractAddress: string;
  let mirrorContractDetails;
  let account2Address: string;
  let expectedGasPrice: string;
  let createChildTx: ethers.ContractTransactionResponse;
  const CHAIN_ID = ConfigService.get('CHAIN_ID');
  const requestId = 'rpc_batch1Test';
  const requestIdPrefix = Utils.formatRequestIdMessage(requestId);
  const requestDetails = JSON.stringify(new RequestDetails({ requestId: 'rpc_batch1Test', ipAddress: '0.0.0.0' }));
  const INCORRECT_CHAIN_ID = 999;
  const GAS_PRICE_TOO_LOW = '0x1';
  const GAS_PRICE_REF = '0x123456';
  const ONE_TINYBAR = Utils.add0xPrefix(Utils.toHex(Constants.TINYBAR_TO_WEIBAR_COEF));
  const TEN_HBAR = Utils.add0xPrefix(
    (BigInt(new Hbar(10).toTinybars().toString()) * BigInt(Constants.TINYBAR_TO_WEIBAR_COEF)).toString(16),
  );
  const gasPriceDeviation = ConfigService.get('TEST_GAS_PRICE_DEVIATION');
  const sendRawTransaction = relay.sendRawTransaction;
  const useAsyncTxProcessing = ConfigService.get('USE_ASYNC_TX_PROCESSING');

  /**
   * resolves long zero addresses to EVM addresses by querying mirror node
   * @param tx - supposedly a proper transaction that has `from` and `to` fields
   * @returns Promise<{from: any|null, to: any|null}>
   */
  const resolveAccountEvmAddresses = async (tx: any) => {
    const fromAccountInfo = await mirrorNode.get(`/accounts/${tx.from}`, requestId);
    const toAccountInfo = await mirrorNode.get(`/accounts/${tx.to}`, requestId);
    return {
      from: fromAccountInfo?.evm_address ?? tx.from,
      to: toAccountInfo?.evm_address ?? tx.to,
    };
  };

  async function getGasWithDeviation(relay: RelayClient, requestDetails: string, gasPriceDeviation: number) {
    const gasPrice = await relay.gasPrice(requestDetails);
    const gasPriceWithDeviation = gasPrice * (1 + gasPriceDeviation);
    return gasPriceWithDeviation;
  }

  describe('RPC Server Acceptance Tests', function () {
    this.timeout(240 * 1000); // 240 seconds

    this.beforeAll(async () => {
      expectedGasPrice = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_GAS_PRICE, [], requestIdPrefix);

      const initialAccount: AliasAccount = global.accounts[0];
      const neededAccounts: number = 3;
      accounts.push(
        ...(await Utils.createMultipleAliasAccounts(
          mirrorNode,
          initialAccount,
          neededAccounts,
          initialBalance,
          requestDetails,
        )),
      );
      global.accounts.push(...accounts);

      const parentContract = await Utils.deployContract(
        parentContractJson.abi,
        parentContractJson.bytecode,
        accounts[0].wallet,
      );

      parentContractAddress = parentContract.target as string;
      if (global.logger.isLevelEnabled('trace')) {
        global.logger.trace(
          `${requestDetails.formattedRequestId} Deploy parent contract on address ${parentContractAddress}`,
        );
      }

      const response = await accounts[0].wallet.sendTransaction({
        to: parentContractAddress,
        value: ethers.parseEther('1'),
      });
      await relay.pollForValidTransactionReceipt(response.hash);

      // @ts-ignore
      createChildTx = await parentContract.createChild(1);
      await relay.pollForValidTransactionReceipt(createChildTx.hash);

      if (global.logger.isLevelEnabled('trace')) {
        global.logger.trace(
          `${requestDetails.formattedRequestId} Contract call createChild on parentContract results in tx hash: ${createChildTx.hash}`,
        );
      }
      // get contract result details
      mirrorContractDetails = await mirrorNode.get(`/contracts/results/${createChildTx.hash}`, requestId);

      mirrorContractDetails.from = accounts[0].address;
      account2Address = accounts[2].address;
    });

    describe('eth_getLogs', () => {
      let log0Block,
        log4Block,
        contractAddress: string,
        contractAddress2: string,
        latestBlock,
        previousBlock,
        expectedAmountOfLogs;

      before(async () => {
        const logsContract = await Utils.deployContract(
          logsContractJson.abi,
          logsContractJson.bytecode,
          accounts[2].wallet,
        );
        const logsContract2 = await Utils.deployContract(
          logsContractJson.abi,
          logsContractJson.bytecode,
          accounts[2].wallet,
        );
        contractAddress = logsContract.target.toString();
        contractAddress2 = logsContract2.target.toString();

        previousBlock = Number(await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_BLOCK_NUMBER, [], requestIdPrefix));

        // @ts-ignore
        await (await logsContract.connect(accounts[1].wallet).log0(1)).wait();
        // @ts-ignore
        await (await logsContract.connect(accounts[1].wallet).log1(1)).wait();
        // @ts-ignore
        await (await logsContract.connect(accounts[1].wallet).log2(1, 1)).wait();
        // @ts-ignore
        await (await logsContract.connect(accounts[1].wallet).log3(1, 1, 1)).wait();
        // @ts-ignore
        await (await logsContract.connect(accounts[1].wallet).log4(1, 1, 1, 1)).wait();
        // @ts-ignore
        await (await logsContract2.connect(accounts[1].wallet).log4(1, 1, 1, 1)).wait();

        expectedAmountOfLogs = 6;
        latestBlock = Number(await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_BLOCK_NUMBER, [], requestIdPrefix));
      });

      it('@release should deploy a contract', async () => {
        //empty params for get logs defaults to latest block, which doesn't have required logs, that's why we fetch the last 12
        const logs = await relay.call(
          RelayCalls.ETH_ENDPOINTS.ETH_GET_LOGS,
          [
            {
              fromBlock: numberTo0x(previousBlock),
              address: [contractAddress, contractAddress2],
            },
          ],
          requestIdPrefix,
        );

        expect(logs.length).to.be.greaterThan(0);
        const txIndexLogIndexMapping: any[] = [];
        for (const i in logs) {
          expect(logs[i]).to.have.property('address');
          expect(logs[i]).to.have.property('logIndex');

          const key = `${logs[i].transactionHash}---${logs[i].logIndex}`;
          txIndexLogIndexMapping.push(key);
        }
        const uniqueTxIndexLogIndexMapping = txIndexLogIndexMapping.filter(
          (value, index, self) => self.indexOf(value) === index,
        );
        expect(txIndexLogIndexMapping.length).to.equal(uniqueTxIndexLogIndexMapping.length);

        log0Block = await relay.call(
          RelayCalls.ETH_ENDPOINTS.ETH_GET_TRANSACTION_BY_HASH,
          [logs[0].transactionHash],
          requestIdPrefix,
        );
        const transactionCountLog0Block = await relay.provider.getTransactionCount(
          log0Block.from,
          log0Block.blockNumber,
        );

        log4Block = await relay.call(
          RelayCalls.ETH_ENDPOINTS.ETH_GET_TRANSACTION_BY_HASH,
          [logs[logs.length - 1].transactionHash],
          requestIdPrefix,
        );
        const transactionCountLog4Block = await relay.provider.getTransactionCount(
          log4Block.from,
          log4Block.blockNumber,
        );

        expect(log0Block).to.exist;
        expect(log0Block).to.have.property('blockNumber');

        // nonce is zero based, so we need to subtract 1
        expect(parseInt(log0Block.nonce, 16)).to.equal(transactionCountLog0Block - 1);

        expect(log4Block).to.exist;
        expect(log4Block).to.have.property('blockNumber');

        // nonce is zero based, so we need to subtract 1
        expect(parseInt(log4Block.nonce, 16)).to.equal(transactionCountLog4Block - 1);
      });

      it('should be able to use `fromBlock` param', async () => {
        const logs = await relay.call(
          RelayCalls.ETH_ENDPOINTS.ETH_GET_LOGS,
          [
            {
              fromBlock: log0Block.blockNumber,
              address: [contractAddress, contractAddress2],
            },
          ],
          requestIdPrefix,
        );
        expect(logs.length).to.be.greaterThan(0);

        const log0BlockInt = parseInt(log0Block.blockNumber);
        for (const i in logs) {
          expect(parseInt(logs[i].blockNumber, 16)).to.be.greaterThanOrEqual(log0BlockInt);
        }
      });

      it('should not be able to use `toBlock` without `fromBlock` param if `toBlock` is not latest', async () => {
        await relay.callFailing(
          RelayCalls.ETH_ENDPOINTS.ETH_GET_LOGS,
          [
            {
              toBlock: log0Block.blockNumber,
            },
          ],
          predefined.MISSING_FROM_BLOCK_PARAM,
          requestIdPrefix,
        );
      });

      it('should be able to use range of `fromBlock` and `toBlock` params', async () => {
        const logs = await relay.call(
          RelayCalls.ETH_ENDPOINTS.ETH_GET_LOGS,
          [
            {
              fromBlock: log0Block.blockNumber,
              toBlock: log4Block.blockNumber,
              address: [contractAddress, contractAddress2],
            },
          ],
          requestIdPrefix,
        );
        expect(logs.length).to.be.greaterThan(0);

        const log0BlockInt = parseInt(log0Block.blockNumber);
        const log4BlockInt = parseInt(log4Block.blockNumber);
        for (const i in logs) {
          expect(parseInt(logs[i].blockNumber, 16)).to.be.greaterThanOrEqual(log0BlockInt);
          expect(parseInt(logs[i].blockNumber, 16)).to.be.lessThanOrEqual(log4BlockInt);
        }
      });

      it('should return empty logs if `toBlock` is not found', async () => {
        const notExistedLog = latestBlock + 99;

        const logs = await relay.call(
          RelayCalls.ETH_ENDPOINTS.ETH_GET_LOGS,
          [
            {
              fromBlock: log0Block.blockNumber,
              toBlock: `0x${notExistedLog.toString(16)}`,
              address: [contractAddress, contractAddress2],
            },
          ],
          requestIdPrefix,
        );

        expect(logs.length).to.eq(0);
      });

      it('should be able to use `address` param', async () => {
        //when we pass only address, it defaults to the latest block
        const logs = await relay.call(
          RelayCalls.ETH_ENDPOINTS.ETH_GET_LOGS,
          [
            {
              fromBlock: numberTo0x(previousBlock),
              address: contractAddress,
            },
          ],
          requestIdPrefix,
        );
        expect(logs.length).to.be.greaterThan(0);

        for (const i in logs) {
          expect(logs[i].address.toLowerCase()).to.equal(contractAddress.toLowerCase());
        }
      });

      it('should be able to use `address` param with a large block range', async () => {
        const blockRangeLimit = ConfigService.get('ETH_GET_LOGS_BLOCK_RANGE_LIMIT');
        let customBlockRangeLimit = 10;
        try {
          //when we pass only address, it defaults to the latest block
          const logs = await relay.call(
            RelayCalls.ETH_ENDPOINTS.ETH_GET_LOGS,
            [
              {
                fromBlock: numberTo0x(latestBlock - customBlockRangeLimit - 1),
                address: contractAddress,
              },
            ],
            requestIdPrefix,
          );
          expect(logs.length).to.be.greaterThan(0);

          for (const i in logs) {
            expect(logs[i].address.toLowerCase()).to.equal(contractAddress.toLowerCase());
          }
        } finally {
          customBlockRangeLimit = blockRangeLimit;
        }
      });

      it('should be able to use `address` param with multiple addresses', async () => {
        const logs = await relay.call(
          RelayCalls.ETH_ENDPOINTS.ETH_GET_LOGS,
          [
            {
              fromBlock: numberTo0x(previousBlock),
              address: [contractAddress, contractAddress2, Address.NON_EXISTING_ADDRESS],
            },
          ],
          requestIdPrefix,
        );
        expect(logs.length).to.be.greaterThan(0);
        expect(logs.length).to.be.eq(6);

        for (let i = 0; i < 5; i++) {
          expect(logs[i].address.toLowerCase()).to.equal(contractAddress.toLowerCase());
        }

        expect(logs[5].address.toLowerCase()).to.equal(contractAddress2.toLowerCase());
      });

      it('should be able to use `blockHash` param', async () => {
        const logs = await relay.call(
          RelayCalls.ETH_ENDPOINTS.ETH_GET_LOGS,
          [
            {
              blockHash: log0Block.blockHash,
              address: [contractAddress, contractAddress2],
            },
          ],
          requestIdPrefix,
        );
        expect(logs.length).to.be.greaterThan(0);

        for (const i in logs) {
          expect(logs[i].blockHash).to.equal(log0Block.blockHash);
        }
      });

      it('should return empty result for  non-existing `blockHash`', async () => {
        const logs = await relay.call(
          RelayCalls.ETH_ENDPOINTS.ETH_GET_LOGS,
          [
            {
              blockHash: Address.NON_EXISTING_BLOCK_HASH,
              address: [contractAddress, contractAddress2],
            },
          ],
          requestIdPrefix,
        );
        expect(logs).to.exist;
        expect(logs.length).to.be.eq(0);
      });

      it('should be able to use `topics` param', async () => {
        const logs = await relay.call(
          RelayCalls.ETH_ENDPOINTS.ETH_GET_LOGS,
          [
            {
              fromBlock: log0Block.blockNumber,
              toBlock: log4Block.blockNumber,
              address: [contractAddress, contractAddress2],
            },
          ],
          requestIdPrefix,
        );
        expect(logs.length).to.be.greaterThan(0);
        //using second log in array, because the first doesn't contain any topics
        const topic = logs[1].topics[0];

        const logsWithTopic = await relay.call(
          RelayCalls.ETH_ENDPOINTS.ETH_GET_LOGS,
          [
            {
              fromBlock: log0Block.blockNumber,
              toBlock: log4Block.blockNumber,
              topics: [topic],
            },
          ],
          requestIdPrefix,
        );
        expect(logsWithTopic.length).to.be.greaterThan(0);

        for (const i in logsWithTopic) {
          expect(logsWithTopic[i].topics.length).to.be.greaterThan(0);
          expect(logsWithTopic[i].topics[0]).to.be.equal(topic);
        }
      });

      it('should be able to return more than 2 logs with limit of 2 logs per request', async () => {
        //for the purpose of the test, we are settings limit to 2, and fetching all.
        //setting mirror node limit to 2 for this test only
        ConfigServiceTestHelper.dynamicOverride('MIRROR_NODE_LIMIT_PARAM', '2');

        const logs = await relay.call(
          RelayCalls.ETH_ENDPOINTS.ETH_GET_LOGS,
          [
            {
              fromBlock: numberTo0x(previousBlock),
              toBlock: numberTo0x(latestBlock),
              address: [contractAddress, contractAddress2],
            },
          ],
          requestIdPrefix,
        );

        expect(logs.length).to.eq(expectedAmountOfLogs);
      });

      it('should return empty logs if address = ZeroAddress', async () => {
        const logs = await relay.call(
          RelayCalls.ETH_ENDPOINTS.ETH_GET_LOGS,
          [
            {
              fromBlock: '0x0',
              toBlock: 'latest',
              address: ethers.ZeroAddress,
            },
          ],
          requestIdPrefix,
        );
        expect(logs.length).to.eq(0);
      });

      it('should return only logs of non-zero addresses', async () => {
        const currentBlock = Number(await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_BLOCK_NUMBER, [], requestIdPrefix));
        let blocksBehindLatest = 0;
        if (currentBlock > 10) {
          blocksBehindLatest = currentBlock - 10;
        }
        const logs = await relay.call(
          RelayCalls.ETH_ENDPOINTS.ETH_GET_LOGS,
          [
            {
              fromBlock: numberTo0x(blocksBehindLatest),
              toBlock: 'latest',
              address: [ethers.ZeroAddress, contractAddress2],
            },
          ],
          requestIdPrefix,
        );
        expect(logs.length).to.eq(1);
      });
    });

    describe('Block related RPC calls', () => {
      let mirrorBlock;
      let mirrorContractResults;
      const mirrorTransactions: any[] = [];

      before(async () => {
        mirrorBlock = (await mirrorNode.get(`/blocks?block.number=${mirrorContractDetails.block_number}`, requestId))
          .blocks[0];
        const timestampQuery = `timestamp=gte:${mirrorBlock.timestamp.from}&timestamp=lte:${mirrorBlock.timestamp.to}`;
        mirrorContractResults = (await mirrorNode.get(`/contracts/results?${timestampQuery}`, requestId)).results;

        for (const res of mirrorContractResults) {
          mirrorTransactions.push(
            await mirrorNode.get(`/contracts/${res.contract_id}/results/${res.timestamp}`, requestId),
          );
        }

        // resolve EVM address for `from` and `to`
        for (const mirrorTx of mirrorTransactions) {
          const resolvedAddresses = await resolveAccountEvmAddresses(mirrorTx);

          mirrorTx.from = resolvedAddresses.from;
          mirrorTx.to = resolvedAddresses.to;
        }
      });

      it('should execute "eth_getBlockByHash", hydrated transactions = false', async function () {
        const blockResult = await relay.call(
          RelayCalls.ETH_ENDPOINTS.ETH_GET_BLOCK_BY_HASH,
          [mirrorBlock.hash.substring(0, 66), false],
          requestIdPrefix,
        );
        Assertions.block(blockResult, mirrorBlock, mirrorTransactions, expectedGasPrice, false);
      });

      it('@release should execute "eth_getBlockByHash", hydrated transactions = true', async function () {
        const blockResult = await relay.call(
          RelayCalls.ETH_ENDPOINTS.ETH_GET_BLOCK_BY_HASH,
          [mirrorBlock.hash.substring(0, 66), true],
          requestIdPrefix,
        );
        // Remove synthetic transactions
        blockResult.transactions = blockResult.transactions.filter((transaction) => transaction.value !== '0x1234');
        Assertions.block(blockResult, mirrorBlock, mirrorTransactions, expectedGasPrice, true);
      });

      it('should execute "eth_getBlockByHash" for non-existing block hash and hydrated transactions = false', async function () {
        const blockResult = await relay.call(
          RelayCalls.ETH_ENDPOINTS.ETH_GET_BLOCK_BY_HASH,
          [Address.NON_EXISTING_BLOCK_HASH, false],
          requestIdPrefix,
        );
        expect(blockResult).to.be.null;
      });

      it('should execute "eth_getBlockByHash" for non-existing block hash and hydrated transactions = true', async function () {
        const blockResult = await relay.call(
          RelayCalls.ETH_ENDPOINTS.ETH_GET_BLOCK_BY_HASH,
          [Address.NON_EXISTING_BLOCK_HASH, true],
          requestIdPrefix,
        );
        expect(blockResult).to.be.null;
      });

      it('should execute "eth_getBlockByNumber", hydrated transactions = false', async function () {
        const blockResult = await relay.call(
          RelayCalls.ETH_ENDPOINTS.ETH_GET_BLOCK_BY_NUMBER,
          [numberTo0x(mirrorBlock.number), false],
          requestIdPrefix,
        );
        // Remove synthetic transactions
        blockResult.transactions = blockResult.transactions.filter((transaction) => transaction.value !== '0x1234');
        Assertions.block(blockResult, mirrorBlock, mirrorTransactions, expectedGasPrice, false);
      });

      it('should not cache "latest" block in "eth_getBlockByNumber" ', async function () {
        const blockResult = await relay.call(
          RelayCalls.ETH_ENDPOINTS.ETH_GET_BLOCK_BY_NUMBER,
          ['latest', false],
          requestIdPrefix,
        );
        await Utils.wait(1000);

        const blockResult2 = await relay.call(
          RelayCalls.ETH_ENDPOINTS.ETH_GET_BLOCK_BY_NUMBER,
          ['latest', false],
          requestIdPrefix,
        );
        expect(blockResult).to.not.deep.equal(blockResult2);
      });

      it('should not cache "finalized" block in "eth_getBlockByNumber" ', async function () {
        const blockResult = await relay.call(
          RelayCalls.ETH_ENDPOINTS.ETH_GET_BLOCK_BY_NUMBER,
          ['finalized', false],
          requestIdPrefix,
        );
        await Utils.wait(1000);

        const blockResult2 = await relay.call(
          RelayCalls.ETH_ENDPOINTS.ETH_GET_BLOCK_BY_NUMBER,
          ['finalized', false],
          requestIdPrefix,
        );
        expect(blockResult).to.not.deep.equal(blockResult2);
      });

      it('should not cache "safe" block in "eth_getBlockByNumber" ', async function () {
        const blockResult = await relay.call(
          RelayCalls.ETH_ENDPOINTS.ETH_GET_BLOCK_BY_NUMBER,
          ['safe', false],
          requestIdPrefix,
        );
        await Utils.wait(1000);

        const blockResult2 = await relay.call(
          RelayCalls.ETH_ENDPOINTS.ETH_GET_BLOCK_BY_NUMBER,
          ['safe', false],
          requestIdPrefix,
        );
        expect(blockResult).to.not.deep.equal(blockResult2);
      });

      it('should not cache "pending" block in "eth_getBlockByNumber" ', async function () {
        const blockResult = await relay.call(
          RelayCalls.ETH_ENDPOINTS.ETH_GET_BLOCK_BY_NUMBER,
          ['pending', false],
          requestIdPrefix,
        );
        await Utils.wait(1000);

        const blockResult2 = await relay.call(
          RelayCalls.ETH_ENDPOINTS.ETH_GET_BLOCK_BY_NUMBER,
          ['pending', false],
          requestIdPrefix,
        );
        expect(blockResult).to.not.deep.equal(blockResult2);
      });

      it('@release should execute "eth_getBlockByNumber", hydrated transactions = true', async function () {
        const blockResult = await relay.call(
          RelayCalls.ETH_ENDPOINTS.ETH_GET_BLOCK_BY_NUMBER,
          [numberTo0x(mirrorBlock.number), true],
          requestIdPrefix,
        );
        // Remove synthetic transactions
        blockResult.transactions = blockResult.transactions.filter((transaction) => transaction.value !== '0x1234');
        Assertions.block(blockResult, mirrorBlock, mirrorTransactions, expectedGasPrice, true);
      });

      it('should execute "eth_getBlockByNumber" for non existing block number and hydrated transactions = true', async function () {
        const blockResult = await relay.call(
          RelayCalls.ETH_ENDPOINTS.ETH_GET_BLOCK_BY_NUMBER,
          [Address.NON_EXISTING_BLOCK_NUMBER, true],
          requestIdPrefix,
        );
        expect(blockResult).to.be.null;
      });

      it('should execute "eth_getBlockByNumber" for non existing block number and hydrated transactions = false', async function () {
        const blockResult = await relay.call(
          RelayCalls.ETH_ENDPOINTS.ETH_GET_BLOCK_BY_NUMBER,
          [Address.NON_EXISTING_BLOCK_NUMBER, false],
          requestIdPrefix,
        );
        expect(blockResult).to.be.null;
      });

      it('@release should execute "eth_getBlockTransactionCountByNumber"', async function () {
        const res = await relay.call(
          RelayCalls.ETH_ENDPOINTS.ETH_GET_BLOCK_TRANSACTION_COUNT_BY_NUMBER,
          [numberTo0x(mirrorBlock.number)],
          requestIdPrefix,
        );
        expect(res).to.be.equal(ethers.toQuantity(mirrorBlock.count));
      });

      it('should execute "eth_getBlockTransactionCountByNumber" for non-existing block number', async function () {
        const res = await relay.call(
          RelayCalls.ETH_ENDPOINTS.ETH_GET_BLOCK_TRANSACTION_COUNT_BY_NUMBER,
          [Address.NON_EXISTING_BLOCK_NUMBER],
          requestIdPrefix,
        );
        expect(res).to.be.null;
      });

      it('@release should execute "eth_getBlockTransactionCountByHash"', async function () {
        const res = await relay.call(
          RelayCalls.ETH_ENDPOINTS.ETH_GET_BLOCK_TRANSACTION_COUNT_BY_HASH,
          [mirrorBlock.hash.substring(0, 66)],
          requestIdPrefix,
        );
        expect(res).to.be.equal(ethers.toQuantity(mirrorBlock.count));
      });

      it('should execute "eth_getBlockTransactionCountByHash" for non-existing block hash', async function () {
        const res = await relay.call(
          RelayCalls.ETH_ENDPOINTS.ETH_GET_BLOCK_TRANSACTION_COUNT_BY_HASH,
          [Address.NON_EXISTING_BLOCK_HASH],
          requestIdPrefix,
        );
        expect(res).to.be.null;
      });

      it('should execute "eth_getBlockTransactionCountByNumber"', async function () {
        it('@release should execute "eth_blockNumber"', async function () {
          const mirrorBlocks = await mirrorNode.get(`blocks`, requestId);
          expect(mirrorBlocks).to.have.property('blocks');
          expect(mirrorBlocks.blocks.length).to.gt(0);
          const mirrorBlockNumber = mirrorBlocks.blocks[0].number;

          const res = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_BLOCK_NUMBER, [], requestIdPrefix);
          const blockNumber = Number(res);
          expect(blockNumber).to.exist;

          // In some rare occasions, the relay block might be equal to the mirror node block + 1
          // due to the mirror node block updating after it was retrieved and before the relay.call completes
          expect(blockNumber).to.be.oneOf([mirrorBlockNumber, mirrorBlockNumber + 1]);
        });
      });

      it('should execute "eth_getBlockByNumber", hydrated transactions = true for a block that contains a call with CONTRACT_NEGATIVE_VALUE status', async function () {
        let transactionId;
        let hasContractNegativeValueError = false;
        try {
          await servicesNode.executeContractCallWithAmount(
            mirrorContractDetails.contract_id,
            '',
            new ContractFunctionParameters(),
            500_000,
            -100,
            requestId,
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
          requestId,
        );
        const txHash = mirrorResult.hash;
        const blockResult = await relay.call(
          RelayCalls.ETH_ENDPOINTS.ETH_GET_BLOCK_BY_NUMBER,
          [numberTo0x(mirrorResult.block_number), true],
          requestIdPrefix,
        );
        expect(blockResult.transactions).to.not.be.empty;
        expect(blockResult.transactions.map((tx) => tx.hash)).to.contain(txHash);
        expect(blockResult.transactions.filter((tx) => tx.hash == txHash)[0].value).to.equal('0xffffffffffffff9c');
      });

      it('should execute "eth_getBlockReceipts" with block hash successfully', async function () {
        const res = await relay.call(
          RelayCalls.ETH_ENDPOINTS.ETH_GET_BLOCK_RECEIPTS,
          [{ blockHash: mirrorBlock.hash.substring(0, 66) }],
          requestIdPrefix,
        );

        expect(res).to.have.length(1);
        expect(res[0]).to.have.property('blockHash');
        expect(res[0].blockHash).to.equal(mirrorBlock.hash.substring(0, 66));
        expect(res[0]).to.have.property('status');
        expect(res[0].status).to.equal('0x1');
        expect(res[0]).to.have.property('transactionHash');
        expect(res[0].transactionHash).to.equal(createChildTx.hash);
      });

      it('should execute "eth_getBlockReceipts" with block number successfully', async function () {
        const res = await relay.call(
          RelayCalls.ETH_ENDPOINTS.ETH_GET_BLOCK_RECEIPTS,
          [numberTo0x(mirrorBlock.number)],
          requestIdPrefix,
        );

        expect(res).to.have.length(1);
        expect(res[0]).to.have.property('blockHash');
        expect(res[0].blockHash).to.equal(mirrorBlock.hash.substring(0, 66));
        expect(res[0]).to.have.property('status');
        expect(res[0].status).to.equal('0x1');
        expect(res[0]).to.have.property('transactionHash');
        expect(res[0].transactionHash).to.equal(createChildTx.hash);
      });

      it('should execute "eth_getBlockReceipts" with tag "earliest" successfully', async function () {
        const res = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_GET_BLOCK_RECEIPTS, ['earliest'], requestIdPrefix);

        expect(res).to.have.length(0);
      });

      it('should execute "eth_getBlockReceipts" with tag "latest" successfully', async function () {
        const res = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_GET_BLOCK_RECEIPTS, ['latest'], requestIdPrefix);

        expect(res).to.have.length(0);
      });

      it('should throw error on "eth_getBlockReceipts" with invalid parameter passed', async function () {
        const error = predefined.INVALID_PARAMETER(0, BLOCK_PARAMS_ERROR);
        Assertions.assertPredefinedRpcError(error, relay.call, true, relay, [
          RelayCalls.ETH_ENDPOINTS.ETH_GET_BLOCK_RECEIPTS,
          ['0x', requestIdPrefix],
        ]);
      });
    });

    describe('Transaction related RPC Calls', () => {
      const defaultGasPrice = numberTo0x(Assertions.defaultGasPrice);
      const defaultGasLimit = numberTo0x(3_000_000);
      const defaultLegacyTransactionData = {
        value: ONE_TINYBAR,
        gasPrice: defaultGasPrice,
        gasLimit: defaultGasLimit,
      };

      const default155TransactionData = {
        ...defaultLegacyTransactionData,
        chainId: Number(CHAIN_ID),
      };

      const defaultLondonTransactionData = {
        value: ONE_TINYBAR,
        chainId: Number(CHAIN_ID),
        maxPriorityFeePerGas: defaultGasPrice,
        maxFeePerGas: defaultGasPrice,
        gasLimit: defaultGasLimit,
        type: 2,
      };

      const defaultLegacy2930TransactionData = {
        value: ONE_TINYBAR,
        chainId: Number(CHAIN_ID),
        gasPrice: defaultGasPrice,
        gasLimit: defaultGasLimit,
        type: 1,
      };

      it('@release should execute "eth_getTransactionByBlockHashAndIndex"', async function () {
        const response = await relay.call(
          RelayCalls.ETH_ENDPOINTS.ETH_GET_TRANSACTION_BY_BLOCK_HASH_AND_INDEX,
          [mirrorContractDetails.block_hash.substring(0, 66), numberTo0x(mirrorContractDetails.transaction_index)],
          requestIdPrefix,
        );
        Assertions.transaction(response, mirrorContractDetails);
      });

      it('should execute "eth_getTransactionByBlockHashAndIndex" for invalid block hash', async function () {
        const response = await relay.call(
          RelayCalls.ETH_ENDPOINTS.ETH_GET_TRANSACTION_BY_BLOCK_HASH_AND_INDEX,
          [Address.NON_EXISTING_BLOCK_HASH, numberTo0x(mirrorContractDetails.transaction_index)],
          requestIdPrefix,
        );
        expect(response).to.be.null;
      });

      it('should execute "eth_getTransactionByBlockHashAndIndex" for invalid index', async function () {
        const response = await relay.call(
          RelayCalls.ETH_ENDPOINTS.ETH_GET_TRANSACTION_BY_BLOCK_HASH_AND_INDEX,
          [mirrorContractDetails.block_hash.substring(0, 66), Address.NON_EXISTING_INDEX],
          requestIdPrefix,
        );
        expect(response).to.be.null;
      });

      it('@release should execute "eth_getTransactionByBlockNumberAndIndex"', async function () {
        const response = await relay.call(
          RelayCalls.ETH_ENDPOINTS.ETH_GET_TRANSACTION_BY_BLOCK_NUMBER_AND_INDEX,
          [numberTo0x(mirrorContractDetails.block_number), numberTo0x(mirrorContractDetails.transaction_index)],
          requestIdPrefix,
        );
        Assertions.transaction(response, mirrorContractDetails);
      });

      it('should execute "eth_getTransactionByBlockNumberAndIndex" for invalid index', async function () {
        const response = await relay.call(
          RelayCalls.ETH_ENDPOINTS.ETH_GET_TRANSACTION_BY_BLOCK_NUMBER_AND_INDEX,
          [numberTo0x(mirrorContractDetails.block_number), Address.NON_EXISTING_INDEX],
          requestIdPrefix,
        );
        expect(response).to.be.null;
      });

      it('should execute "eth_getTransactionByBlockNumberAndIndex" for non-exising block number', async function () {
        const response = await relay.call(
          RelayCalls.ETH_ENDPOINTS.ETH_GET_TRANSACTION_BY_BLOCK_NUMBER_AND_INDEX,
          [Address.NON_EXISTING_BLOCK_NUMBER, numberTo0x(mirrorContractDetails.transaction_index)],
          requestIdPrefix,
        );
        expect(response).to.be.null;
      });

      it('@release-light, @release should execute "eth_getTransactionReceipt" for hash of legacy transaction', async function () {
        const gasPriceWithDeviation = await getGasWithDeviation(relay, requestDetails, gasPriceDeviation);
        const transaction = {
          ...default155TransactionData,
          to: parentContractAddress,
          nonce: await relay.getAccountNonce(accounts[2].address, requestId),
          gasPrice: gasPriceWithDeviation,
          type: 0,
        };

        const signedTx = await accounts[2].wallet.signTransaction(transaction);
        const legacyTxHash = await relay.sendRawTransaction(signedTx, requestId);
        // Since the transactionId is not available in this context
        // Wait for the transaction to be processed and imported in the mirror node with axios-retry
        const mirrorResult = await mirrorNode.get(`/contracts/results/${legacyTxHash}`, requestId);
        mirrorResult.from = accounts[2].wallet.address;
        mirrorResult.to = parentContractAddress;

        const res = await relay.call(
          RelayCalls.ETH_ENDPOINTS.ETH_GET_TRANSACTION_RECEIPT,
          [legacyTxHash],
          requestIdPrefix,
        );
        const currentPrice = await relay.gasPrice(requestId);

        Assertions.transactionReceipt(res, mirrorResult, currentPrice);
      });

      it('@release-light, @release should execute "eth_getTransactionReceipt" for hash of London transaction', async function () {
        const gasPriceWithDeviation = await getGasWithDeviation(relay, requestDetails, gasPriceDeviation);
        const transaction = {
          ...defaultLondonTransactionData,
          to: parentContractAddress,
          nonce: await relay.getAccountNonce(accounts[2].address, requestId),
          maxFeePerGas: gasPriceWithDeviation,
          maxPriorityFeePerGas: gasPriceWithDeviation,
        };

        const signedTx = await accounts[2].wallet.signTransaction(transaction);
        const transactionHash = await relay.sendRawTransaction(signedTx, requestId);
        // Since the transactionId is not available in this context
        // Wait for the transaction to be processed and imported in the mirror node with axios-retry
        const mirrorResult = await mirrorNode.get(`/contracts/results/${transactionHash}`, requestId);
        mirrorResult.from = accounts[2].wallet.address;
        mirrorResult.to = parentContractAddress;

        const res = await relay.call(
          RelayCalls.ETH_ENDPOINTS.ETH_GET_TRANSACTION_RECEIPT,
          [transactionHash],
          requestIdPrefix,
        );
        const currentPrice = await relay.gasPrice(requestId);

        Assertions.transactionReceipt(res, mirrorResult, currentPrice);
      });

      it('@release-light, @release should execute "eth_getTransactionReceipt" for hash of 2930 transaction', async function () {
        const gasPriceWithDeviation = await getGasWithDeviation(relay, requestDetails, gasPriceDeviation);
        const transaction = {
          ...defaultLegacy2930TransactionData,
          to: parentContractAddress,
          nonce: await relay.getAccountNonce(accounts[2].address, requestId),
          gasPrice: gasPriceWithDeviation,
        };

        const signedTx = await accounts[2].wallet.signTransaction(transaction);
        const transactionHash = await relay.sendRawTransaction(signedTx, requestId);
        // Since the transactionId is not available in this context
        // Wait for the transaction to be processed and imported in the mirror node with axios-retry
        const mirrorResult = await mirrorNode.get(`/contracts/results/${transactionHash}`, requestId);
        mirrorResult.from = accounts[2].wallet.address;
        mirrorResult.to = parentContractAddress;

        const res = await relay.call(
          RelayCalls.ETH_ENDPOINTS.ETH_GET_TRANSACTION_RECEIPT,
          [transactionHash],
          requestIdPrefix,
        );
        const currentPrice = await relay.gasPrice(requestId);

        Assertions.transactionReceipt(res, mirrorResult, currentPrice);
      });

      it('@release should fail to execute "eth_getTransactionReceipt" for hash of London transaction', async function () {
        const gasPrice = await relay.gasPrice(requestId);
        const transaction = {
          ...defaultLondonTransactionData,
          to: parentContractAddress,
          nonce: await relay.getAccountNonce(accounts[2].address, requestId),
          maxFeePerGas: gasPrice,
          maxPriorityFeePerGas: gasPrice,
        };

        const signedTx = await accounts[2].wallet.signTransaction(transaction);
        const error = predefined.INTERNAL_ERROR();

        await Assertions.assertPredefinedRpcError(error, sendRawTransaction, false, relay, [
          signedTx + '11',
          requestDetails,
        ]);
      });

      it('@release should return the right "effectiveGasPrice" for SYNTHETIC HTS transaction', async function () {
        const tokenId = await servicesNode.createToken(1000, requestId);
        await accounts[2].client.associateToken(tokenId, requestId);
        const currentPrice = await relay.gasPrice(requestId);
        const transaction = new TransferTransaction()
          .addTokenTransfer(tokenId, servicesNode._thisAccountId(), -10)
          .addTokenTransfer(tokenId, accounts[2].accountId, 10)
          .setTransactionMemo('Relay test token transfer');
        const resp = await transaction.execute(servicesNode.client);
        await resp.getRecord(servicesNode.client);
        await Utils.wait(1000);
        const logsRes = await mirrorNode.get(`/contracts/results/logs?limit=1`, requestId);
        const blockNumber = logsRes.logs[0].block_number;
        const formattedBlockNumber = prepend0x(blockNumber.toString(16));
        const contractId = logsRes.logs[0].contract_id;
        const transactionHash = logsRes.logs[0].transaction_hash;
        if (contractId !== tokenId.toString()) {
          return;
        }

        // load the block in cache
        await relay.call(
          RelayCalls.ETH_ENDPOINTS.ETH_GET_BLOCK_BY_NUMBER,
          [formattedBlockNumber, true],
          requestIdPrefix,
        );
        const receiptFromRelay = await relay.call(
          RelayCalls.ETH_ENDPOINTS.ETH_GET_TRANSACTION_RECEIPT,
          [transactionHash],
          requestIdPrefix,
        );

        // handle deviation in gas price
        expect(parseInt(receiptFromRelay.effectiveGasPrice)).to.be.lessThan(currentPrice * (1 + gasPriceDeviation));
        expect(parseInt(receiptFromRelay.effectiveGasPrice)).to.be.greaterThan(currentPrice * (1 - gasPriceDeviation));
      });

      it('@release should return the right "effectiveGasPrice" for SYNTHETIC Contract Call transaction', async function () {
        const currentPrice = await relay.gasPrice(requestId);
        const transactionHash = mirrorContractDetails.hash;
        const formattedBlockNumber = prepend0x(mirrorContractDetails.block_number.toString(16));

        // load the block in cache
        await relay.call(
          RelayCalls.ETH_ENDPOINTS.ETH_GET_BLOCK_BY_NUMBER,
          [formattedBlockNumber, true],
          requestIdPrefix,
        );
        const receiptFromRelay = await relay.call(
          RelayCalls.ETH_ENDPOINTS.ETH_GET_TRANSACTION_RECEIPT,
          [transactionHash],
          requestIdPrefix,
        );

        // handle deviation in gas price
        expect(parseInt(receiptFromRelay.effectiveGasPrice)).to.be.lessThan(currentPrice * (1 + gasPriceDeviation));
        expect(parseInt(receiptFromRelay.effectiveGasPrice)).to.be.greaterThan(currentPrice * (1 - gasPriceDeviation));
      });

      it('should execute "eth_getTransactionReceipt" for non-existing hash', async function () {
        const res = await relay.call(
          RelayCalls.ETH_ENDPOINTS.ETH_GET_TRANSACTION_RECEIPT,
          [Address.NON_EXISTING_TX_HASH],
          requestIdPrefix,
        );
        expect(res).to.be.null;
      });

      it('should fail "eth_sendRawTransaction" for transaction with incorrect chain_id', async function () {
        const transaction = {
          ...default155TransactionData,
          to: parentContractAddress,
          nonce: await relay.getAccountNonce(accounts[2].address, requestId),
          chainId: INCORRECT_CHAIN_ID,
        };
        const signedTx = await accounts[2].wallet.signTransaction(transaction);
        const error = predefined.UNSUPPORTED_CHAIN_ID(ethers.toQuantity(INCORRECT_CHAIN_ID), CHAIN_ID);

        await Assertions.assertPredefinedRpcError(error, sendRawTransaction, true, relay, [signedTx, requestDetails]);
      });

      it('should execute "eth_sendRawTransaction" for deterministic deployment transaction', async function () {
        // send gas money to the proxy deployer
        const sendHbarTx = {
          ...defaultLegacyTransactionData,
          value: TEN_HBAR, // 10hbar - the gasPrice to deploy the deterministic proxy contract
          to: Constants.DETERMINISTIC_DEPLOYMENT_SIGNER,
          nonce: await relay.getAccountNonce(accounts[0].address, requestId),
          gasPrice: await relay.gasPrice(requestId),
        };
        const signedSendHbarTx = await accounts[0].wallet.signTransaction(sendHbarTx);
        await relay.sendRawTransaction(signedSendHbarTx, requestId);
        await Utils.wait(5000); // wait for signer's account to propagate accross the network
        const deployerBalance = await global.relay.getBalance(Constants.DETERMINISTIC_DEPLOYMENT_SIGNER, 'latest');
        expect(deployerBalance).to.not.eq(0);

        // @logic: since the DETERMINISTIC_DEPLOYER_TRANSACTION is a deterministic transaction hash which is signed
        //          by the DETERMINISTIC_DEPLOYMENT_SIGNER with tx.nonce = 0. With that reason, if the current nonce of the signer
        //          is not 0, it means the DETERMINISTIC_DEPLOYER_TRANSACTION has already been submitted, and the DETERMINISTIC_PROXY_CONTRACT
        //          has already been deployed to the network. Therefore, it only matters to test this flow once.
        const signerNonce = await relay.getAccountNonce(Constants.DETERMINISTIC_DEPLOYMENT_SIGNER, requestId);

        if (signerNonce === 0) {
          const deployerBalance = await relay.getBalance(
            Constants.DETERMINISTIC_DEPLOYMENT_SIGNER,
            'latest',
            requestId,
          );
          expect(deployerBalance).to.not.eq(0);

          // send transaction to deploy proxy transaction
          const deterministicDeployTransactionHash = await relay.sendRawTransaction(
            Constants.DETERMINISTIC_DEPLOYER_TRANSACTION,
            requestId,
          );

          const receipt = await mirrorNode.get(`/contracts/results/${deterministicDeployTransactionHash}`, requestId);
          const fromAccountInfo = await global.mirrorNode.get(`/accounts/${receipt.from}`, requestId);
          const toAccountInfo = await global.mirrorNode.get(`/accounts/${receipt.to}`, requestId);

          expect(receipt).to.exist;
          expect(fromAccountInfo.evm_address).to.eq(Constants.DETERMINISTIC_DEPLOYMENT_SIGNER);
          expect(toAccountInfo.evm_address).to.eq(Constants.DETERMINISTIC_PROXY_CONTRACT);
          expect(receipt.address).to.eq(Constants.DETERMINISTIC_PROXY_CONTRACT);
        } else {
          try {
            await relay.sendRawTransaction(Constants.DETERMINISTIC_DEPLOYER_TRANSACTION, requestId);
            expect(true).to.be.false;
          } catch (error: any) {
            const expectedNonceTooLowError = predefined.NONCE_TOO_LOW(0, signerNonce);
            const errObj = JSON.parse(error.info.responseBody).error;
            expect(errObj.code).to.eq(expectedNonceTooLowError.code);
            expect(errObj.message).to.contain(expectedNonceTooLowError.message);
          }
        }
      });

      it('@release-light, @release should execute "eth_sendRawTransaction" for legacy EIP 155 transactions', async function () {
        const receiverInitialBalance = await relay.getBalance(parentContractAddress, 'latest', requestDetails);
        const gasPriceWithDeviation = await getGasWithDeviation(relay, requestDetails, gasPriceDeviation);
        const transaction = {
          ...default155TransactionData,
          to: parentContractAddress,
          nonce: await relay.getAccountNonce(accounts[2].address, requestId),
          gasPrice: gasPriceWithDeviation,
        };
        const signedTx = await accounts[2].wallet.signTransaction(transaction);
        const transactionHash = await relay.sendRawTransaction(signedTx, requestId);
        // Since the transactionId is not available in this context
        // Wait for the transaction to be processed and imported in the mirror node with axios-retry
        await Utils.wait(5000);
        await mirrorNode.get(`/contracts/results/${transactionHash}`, requestId);

        const receiverEndBalance = await relay.getBalance(parentContractAddress, 'latest', requestId);
        const balanceChange = receiverEndBalance - receiverInitialBalance;
        expect(balanceChange.toString()).to.eq(Number(ONE_TINYBAR).toString());
      });

      it('should fail "eth_sendRawTransaction" for legacy EIP 155 transactions (with insufficient balance)', async function () {
        const balanceInWeiBars = await relay.getBalance(account2Address, 'latest', requestId);
        const transaction = {
          ...default155TransactionData,
          to: parentContractAddress,
          value: balanceInWeiBars,
          nonce: await relay.getAccountNonce(accounts[2].address, requestId),
          gasPrice: await relay.gasPrice(requestId),
        };
        const signedTx = await accounts[2].wallet.signTransaction(transaction);
        const error = predefined.INSUFFICIENT_ACCOUNT_BALANCE;

        await Assertions.assertPredefinedRpcError(error, sendRawTransaction, true, relay, [signedTx, requestDetails]);
      });

      it('should execute "eth_sendRawTransaction" for legacy transactions (with no chainId i.e. chainId=0x0)', async function () {
        const receiverInitialBalance = await relay.getBalance(parentContractAddress, 'latest', requestId);
        const transaction = {
          ...defaultLegacyTransactionData,
          to: parentContractAddress,
          nonce: await relay.getAccountNonce(accounts[2].address, requestId),
          gasPrice: await relay.gasPrice(requestId),
        };
        const signedTx = await accounts[2].wallet.signTransaction(transaction);
        const transactionHash = await relay.sendRawTransaction(signedTx, requestId);
        // Since the transactionId is not available in this context
        // Wait for the transaction to be processed and imported in the mirror node with axios-retry
        await Utils.wait(5000);
        await mirrorNode.get(`/contracts/results/${transactionHash}`, requestId);

        const receiverEndBalance = await relay.getBalance(parentContractAddress, 'latest', requestId);
        const balanceChange = receiverEndBalance - receiverInitialBalance;
        expect(balanceChange.toString()).to.eq(Number(ONE_TINYBAR).toString());
      });

      it('should return transaction result with no chainId field for legacy EIP155 transactions  (with no chainId i.e. chainId=0x0)', async function () {
        const transaction = {
          ...defaultLegacyTransactionData,
          to: parentContractAddress,
          nonce: await relay.getAccountNonce(accounts[1].address, requestId),
          gasPrice: await relay.gasPrice(requestId),
        };
        const signedTx = await accounts[1].wallet.signTransaction(transaction);
        const transactionHash = await relay.sendRawTransaction(signedTx, requestId);
        const transactionResult = await relay.pollForValidTransactionReceipt(transactionHash);

        const result = Object.prototype.hasOwnProperty.call(transactionResult, 'chainId');
        expect(result).to.be.false;
      });

      it('should fail "eth_sendRawTransaction" for Legacy transactions (with gas price too low)', async function () {
        const transaction = {
          ...defaultLegacyTransactionData,
          chainId: Number(CHAIN_ID),
          gasPrice: GAS_PRICE_TOO_LOW,
          to: parentContractAddress,
          nonce: await relay.getAccountNonce(accounts[2].address, requestId),
        };
        const signedTx = await accounts[2].wallet.signTransaction(transaction);
        const error = predefined.GAS_PRICE_TOO_LOW(GAS_PRICE_TOO_LOW, GAS_PRICE_REF);

        await Assertions.assertPredefinedRpcError(error, sendRawTransaction, false, relay, [signedTx, requestDetails]);
      });

      it('should not fail "eth_sendRawTransactxion" for Legacy 2930 transactions', async function () {
        const transaction = {
          ...defaultLegacy2930TransactionData,
          to: parentContractAddress,
          nonce: await relay.getAccountNonce(accounts[2].address, requestId),
          gasPrice: await relay.gasPrice(requestId),
        };
        const signedTx = await accounts[2].wallet.signTransaction(transaction);
        const transactionHash = await relay.sendRawTransaction(signedTx, requestId);
        const info = await mirrorNode.get(`/contracts/results/${transactionHash}`, requestId);
        expect(info).to.exist;
        expect(info.result).to.equal('SUCCESS');
      });

      it('should fail "eth_sendRawTransaction" for Legacy 2930 transactions (with gas price too low)', async function () {
        const transaction = {
          ...defaultLegacy2930TransactionData,
          gasPrice: GAS_PRICE_TOO_LOW,
          to: parentContractAddress,
          nonce: await relay.getAccountNonce(accounts[2].address, requestId),
        };
        const signedTx = await accounts[2].wallet.signTransaction(transaction);
        const error = predefined.GAS_PRICE_TOO_LOW(GAS_PRICE_TOO_LOW, GAS_PRICE_REF);

        await Assertions.assertPredefinedRpcError(error, sendRawTransaction, false, relay, [signedTx, requestDetails]);
      });

      it('should fail "eth_sendRawTransaction" for Legacy 2930 transactions (with insufficient balance)', async function () {
        const balanceInWeiBars = await relay.getBalance(account2Address, 'latest', requestId);
        const transaction = {
          ...defaultLegacy2930TransactionData,
          value: balanceInWeiBars,
          to: parentContractAddress,
          nonce: await relay.getAccountNonce(accounts[2].address, requestId),
          gasPrice: await relay.gasPrice(requestId),
        };
        const signedTx = await accounts[2].wallet.signTransaction(transaction);
        const error = predefined.INSUFFICIENT_ACCOUNT_BALANCE;

        await Assertions.assertPredefinedRpcError(error, sendRawTransaction, true, relay, [signedTx, requestDetails]);
      });

      it('should fail "eth_sendRawTransaction" for London transactions (with gas price too low)', async function () {
        const transaction = {
          ...defaultLondonTransactionData,
          maxPriorityFeePerGas: GAS_PRICE_TOO_LOW,
          maxFeePerGas: GAS_PRICE_TOO_LOW,
          to: parentContractAddress,
          nonce: await relay.getAccountNonce(accounts[2].address, requestId),
        };
        const signedTx = await accounts[2].wallet.signTransaction(transaction);
        const error = predefined.GAS_PRICE_TOO_LOW(GAS_PRICE_TOO_LOW, GAS_PRICE_REF);

        await Assertions.assertPredefinedRpcError(error, sendRawTransaction, false, relay, [signedTx, requestDetails]);
      });

      it('should fail "eth_sendRawTransaction" for London transactions (with insufficient balance)', async function () {
        const balanceInWeiBars = await relay.getBalance(account2Address, 'latest', requestId);
        const gasPrice = await relay.gasPrice(requestId);

        const transaction = {
          ...defaultLondonTransactionData,
          value: balanceInWeiBars,
          to: parentContractAddress,
          nonce: await relay.getAccountNonce(accounts[2].address, requestId),
          maxPriorityFeePerGas: gasPrice,
          maxFeePerGas: gasPrice,
        };
        const signedTx = await accounts[2].wallet.signTransaction(transaction);
        const error = predefined.INSUFFICIENT_ACCOUNT_BALANCE;

        await Assertions.assertPredefinedRpcError(error, sendRawTransaction, true, relay, [signedTx, requestDetails]);
      });

      it('should execute "eth_sendRawTransaction" for London transactions', async function () {
        const receiverInitialBalance = await relay.getBalance(parentContractAddress, 'latest', requestId);
        const gasPrice = await relay.gasPrice(requestId);

        const transaction = {
          ...defaultLondonTransactionData,
          to: parentContractAddress,
          nonce: await relay.getAccountNonce(accounts[2].address, requestId),
          maxPriorityFeePerGas: gasPrice,
          maxFeePerGas: gasPrice,
        };
        const signedTx = await accounts[2].wallet.signTransaction(transaction);
        const transactionHash = await relay.sendRawTransaction(signedTx, requestId);

        // Since the transactionId is not available in this context
        // Wait for the transaction to be processed and imported in the mirror node with axios-retry
        await Utils.wait(5000);

        await mirrorNode.get(`/contracts/results/${transactionHash}`, requestId);
        const receiverEndBalance = await relay.getBalance(parentContractAddress, 'latest', requestId);
        const balanceChange = receiverEndBalance - receiverInitialBalance;
        expect(balanceChange.toString()).to.eq(Number(ONE_TINYBAR).toString());
      });

      it('should execute "eth_sendRawTransaction" and deploy a large contract', async function () {
        const gasPrice = await relay.gasPrice(requestId);
        const transaction = {
          type: 2,
          chainId: Number(CHAIN_ID),
          nonce: await relay.getAccountNonce(accounts[2].address, requestId),
          maxPriorityFeePerGas: gasPrice,
          maxFeePerGas: gasPrice,
          gasLimit: defaultGasLimit,
          data: '0x' + '00'.repeat(5121),
        };

        const signedTx = await accounts[2].wallet.signTransaction(transaction);
        const transactionHash = await relay.sendRawTransaction(signedTx, requestId);
        const info = await mirrorNode.get(`/contracts/results/${transactionHash}`, requestId);
        expect(info).to.have.property('contract_id');
        expect(info.contract_id).to.not.be.null;
        expect(info).to.have.property('created_contract_ids');
        expect(info.created_contract_ids.length).to.be.equal(1);
      });

      // note: according to this ticket https://github.com/hashgraph/hedera-json-rpc-relay/issues/2563,
      //      if calldata's size fails into the range of [2568 bytes, 5217 bytes], the request fails and throw
      //      `Null Entity ID` error. This unit test makes sure that with the new fix, requests should work with all case scenarios.
      it('should execute "eth_sendRawTransaction" and deploy a contract with any arbitrary calldata size', async () => {
        const gasPrice = await relay.gasPrice(requestId);

        const randomBytes = [2566, 2568, 3600, 5217, 7200];

        for (const bytes of randomBytes) {
          const transaction = {
            type: 2,
            chainId: Number(CHAIN_ID),
            nonce: await relay.getAccountNonce(accounts[0].address, requestId),
            maxPriorityFeePerGas: gasPrice,
            maxFeePerGas: gasPrice,
            gasLimit: defaultGasLimit,
            data: '0x' + '00'.repeat(bytes),
          };
          const signedTx = await accounts[0].wallet.signTransaction(transaction);
          const transactionHash = await relay.sendRawTransaction(signedTx, requestId);
          const info = await mirrorNode.get(`/contracts/results/${transactionHash}`, requestId);
          expect(info).to.have.property('contract_id');
          expect(info.contract_id).to.not.be.null;
          expect(info).to.have.property('created_contract_ids');
          expect(info.created_contract_ids.length).to.be.equal(1);
          await new Promise((r) => setTimeout(r, 3000));
        }
      });

      it('should delete the file created while execute "eth_sendRawTransaction" to deploy a large contract', async function () {
        const gasPrice = await relay.gasPrice(requestId);
        const transaction = {
          type: 2,
          chainId: Number(CHAIN_ID),
          nonce: await relay.getAccountNonce(accounts[2].address, requestId),
          maxPriorityFeePerGas: gasPrice,
          maxFeePerGas: gasPrice,
          gasLimit: defaultGasLimit,
          data: '0x' + '00'.repeat(5121),
        };

        const signedTx = await accounts[2].wallet.signTransaction(transaction);
        const transactionHash = await relay.sendRawTransaction(signedTx, requestId);

        await Utils.wait(1000);
        const txInfo = await mirrorNode.get(`/contracts/results/${transactionHash}`, requestId);

        const contractResult = await mirrorNode.get(`/contracts/${txInfo.contract_id}`, requestId);
        const fileInfo = await new FileInfoQuery().setFileId(contractResult.file_id).execute(servicesNode.client);
        expect(fileInfo).to.exist;
        expect(fileInfo instanceof FileInfo).to.be.true;
        expect(fileInfo.isDeleted).to.be.true;
        expect(fileInfo.size.toNumber()).to.eq(0);
      });

      it('should execute "eth_sendRawTransaction" and fail when deploying too large contract', async function () {
        const gasPrice = await relay.gasPrice(requestId);
        const transaction = {
          type: 2,
          chainId: Number(CHAIN_ID),
          nonce: await relay.getAccountNonce(accounts[1].address, requestId),
          maxPriorityFeePerGas: gasPrice,
          maxFeePerGas: gasPrice,
          gasLimit: defaultGasLimit,
          data: '0x' + '00'.repeat(132221),
        };

        const signedTx = await accounts[1].wallet.signTransaction(transaction);
        const error = predefined.TRANSACTION_SIZE_TOO_BIG(
          '132320',
          String(ConfigService.get('SEND_RAW_TRANSACTION_SIZE_LIMIT')),
        );

        await Assertions.assertPredefinedRpcError(error, sendRawTransaction, true, relay, [signedTx, requestDetails]);
      });

      it('should execute "eth_sendRawTransaction" of type 1 and deploy a real contract', async function () {
        //omitting the "to" and "nonce" fields when creating a new contract
        const transaction = {
          ...defaultLegacy2930TransactionData,
          value: 0,
          data: basicContract.bytecode,
          nonce: await relay.getAccountNonce(accounts[2].address, requestId),
        };

        const signedTx = await accounts[2].wallet.signTransaction(transaction);
        const transactionHash = await relay.sendRawTransaction(signedTx, requestId);
        const info = await mirrorNode.get(`/contracts/results/${transactionHash}`, requestId);
        expect(info).to.have.property('contract_id');
        expect(info.contract_id).to.not.be.null;
        expect(info).to.have.property('created_contract_ids');
        expect(info.created_contract_ids.length).to.be.equal(1);
        expect(info.max_fee_per_gas).to.eq('0x');
        expect(info.max_priority_fee_per_gas).to.eq('0x');
        expect(info).to.have.property('access_list');
      });

      it('should execute "eth_sendRawTransaction" of type 2 and deploy a real contract', async function () {
        //omitting the "to" and "nonce" fields when creating a new contract
        const transaction = {
          ...defaultLondonTransactionData,
          value: 0,
          data: basicContract.bytecode,
          nonce: await relay.getAccountNonce(accounts[2].address, requestId),
        };

        const signedTx = await accounts[2].wallet.signTransaction(transaction);
        const transactionHash = await relay.sendRawTransaction(signedTx, requestId);
        const info = await mirrorNode.get(`/contracts/results/${transactionHash}`, requestId);
        expect(info).to.have.property('contract_id');
        expect(info.contract_id).to.not.be.null;
        expect(info).to.have.property('max_fee_per_gas');
        expect(info).to.have.property('max_priority_fee_per_gas');
        expect(info).to.have.property('created_contract_ids');
        expect(info.created_contract_ids.length).to.be.equal(1);
        expect(info).to.have.property('type');
        expect(info.type).to.be.equal(2);
        expect(info).to.have.property('access_list');
      });

      it('should execute "eth_sendRawTransaction" and deploy a contract with more than 2 HBAR transaction fee and less than max transaction fee', async function () {
        const balanceBefore = await relay.getBalance(accounts[2].wallet.address, 'latest', requestId);

        const gasPrice = await relay.gasPrice(requestId);
        const transaction = {
          type: 2,
          chainId: Number(CHAIN_ID),
          nonce: await relay.getAccountNonce(accounts[2].address, requestId),
          maxPriorityFeePerGas: gasPrice,
          maxFeePerGas: gasPrice,
          gasLimit: Constants.MAX_TRANSACTION_FEE_THRESHOLD,
          data: '0x' + '00'.repeat(40000),
        };

        const signedTx = await accounts[2].wallet.signTransaction(transaction);
        const transactionHash = await relay.sendRawTransaction(signedTx, requestId);
        const info = await mirrorNode.get(`/contracts/results/${transactionHash}`, requestId);
        const balanceAfter = await relay.getBalance(accounts[2].wallet.address, 'latest', requestId);
        expect(info).to.have.property('contract_id');
        expect(info.contract_id).to.not.be.null;
        expect(info).to.have.property('created_contract_ids');
        expect(info.created_contract_ids.length).to.be.equal(1);
        const diffInHbars =
          BigInt(balanceBefore - balanceAfter) / BigInt(Constants.TINYBAR_TO_WEIBAR_COEF) / BigInt(100_000_000);
        expect(Number(diffInHbars)).to.be.greaterThan(2);
        expect(Number(diffInHbars)).to.be.lessThan(
          (gasPrice * Constants.MAX_TRANSACTION_FEE_THRESHOLD) / Constants.TINYBAR_TO_WEIBAR_COEF / 100_000_000,
        );
      });

      if (!useAsyncTxProcessing) {
        it('should execute "eth_sendRawTransaction" and deploy a contract with more than max transaction fee', async function () {
          const gasPrice = await relay.gasPrice(requestId);
          const transaction = {
            type: 2,
            chainId: Number(CHAIN_ID),
            nonce: await relay.getAccountNonce(accounts[2].address, requestId),
            maxPriorityFeePerGas: gasPrice,
            maxFeePerGas: gasPrice,
            gasLimit: Constants.MAX_TRANSACTION_FEE_THRESHOLD,
            data: '0x' + '00'.repeat(60000),
          };
          const signedTx = await accounts[2].wallet.signTransaction(transaction);
          const error = predefined.INTERNAL_ERROR();

          await Assertions.assertPredefinedRpcError(error, sendRawTransaction, false, relay, [
            signedTx,
            requestDetails,
          ]);
        });
      }

      describe('Prechecks', async function () {
        it('should fail "eth_sendRawTransaction" for transaction with incorrect chain_id', async function () {
          const transaction = {
            ...default155TransactionData,
            to: parentContractAddress,
            nonce: await relay.getAccountNonce(accounts[2].address, requestId),
            chainId: INCORRECT_CHAIN_ID,
          };
          const signedTx = await accounts[2].wallet.signTransaction(transaction);
          const error = predefined.UNSUPPORTED_CHAIN_ID('0x3e7', CHAIN_ID);

          await Assertions.assertPredefinedRpcError(error, sendRawTransaction, true, relay, [signedTx, requestDetails]);
        });

        it('should fail "eth_sendRawTransaction" for EIP155 transaction with not enough gas', async function () {
          const gasLimit = 100;
          const transaction = {
            ...default155TransactionData,
            to: parentContractAddress,
            nonce: await relay.getAccountNonce(accounts[2].address, requestId),
            gasLimit: gasLimit,
            gasPrice: await relay.gasPrice(requestId),
          };

          const signedTx = await accounts[2].wallet.signTransaction(transaction);
          const error = predefined.GAS_LIMIT_TOO_LOW(gasLimit, Constants.MAX_TRANSACTION_FEE_THRESHOLD);

          await Assertions.assertPredefinedRpcError(error, sendRawTransaction, false, relay, [
            signedTx,
            requestDetails,
          ]);
        });

        it('should fail "eth_sendRawTransaction" for EIP155 transaction with a too high gasLimit', async function () {
          const gasLimit = 999999999;
          const transaction = {
            ...default155TransactionData,
            to: parentContractAddress,
            nonce: await relay.getAccountNonce(accounts[2].address, requestId),
            gasLimit: gasLimit,
            gasPrice: await relay.gasPrice(requestId),
          };

          const signedTx = await accounts[2].wallet.signTransaction(transaction);
          const error = predefined.GAS_LIMIT_TOO_HIGH(gasLimit, Constants.MAX_TRANSACTION_FEE_THRESHOLD);

          await Assertions.assertPredefinedRpcError(error, sendRawTransaction, false, relay, [
            signedTx,
            requestDetails,
          ]);
        });

        it('should fail "eth_sendRawTransaction" for London transaction with not enough gas', async function () {
          const gasLimit = 100;
          const transaction = {
            ...defaultLondonTransactionData,
            to: parentContractAddress,
            nonce: await relay.getAccountNonce(accounts[2].address, requestId),
            gasLimit: gasLimit,
          };
          const signedTx = await accounts[2].wallet.signTransaction(transaction);
          const error = predefined.GAS_LIMIT_TOO_LOW(gasLimit, Constants.MAX_TRANSACTION_FEE_THRESHOLD);

          await Assertions.assertPredefinedRpcError(error, sendRawTransaction, false, relay, [
            signedTx,
            requestDetails,
          ]);
        });

        it('should fail "eth_sendRawTransaction" for London transaction with a too high gasLimit', async function () {
          const gasLimit = 999999999;
          const transaction = {
            ...defaultLondonTransactionData,
            to: parentContractAddress,
            nonce: await relay.getAccountNonce(accounts[2].address, requestId),
            gasLimit: gasLimit,
          };
          const signedTx = await accounts[2].wallet.signTransaction(transaction);
          const error = predefined.GAS_LIMIT_TOO_HIGH(gasLimit, Constants.MAX_TRANSACTION_FEE_THRESHOLD);

          await Assertions.assertPredefinedRpcError(error, sendRawTransaction, false, relay, [
            signedTx,
            requestDetails,
          ]);
        });

        it('should fail "eth_sendRawTransaction" for legacy EIP 155 transactions (with gas price too low)', async function () {
          const transaction = {
            ...default155TransactionData,
            gasPrice: GAS_PRICE_TOO_LOW,
            to: parentContractAddress,
            nonce: await relay.getAccountNonce(accounts[2].address, requestId),
          };
          const signedTx = await accounts[2].wallet.signTransaction(transaction);
          const error = predefined.GAS_PRICE_TOO_LOW(GAS_PRICE_TOO_LOW, GAS_PRICE_REF);

          await Assertions.assertPredefinedRpcError(error, sendRawTransaction, false, relay, [
            signedTx,
            requestDetails,
          ]);
        });

        it('@release fail "eth_getTransactionReceipt" on precheck with wrong nonce error when sending a tx with the same nonce twice', async function () {
          const nonce = await relay.getAccountNonce(accounts[2].address, requestId);
          const transaction = {
            ...default155TransactionData,
            to: parentContractAddress,
            nonce: nonce,
            maxFeePerGas: await relay.gasPrice(requestId),
          };

          const signedTx = await accounts[2].wallet.signTransaction(transaction);
          const txHash1 = await relay.sendRawTransaction(signedTx, requestId);
          const mirrorResult = await mirrorNode.get(`/contracts/results/${txHash1}`, requestId);
          mirrorResult.from = accounts[2].wallet.address;
          mirrorResult.to = parentContractAddress;

          const res = await relay.call(
            RelayCalls.ETH_ENDPOINTS.ETH_GET_TRANSACTION_RECEIPT,
            [txHash1],
            requestIdPrefix,
          );
          const currentPrice = await relay.gasPrice(requestId);
          Assertions.transactionReceipt(res, mirrorResult, currentPrice);
          const error = predefined.NONCE_TOO_LOW(nonce, nonce + 1);

          await Assertions.assertPredefinedRpcError(error, sendRawTransaction, true, relay, [signedTx, requestDetails]);
        });

        if (!useAsyncTxProcessing) {
          it('@release fail "eth_getTransactionReceipt" on precheck with wrong nonce error when sending a tx with a higher nonce', async function () {
            const nonce = await relay.getAccountNonce(accounts[2].address, requestId);

            const transaction = {
              ...default155TransactionData,
              to: parentContractAddress,
              nonce: nonce + 100,
              gasPrice: await relay.gasPrice(requestId),
            };

            const signedTx = await accounts[2].wallet.signTransaction(transaction);
            const error = predefined.NONCE_TOO_HIGH(nonce + 100, nonce);

            await Assertions.assertPredefinedRpcError(error, sendRawTransaction, true, relay, [
              signedTx,
              requestDetails,
            ]);
          });
        }

        it('@release fail "eth_getTransactionReceipt" on submitting with wrong nonce error when sending a tx with the same nonce twice', async function () {
          const nonce = await relay.getAccountNonce(accounts[2].address, requestId);

          const transaction1 = {
            ...default155TransactionData,
            to: parentContractAddress,
            nonce: nonce,
            maxFeePerGas: await relay.gasPrice(requestId),
          };

          const signedTx = await accounts[2].wallet.signTransaction(transaction1);

          const res = await relay.sendRawTransaction(signedTx, requestId);
          await relay.pollForValidTransactionReceipt(res);

          const error = predefined.NONCE_TOO_LOW(nonce, nonce + 1);
          await Assertions.assertPredefinedRpcError(error, sendRawTransaction, true, relay, [signedTx, requestDetails]);
        });

        it('should fail "eth_sendRawTransaction" if receiver\'s account has receiver_sig_required enabled', async function () {
          const newPrivateKey = PrivateKey.generateED25519();
          const newAccount = await new AccountCreateTransaction()
            .setKey(newPrivateKey.publicKey)
            .setInitialBalance(100)
            .setReceiverSignatureRequired(true)
            .freezeWith(servicesNode.client)
            .sign(newPrivateKey);

          const transaction = await newAccount.execute(servicesNode.client);
          const receipt = await transaction.getReceipt(servicesNode.client);

          if (!receipt.accountId) {
            throw new Error('Failed to create new account - accountId is null');
          }

          const toAddress = Utils.idToEvmAddress(receipt.accountId.toString());
          const verifyAccount = await mirrorNode.get(`/accounts/${toAddress}`, requestId);

          if (verifyAccount && !verifyAccount.account) {
            verifyAccount == (await mirrorNode.get(`/accounts/${toAddress}`, requestId));
          }

          expect(verifyAccount.receiver_sig_required).to.be.true;

          const tx = {
            ...defaultLegacyTransactionData,
            chainId: Number(CHAIN_ID),
            nonce: await accounts[0].wallet.getNonce(),
            to: toAddress,
            from: accounts[0].address,
          };

          const signedTx = await accounts[0].wallet.signTransaction(tx);

          const error = predefined.RECEIVER_SIGNATURE_ENABLED;

          await Assertions.assertPredefinedRpcError(error, sendRawTransaction, false, relay, [
            signedTx,
            requestDetails,
          ]);
        });

        it(`should execute "eth_sendRawTransaction" if receiver's account has receiver_sig_required disabled`, async function () {
          const newPrivateKey = PrivateKey.generateED25519();
          const newAccount = await new AccountCreateTransaction()
            .setKey(newPrivateKey.publicKey)
            .setInitialBalance(100)
            .setReceiverSignatureRequired(false)
            .freezeWith(servicesNode.client)
            .sign(newPrivateKey);

          const transaction = await newAccount.execute(servicesNode.client);
          const receipt = await transaction.getReceipt(servicesNode.client);
          await Utils.wait(3000);

          if (!receipt.accountId) {
            throw new Error('Failed to create new account - accountId is null');
          }

          const toAddress = Utils.idToEvmAddress(receipt.accountId.toString());
          const verifyAccount = await mirrorNode.get(`/accounts/${toAddress}`, requestId);
          if (verifyAccount && !verifyAccount.account) {
            verifyAccount == (await mirrorNode.get(`/accounts/${toAddress}`, requestId));
          }

          expect(verifyAccount.receiver_sig_required).to.be.false;

          const tx = {
            ...defaultLegacyTransactionData,
            chainId: Number(CHAIN_ID),
            nonce: await accounts[0].wallet.getNonce(),
            to: toAddress,
            from: accounts[0].address,
          };

          const signedTx = await accounts[0].wallet.signTransaction(tx);
          const transactionHash = await relay.sendRawTransaction(signedTx, requestId);
          await relay.pollForValidTransactionReceipt(transactionHash);

          const info = await mirrorNode.get(`/contracts/results/${transactionHash}`, requestId);

          expect(info).to.exist;
          expect(info.result).to.equal('SUCCESS');
        });

        it('should fail "eth_sendRawTransaction" for transaction with null gasPrice, null maxFeePerGas, and null maxPriorityFeePerGas', async function () {
          const transaction = {
            ...defaultLegacyTransactionData,
            chainId: Number(CHAIN_ID),
            gasPrice: null,
            maxFeePerGas: null,
            maxPriorityFeePerGas: null,
            to: parentContractAddress,
            nonce: await relay.getAccountNonce(accounts[2].address, requestId),
          };
          const signedTx = await accounts[2].wallet.signTransaction(transaction);
          const error = predefined.GAS_PRICE_TOO_LOW(0, GAS_PRICE_REF);

          await Assertions.assertPredefinedRpcError(error, sendRawTransaction, false, relay, [
            signedTx,
            requestDetails,
          ]);
        });
      });

      it('@release should execute "eth_getTransactionByHash" for existing transaction', async function () {
        const gasPrice = await relay.gasPrice(requestId);
        const transaction = {
          ...defaultLondonTransactionData,
          to: parentContractAddress,
          nonce: await relay.getAccountNonce(accounts[2].address, requestId),
          maxPriorityFeePerGas: gasPrice,
          maxFeePerGas: gasPrice,
        };
        const signedTx = await accounts[2].wallet.signTransaction(transaction);
        const transactionHash = await relay.sendRawTransaction(signedTx, requestId);
        const mirrorTransaction = await mirrorNode.get(`/contracts/results/${transactionHash}`, requestId);

        const res = await relay.call(
          RelayCalls.ETH_ENDPOINTS.ETH_GET_TRANSACTION_BY_HASH,
          [transactionHash],
          requestIdPrefix,
        );
        const addressResult = await mirrorNode.get(`/accounts/${res.from}`, requestId);
        mirrorTransaction.from = addressResult.evm_address;

        Assertions.transaction(res, mirrorTransaction);
      });

      it('should execute "eth_getTransactionByHash" for non-existing transaction and return null', async function () {
        const res = await relay.call(
          RelayCalls.ETH_ENDPOINTS.ETH_GET_TRANSACTION_BY_HASH,
          [Address.NON_EXISTING_TX_HASH],
          requestIdPrefix,
        );
        expect(res).to.be.null;
      });
    });
  });
});
