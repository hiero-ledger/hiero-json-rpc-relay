// SPDX-License-Identifier: Apache-2.0

import MockAdapter from 'axios-mock-adapter';
import { expect, use } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import pino from 'pino';
import { Registry } from 'prom-client';
import sinon from 'sinon';

import { ConfigService } from '../../../src/config-service/services';
import { nanOrNumberTo0x, nullableNumberTo0x, numberTo0x, toHash32 } from '../../../src/relay/formatters';
import { MirrorNodeClient } from '../../../src/relay/lib/clients';
import type { ICacheClient } from '../../../src/relay/lib/clients/cache/ICacheClient';
import constants from '../../../src/relay/lib/constants';
import { CacheClientFactory } from '../../../src/relay/lib/factories/cacheClientFactory';
import { Log, Transaction } from '../../../src/relay/lib/model';
import { __test__ } from '../../../src/relay/lib/services/ethService/blockService/blockWorker';
import { CommonService } from '../../../src/relay/lib/services/ethService/ethCommonService/CommonService';
import { MirrorNodeContractResult, RequestDetails } from '../../../src/relay/lib/types';
import { defaultDetailedContractResults, overrideEnvsInMochaDescribe, useInMemoryRedisServer } from '../helpers';

use(chaiAsPromised);

const logger = pino({ level: 'silent' });
const registry = new Registry();

let restMock: MockAdapter;
let mirrorNodeInstance: MirrorNodeClient;
let cacheService: ICacheClient;

const blockHashTrimmed = '0x3c08bbbee74d287b1dcd3f0ca6d1d2cb92c90883c4acf9747de9f3f3162ad25b';
const blockHash = `${blockHashTrimmed}999fc7e86699f60f2a3fb3ed9a646c6b`;
const blockNumber = 3;
const firstTransactionTimestampSeconds = '1653077541';
const contractTimestamp1 = `${firstTransactionTimestampSeconds}.983983199`;
const contractHash1 = '0x4a563af33c4871b51a8b108aa2fe1dd5280a30dfb7236170ae5e5e7957eb6392';
const contractHash2 = '0x4a563af33c4871b51a8b108aa2fe1dd5280a30dfb7236170ae5e5e7957eb6393';
const contractHash3 = '0x4a563af33c4871b51a8b108aa2fe1dd5280a30dfb7236170ae5e5e7957eb6394';
const contractId1 = '0.0.1375';

const defaultLogTopics = [
  '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
  '0x0000000000000000000000000000000000000000000000000000000000000000',
  '0x000000000000000000000000000000000000000000000000000000000208fa13',
  '0x0000000000000000000000000000000000000000000000000000000000000005',
];

const logBloom1 = '0x1111';
const logBloom2 = '0x2222';
const defaultLogs1 = [
  {
    address: '0x67D8d32E9Bf1a9968a5ff53B87d777Aa8EBBEe69',
    bloom: logBloom1,
    contract_id: contractId1,
    data: '0x',
    index: 0,
    topics: defaultLogTopics,
    root_contract_id: '0.0.34806097',
    timestamp: contractTimestamp1,
    block_hash: blockHash,
    block_number: blockNumber,
    transaction_hash: contractHash1,
    transaction_index: 1,
  },
  {
    address: '0x67D8d32E9Bf1a9968a5ff53B87d777Aa8EBBEe69',
    bloom: logBloom2,
    contract_id: contractId1,
    data: '0x',
    index: 1,
    topics: defaultLogTopics,
    root_contract_id: '0.0.34806097',
    timestamp: contractTimestamp1,
    block_hash: blockHash,
    block_number: blockNumber,
    transaction_hash: contractHash2,
    transaction_index: 1,
  },
  {
    address: '0x67D8d32E9Bf1a9968a5ff53B87d777Aa8EBBEe69',
    bloom: logBloom2,
    contract_id: contractId1,
    data: '0x',
    index: 2,
    topics: defaultLogTopics,
    root_contract_id: '0.0.34806097',
    timestamp: contractTimestamp1,
    block_hash: blockHash,
    block_number: blockNumber,
    transaction_hash: contractHash3,
    transaction_index: 1,
  },
];

describe('eth_getBlockBy', async function () {
  this.timeout(10000);

  useInMemoryRedisServer(logger, 5031);
  overrideEnvsInMochaDescribe({ ETH_FEE_HISTORY_FIXED: false });

  this.beforeAll(async () => {
    const redisClientMock = {
      connect: sinon.stub().resolves(true),
      on: sinon.stub(),
      eval: sinon.stub(),
      quit: sinon.stub().resolves(true),
    } as any;
    cacheService = CacheClientFactory.create(logger, registry, new Set(), redisClientMock as any);

    // @ts-ignore
    mirrorNodeInstance = new MirrorNodeClient(
      ConfigService.get('MIRROR_NODE_URL'),
      logger.child({ name: `mirror-node` }),
      registry,
      cacheService,
    );

    // @ts-ignore
    restMock = new MockAdapter(mirrorNodeInstance.getMirrorNodeRestInstance(), { onNoMatch: 'throwException' });
  });

  this.beforeEach(async () => {
    await cacheService.clear();
    restMock.reset();
  });

  const mirrorLogToModelLog = (mirrorLog: (typeof defaultLogs1)[0]) => {
    return new Log({
      address: mirrorLog.address,
      blockHash: mirrorLog.block_hash,
      blockNumber: mirrorLog.block_number,
      data: mirrorLog.data,
      logIndex: mirrorLog.index,
      topics: mirrorLog.topics,
      transactionHash: mirrorLog.transaction_hash,
      transactionIndex: mirrorLog.transaction_index,
    });
  };

  const modelLog1 = mirrorLogToModelLog(defaultLogs1[0]);
  const modelLog2 = mirrorLogToModelLog(defaultLogs1[1]);
  const modelLog3 = mirrorLogToModelLog(defaultLogs1[2]);
  const referenceLogs = [modelLog1, modelLog2, modelLog3];
  describe('populateSyntheticTransactions w showDetails=false', () => {
    const showDetails = false;

    it('populateSyntheticTransactions with no dupes in empty transactionHashes', async function () {
      const initHashes: string[] = [];
      const result = __test__.__private.populateSyntheticTransactions(showDetails, referenceLogs, initHashes, '0x12a');
      expect(result.length).to.equal(defaultLogs1.length);
      expect(result[0]).to.equal(modelLog1.transactionHash);
      expect(result[1]).to.equal(modelLog2.transactionHash);
      expect(result[2]).to.equal(modelLog3.transactionHash);
    });

    it('populateSyntheticTransactions with no dupes in non empty transactionHashes', async function () {
      const initHashes = ['txHash1', 'txHash2'];
      const result = __test__.__private.populateSyntheticTransactions(showDetails, referenceLogs, initHashes, '0x12a');
      expect(result.length).to.equal(initHashes.length + defaultLogs1.length);
      expect(result[initHashes.length + 0]).to.equal(modelLog1.transactionHash);
      expect(result[initHashes.length + 1]).to.equal(modelLog2.transactionHash);
      expect(result[initHashes.length + 2]).to.equal(modelLog3.transactionHash);
    });

    it('populateSyntheticTransactions with 1 transaction dupes in transactionHashes', async function () {
      const initHashes = [modelLog2.transactionHash];
      const result = __test__.__private.populateSyntheticTransactions(showDetails, referenceLogs, initHashes, '0x12a');
      expect(result.length).to.equal(referenceLogs.length);
      expect(result[0]).to.equal(contractHash2);
      expect(result[1]).to.equal(modelLog1.transactionHash);
      expect(result[2]).to.equal(modelLog3.transactionHash);
    });

    it('populateSyntheticTransactions with all dupes in transactionHashes', async function () {
      const initHashes = [modelLog1.transactionHash, modelLog2.transactionHash, modelLog3.transactionHash];
      const result = __test__.__private.populateSyntheticTransactions(showDetails, referenceLogs, initHashes, '0x12a');
      expect(result.length).to.equal(referenceLogs.length);
      expect(result[0]).to.equal(modelLog1.transactionHash);
      expect(result[1]).to.equal(modelLog2.transactionHash);
      expect(result[2]).to.equal(modelLog3.transactionHash);
    });
  });

  describe('populateSyntheticTransactions w showDetails=true', () => {
    const getTransactionModel = (transactionHash: string) => {
      return new Transaction({
        accessList: undefined, // we don't support access lists for now, so punt
        blockHash: toHash32(defaultDetailedContractResults.block_hash),
        blockNumber: numberTo0x(defaultDetailedContractResults.block_number),
        chainId: defaultDetailedContractResults.chain_id,
        from: defaultDetailedContractResults.from.substring(0, 42),
        gas: nanOrNumberTo0x(defaultDetailedContractResults.gas_used),
        gasPrice: null,
        hash: transactionHash,
        input: defaultDetailedContractResults.function_parameters,
        maxPriorityFeePerGas: null,
        maxFeePerGas: null,
        nonce: nanOrNumberTo0x(defaultDetailedContractResults.nonce),
        r: constants.ZERO_HEX,
        s: constants.ZERO_HEX,
        to: defaultDetailedContractResults.to.substring(0, 42),
        transactionIndex: nullableNumberTo0x(defaultDetailedContractResults.transaction_index),
        type: nullableNumberTo0x(defaultDetailedContractResults.type),
        v: nanOrNumberTo0x(defaultDetailedContractResults.v),
        value: nanOrNumberTo0x(defaultDetailedContractResults.amount),
      });
    };

    const showDetails = true;
    it('populateSyntheticTransactions with no dupes in empty txObjects', async function () {
      const initTxObjects: Transaction[] = [];
      const result = __test__.__private.populateSyntheticTransactions(
        showDetails,
        referenceLogs,
        initTxObjects,
        '0x12a',
      ) as Transaction[];
      expect(result.length).to.equal(defaultLogs1.length);
      expect(result[0].hash).to.equal(modelLog1.transactionHash);
      expect(result[1].hash).to.equal(modelLog2.transactionHash);
      expect(result[2].hash).to.equal(modelLog3.transactionHash);
    });

    it('populateSyntheticTransactions with no dupes in non empty txObjects', async function () {
      const initTxObjects = [getTransactionModel('txHash1'), getTransactionModel('txHash2')];
      const result = __test__.__private.populateSyntheticTransactions(
        showDetails,
        referenceLogs,
        initTxObjects,
        '0x12a',
      ) as Transaction[];
      expect(result.length).to.equal(initTxObjects.length + defaultLogs1.length);
      expect(result[initTxObjects.length + 0].hash).to.equal(modelLog1.transactionHash);
      expect(result[initTxObjects.length + 1].hash).to.equal(modelLog2.transactionHash);
      expect(result[initTxObjects.length + 2].hash).to.equal(modelLog3.transactionHash);
    });

    it('populateSyntheticTransactions with 1 transaction dupes in txObjects', async function () {
      const initTxObjects = [getTransactionModel(modelLog2.transactionHash)];
      const result = __test__.__private.populateSyntheticTransactions(
        showDetails,
        referenceLogs,
        initTxObjects,
        '0x12a',
      ) as Transaction[];
      expect(result.length).to.equal(referenceLogs.length);
      expect(result[0].hash).to.equal(contractHash2);
      expect(result[1].hash).to.equal(modelLog1.transactionHash);
      expect(result[2].hash).to.equal(modelLog3.transactionHash);
    });

    it('populateSyntheticTransactions with all dupes in txObjects', async function () {
      const initTxObjects = [
        getTransactionModel(modelLog1.transactionHash),
        getTransactionModel(modelLog2.transactionHash),
        getTransactionModel(modelLog3.transactionHash),
      ];
      const result = __test__.__private.populateSyntheticTransactions(
        showDetails,
        referenceLogs,
        initTxObjects,
        '0x12a',
      ) as Transaction[];
      expect(result.length).to.equal(referenceLogs.length);
      expect(result[0].hash).to.equal(modelLog1.transactionHash);
      expect(result[1].hash).to.equal(modelLog2.transactionHash);
      expect(result[2].hash).to.equal(modelLog3.transactionHash);
    });

    it('deduplicates duplicate transaction objects in the result', async function () {
      const tx1 = getTransactionModel(modelLog1.transactionHash);
      const tx2 = getTransactionModel(modelLog1.transactionHash); // duplicate hash, different object
      const initTxObjects = [tx1, tx2];

      const txObjects = initTxObjects.slice();
      const returnedTxObjects = __test__.__private.populateSyntheticTransactions(
        true,
        referenceLogs,
        txObjects,
        '0x12a',
      );

      // Should only have one object with modelLog1.transactionHash
      const count = returnedTxObjects.filter((tx) => (tx as Transaction).hash === modelLog1.transactionHash).length;
      expect(count).to.equal(1);

      expect(returnedTxObjects.length).to.equal(referenceLogs.length);
    });

    it('handles duplicate log transaction hashes correctly', async function () {
      const duplicateLogs = [
        mirrorLogToModelLog({ ...defaultLogs1[0], transaction_hash: contractHash1 }),
        mirrorLogToModelLog({ ...defaultLogs1[1], transaction_hash: contractHash1 }), // Same hash as above
        mirrorLogToModelLog({ ...defaultLogs1[2], transaction_hash: contractHash2 }),
      ];

      const result = __test__.__private.populateSyntheticTransactions(
        true,
        duplicateLogs,
        [],
        '0x12a',
      ) as Transaction[];

      // Should only have 2 unique hashes despite 3 logs
      expect(result.length).to.equal(2);
      expect(result.map((tx) => tx.hash)).to.include(contractHash1);
      expect(result.map((tx) => tx.hash)).to.include(contractHash2);
    });

    it('handles large transaction arrays with O(n) performance', async function () {
      const makeLogs = (count: number) =>
        Array.from({ length: count }, (_, i) =>
          mirrorLogToModelLog({
            ...defaultLogs1[0],
            transaction_hash: `0x${i.toString(16).padStart(64, '0')}`,
            index: i,
          }),
        );

      const runOnce = (logs: ReturnType<typeof makeLogs>) =>
        __test__.__private.populateSyntheticTransactions(false, logs, [], '0x12a');

      const median = (values: number[]) => {
        const sorted = [...values].sort((a, b) => a - b);
        const mid = Math.floor(sorted.length / 2);
        return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
      };

      // Generate 10000 logs with unique hashes
      const logsN = makeLogs(10000);
      // Generate 20000 logs with unique hashes
      const logs2N = makeLogs(20000);

      // Warm-up
      runOnce(logsN);

      const measureRuns = (logs: ReturnType<typeof makeLogs>, expectedLen: number, runs = 5) => {
        const times: number[] = [];
        for (let i = 0; i < runs; i++) {
          const t0 = performance.now();
          const result = runOnce(logs);
          times.push(performance.now() - t0);
          expect(result.length).to.equal(expectedLen);
        }
        return times;
      };

      const timesN = measureRuns(logsN, 10000);
      const times2N = measureRuns(logs2N, 20000);

      const ratio = median(times2N) / median(timesN);

      // Loose bound to avoid flakiness but still catch superlinear behavior.
      expect(ratio).to.be.lessThan(2.5);
    });
  });

  describe('resolveUniqueAddresses', () => {
    const requestDetails = new RequestDetails({ requestId: 'resolveUniqueAddressesTest', ipAddress: '0.0.0.0' });

    it('deduplicates shared from/to addresses and resolves each unique address once', async function () {
      const resolveStub = sinon.stub();
      resolveStub.callsFake(async (addr: string) => `resolved_${addr}`);
      const fakeCommon = { resolveEvmAddress: resolveStub } as unknown as CommonService;

      const contractResults = [
        { from: '0xAAA', to: '0xBBB', hash: 'h1', transaction_index: 0 },
        { from: '0xAAA', to: '0xCCC', hash: 'h2', transaction_index: 1 },
        { from: '0xBBB', to: '0xAAA', hash: 'h3', transaction_index: 2 },
      ] as unknown as MirrorNodeContractResult[];

      const resolved = await __test__.__private.resolveUniqueAddresses(contractResults, requestDetails, fakeCommon);

      // 0xAAA (from), 0xBBB (from + to, but from wins), 0xCCC (to-only) = 3 unique addresses
      expect(resolved.size).to.equal(3);
      expect(resolved.get('0xAAA')).to.equal('resolved_0xAAA');
      expect(resolved.get('0xBBB')).to.equal('resolved_0xBBB');
      expect(resolved.get('0xCCC')).to.equal('resolved_0xCCC');

      // 'from' addresses get TYPE_ACCOUNT, 'to-only' addresses get default types
      const fromCalls = resolveStub.getCalls().filter((c) => c.args[2]?.[0] === constants.TYPE_ACCOUNT);
      expect(fromCalls.length).to.equal(2); // 0xAAA, 0xBBB
    });

    it('handles empty contract results', async function () {
      const fakeCommon = {
        resolveEvmAddress: sinon.stub().resolves('resolved'),
      } as unknown as CommonService;

      const resolved = await __test__.__private.resolveUniqueAddresses(
        [] as unknown as MirrorNodeContractResult[],
        requestDetails,
        fakeCommon,
      );
      expect(resolved.size).to.equal(0);
    });

    it('handles contract results with null to addresses', async function () {
      const resolveStub = sinon.stub();
      resolveStub.callsFake(async (addr: string) => `resolved_${addr}`);
      const fakeCommon = { resolveEvmAddress: resolveStub } as unknown as CommonService;

      const contractResults = [
        { from: '0xAAA', to: null, hash: 'h1', transaction_index: 0 },
        { from: '0xBBB', to: '0xCCC', hash: 'h2', transaction_index: 1 },
      ] as unknown as MirrorNodeContractResult[];

      const resolved = await __test__.__private.resolveUniqueAddresses(contractResults, requestDetails, fakeCommon);

      // 0xAAA (from), 0xBBB (from), 0xCCC (to-only) = 3 unique; null is skipped
      expect(resolved.size).to.equal(3);
      expect(resolved.has('0xAAA')).to.be.true;
      expect(resolved.has('0xBBB')).to.be.true;
      expect(resolved.has('0xCCC')).to.be.true;
    });

    it('correctly classifies toOnly regardless of record order (order-independent)', async function () {
      const resolveStub = sinon.stub();
      resolveStub.callsFake(async (addr: string) => `resolved_${addr}`);
      const fakeCommon = { resolveEvmAddress: resolveStub } as unknown as CommonService;

      // In this sequence, "b", "c", "d" appear as 'to' before they appear as 'from' in later records.
      // Only "e" should be classified as toOnly.
      const contractResults = [
        { from: '0xA', to: '0xB', hash: 'h1', transaction_index: 0 },
        { from: '0xB', to: '0xC', hash: 'h2', transaction_index: 1 },
        { from: '0xC', to: '0xD', hash: 'h3', transaction_index: 2 },
        { from: '0xD', to: '0xE', hash: 'h4', transaction_index: 3 },
      ] as unknown as MirrorNodeContractResult[];

      const resolved = await __test__.__private.resolveUniqueAddresses(contractResults, requestDetails, fakeCommon);

      // All 5 unique addresses should be resolved
      expect(resolved.size).to.equal(5);
      expect(resolved.get('0xA')).to.equal('resolved_0xA');
      expect(resolved.get('0xB')).to.equal('resolved_0xB');
      expect(resolved.get('0xC')).to.equal('resolved_0xC');
      expect(resolved.get('0xD')).to.equal('resolved_0xD');
      expect(resolved.get('0xE')).to.equal('resolved_0xE');

      // 'from' addresses (0xA, 0xB, 0xC, 0xD) should be resolved with TYPE_ACCOUNT
      const fromCalls = resolveStub.getCalls().filter((c) => c.args[2]?.[0] === constants.TYPE_ACCOUNT);
      expect(fromCalls.length).to.equal(4);

      // Only 0xE should be resolved without TYPE_ACCOUNT (toOnly)
      const toOnlyCalls = resolveStub.getCalls().filter((c) => !c.args[2]);
      expect(toOnlyCalls.length).to.equal(1);
      expect(toOnlyCalls[0].args[0]).to.equal('0xE');
    });

    it('returns empty toOnly when all to addresses also appear as from', async function () {
      const resolveStub = sinon.stub();
      resolveStub.callsFake(async (addr: string) => `resolved_${addr}`);
      const fakeCommon = { resolveEvmAddress: resolveStub } as unknown as CommonService;

      // Circular: every address appears in both from and to
      const contractResults = [
        { from: '0xA', to: '0xB', hash: 'h1', transaction_index: 0 },
        { from: '0xB', to: '0xA', hash: 'h2', transaction_index: 1 },
      ] as unknown as MirrorNodeContractResult[];

      const resolved = await __test__.__private.resolveUniqueAddresses(contractResults, requestDetails, fakeCommon);

      // 2 unique addresses, both resolved as 'from' (TYPE_ACCOUNT)
      expect(resolved.size).to.equal(2);

      // All calls should use TYPE_ACCOUNT since there are no toOnly addresses
      const fromCalls = resolveStub.getCalls().filter((c) => c.args[2]?.[0] === constants.TYPE_ACCOUNT);
      expect(fromCalls.length).to.equal(2);

      const toOnlyCalls = resolveStub.getCalls().filter((c) => !c.args[2]);
      expect(toOnlyCalls.length).to.equal(0);
    });
  });

  describe('prepareTransactionArray', () => {
    const requestDetails = new RequestDetails({ requestId: 'prepareTransactionArrayTest', ipAddress: '0.0.0.0' });

    it('returns only hashes when showDetails is false', async function () {
      const fakeCommon = {
        resolveEvmAddress: sinon.stub().resolves('0xResolved'),
      } as unknown as CommonService;

      const contractResults = [
        { hash: '0xhash1', from: '0xA', to: '0xB', transaction_index: 0 },
        { hash: '0xhash2', from: '0xC', to: '0xD', transaction_index: 1 },
      ] as unknown as MirrorNodeContractResult[];

      const result = await __test__.__private.prepareTransactionArray(
        contractResults,
        false,
        requestDetails,
        '0x12a',
        fakeCommon,
      );

      expect(result).to.deep.equal(['0xhash1', '0xhash2']);
      // Should not call resolveEvmAddress when showDetails is false
      expect(fakeCommon.resolveEvmAddress.called).to.be.false;
    });

    it('sorts contract results by transaction_index when showDetails is true', async function () {
      const resolveStub = sinon.stub();
      resolveStub.callsFake(async (addr: string) => addr);
      const fakeCommon = { resolveEvmAddress: resolveStub } as unknown as CommonService;

      const contractResults = [
        {
          ...defaultDetailedContractResults,
          hash: '0xhash_b',
          from: '0xA',
          to: '0xB',
          transaction_index: 2,
          chain_id: '0x12a',
        },
        {
          ...defaultDetailedContractResults,
          hash: '0xhash_a',
          from: '0xC',
          to: '0xD',
          transaction_index: 1,
          chain_id: '0x12a',
        },
      ] as unknown as MirrorNodeContractResult[];

      const result = (await __test__.__private.prepareTransactionArray(
        contractResults,
        true,
        requestDetails,
        '0x12a',
        fakeCommon,
      )) as Transaction[];

      // Should be sorted by transaction_index: index 1 first, then index 2
      expect(result.length).to.be.greaterThan(0);
      if (result.length === 2) {
        expect(result[0].hash).to.equal('0xhash_a');
        expect(result[1].hash).to.equal('0xhash_b');
      }
    });
  });

  describe('buildReceiptRootHashes', () => {
    it('returns empty array for no tx hashes', function () {
      const receipts = __test__.__private.buildReceiptRootHashes([], [] as unknown as MirrorNodeContractResult[], []);
      expect(receipts).to.deep.equal([]);
    });

    it('builds receipts sorted by transaction index', function () {
      const cr1 = {
        hash: '0xhash1',
        gas_used: 100,
        transaction_index: 2,
        type: 2,
        root: '0x01',
        status: '0x1',
        bloom: '0x00',
      } as unknown as MirrorNodeContractResult;
      const cr2 = {
        hash: '0xhash2',
        gas_used: 200,
        transaction_index: 1,
        type: 2,
        root: '0x01',
        status: '0x1',
        bloom: '0x00',
      } as unknown as MirrorNodeContractResult;

      const receipts = __test__.__private.buildReceiptRootHashes(['0xhash1', '0xhash2'], [cr1, cr2], []);

      expect(receipts.length).to.equal(2);
      // index 1 should come before index 2
      expect(receipts[0].transactionIndex).to.equal('0x1');
      expect(receipts[1].transactionIndex).to.equal('0x2');
    });

    it('accumulates cumulative gas correctly', function () {
      const cr1 = {
        hash: '0xhash1',
        gas_used: 100,
        transaction_index: 1,
        type: 0,
        root: '0x01',
        status: '0x1',
        bloom: '0x00',
      } as unknown as MirrorNodeContractResult;
      const cr2 = {
        hash: '0xhash2',
        gas_used: 250,
        transaction_index: 2,
        type: 0,
        root: '0x01',
        status: '0x1',
        bloom: '0x00',
      } as unknown as MirrorNodeContractResult;

      const receipts = __test__.__private.buildReceiptRootHashes(['0xhash1', '0xhash2'], [cr1, cr2], []);

      expect(receipts.length).to.equal(2);
      // First receipt: cumulative = 100, Second: cumulative = 100 + 250 = 350
      expect(receipts[0].cumulativeGasUsed).to.equal('0x64'); // 100
      expect(receipts[1].cumulativeGasUsed).to.equal('0x15e'); // 350
    });
  });
});
