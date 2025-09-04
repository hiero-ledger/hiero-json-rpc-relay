// SPDX-License-Identifier: Apache-2.0

// External resources
import { ConfigService } from '@hashgraph/json-rpc-config-service/dist/services';
// Other imports
import { formatTransactionId, numberTo0x, prepend0x } from '@hashgraph/json-rpc-relay/dist/formatters';
import Constants from '@hashgraph/json-rpc-relay/dist/lib/constants';
// Errors and constants from local resources
import { predefined } from '@hashgraph/json-rpc-relay/dist/lib/errors/JsonRpcError';
import { RequestDetails } from '@hashgraph/json-rpc-relay/dist/lib/types';
import { BLOCK_NUMBER_ERROR, HASH_ERROR } from '@hashgraph/json-rpc-relay/src/lib/validators';
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
import { withOverriddenEnvsInMochaTest } from '../../../relay/tests/helpers';
import basicContract from '../../tests/contracts/Basic.json';
import RelayCalls from '../../tests/helpers/constants';
import MirrorClient from '../clients/mirrorClient';
import RelayClient from '../clients/relayClient';
import ServicesClient from '../clients/servicesClient';
import basicContractJson from '../contracts/Basic.json';
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
  const requestDetails = new RequestDetails({ requestId: 'rpc_batch1Test', ipAddress: '0.0.0.0' });
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
    const fromAccountInfo = await mirrorNode.get(`/accounts/${tx.from}`);
    const toAccountInfo = await mirrorNode.get(`/accounts/${tx.to}`);
    return {
      from: fromAccountInfo?.evm_address ?? tx.from,
      to: toAccountInfo?.evm_address ?? tx.to,
    };
  };

  async function getGasWithDeviation(relay: RelayClient, gasPriceDeviation: number) {
    const gasPrice = await relay.gasPrice();
    const gasPriceWithDeviation = gasPrice * (1 + gasPriceDeviation);
    return gasPriceWithDeviation;
  }

  describe('RPC Server Acceptance Tests', function () {
    this.timeout(240 * 1000); // 240 seconds

    this.beforeAll(async () => {
      expectedGasPrice = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_GAS_PRICE, []);

      const initialAccount: AliasAccount = global.accounts[0];
      const neededAccounts: number = 3;
      accounts.push(
        ...(await Utils.createMultipleAliasAccounts(mirrorNode, initialAccount, neededAccounts, initialBalance)),
      );
      global.accounts.push(...accounts);

      const parentContract = await Utils.deployContract(
        parentContractJson.abi,
        parentContractJson.bytecode,
        accounts[0].wallet,
      );

      parentContractAddress = parentContract.target as string;
      if (global.logger.isLevelEnabled('trace')) {
        global.logger.trace(`Deploy parent contract on address ${parentContractAddress}`);
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
        global.logger.trace(`Contract call createChild on parentContract results in tx hash: ${createChildTx.hash}`);
      }
      // get contract result details
      mirrorContractDetails = await mirrorNode.get(`/contracts/results/${createChildTx.hash}`);

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

        previousBlock = Number(await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_BLOCK_NUMBER, []));

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
        latestBlock = Number(await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_BLOCK_NUMBER, []));
      });

      it('@release should deploy a contract', async () => {
        //empty params for get logs defaults to latest block, which doesn't have required logs, that's why we fetch the last 12
        const logs = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_GET_LOGS, [
          {
            fromBlock: numberTo0x(previousBlock),
            address: [contractAddress, contractAddress2],
          },
        ]);

        expect(logs.length).to.be.greaterThan(0);
        const txIndexLogIndexMapping: any[] = [];
        for (const i in logs) {
          expect(logs[i]).to.have.property('address');
          expect(logs[i]).to.have.property('logIndex');
          expect(logs[i]).to.have.property('blockTimestamp');

          const key = `${logs[i].transactionHash}---${logs[i].logIndex}`;
          txIndexLogIndexMapping.push(key);
        }
        const uniqueTxIndexLogIndexMapping = txIndexLogIndexMapping.filter(
          (value, index, self) => self.indexOf(value) === index,
        );
        expect(txIndexLogIndexMapping.length).to.equal(uniqueTxIndexLogIndexMapping.length);

        log0Block = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_GET_TRANSACTION_BY_HASH, [logs[0].transactionHash]);
        const transactionCountLog0Block = await relay.provider.getTransactionCount(
          log0Block.from,
          log0Block.blockNumber,
        );

        log4Block = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_GET_TRANSACTION_BY_HASH, [
          logs[logs.length - 1].transactionHash,
        ]);
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
        const logs = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_GET_LOGS, [
          {
            fromBlock: log0Block.blockNumber,
            address: [contractAddress, contractAddress2],
          },
        ]);
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
        );
      });

      it('should be able to use range of `fromBlock` and `toBlock` params', async () => {
        const logs = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_GET_LOGS, [
          {
            fromBlock: log0Block.blockNumber,
            toBlock: log4Block.blockNumber,
            address: [contractAddress, contractAddress2],
          },
        ]);
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

        const logs = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_GET_LOGS, [
          {
            fromBlock: log0Block.blockNumber,
            toBlock: `0x${notExistedLog.toString(16)}`,
            address: [contractAddress, contractAddress2],
          },
        ]);

        expect(logs.length).to.eq(0);
      });

      it('should be able to use `address` param', async () => {
        //when we pass only address, it defaults to the latest block
        const logs = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_GET_LOGS, [
          {
            fromBlock: numberTo0x(previousBlock),
            address: contractAddress,
          },
        ]);
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
          const logs = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_GET_LOGS, [
            {
              fromBlock: numberTo0x(latestBlock - customBlockRangeLimit - 1),
              address: contractAddress,
            },
          ]);
          expect(logs.length).to.be.greaterThan(0);

          for (const i in logs) {
            expect(logs[i].address.toLowerCase()).to.equal(contractAddress.toLowerCase());
          }
        } finally {
          customBlockRangeLimit = blockRangeLimit;
        }
      });

      it('should be able to use `address` param with multiple addresses', async () => {
        const logs = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_GET_LOGS, [
          {
            fromBlock: numberTo0x(previousBlock),
            address: [contractAddress, contractAddress2, Address.NON_EXISTING_ADDRESS],
          },
        ]);
        expect(logs.length).to.be.greaterThan(0);
        expect(logs.length).to.be.eq(6);

        for (let i = 0; i < 5; i++) {
          expect(logs[i].address.toLowerCase()).to.equal(contractAddress.toLowerCase());
        }

        expect(logs[5].address.toLowerCase()).to.equal(contractAddress2.toLowerCase());
      });

      it('should be able to use `blockHash` param', async () => {
        const logs = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_GET_LOGS, [
          {
            blockHash: log0Block.blockHash,
            address: [contractAddress, contractAddress2],
          },
        ]);
        expect(logs.length).to.be.greaterThan(0);

        for (const i in logs) {
          expect(logs[i].blockHash).to.equal(log0Block.blockHash);
        }
      });

      it('should return empty result for  non-existing `blockHash`', async () => {
        const logs = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_GET_LOGS, [
          {
            blockHash: Address.NON_EXISTING_BLOCK_HASH,
            address: [contractAddress, contractAddress2],
          },
        ]);
        expect(logs).to.exist;
        expect(logs.length).to.be.eq(0);
      });

      it('should be able to use `topics` param', async () => {
        const logs = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_GET_LOGS, [
          {
            fromBlock: log0Block.blockNumber,
            toBlock: log4Block.blockNumber,
            address: [contractAddress, contractAddress2],
          },
        ]);
        expect(logs.length).to.be.greaterThan(0);
        //using second log in array, because the first doesn't contain any topics
        const topic = logs[1].topics[0];

        const logsWithTopic = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_GET_LOGS, [
          {
            fromBlock: log0Block.blockNumber,
            toBlock: log4Block.blockNumber,
            topics: [topic],
          },
        ]);
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

        const logs = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_GET_LOGS, [
          {
            fromBlock: numberTo0x(previousBlock),
            toBlock: numberTo0x(latestBlock),
            address: [contractAddress, contractAddress2],
          },
        ]);

        expect(logs.length).to.eq(expectedAmountOfLogs);
      });

      it('should return empty logs if address = ZeroAddress', async () => {
        const logs = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_GET_LOGS, [
          {
            fromBlock: '0x0',
            toBlock: 'latest',
            address: ethers.ZeroAddress,
          },
        ]);
        expect(logs.length).to.eq(0);
      });

      it('should return only logs of non-zero addresses', async () => {
        const currentBlock = Number(await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_BLOCK_NUMBER, []));
        let blocksBehindLatest = 0;
        if (currentBlock > 10) {
          blocksBehindLatest = currentBlock - 10;
        }
        const logs = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_GET_LOGS, [
          {
            fromBlock: numberTo0x(blocksBehindLatest),
            toBlock: 'latest',
            address: [ethers.ZeroAddress, contractAddress2],
          },
        ]);
        expect(logs.length).to.eq(1);
      });
    });

    describe('Block related RPC calls', () => {
      let mirrorBlock;
      let mirrorContractResults;
      const mirrorTransactions: any[] = [];

      before(async () => {
        mirrorBlock = (await mirrorNode.get(`/blocks?block.number=${mirrorContractDetails.block_number}`)).blocks[0];
        const timestampQuery = `timestamp=gte:${mirrorBlock.timestamp.from}&timestamp=lte:${mirrorBlock.timestamp.to}`;
        mirrorContractResults = (await mirrorNode.get(`/contracts/results?${timestampQuery}`)).results;

        for (const res of mirrorContractResults) {
          mirrorTransactions.push(await mirrorNode.get(`/contracts/${res.contract_id}/results/${res.timestamp}`));
        }

        // resolve EVM address for `from` and `to`
        for (const mirrorTx of mirrorTransactions) {
          const resolvedAddresses = await resolveAccountEvmAddresses(mirrorTx);

          mirrorTx.from = resolvedAddresses.from;
          mirrorTx.to = resolvedAddresses.to;
        }
      });

      it('should execute "eth_getBlockByHash", hydrated transactions = false', async function () {
        const blockResult = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_GET_BLOCK_BY_HASH, [
          mirrorBlock.hash.substring(0, 66),
          false,
        ]);
        Assertions.block(blockResult, mirrorBlock, mirrorTransactions, expectedGasPrice, false);
      });

      it('@release should execute "eth_getBlockByHash", hydrated transactions = true', async function () {
        const blockResult = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_GET_BLOCK_BY_HASH, [
          mirrorBlock.hash.substring(0, 66),
          true,
        ]);
        // Remove synthetic transactions
        blockResult.transactions = blockResult.transactions.filter((transaction) => transaction.value !== '0x1234');
        Assertions.block(blockResult, mirrorBlock, mirrorTransactions, expectedGasPrice, true);
      });

      it('should execute "eth_getBlockByHash" for non-existing block hash and hydrated transactions = false', async function () {
        const blockResult = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_GET_BLOCK_BY_HASH, [
          Address.NON_EXISTING_BLOCK_HASH,
          false,
        ]);
        expect(blockResult).to.be.null;
      });

      it('should execute "eth_getBlockByHash" for non-existing block hash and hydrated transactions = true', async function () {
        const blockResult = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_GET_BLOCK_BY_HASH, [
          Address.NON_EXISTING_BLOCK_HASH,
          true,
        ]);
        expect(blockResult).to.be.null;
      });

      it('should execute "eth_getBlockByNumber", hydrated transactions = false', async function () {
        const blockResult = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_GET_BLOCK_BY_NUMBER, [
          numberTo0x(mirrorBlock.number),
          false,
        ]);
        // Remove synthetic transactions
        blockResult.transactions = blockResult.transactions.filter((transaction) => transaction.value !== '0x1234');
        Assertions.block(blockResult, mirrorBlock, mirrorTransactions, expectedGasPrice, false);
      });

      it('should not cache "latest" block in "eth_getBlockByNumber" ', async function () {
        const blockResult = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_GET_BLOCK_BY_NUMBER, ['latest', false]);
        await Utils.wait(1000);

        const blockResult2 = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_GET_BLOCK_BY_NUMBER, ['latest', false]);
        expect(blockResult).to.not.deep.equal(blockResult2);
      });

      it('should not cache "finalized" block in "eth_getBlockByNumber" ', async function () {
        const blockResult = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_GET_BLOCK_BY_NUMBER, ['finalized', false]);
        await Utils.wait(1000);

        const blockResult2 = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_GET_BLOCK_BY_NUMBER, ['finalized', false]);
        expect(blockResult).to.not.deep.equal(blockResult2);
      });

      it('should not cache "safe" block in "eth_getBlockByNumber" ', async function () {
        const blockResult = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_GET_BLOCK_BY_NUMBER, ['safe', false]);
        await Utils.wait(1000);

        const blockResult2 = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_GET_BLOCK_BY_NUMBER, ['safe', false]);
        expect(blockResult).to.not.deep.equal(blockResult2);
      });

      it('should not cache "pending" block in "eth_getBlockByNumber" ', async function () {
        const blockResult = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_GET_BLOCK_BY_NUMBER, ['pending', false]);
        await Utils.wait(1000);

        const blockResult2 = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_GET_BLOCK_BY_NUMBER, ['pending', false]);
        expect(blockResult).to.not.deep.equal(blockResult2);
      });

      it('@release should execute "eth_getBlockByNumber", hydrated transactions = true', async function () {
        const blockResult = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_GET_BLOCK_BY_NUMBER, [
          numberTo0x(mirrorBlock.number),
          true,
        ]);
        // Remove synthetic transactions
        blockResult.transactions = blockResult.transactions.filter((transaction) => transaction.value !== '0x1234');
        Assertions.block(blockResult, mirrorBlock, mirrorTransactions, expectedGasPrice, true);
      });

      it('should execute "eth_getBlockByNumber" for non existing block number and hydrated transactions = true', async function () {
        const blockResult = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_GET_BLOCK_BY_NUMBER, [
          Address.NON_EXISTING_BLOCK_NUMBER,
          true,
        ]);
        expect(blockResult).to.be.null;
      });

      it('should execute "eth_getBlockByNumber" for non existing block number and hydrated transactions = false', async function () {
        const blockResult = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_GET_BLOCK_BY_NUMBER, [
          Address.NON_EXISTING_BLOCK_NUMBER,
          false,
        ]);
        expect(blockResult).to.be.null;
      });

      it('@release should execute "eth_getBlockTransactionCountByNumber"', async function () {
        const res = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_GET_BLOCK_TRANSACTION_COUNT_BY_NUMBER, [
          numberTo0x(mirrorBlock.number),
        ]);
        expect(res).to.be.equal(ethers.toQuantity(mirrorBlock.count));
      });

      it('should execute "eth_getBlockTransactionCountByNumber" for non-existing block number', async function () {
        const res = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_GET_BLOCK_TRANSACTION_COUNT_BY_NUMBER, [
          Address.NON_EXISTING_BLOCK_NUMBER,
        ]);
        expect(res).to.be.null;
      });

      it('@release should execute "eth_getBlockTransactionCountByHash"', async function () {
        const res = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_GET_BLOCK_TRANSACTION_COUNT_BY_HASH, [
          mirrorBlock.hash.substring(0, 66),
        ]);
        expect(res).to.be.equal(ethers.toQuantity(mirrorBlock.count));
      });

      it('should execute "eth_getBlockTransactionCountByHash" for non-existing block hash', async function () {
        const res = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_GET_BLOCK_TRANSACTION_COUNT_BY_HASH, [
          Address.NON_EXISTING_BLOCK_HASH,
        ]);
        expect(res).to.be.null;
      });

      it('should execute "eth_getBlockTransactionCountByNumber"', async function () {
        it('@release should execute "eth_blockNumber"', async function () {
          const mirrorBlocks = await mirrorNode.get(`blocks`);
          expect(mirrorBlocks).to.have.property('blocks');
          expect(mirrorBlocks.blocks.length).to.gt(0);
          const mirrorBlockNumber = mirrorBlocks.blocks[0].number;

          const res = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_BLOCK_NUMBER, []);
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
        const blockResult = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_GET_BLOCK_BY_NUMBER, [
          numberTo0x(mirrorResult.block_number),
          true,
        ]);
        expect(blockResult.transactions).to.not.be.empty;
        expect(blockResult.transactions.map((tx) => tx.hash)).to.contain(txHash);
        expect(blockResult.transactions.filter((tx) => tx.hash == txHash)[0].value).to.equal('0xffffffffffffff9c');
      });

      it('should execute "eth_getBlockReceipts" with block hash successfully', async function () {
        const res = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_GET_BLOCK_RECEIPTS, [
          mirrorBlock.hash.substring(0, 66),
        ]);

        expect(res).to.have.length(1);
        expect(res[0]).to.have.property('blockHash');
        expect(res[0].blockHash).to.equal(mirrorBlock.hash.substring(0, 66));
        expect(res[0]).to.have.property('status');
        expect(res[0].status).to.equal('0x1');
        expect(res[0]).to.have.property('transactionHash');
        expect(res[0].transactionHash).to.equal(createChildTx.hash);
        expect(res[0].logs).to.not.be.empty;
        res[0].logs.map((log) =>
          expect(log.blockTimestamp).to.equal(numberTo0x(Number(mirrorBlock.timestamp.to.split('.')[0]))),
        );
      });

      it('should execute "eth_getBlockReceipts" with block number successfully', async function () {
        const res = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_GET_BLOCK_RECEIPTS, [numberTo0x(mirrorBlock.number)]);

        expect(res).to.have.length(1);
        expect(res[0]).to.have.property('blockHash');
        expect(res[0].blockHash).to.equal(mirrorBlock.hash.substring(0, 66));
        expect(res[0]).to.have.property('status');
        expect(res[0].status).to.equal('0x1');
        expect(res[0]).to.have.property('transactionHash');
        expect(res[0].transactionHash).to.equal(createChildTx.hash);
      });

      it('should execute "eth_getBlockReceipts" with tag "earliest" successfully', async function () {
        const res = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_GET_BLOCK_RECEIPTS, ['earliest']);

        expect(res).to.have.length(0);
      });

      it('should execute "eth_getBlockReceipts" with tag "latest" successfully', async function () {
        const res = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_GET_BLOCK_RECEIPTS, ['latest']);

        expect(res).to.have.length(0);
      });

      it('should throw error on "eth_getBlockReceipts" with invalid parameter passed', async function () {
        const error = predefined.INVALID_PARAMETER(
          0,
          `The value passed is not valid: 0x. ${BLOCK_NUMBER_ERROR} OR Expected ${HASH_ERROR} of a block`,
        );
        Assertions.assertPredefinedRpcError(error, relay.call, true, relay, [
          RelayCalls.ETH_ENDPOINTS.ETH_GET_BLOCK_RECEIPTS,
          ['0x', requestIdPrefix],
        ]);
      });

      it('should execute "eth_getBlockReceipts" with contract deployment transaction showing null to field', async function () {
        const contractDeployment = await Utils.deployContract(
          basicContractJson.abi,
          basicContractJson.bytecode,
          accounts[0].wallet,
        );
        const basicContractTx = contractDeployment.deploymentTransaction();
        if (!basicContractTx) {
          throw new Error('Deployment transaction is null');
        }
        const receipt = await relay.pollForValidTransactionReceipt(basicContractTx.hash);

        const deploymentBlock = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_GET_BLOCK_BY_HASH, [
          receipt.blockHash,
          false,
        ]);

        const res = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_GET_BLOCK_RECEIPTS, [deploymentBlock.hash]);

        const deploymentReceiptInBlock = res.find((receipt) => receipt.transactionHash === basicContractTx.hash);

        expect(deploymentReceiptInBlock).to.exist;
        expect(deploymentReceiptInBlock).to.have.property('to');
        expect(deploymentReceiptInBlock.to).to.be.null;
        expect(deploymentReceiptInBlock.contractAddress).to.not.be.null;
        expect(deploymentReceiptInBlock.contractAddress.toLowerCase()).to.equal(
          contractDeployment.target.toString().toLowerCase(),
        );
      });

      it('should return null for "eth_getBlockReceipts" when block is not found', async function () {
        const res = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_GET_BLOCK_RECEIPTS, [
          Address.NON_EXISTING_BLOCK_HASH,
        ]);
        expect(res).to.be.null;
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
        const response = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_GET_TRANSACTION_BY_BLOCK_HASH_AND_INDEX, [
          mirrorContractDetails.block_hash.substring(0, 66),
          numberTo0x(mirrorContractDetails.transaction_index),
        ]);
        Assertions.transaction(response, mirrorContractDetails);
      });

      it('should execute "eth_getTransactionByBlockHashAndIndex" for invalid block hash', async function () {
        const response = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_GET_TRANSACTION_BY_BLOCK_HASH_AND_INDEX, [
          Address.NON_EXISTING_BLOCK_HASH,
          numberTo0x(mirrorContractDetails.transaction_index),
        ]);
        expect(response).to.be.null;
      });

      it('should execute "eth_getTransactionByBlockHashAndIndex" for invalid index', async function () {
        const response = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_GET_TRANSACTION_BY_BLOCK_HASH_AND_INDEX, [
          mirrorContractDetails.block_hash.substring(0, 66),
          Address.NON_EXISTING_INDEX,
        ]);
        expect(response).to.be.null;
      });

      it('@release should execute "eth_getTransactionByBlockNumberAndIndex"', async function () {
        const response = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_GET_TRANSACTION_BY_BLOCK_NUMBER_AND_INDEX, [
          numberTo0x(mirrorContractDetails.block_number),
          numberTo0x(mirrorContractDetails.transaction_index),
        ]);
        Assertions.transaction(response, mirrorContractDetails);
      });

      it('should execute "eth_getTransactionByBlockNumberAndIndex" for invalid index', async function () {
        const response = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_GET_TRANSACTION_BY_BLOCK_NUMBER_AND_INDEX, [
          numberTo0x(mirrorContractDetails.block_number),
          Address.NON_EXISTING_INDEX,
        ]);
        expect(response).to.be.null;
      });

      it('should execute "eth_getTransactionByBlockNumberAndIndex" for non-exising block number', async function () {
        const response = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_GET_TRANSACTION_BY_BLOCK_NUMBER_AND_INDEX, [
          Address.NON_EXISTING_BLOCK_NUMBER,
          numberTo0x(mirrorContractDetails.transaction_index),
        ]);
        expect(response).to.be.null;
      });

      it('@release-light, @release should execute "eth_getTransactionReceipt" for hash of legacy transaction', async function () {
        const gasPriceWithDeviation = await getGasWithDeviation(relay, gasPriceDeviation);
        const transaction = {
          ...default155TransactionData,
          to: parentContractAddress,
          nonce: await relay.getAccountNonce(accounts[2].address),
          gasPrice: gasPriceWithDeviation,
          type: 0,
        };

        const signedTx = await accounts[2].wallet.signTransaction(transaction);
        const legacyTxHash = await relay.sendRawTransaction(signedTx);
        // Since the transactionId is not available in this context
        // Wait for the transaction to be processed and imported in the mirror node with axios-retry
        const mirrorResult = await mirrorNode.get(`/contracts/results/${legacyTxHash}`);
        mirrorResult.from = accounts[2].wallet.address;
        mirrorResult.to = parentContractAddress;

        const res = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_GET_TRANSACTION_RECEIPT, [legacyTxHash]);
        const currentPrice = await relay.gasPrice();

        Assertions.transactionReceipt(res, mirrorResult, currentPrice);
      });

      it('@release-light, @release should execute "eth_getTransactionReceipt" for hash of London transaction', async function () {
        const gasPriceWithDeviation = await getGasWithDeviation(relay, gasPriceDeviation);
        const transaction = {
          ...defaultLondonTransactionData,
          to: parentContractAddress,
          nonce: await relay.getAccountNonce(accounts[2].address),
          maxFeePerGas: gasPriceWithDeviation,
          maxPriorityFeePerGas: gasPriceWithDeviation,
        };

        const signedTx = await accounts[2].wallet.signTransaction(transaction);
        const transactionHash = await relay.sendRawTransaction(signedTx);
        // Since the transactionId is not available in this context
        // Wait for the transaction to be processed and imported in the mirror node with axios-retry
        const mirrorResult = await mirrorNode.get(`/contracts/results/${transactionHash}`);
        mirrorResult.from = accounts[2].wallet.address;
        mirrorResult.to = parentContractAddress;

        const res = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_GET_TRANSACTION_RECEIPT, [transactionHash]);
        const currentPrice = await relay.gasPrice();

        Assertions.transactionReceipt(res, mirrorResult, currentPrice);
      });

      it('@release-light, @release should execute "eth_getTransactionReceipt" for hash of 2930 transaction', async function () {
        const gasPriceWithDeviation = await getGasWithDeviation(relay, gasPriceDeviation);
        const transaction = {
          ...defaultLegacy2930TransactionData,
          to: parentContractAddress,
          nonce: await relay.getAccountNonce(accounts[2].address),
          gasPrice: gasPriceWithDeviation,
        };

        const signedTx = await accounts[2].wallet.signTransaction(transaction);
        const transactionHash = await relay.sendRawTransaction(signedTx);
        // Since the transactionId is not available in this context
        // Wait for the transaction to be processed and imported in the mirror node with axios-retry
        const mirrorResult = await mirrorNode.get(`/contracts/results/${transactionHash}`);
        mirrorResult.from = accounts[2].wallet.address;
        mirrorResult.to = parentContractAddress;

        const res = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_GET_TRANSACTION_RECEIPT, [transactionHash]);
        const currentPrice = await relay.gasPrice();

        Assertions.transactionReceipt(res, mirrorResult, currentPrice);
      });

      it('@release should fail to execute "eth_getTransactionReceipt" for hash of London transaction', async function () {
        const gasPrice = await relay.gasPrice();
        const transaction = {
          ...defaultLondonTransactionData,
          to: parentContractAddress,
          nonce: await relay.getAccountNonce(accounts[2].address),
          maxFeePerGas: gasPrice,
          maxPriorityFeePerGas: gasPrice,
        };

        const signedTx = await accounts[2].wallet.signTransaction(transaction);
        const error = predefined.INVALID_ARGUMENTS('unexpected junk after rlp payload');

        await Assertions.assertPredefinedRpcError(error, sendRawTransaction, false, relay, [
          signedTx + '11',
          requestDetails,
        ]);
      });

      it('@release should return the right "effectiveGasPrice" for SYNTHETIC HTS transaction', async function () {
        const tokenId = await servicesNode.createToken(1000);
        await accounts[2].client.associateToken(tokenId);
        const currentPrice = await relay.gasPrice();
        const transaction = new TransferTransaction()
          .addTokenTransfer(tokenId, servicesNode._thisAccountId(), -10)
          .addTokenTransfer(tokenId, accounts[2].accountId, 10)
          .setTransactionMemo('Relay test token transfer');
        const resp = await transaction.execute(servicesNode.client);
        await resp.getRecord(servicesNode.client);
        await Utils.wait(1000);
        const logsRes = await mirrorNode.get(`/contracts/results/logs?limit=1`);
        const blockNumber = logsRes.logs[0].block_number;
        const formattedBlockNumber = prepend0x(blockNumber.toString(16));
        const contractId = logsRes.logs[0].contract_id;
        const transactionHash = logsRes.logs[0].transaction_hash;
        if (contractId !== tokenId.toString()) {
          return;
        }

        // load the block in cache
        await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_GET_BLOCK_BY_NUMBER, [formattedBlockNumber, true]);
        const receiptFromRelay = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_GET_TRANSACTION_RECEIPT, [
          transactionHash,
        ]);

        // handle deviation in gas price
        expect(parseInt(receiptFromRelay.effectiveGasPrice)).to.be.lessThan(currentPrice * (1 + gasPriceDeviation));
        expect(parseInt(receiptFromRelay.effectiveGasPrice)).to.be.greaterThan(currentPrice * (1 - gasPriceDeviation));
      });

      it('@release should return the right "effectiveGasPrice" for SYNTHETIC Contract Call transaction', async function () {
        const currentPrice = await relay.gasPrice();
        const transactionHash = mirrorContractDetails.hash;
        const formattedBlockNumber = prepend0x(mirrorContractDetails.block_number.toString(16));

        // load the block in cache
        await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_GET_BLOCK_BY_NUMBER, [formattedBlockNumber, true]);
        const receiptFromRelay = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_GET_TRANSACTION_RECEIPT, [
          transactionHash,
        ]);

        // handle deviation in gas price
        expect(parseInt(receiptFromRelay.effectiveGasPrice)).to.be.lessThan(currentPrice * (1 + gasPriceDeviation));
        expect(parseInt(receiptFromRelay.effectiveGasPrice)).to.be.greaterThan(currentPrice * (1 - gasPriceDeviation));
      });

      it('should execute "eth_getTransactionReceipt" for non-existing hash', async function () {
        const res = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_GET_TRANSACTION_RECEIPT, [
          Address.NON_EXISTING_TX_HASH,
        ]);
        expect(res).to.be.null;
      });

      it('should execute "eth_getTransactionReceipt" and set "to" field to null for direct contract deployment', async function () {
        const basicContract = await Utils.deployContract(
          basicContractJson.abi,
          basicContractJson.bytecode,
          accounts[0].wallet,
        );

        const contractDeploymentTx = basicContract.deploymentTransaction();
        if (!contractDeploymentTx) {
          throw new Error('Deployment transaction is null');
        }
        await relay.pollForValidTransactionReceipt(contractDeploymentTx.hash);

        const contractDeploymentReceipt = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_GET_TRANSACTION_RECEIPT, [
          contractDeploymentTx.hash,
        ]);

        expect(contractDeploymentReceipt).to.exist;
        expect(contractDeploymentReceipt.contractAddress).to.not.be.null;
        expect(contractDeploymentReceipt.to).to.be.null;
      });

      it('should fail "eth_sendRawTransaction" for transaction with incorrect chain_id', async function () {
        const transaction = {
          ...default155TransactionData,
          to: parentContractAddress,
          nonce: await relay.getAccountNonce(accounts[2].address),
          chainId: INCORRECT_CHAIN_ID,
        };
        const signedTx = await accounts[2].wallet.signTransaction(transaction);
        const error = predefined.UNSUPPORTED_CHAIN_ID(ethers.toQuantity(INCORRECT_CHAIN_ID), CHAIN_ID);

        await Assertions.assertPredefinedRpcError(error, sendRawTransaction, true, relay, [signedTx, requestDetails]);
      });

      it('@xts should fail "eth_sendRawTransaction" for HBAR crypto transfer to zero addresses', async function () {
        const sendHbarTx = {
          ...defaultLegacyTransactionData,
          value: ONE_TINYBAR,
          to: ethers.ZeroAddress,
          nonce: await relay.getAccountNonce(accounts[1].address),
          gasPrice: await relay.gasPrice(),
        };

        const signedSendHbarTx = await accounts[1].wallet.signTransaction(sendHbarTx);
        const error = predefined.INTERNAL_ERROR('Transaction execution returns a null value');

        await Assertions.assertPredefinedRpcError(error, sendRawTransaction, true, relay, [
          signedSendHbarTx,
          requestDetails,
        ]);
      });

      it('@xts should reject eth_sendRawTransaction requests for HBAR crypto transfers to reserved system account addresses (accounts ≤ 0.0.750) with INVALID_CONTRACT_ID.', async function () {
        // https://github.com/hiero-ledger/hiero-consensus-node/blob/main/hedera-node/docs/system-accounts-operations.md
        const hederaSystemAccounts = [
          // system accounts
          '0x0000000000000000000000000000000000000002', // 0.0.2 treasury
          '0x0000000000000000000000000000000000000003', // 0.0.3
          '0x0000000000000000000000000000000000000032', // 0.0.50 system admin
          '0x0000000000000000000000000000000000000037', // 0.0.55 address book admin
          '0x0000000000000000000000000000000000000039', // 0.0.57 exchange rates admin
          '0x000000000000000000000000000000000000003a', // 0.0.58 freeze admin
          '0x000000000000000000000000000000000000003b', // 0.0.59 system delete admin
          '0x000000000000000000000000000000000000003c', // 0.0.60 system undelete admin

          // system contracts (precompiles)
          '0x0000000000000000000000000000000000000167', // 0.0.359 HTS
          '0x0000000000000000000000000000000000000168', // 0.0.360 Exchange Rate
          '0x0000000000000000000000000000000000000169', // 0.0.361 PRNG
          '0x000000000000000000000000000000000000016a', // 0.0.362 HAS

          // non-existent accounts
          '0x00000000000000000000000000000000000001C2', // 0.0.450
          '0x00000000000000000000000000000000000001FE', // 0.0.510
          '0x00000000000000000000000000000000000002EE', // 0.0.750
        ];

        for (const address of hederaSystemAccounts) {
          const sendHbarTx = {
            ...defaultLegacyTransactionData,
            value: ONE_TINYBAR,
            to: address,
            nonce: await relay.getAccountNonce(accounts[1].address),
            gasPrice: await relay.gasPrice(),
          };

          const signedSendHbarTx = await accounts[1].wallet.signTransaction(sendHbarTx);
          const txHash = await relay.sendRawTransaction(signedSendHbarTx);
          const txReceipt = await relay.pollForValidTransactionReceipt(txHash);

          expect(txReceipt.revertReason).to.not.be.null;
          expect(txReceipt.revertReason).to.not.be.empty;
          expect(Buffer.from((txReceipt.revertReason as string).slice(2), 'hex').toString('utf8')).to.equal(
            'INVALID_CONTRACT_ID',
          );
        }
      });

      it('@xts should validate HBAR transfers to reserved system accounts based on account existence for accounts from 0.0.750 to 0.0.999', async function () {
        const hederaSystemAccounts = [
          // non-existent accounts
          '0x00000000000000000000000000000000000002f1', // 0.0.753
          '0x000000000000000000000000000000000000032A', // 0.0.810

          // system accounts
          '0x0000000000000000000000000000000000000320', // 0.0.800 staking reward account;
          '0x0000000000000000000000000000000000000321', // 0.0.801 node reward account

          // existent accounts
          '0x00000000000000000000000000000000000003A2', // 0.0.930
          '0x00000000000000000000000000000000000003A2', // 0.0.960
          '0x00000000000000000000000000000000000003A2', // 0.0.999
        ];

        for (const address of hederaSystemAccounts) {
          const sendHbarTx = {
            ...defaultLegacyTransactionData,
            value: ONE_TINYBAR,
            to: address,
            nonce: await relay.getAccountNonce(accounts[1].address),
            gasPrice: await relay.gasPrice(),
          };

          const signedSendHbarTx = await accounts[1].wallet.signTransaction(sendHbarTx);
          const txHash = await relay.sendRawTransaction(signedSendHbarTx);
          const txReceipt = await relay.pollForValidTransactionReceipt(txHash);

          // Crypto Transfers are successful if accounts exist
          try {
            const accountInfo = await global.mirrorNode.get(`/accounts/${address}`);
            expect(accountInfo).to.exist;
            expect(txReceipt.status).to.equal('0x1');
            expect(txReceipt.revertReason).to.be.undefined;
          } catch (error) {
            expect(error.status).to.equal(404);
            expect(txReceipt.revertReason).to.not.be.null;
            expect(txReceipt.revertReason).to.not.be.empty;
            expect(Buffer.from((txReceipt.revertReason as string).slice(2), 'hex').toString('utf8')).to.equal(
              'INVALID_ALIAS_KEY',
            );
          }
        }
      });

      it('@xts should execute "eth_sendRawTransaction" for deterministic deployment transaction', async function () {
        // send gas money to the proxy deployer
        const sendHbarTx = {
          ...defaultLegacyTransactionData,
          value: TEN_HBAR, // 10hbar - the gasPrice to deploy the deterministic proxy contract
          to: Constants.DETERMINISTIC_DEPLOYMENT_SIGNER,
          nonce: await relay.getAccountNonce(accounts[0].address),
          gasPrice: await relay.gasPrice(),
        };
        const signedSendHbarTx = await accounts[0].wallet.signTransaction(sendHbarTx);
        const txHash = await relay.sendRawTransaction(signedSendHbarTx);
        await relay.pollForValidTransactionReceipt(txHash);
        const deployerBalance = await global.relay.getBalance(Constants.DETERMINISTIC_DEPLOYMENT_SIGNER, 'latest');
        expect(deployerBalance).to.not.eq(0);

        // @logic: since the DETERMINISTIC_DEPLOYER_TRANSACTION is a deterministic transaction hash which is signed
        //          by the DETERMINISTIC_DEPLOYMENT_SIGNER with tx.nonce = 0. With that reason, if the current nonce of the signer
        //          is not 0, it means the DETERMINISTIC_DEPLOYER_TRANSACTION has already been submitted, and the DETERMINISTIC_PROXY_CONTRACT
        //          has already been deployed to the network. Therefore, it only matters to test this flow once.
        const signerNonce = await relay.getAccountNonce(Constants.DETERMINISTIC_DEPLOYMENT_SIGNER);

        if (signerNonce === 0) {
          const deployerBalance = await relay.getBalance(Constants.DETERMINISTIC_DEPLOYMENT_SIGNER, 'latest');
          expect(deployerBalance).to.not.eq(0);

          // send transaction to deploy proxy transaction
          const deterministicDeployTransactionHash = await relay.sendRawTransaction(
            Constants.DETERMINISTIC_DEPLOYER_TRANSACTION,
          );

          const receipt = await mirrorNode.get(`/contracts/results/${deterministicDeployTransactionHash}`);
          const fromAccountInfo = await global.mirrorNode.get(`/accounts/${receipt.from}`);
          const toAccountInfo = await global.mirrorNode.get(`/accounts/${receipt.to}`);

          expect(receipt).to.exist;
          expect(fromAccountInfo.evm_address).to.eq(Constants.DETERMINISTIC_DEPLOYMENT_SIGNER);
          expect(toAccountInfo.evm_address).to.eq(Constants.DETERMINISTIC_PROXY_CONTRACT);
          expect(receipt.address).to.eq(Constants.DETERMINISTIC_PROXY_CONTRACT);
        } else {
          try {
            await relay.sendRawTransaction(Constants.DETERMINISTIC_DEPLOYER_TRANSACTION);
            expect(true).to.be.false;
          } catch (error: any) {
            const expectedNonceTooLowError = predefined.NONCE_TOO_LOW(0, signerNonce);
            const errObj = JSON.parse(error.info.responseBody).error;
            expect(errObj.code).to.eq(expectedNonceTooLowError.code);
            expect(errObj.message).to.contain(expectedNonceTooLowError.message);
          }
        }
      });

      it('@release-light @release @xts should execute "eth_sendRawTransaction" for legacy EIP 155 transactions', async function () {
        const receiverInitialBalance = await relay.getBalance(parentContractAddress, 'latest');
        const gasPriceWithDeviation = await getGasWithDeviation(relay, gasPriceDeviation);
        const transaction = {
          ...default155TransactionData,
          to: parentContractAddress,
          nonce: await relay.getAccountNonce(accounts[2].address),
          gasPrice: gasPriceWithDeviation,
        };
        const signedTx = await accounts[2].wallet.signTransaction(transaction);
        const transactionHash = await relay.sendRawTransaction(signedTx);
        await relay.pollForValidTransactionReceipt(transactionHash);
        await mirrorNode.get(`/contracts/results/${transactionHash}`);

        const receiverEndBalance = await relay.getBalance(parentContractAddress, 'latest');
        const balanceChange = receiverEndBalance - receiverInitialBalance;
        expect(balanceChange.toString()).to.eq(Number(ONE_TINYBAR).toString());
      });

      it('should fail "eth_sendRawTransaction" for legacy EIP 155 transactions (with insufficient balance)', async function () {
        const balanceInWeiBars = await relay.getBalance(account2Address, 'latest');
        const transaction = {
          ...default155TransactionData,
          to: parentContractAddress,
          value: balanceInWeiBars,
          nonce: await relay.getAccountNonce(accounts[2].address),
          gasPrice: await relay.gasPrice(),
        };
        const signedTx = await accounts[2].wallet.signTransaction(transaction);
        const error = predefined.INSUFFICIENT_ACCOUNT_BALANCE;

        await Assertions.assertPredefinedRpcError(error, sendRawTransaction, true, relay, [signedTx, requestDetails]);
      });

      it('@xts should execute "eth_sendRawTransaction" for legacy transactions (with no chainId i.e. chainId=0x0)', async function () {
        const receiverInitialBalance = await relay.getBalance(parentContractAddress, 'latest');
        const transaction = {
          ...defaultLegacyTransactionData,
          to: parentContractAddress,
          nonce: await relay.getAccountNonce(accounts[2].address),
          gasPrice: await relay.gasPrice(),
        };
        const signedTx = await accounts[2].wallet.signTransaction(transaction);
        const transactionHash = await relay.sendRawTransaction(signedTx);
        await relay.pollForValidTransactionReceipt(transactionHash);
        await mirrorNode.get(`/contracts/results/${transactionHash}`);

        const receiverEndBalance = await relay.getBalance(parentContractAddress, 'latest');
        const balanceChange = receiverEndBalance - receiverInitialBalance;
        expect(balanceChange.toString()).to.eq(Number(ONE_TINYBAR).toString());
      });

      it('@xts should execute "eth_sendRawTransaction" with no chainId field for legacy EIP155 transactions  (with no chainId i.e. chainId=0x0)', async function () {
        const transaction = {
          ...defaultLegacyTransactionData,
          to: parentContractAddress,
          nonce: await relay.getAccountNonce(accounts[1].address),
          gasPrice: await relay.gasPrice(),
        };
        const signedTx = await accounts[1].wallet.signTransaction(transaction);
        const transactionHash = await relay.sendRawTransaction(signedTx);
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
          nonce: await relay.getAccountNonce(accounts[2].address),
        };
        const signedTx = await accounts[2].wallet.signTransaction(transaction);
        const error = predefined.GAS_PRICE_TOO_LOW(GAS_PRICE_TOO_LOW, GAS_PRICE_REF);

        await Assertions.assertPredefinedRpcError(error, sendRawTransaction, false, relay, [signedTx, requestDetails]);
      });

      it('should not fail "eth_sendRawTransactxion" for Legacy 2930 transactions', async function () {
        const transaction = {
          ...defaultLegacy2930TransactionData,
          to: parentContractAddress,
          nonce: await relay.getAccountNonce(accounts[2].address),
          gasPrice: await relay.gasPrice(),
        };
        const signedTx = await accounts[2].wallet.signTransaction(transaction);
        const transactionHash = await relay.sendRawTransaction(signedTx);
        const info = await mirrorNode.get(`/contracts/results/${transactionHash}`);
        expect(info).to.exist;
        expect(info.result).to.equal('SUCCESS');
      });

      it('should fail "eth_sendRawTransaction" for Legacy 2930 transactions (with gas price too low)', async function () {
        const transaction = {
          ...defaultLegacy2930TransactionData,
          gasPrice: GAS_PRICE_TOO_LOW,
          to: parentContractAddress,
          nonce: await relay.getAccountNonce(accounts[2].address),
        };
        const signedTx = await accounts[2].wallet.signTransaction(transaction);
        const error = predefined.GAS_PRICE_TOO_LOW(GAS_PRICE_TOO_LOW, GAS_PRICE_REF);

        await Assertions.assertPredefinedRpcError(error, sendRawTransaction, false, relay, [signedTx, requestDetails]);
      });

      it('should fail "eth_sendRawTransaction" for Legacy 2930 transactions (with insufficient balance)', async function () {
        const balanceInWeiBars = await relay.getBalance(account2Address, 'latest');
        const transaction = {
          ...defaultLegacy2930TransactionData,
          value: balanceInWeiBars,
          to: parentContractAddress,
          nonce: await relay.getAccountNonce(accounts[2].address),
          gasPrice: await relay.gasPrice(),
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
          nonce: await relay.getAccountNonce(accounts[2].address),
        };
        const signedTx = await accounts[2].wallet.signTransaction(transaction);
        const error = predefined.GAS_PRICE_TOO_LOW(GAS_PRICE_TOO_LOW, GAS_PRICE_REF);

        await Assertions.assertPredefinedRpcError(error, sendRawTransaction, false, relay, [signedTx, requestDetails]);
      });

      it('should fail "eth_sendRawTransaction" for London transactions (with insufficient balance)', async function () {
        const balanceInWeiBars = await relay.getBalance(account2Address, 'latest');
        const gasPrice = await relay.gasPrice();

        const transaction = {
          ...defaultLondonTransactionData,
          value: balanceInWeiBars,
          to: parentContractAddress,
          nonce: await relay.getAccountNonce(accounts[2].address),
          maxPriorityFeePerGas: gasPrice,
          maxFeePerGas: gasPrice,
        };
        const signedTx = await accounts[2].wallet.signTransaction(transaction);
        const error = predefined.INSUFFICIENT_ACCOUNT_BALANCE;

        await Assertions.assertPredefinedRpcError(error, sendRawTransaction, true, relay, [signedTx, requestDetails]);
      });

      it('@xts should execute "eth_sendRawTransaction" for London transactions', async function () {
        const receiverInitialBalance = await relay.getBalance(parentContractAddress, 'latest');
        const gasPrice = await relay.gasPrice();

        const transaction = {
          ...defaultLondonTransactionData,
          to: parentContractAddress,
          nonce: await relay.getAccountNonce(accounts[2].address),
          maxPriorityFeePerGas: gasPrice,
          maxFeePerGas: gasPrice,
        };
        const signedTx = await accounts[2].wallet.signTransaction(transaction);
        const transactionHash = await relay.sendRawTransaction(signedTx);
        await relay.pollForValidTransactionReceipt(transactionHash);
        await mirrorNode.get(`/contracts/results/${transactionHash}`);
        const receiverEndBalance = await relay.getBalance(parentContractAddress, 'latest');
        const balanceChange = receiverEndBalance - receiverInitialBalance;
        expect(balanceChange.toString()).to.eq(Number(ONE_TINYBAR).toString());
      });

      it('@xts should execute "eth_sendRawTransaction" and deploy a large contract', async function () {
        const gasPrice = await relay.gasPrice();
        const transaction = {
          type: 2,
          chainId: Number(CHAIN_ID),
          nonce: await relay.getAccountNonce(accounts[2].address),
          maxPriorityFeePerGas: gasPrice,
          maxFeePerGas: gasPrice,
          gasLimit: defaultGasLimit,
          data: '0x' + '00'.repeat(5121),
        };

        const signedTx = await accounts[2].wallet.signTransaction(transaction);
        const transactionHash = await relay.sendRawTransaction(signedTx);
        await relay.pollForValidTransactionReceipt(transactionHash);
        const info = await mirrorNode.get(`/contracts/results/${transactionHash}`);
        expect(info).to.have.property('contract_id');
        expect(info.contract_id).to.not.be.null;
        expect(info).to.have.property('created_contract_ids');
        expect(info.created_contract_ids.length).to.be.equal(1);
      });

      // note: according to this ticket https://github.com/hiero-ledger/hiero-json-rpc-relay/issues/2563,
      //      if calldata's size fails into the range of [2568 bytes, 5217 bytes], the request fails and throw
      //      `Null Entity ID` error. This unit test makes sure that with the new fix, requests should work with all case scenarios.
      it('@xts should execute "eth_sendRawTransaction" and deploy a contract with any arbitrary calldata size', async () => {
        const gasPrice = await relay.gasPrice();

        const randomBytes = [2566, 2568, 3600, 5217, 7200];

        for (const bytes of randomBytes) {
          const transaction = {
            type: 2,
            chainId: Number(CHAIN_ID),
            nonce: await relay.getAccountNonce(accounts[0].address),
            maxPriorityFeePerGas: gasPrice,
            maxFeePerGas: gasPrice,
            gasLimit: defaultGasLimit,
            data: '0x' + '00'.repeat(bytes),
          };
          const signedTx = await accounts[0].wallet.signTransaction(transaction);
          const transactionHash = await relay.sendRawTransaction(signedTx);
          await relay.pollForValidTransactionReceipt(transactionHash);
          const info = await mirrorNode.get(`/contracts/results/${transactionHash}`);
          expect(info).to.have.property('contract_id');
          expect(info.contract_id).to.not.be.null;
          expect(info).to.have.property('created_contract_ids');
          expect(info.created_contract_ids.length).to.be.equal(1);
          await new Promise((r) => setTimeout(r, 3000));
        }
      });

      it('should delete the file created while execute "eth_sendRawTransaction" to deploy a large contract', async function () {
        const gasPrice = await relay.gasPrice();
        const transaction = {
          type: 2,
          chainId: Number(CHAIN_ID),
          nonce: await relay.getAccountNonce(accounts[2].address),
          maxPriorityFeePerGas: gasPrice,
          maxFeePerGas: gasPrice,
          gasLimit: defaultGasLimit,
          data: '0x' + '00'.repeat(5121),
        };

        const signedTx = await accounts[2].wallet.signTransaction(transaction);
        const transactionHash = await relay.sendRawTransaction(signedTx);

        await Utils.wait(1000);
        const txInfo = await mirrorNode.get(`/contracts/results/${transactionHash}`);

        const contractResult = await mirrorNode.get(`/contracts/${txInfo.contract_id}`);
        const fileInfo = await new FileInfoQuery().setFileId(contractResult.file_id).execute(servicesNode.client);
        expect(fileInfo).to.exist;
        expect(fileInfo instanceof FileInfo).to.be.true;
        expect(fileInfo.isDeleted).to.be.true;
        expect(fileInfo.size.toNumber()).to.eq(0);
      });

      it('@xts should execute "eth_sendRawTransaction" and deploy a real contract which can be accessible', async function () {
        // deploy contract
        const deploymentTransaction = {
          ...defaultLondonTransactionData,
          value: 0,
          data: basicContract.bytecode,
          nonce: await relay.getAccountNonce(accounts[2].address),
        };
        const signedTx = await accounts[2].wallet.signTransaction(deploymentTransaction);
        const deploymentTxHash = await relay.sendRawTransaction(signedTx);
        await relay.pollForValidTransactionReceipt(deploymentTxHash);

        // confirm contract deployment successful via MN
        const info = await mirrorNode.get(`/contracts/results/${deploymentTxHash}`);
        expect(info).to.have.property('address');
        expect(info.address).to.not.be.null;
        const contractInfo = await mirrorNode.get(`/contracts/${info.address}`);
        expect(contractInfo).to.have.property('bytecode');
        expect(contractInfo.bytecode).to.not.be.null;

        // confirm contract accessibility
        const deployedContract = new ethers.Contract(info.address, basicContract.abi, accounts[2].wallet);
        expect(await deployedContract.getAddress()).to.eq(contractInfo.evm_address);
        expect(await deployedContract.getDeployedCode()).to.eq(contractInfo.runtime_bytecode);
        const result = await deployedContract.ping();
        expect(result).to.eq(1n);
      });

      it('@xts should execute "eth_sendRawTransaction" of type 1 and deploy a real contract', async function () {
        //omitting the "to" and "nonce" fields when creating a new contract
        const transaction = {
          ...defaultLegacy2930TransactionData,
          value: 0,
          data: basicContract.bytecode,
          nonce: await relay.getAccountNonce(accounts[2].address),
        };

        const signedTx = await accounts[2].wallet.signTransaction(transaction);
        const transactionHash = await relay.sendRawTransaction(signedTx);
        await relay.pollForValidTransactionReceipt(transactionHash);
        const info = await mirrorNode.get(`/contracts/results/${transactionHash}`);
        expect(info).to.have.property('contract_id');
        expect(info.contract_id).to.not.be.null;
        expect(info).to.have.property('created_contract_ids');
        expect(info.created_contract_ids.length).to.be.equal(1);
        expect(info.max_fee_per_gas).to.eq('0x');
        expect(info.max_priority_fee_per_gas).to.eq('0x');
        expect(info).to.have.property('access_list');
      });

      it('@xts should execute "eth_sendRawTransaction" of type 2 and deploy a real contract', async function () {
        //omitting the "to" and "nonce" fields when creating a new contract
        const transaction = {
          ...defaultLondonTransactionData,
          value: 0,
          data: basicContract.bytecode,
          nonce: await relay.getAccountNonce(accounts[2].address),
        };

        const signedTx = await accounts[2].wallet.signTransaction(transaction);
        const transactionHash = await relay.sendRawTransaction(signedTx);
        await relay.pollForValidTransactionReceipt(transactionHash);
        const info = await mirrorNode.get(`/contracts/results/${transactionHash}`);
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

      it('@xts should execute "eth_sendRawTransaction" and deploy a contract with reasonable transaction fee within expected bounds', async function () {
        const balanceBefore = await relay.getBalance(accounts[2].wallet.address, 'latest');

        const gasPrice = await relay.gasPrice();
        const transaction = {
          type: 2,
          chainId: Number(CHAIN_ID),
          nonce: await relay.getAccountNonce(accounts[2].address),
          maxPriorityFeePerGas: gasPrice,
          maxFeePerGas: gasPrice,
          gasLimit: Constants.MAX_TRANSACTION_FEE_THRESHOLD,
          data: '0x' + '00'.repeat(100),
        };

        const signedTx = await accounts[2].wallet.signTransaction(transaction);
        const transactionHash = await relay.sendRawTransaction(signedTx);
        await relay.pollForValidTransactionReceipt(transactionHash);
        const info = await mirrorNode.get(`/contracts/results/${transactionHash}`);
        const balanceAfter = await relay.getBalance(accounts[2].wallet.address, 'latest');
        expect(info).to.have.property('contract_id');
        expect(info.contract_id).to.not.be.null;
        expect(info).to.have.property('created_contract_ids');
        expect(info.created_contract_ids.length).to.be.equal(1);

        // Calculate fee in tinybars first to avoid precision loss, then convert to HBAR for comparison
        const diffInTinybars = BigInt(balanceBefore - balanceAfter) / BigInt(Constants.TINYBAR_TO_WEIBAR_COEF);
        const diffInHbars = Number(diffInTinybars) / 100_000_000; // Convert tinybars to HBAR as decimal

        const maxPossibleFeeInHbars =
          (gasPrice * Constants.MAX_TRANSACTION_FEE_THRESHOLD) / Constants.TINYBAR_TO_WEIBAR_COEF / 100_000_000;

        // Ensure fee is greater than 0 and reasonable for contract deployment
        expect(diffInHbars).to.be.greaterThan(0);
        expect(diffInHbars).to.be.lessThan(maxPossibleFeeInHbars);
      });

      describe('Check subsidizing gas fees', async function () {
        withOverriddenEnvsInMochaTest(
          {
            PAYMASTER_ENABLED: true,
            PAYMASTER_WHITELIST: ['*'],
            MAX_GAS_ALLOWANCE_HBAR: 100,
          },
          () => {
            it('should execute a pre EIP-1559 transaction with "eth_sendRawTransaction" and pays the total amount of the fees on behalf of the sender', async function () {
              const balanceBefore = await relay.getBalance(accounts[2].wallet.address, 'latest');

              const transaction = {
                type: 1,
                chainId: Number(CHAIN_ID),
                nonce: await relay.getAccountNonce(accounts[2].wallet.address),
                gasPrice: 0,
                gasLimit: Constants.MAX_TRANSACTION_FEE_THRESHOLD,
                data: '0x00',
              };
              const signedTx = await accounts[2].wallet.signTransaction(transaction);
              const transactionHash = await relay.sendRawTransaction(signedTx);
              const info = await mirrorNode.get(`/contracts/results/${transactionHash}`);
              expect(info).to.have.property('contract_id');
              expect(info.contract_id).to.not.be.null;
              expect(info).to.have.property('created_contract_ids');
              expect(info.created_contract_ids.length).to.be.equal(1);

              const balanceAfter = await relay.getBalance(accounts[2].wallet.address, 'latest');
              expect(balanceAfter).to.be.equal(balanceBefore);
            });

            it('should execute a post EIP-1559 transaction with "eth_sendRawTransaction" and pays the total amount of the fees on behalf of the sender', async function () {
              const balanceBefore = await relay.getBalance(accounts[2].wallet.address, 'latest');

              const transaction = {
                type: 2,
                chainId: Number(CHAIN_ID),
                nonce: await relay.getAccountNonce(accounts[2].wallet.address),
                maxPriorityFeePerGas: 0,
                maxFeePerGas: 0,
                gasLimit: Constants.MAX_TRANSACTION_FEE_THRESHOLD,
                data: '0x00',
              };
              const signedTx = await accounts[2].wallet.signTransaction(transaction);
              const transactionHash = await relay.sendRawTransaction(signedTx);
              const info = await mirrorNode.get(`/contracts/results/${transactionHash}`);
              expect(info).to.have.property('contract_id');
              expect(info.contract_id).to.not.be.null;
              expect(info).to.have.property('created_contract_ids');
              expect(info.created_contract_ids.length).to.be.equal(1);

              const balanceAfter = await relay.getBalance(accounts[2].wallet.address, 'latest');
              expect(balanceAfter).to.be.equal(balanceBefore);
            });
          },
        );
      });

      describe('Prechecks', async function () {
        it('should fail "eth_sendRawTransaction" for transaction with incorrect chain_id', async function () {
          const transaction = {
            ...default155TransactionData,
            to: parentContractAddress,
            nonce: await relay.getAccountNonce(accounts[2].address),
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
            nonce: await relay.getAccountNonce(accounts[2].address),
            gasLimit: gasLimit,
            gasPrice: await relay.gasPrice(),
          };

          const signedTx = await accounts[2].wallet.signTransaction(transaction);
          const error = predefined.GAS_LIMIT_TOO_LOW(gasLimit, Constants.MAX_TRANSACTION_FEE_THRESHOLD);

          await Assertions.assertPredefinedRpcError(error, sendRawTransaction, false, relay, [
            signedTx,
            requestDetails,
          ]);
        });

        it('should fail "eth_sendRawTransaction" when transaction has invalid format', async function () {
          const error = predefined.INVALID_ARGUMENTS('unexpected junk after rlp payload');

          await Assertions.assertPredefinedRpcError(error, sendRawTransaction, true, relay, [
            Constants.INVALID_TRANSACTION,
            requestDetails,
          ]);
        });

        it('should fail "eth_sendRawTransaction" for EIP155 transaction with a too high gasLimit', async function () {
          const gasLimit = 999999999;
          const transaction = {
            ...default155TransactionData,
            to: parentContractAddress,
            nonce: await relay.getAccountNonce(accounts[2].address),
            gasLimit: gasLimit,
            gasPrice: await relay.gasPrice(),
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
            nonce: await relay.getAccountNonce(accounts[2].address),
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
            nonce: await relay.getAccountNonce(accounts[2].address),
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
            nonce: await relay.getAccountNonce(accounts[2].address),
          };
          const signedTx = await accounts[2].wallet.signTransaction(transaction);
          const error = predefined.GAS_PRICE_TOO_LOW(GAS_PRICE_TOO_LOW, GAS_PRICE_REF);

          await Assertions.assertPredefinedRpcError(error, sendRawTransaction, false, relay, [
            signedTx,
            requestDetails,
          ]);
        });

        it('@release fail "eth_getTransactionReceipt" on precheck with wrong nonce error when sending a tx with the same nonce twice', async function () {
          const nonce = await relay.getAccountNonce(accounts[2].address);
          const transaction = {
            ...default155TransactionData,
            to: parentContractAddress,
            nonce: nonce,
            maxFeePerGas: await relay.gasPrice(),
          };

          const signedTx = await accounts[2].wallet.signTransaction(transaction);
          const txHash1 = await relay.sendRawTransaction(signedTx);
          const mirrorResult = await mirrorNode.get(`/contracts/results/${txHash1}`);
          mirrorResult.from = accounts[2].wallet.address;
          mirrorResult.to = parentContractAddress;

          const res = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_GET_TRANSACTION_RECEIPT, [txHash1]);
          const currentPrice = await relay.gasPrice();
          Assertions.transactionReceipt(res, mirrorResult, currentPrice);
          const error = predefined.NONCE_TOO_LOW(nonce, nonce + 1);

          await Assertions.assertPredefinedRpcError(error, sendRawTransaction, true, relay, [signedTx, requestDetails]);
        });

        if (!useAsyncTxProcessing) {
          it('@release fail "eth_getTransactionReceipt" on precheck with wrong nonce error when sending a tx with a higher nonce', async function () {
            const nonce = await relay.getAccountNonce(accounts[2].address);

            const transaction = {
              ...default155TransactionData,
              to: parentContractAddress,
              nonce: nonce + 100,
              gasPrice: await relay.gasPrice(),
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
          const nonce = await relay.getAccountNonce(accounts[2].address);

          const transaction1 = {
            ...default155TransactionData,
            to: parentContractAddress,
            nonce: nonce,
            maxFeePerGas: await relay.gasPrice(),
          };

          const signedTx = await accounts[2].wallet.signTransaction(transaction1);

          const res = await relay.sendRawTransaction(signedTx);
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
          const verifyAccount = await mirrorNode.get(`/accounts/${toAddress}`);

          if (verifyAccount && !verifyAccount.account) {
            verifyAccount == (await mirrorNode.get(`/accounts/${toAddress}`));
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
          const verifyAccount = await mirrorNode.get(`/accounts/${toAddress}`);
          if (verifyAccount && !verifyAccount.account) {
            verifyAccount == (await mirrorNode.get(`/accounts/${toAddress}`));
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
          const transactionHash = await relay.sendRawTransaction(signedTx);
          await relay.pollForValidTransactionReceipt(transactionHash);

          const info = await mirrorNode.get(`/contracts/results/${transactionHash}`);

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
            nonce: await relay.getAccountNonce(accounts[2].address),
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
        const gasPrice = await relay.gasPrice();
        const transaction = {
          ...defaultLondonTransactionData,
          to: parentContractAddress,
          nonce: await relay.getAccountNonce(accounts[2].address),
          maxPriorityFeePerGas: gasPrice,
          maxFeePerGas: gasPrice,
        };
        const signedTx = await accounts[2].wallet.signTransaction(transaction);
        const transactionHash = await relay.sendRawTransaction(signedTx);
        const mirrorTransaction = await mirrorNode.get(`/contracts/results/${transactionHash}`);

        const res = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_GET_TRANSACTION_BY_HASH, [transactionHash]);
        const addressResult = await mirrorNode.get(`/accounts/${res.from}`);
        mirrorTransaction.from = addressResult.evm_address;

        Assertions.transaction(res, mirrorTransaction);
      });

      it('should execute "eth_getTransactionByHash" for non-existing transaction and return null', async function () {
        const res = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_GET_TRANSACTION_BY_HASH, [
          Address.NON_EXISTING_TX_HASH,
        ]);
        expect(res).to.be.null;
      });
    });
  });
});
