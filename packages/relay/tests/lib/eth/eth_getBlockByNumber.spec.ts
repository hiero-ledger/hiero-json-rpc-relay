// SPDX-License-Identifier: Apache-2.0

import { fail } from 'assert';
import MockAdapter from 'axios-mock-adapter';
import { expect, use } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import sinon from 'sinon';

import { ASCIIToHex, numberTo0x, prepend0x } from '../../../dist/formatters';
import { CommonService } from '../../../dist/lib/services';
import { predefined } from '../../../src';
import { MirrorNodeClient, SDKClient } from '../../../src/lib/clients';
import type { ICacheClient } from '../../../src/lib/clients/cache/ICacheClient';
import constants from '../../../src/lib/constants';
import { EthImpl } from '../../../src/lib/eth';
import { Block, Transaction } from '../../../src/lib/model';
import HAPIService from '../../../src/lib/services/hapiService/hapiService';
import { RequestDetails } from '../../../src/lib/types';
import RelayAssertions from '../../assertions';
import {
  blockLogsBloom,
  defaultContractResults,
  defaultDetailedContractResults,
  mockWorkersPool,
  withOverriddenEnvsInMochaTest,
} from '../../helpers';
import {
  BLOCK_HASH,
  BLOCK_HASH_PREV_TRIMMED,
  BLOCK_HASH_TRIMMED,
  BLOCK_NOT_FOUND_RES,
  BLOCK_NUMBER,
  BLOCK_NUMBER_HEX,
  BLOCK_NUMBER_WITH_SYN_TXN,
  BLOCK_TIMESTAMP_HEX,
  BLOCK_WITH_SYN_TXN,
  BLOCKS_LIMIT_ORDER_URL,
  BLOCKS_RES,
  CONTRACT_ADDRESS_1,
  CONTRACT_ADDRESS_2,
  CONTRACT_HASH_1,
  CONTRACT_HASH_2,
  CONTRACT_QUERY,
  CONTRACT_RESPONSE_MOCK,
  CONTRACT_RESULTS_LOGS_WITH_FILTER_URL,
  CONTRACT_RESULTS_WITH_FILTER_URL,
  CONTRACT_TIMESTAMP_1,
  CONTRACT_TIMESTAMP_2,
  CONTRACTS_RESULTS_NEXT_URL,
  DEFAULT_BLOCK,
  DEFAULT_BLOCK_RECEIPTS_ROOT_HASH,
  DEFAULT_BLOCKS_RES,
  DEFAULT_CONTRACT_RES_REVERT,
  DEFAULT_ETH_GET_BLOCK_BY_LOGS,
  DEFAULT_LOGS,
  DEFAULT_NETWORK_FEES,
  GAS_USED_1,
  LATEST_BLOCK_QUERY,
  LATEST_BLOCK_RESPONSE,
  LINKS_NEXT_RES,
  LOG_QUERY,
  LOGS_RESPONSE_MOCK,
  MAX_GAS_LIMIT_HEX,
  MAX_GAS_LIMIT2_HEX,
  MOST_RECENT_BLOCK,
  NO_SUCH_BLOCK_EXISTS_RES,
  NOT_FOUND_RES,
} from './eth-config';
import { generateEthTestEnv } from './eth-helpers';

use(chaiAsPromised);

let sdkClientStub: sinon.SinonStubbedInstance<SDKClient>;
let getSdkClientStub: sinon.SinonStub;

describe('@ethGetBlockByNumber using MirrorNode', async function () {
  this.timeout(10000);
  const {
    restMock,
    hapiServiceInstance,
    ethImpl,
    cacheService,
    commonService,
    mirrorNodeInstance,
  }: {
    restMock: MockAdapter;
    hapiServiceInstance: HAPIService;
    ethImpl: EthImpl;
    cacheService: ICacheClient;
    commonService: CommonService;
    mirrorNodeInstance: MirrorNodeClient;
  } = generateEthTestEnv(true);
  const results = defaultContractResults.results;
  const TOTAL_GAS_USED = numberTo0x(results[0].gas_used + results[1].gas_used);

  const requestDetails = new RequestDetails({ requestId: 'eth_getBlockByNumberTest', ipAddress: '0.0.0.0' });

  const veriftAggregatedInfo = (result) => {
    // verify aggregated info
    expect(result).to.exist;
    expect(result).to.not.be.null;
    expect(result.hash).equal(BLOCK_HASH_TRIMMED);
    expect(result.number).equal(BLOCK_NUMBER_HEX);
    expect(result.parentHash).equal(BLOCK_HASH_PREV_TRIMMED);
    expect(result.timestamp).equal(BLOCK_TIMESTAMP_HEX);
  };

  function verifyTransactions(transactions: Array<Transaction>) {
    expect(transactions.length).equal(2);
    expect(transactions[0].hash).equal(CONTRACT_HASH_1);
    expect(transactions[0].gas).equal(MAX_GAS_LIMIT_HEX);
    expect(transactions[1].hash).equal(CONTRACT_HASH_2);
    expect(transactions[1].gas).equal(MAX_GAS_LIMIT2_HEX);
  }

  before(async () => {
    await mockWorkersPool(mirrorNodeInstance, commonService, cacheService);
  });

  this.beforeEach(async () => {
    // reset cache and restMock
    await cacheService.clear(requestDetails);
    restMock.reset();
    restMock.resetHandlers();

    sdkClientStub = sinon.createStubInstance(SDKClient);
    getSdkClientStub = sinon.stub(hapiServiceInstance, 'getSDKClient').returns(sdkClientStub);
    const modifiedNetworkFees = structuredClone(DEFAULT_NETWORK_FEES);
    modifiedNetworkFees.fees[2].gas *= 100;
    restMock.onGet('network/fees').reply(200, JSON.stringify(modifiedNetworkFees));
    restMock.onGet(`accounts/${defaultContractResults.results[0].from}?transactions=false`).reply(200);
    restMock.onGet(`accounts/${defaultContractResults.results[1].from}?transactions=false`).reply(200);
    restMock.onGet(`accounts/${defaultContractResults.results[0].to}?transactions=false`).reply(200);
    restMock.onGet(`accounts/${defaultContractResults.results[1].to}?transactions=false`).reply(200);
    restMock.onGet(`contracts/${defaultContractResults.results[0].from}`).reply(404, JSON.stringify(NOT_FOUND_RES));
    restMock.onGet(`contracts/${defaultContractResults.results[1].from}`).reply(404, JSON.stringify(NOT_FOUND_RES));
    restMock.onGet(`contracts/${defaultContractResults.results[0].to}`).reply(200);
    restMock.onGet(`contracts/${defaultContractResults.results[1].to}`).reply(200);
    restMock.onGet(`tokens/${defaultContractResults.results[0].contract_id}`).reply(200);
    restMock.onGet(`tokens/${defaultContractResults.results[1].contract_id}`).reply(200);
  });

  this.afterEach(() => {
    getSdkClientStub.restore();
  });

  it('"eth_blockNumber" should return the latest block number', async function () {
    restMock.onGet(BLOCKS_LIMIT_ORDER_URL).reply(200, JSON.stringify(DEFAULT_BLOCKS_RES));
    const blockNumber = await ethImpl.blockNumber(requestDetails);
    expect(blockNumber).to.be.eq(blockNumber);
  });

  it('"eth_blockNumber" should throw an error if no blocks are found', async function () {
    restMock.onGet(BLOCKS_LIMIT_ORDER_URL).reply(404, JSON.stringify(BLOCK_NOT_FOUND_RES));
    const error = predefined.COULD_NOT_RETRIEVE_LATEST_BLOCK;
    await RelayAssertions.assertRejection(error, ethImpl.blockNumber, true, ethImpl, [requestDetails]);
  });

  it('"eth_blockNumber" return the latest block number on second try', async function () {
    restMock
      .onGet(BLOCKS_LIMIT_ORDER_URL)
      .replyOnce(404, JSON.stringify(BLOCK_NOT_FOUND_RES))
      .onGet(BLOCKS_LIMIT_ORDER_URL)
      .replyOnce(200, JSON.stringify(DEFAULT_BLOCKS_RES));

    try {
      await ethImpl.blockNumber(requestDetails);
      // eslint-disable-next-line no-empty
    } catch {}
    const blockNumber = await ethImpl.blockNumber(requestDetails);

    expect(blockNumber).to.be.eq(blockNumber);
  });

  it('"eth_blockNumber" should throw an error if no blocks are found after third try', async function () {
    restMock.onGet(BLOCKS_LIMIT_ORDER_URL).reply(404, JSON.stringify(BLOCK_NOT_FOUND_RES));

    await RelayAssertions.assertRejection(
      predefined.COULD_NOT_RETRIEVE_LATEST_BLOCK,
      ethImpl.blockNumber,
      true,
      ethImpl,
      [requestDetails],
    );
  });

  describe('with match', async function () {
    beforeEach(function () {
      // mirror node request mocks
      restMock.onGet(`blocks/${BLOCK_NUMBER}`).reply(200, JSON.stringify(DEFAULT_BLOCK));
      restMock.onGet(`blocks/${BLOCK_HASH}`).reply(200, JSON.stringify(DEFAULT_BLOCK));
      restMock.onGet(BLOCKS_LIMIT_ORDER_URL).reply(200, JSON.stringify(MOST_RECENT_BLOCK));
      restMock.onGet(CONTRACT_RESULTS_LOGS_WITH_FILTER_URL).reply(200, JSON.stringify(DEFAULT_ETH_GET_BLOCK_BY_LOGS));
    });

    it('eth_getBlockByNumber with match', async function () {
      restMock.onGet(CONTRACT_RESULTS_WITH_FILTER_URL).reply(200, JSON.stringify(defaultContractResults));

      const result = await ethImpl.getBlockByNumber(numberTo0x(BLOCK_NUMBER), false, requestDetails);

      RelayAssertions.assertBlock(result, {
        hash: BLOCK_HASH_TRIMMED,
        gasUsed: TOTAL_GAS_USED,
        number: BLOCK_NUMBER_HEX,
        parentHash: BLOCK_HASH_PREV_TRIMMED,
        timestamp: BLOCK_TIMESTAMP_HEX,
        transactions: [CONTRACT_HASH_1, CONTRACT_HASH_2],
        receiptsRoot: DEFAULT_BLOCK_RECEIPTS_ROOT_HASH,
      });
    });

    it('eth_getBlockByNumber with match and duplicated transactions', async function () {
      restMock.onGet(CONTRACT_RESULTS_WITH_FILTER_URL).reply(
        200,
        JSON.stringify({
          results: [...defaultContractResults.results, ...defaultContractResults.results],
        }),
      );

      const res = await ethImpl.getBlockByNumber(numberTo0x(BLOCK_NUMBER), false, requestDetails);
      RelayAssertions.assertBlock(res, {
        transactions: [CONTRACT_HASH_1, CONTRACT_HASH_2],
        hash: BLOCK_HASH_TRIMMED,
        number: BLOCK_NUMBER_HEX,
        timestamp: BLOCK_TIMESTAMP_HEX,
        parentHash: BLOCK_HASH_PREV_TRIMMED,
        gasUsed: TOTAL_GAS_USED,
      });
    });

    it('eth_getBlockByNumber with match and valid logsBloom field', async function () {
      restMock.onGet(`blocks/${BLOCK_NUMBER}`).reply(
        200,
        JSON.stringify({
          ...DEFAULT_BLOCK,
          logs_bloom: blockLogsBloom,
        }),
      );
      restMock.onGet(CONTRACT_RESULTS_WITH_FILTER_URL).reply(200, JSON.stringify(defaultContractResults));

      const result = await ethImpl.getBlockByNumber(numberTo0x(BLOCK_NUMBER), false, requestDetails);

      RelayAssertions.assertBlock(result, {
        hash: BLOCK_HASH_TRIMMED,
        gasUsed: TOTAL_GAS_USED,
        number: BLOCK_NUMBER_HEX,
        parentHash: BLOCK_HASH_PREV_TRIMMED,
        timestamp: BLOCK_TIMESTAMP_HEX,
        transactions: [CONTRACT_HASH_1, CONTRACT_HASH_2],
        receiptsRoot: DEFAULT_BLOCK_RECEIPTS_ROOT_HASH,
      });

      expect(result?.logsBloom).equal(blockLogsBloom);
    });

    it('eth_getBlockByNumber with match and details and transactions with same hash but different fields', async function () {
      restMock.onGet(CONTRACT_RESULTS_WITH_FILTER_URL).reply(
        200,
        JSON.stringify({
          results: [
            ...defaultContractResults.results,
            {
              ...defaultContractResults.results[0],
              transaction_index: defaultContractResults.results[0].transaction_index + 1,
            },
          ],
        }),
      );

      const result = await ethImpl.getBlockByNumber(numberTo0x(BLOCK_NUMBER), true, requestDetails);

      if (result) {
        // verify aggregated info
        veriftAggregatedInfo(result);
        expect(result.gasUsed).equal(TOTAL_GAS_USED);
        verifyTransactions(result.transactions as Array<Transaction>);

        // verify expected constants
        RelayAssertions.verifyBlockConstants(result);
        expect(result.receiptsRoot).to.equal(DEFAULT_BLOCK_RECEIPTS_ROOT_HASH);
      }
    });

    it('eth_getBlockByNumber with match paginated', async function () {
      restMock.onGet(CONTRACT_RESULTS_WITH_FILTER_URL).reply(200, JSON.stringify(LINKS_NEXT_RES));
      restMock.onGet(CONTRACTS_RESULTS_NEXT_URL).reply(200, JSON.stringify(defaultContractResults));
      const result = await ethImpl.getBlockByNumber(numberTo0x(BLOCK_NUMBER), false, requestDetails);

      RelayAssertions.assertBlock(result, {
        hash: BLOCK_HASH_TRIMMED,
        gasUsed: TOTAL_GAS_USED,
        number: BLOCK_NUMBER_HEX,
        parentHash: BLOCK_HASH_PREV_TRIMMED,
        timestamp: BLOCK_TIMESTAMP_HEX,
        transactions: [CONTRACT_HASH_1, CONTRACT_HASH_2],
        receiptsRoot: DEFAULT_BLOCK_RECEIPTS_ROOT_HASH,
      });
    });

    it('eth_getBlockByNumber should return cached result', async function () {
      restMock.onGet(CONTRACT_RESULTS_WITH_FILTER_URL).reply(200, JSON.stringify(defaultContractResults));
      const resBeforeCache = await ethImpl.getBlockByNumber(numberTo0x(BLOCK_NUMBER), false, requestDetails);

      restMock.onGet(`blocks/${BLOCK_NUMBER}`).reply(404);
      const resAfterCache = await ethImpl.getBlockByNumber(numberTo0x(BLOCK_NUMBER), false, requestDetails);

      expect(resBeforeCache).to.eq(resAfterCache);
    });

    it('eth_getBlockByHash with match', async function () {
      restMock.onGet(CONTRACT_RESULTS_WITH_FILTER_URL).reply(200, JSON.stringify(defaultContractResults));

      const result = await ethImpl.getBlockByHash(BLOCK_HASH, false, requestDetails);
      RelayAssertions.assertBlock(result, {
        hash: BLOCK_HASH_TRIMMED,
        gasUsed: TOTAL_GAS_USED,
        number: BLOCK_NUMBER_HEX,
        parentHash: BLOCK_HASH_PREV_TRIMMED,
        timestamp: BLOCK_TIMESTAMP_HEX,
        transactions: [CONTRACT_HASH_1, CONTRACT_HASH_2],
      });
    });

    it('eth_getBlockByHash with match paginated', async function () {
      restMock.onGet(CONTRACT_RESULTS_WITH_FILTER_URL).reply(200, JSON.stringify(LINKS_NEXT_RES));
      restMock.onGet(CONTRACTS_RESULTS_NEXT_URL).reply(200, JSON.stringify(defaultContractResults));

      const result = await ethImpl.getBlockByHash(BLOCK_HASH, false, requestDetails);
      const toMatch = {
        hash: BLOCK_HASH_TRIMMED,
        gasUsed: TOTAL_GAS_USED,
        number: BLOCK_NUMBER_HEX,
        parentHash: BLOCK_HASH_PREV_TRIMMED,
        timestamp: BLOCK_TIMESTAMP_HEX,
        transactions: [CONTRACT_HASH_1, CONTRACT_HASH_2],
      };
      RelayAssertions.assertBlock(result, toMatch);
    });
  });

  it('eth_getBlockByNumber with zero transactions', async function () {
    // mirror node request mocks
    restMock.onGet(`blocks/${BLOCK_NUMBER}`).reply(200, JSON.stringify({ ...DEFAULT_BLOCK, gas_used: 0 }));
    restMock.onGet(BLOCKS_LIMIT_ORDER_URL).reply(200, JSON.stringify(MOST_RECENT_BLOCK));
    restMock.onGet(CONTRACT_RESULTS_WITH_FILTER_URL).reply(200, JSON.stringify({ results: [] }));
    restMock.onGet(CONTRACT_RESULTS_LOGS_WITH_FILTER_URL).reply(200, JSON.stringify({ logs: [] }));
    const result = await ethImpl.getBlockByNumber(numberTo0x(BLOCK_NUMBER), false, requestDetails);
    if (result) {
      // verify aggregated info
      veriftAggregatedInfo(result);
      expect(result.gasUsed).equal('0x0');
      expect(result.transactions.length).equal(0);
      expect(result.transactionsRoot).equal(constants.DEFAULT_ROOT_HASH);

      // verify expected constants
      RelayAssertions.verifyBlockConstants(result);
    }
  });

  it('eth_getBlockByNumber with match and details', async function () {
    // mirror node request mocks
    restMock.onGet(`blocks/${BLOCK_NUMBER}`).reply(200, JSON.stringify(DEFAULT_BLOCK));
    restMock.onGet(BLOCKS_LIMIT_ORDER_URL).reply(200, JSON.stringify(MOST_RECENT_BLOCK));
    restMock.onGet(CONTRACT_RESULTS_WITH_FILTER_URL).reply(200, JSON.stringify(defaultContractResults));
    restMock.onGet(CONTRACT_RESULTS_LOGS_WITH_FILTER_URL).reply(200, JSON.stringify(DEFAULT_ETH_GET_BLOCK_BY_LOGS));
    const result = await ethImpl.getBlockByNumber(numberTo0x(BLOCK_NUMBER), true, requestDetails);
    if (result) {
      veriftAggregatedInfo(result);
      expect(result.gasUsed).equal(TOTAL_GAS_USED);
      verifyTransactions(result.transactions as Array<Transaction>);

      // verify expected constants
      RelayAssertions.verifyBlockConstants(result);
      expect(result.receiptsRoot).to.equal(DEFAULT_BLOCK_RECEIPTS_ROOT_HASH);
    }
  });

  it('eth_getBlockByNumber with match and details and synthetic transactions', async function () {
    // mirror node request mocks
    restMock.onGet(`blocks/${BLOCK_NUMBER_WITH_SYN_TXN}`).reply(200, JSON.stringify(BLOCK_WITH_SYN_TXN));

    restMock.onGet(LATEST_BLOCK_QUERY).reply(200, JSON.stringify(LATEST_BLOCK_RESPONSE));
    restMock.onGet(CONTRACT_QUERY).reply(200, JSON.stringify(CONTRACT_RESPONSE_MOCK));
    restMock.onGet(LOG_QUERY).reply(200, JSON.stringify(LOGS_RESPONSE_MOCK));

    const result = await ethImpl.getBlockByNumber(numberTo0x(BLOCK_NUMBER_WITH_SYN_TXN), true, requestDetails);
    if (result) {
      result.transactions.forEach((tx) => {
        expect(tx.maxFeePerGas).to.not.exist;
        expect(tx.maxPriorityFeePerGas).to.not.exist;
        expect(tx.type).to.be.eq(constants.ZERO_HEX);
      });
    } else {
      fail('Result is null');
    }
  });

  it('eth_getBlockByNumber with match and details paginated', async function () {
    // mirror node request mocks
    restMock.onGet(`blocks/${BLOCK_NUMBER}`).reply(200, JSON.stringify(DEFAULT_BLOCK));
    restMock.onGet(BLOCKS_LIMIT_ORDER_URL).reply(200, JSON.stringify(MOST_RECENT_BLOCK));
    restMock.onGet(CONTRACT_RESULTS_WITH_FILTER_URL).reply(200, JSON.stringify(LINKS_NEXT_RES));
    restMock.onGet(CONTRACTS_RESULTS_NEXT_URL).reply(200, JSON.stringify(defaultContractResults));
    restMock.onGet(CONTRACT_RESULTS_LOGS_WITH_FILTER_URL).reply(200, JSON.stringify(DEFAULT_ETH_GET_BLOCK_BY_LOGS));
    const result = await ethImpl.getBlockByNumber(numberTo0x(BLOCK_NUMBER), true, requestDetails);
    if (result) {
      // verify aggregated info
      veriftAggregatedInfo(result);
      expect(result.gasUsed).equal(TOTAL_GAS_USED);
      verifyTransactions(result.transactions as Array<Transaction>);

      // verify expected constants
      RelayAssertions.verifyBlockConstants(result);
      expect(result.receiptsRoot).to.equal(DEFAULT_BLOCK_RECEIPTS_ROOT_HASH);
    }
  });

  it('eth_getBlockByNumber with block match and contract revert', async function () {
    // mirror node request mocks
    restMock.onGet(`blocks/${BLOCK_NUMBER}`).reply(200, JSON.stringify({ ...DEFAULT_BLOCK, gas_used: GAS_USED_1 }));
    restMock.onGet(BLOCKS_LIMIT_ORDER_URL).reply(200, JSON.stringify(MOST_RECENT_BLOCK));
    restMock.onGet(CONTRACT_RESULTS_WITH_FILTER_URL).reply(200, JSON.stringify(DEFAULT_CONTRACT_RES_REVERT));
    restMock.onGet(CONTRACT_RESULTS_LOGS_WITH_FILTER_URL).reply(200, JSON.stringify({ logs: [] }));
    const result = await ethImpl.getBlockByNumber(numberTo0x(BLOCK_NUMBER), true, requestDetails);
    if (result) {
      veriftAggregatedInfo(result);
      expect(result.gasUsed).equal(numberTo0x(GAS_USED_1));
      expect(result.transactions.length).equal(1);

      // verify expected constants
      RelayAssertions.verifyBlockConstants(result);
    }
  });

  it('eth_getBlockByNumber with no match', async function () {
    restMock.onGet(`blocks/${BLOCK_NUMBER}`).reply(404, JSON.stringify(NO_SUCH_BLOCK_EXISTS_RES));
    restMock.onGet(BLOCKS_LIMIT_ORDER_URL).reply(200, JSON.stringify(MOST_RECENT_BLOCK));

    const result = await ethImpl.getBlockByNumber(BLOCK_NUMBER.toString(), false, requestDetails);
    expect(result).to.equal(null);
  });

  describe('eth_getBlockByNumber with tag', async function () {
    const TOTAL_GET_CALLS_EXECUTED = 12;
    function confirmResult(result: Block | null) {
      expect(result).to.exist;
      expect(result).to.not.be.null;

      if (result) {
        expect(result.number).equal(BLOCK_NUMBER_HEX);
      }
    }

    beforeEach(() => {
      restMock.resetHistory();
      restMock.onGet(CONTRACT_RESULTS_LOGS_WITH_FILTER_URL).reply(200, JSON.stringify(DEFAULT_ETH_GET_BLOCK_BY_LOGS));
      for (const result of defaultContractResults.results) {
        restMock.onGet(`contracts/${result.to}/results/${result.timestamp}`).reply(404, JSON.stringify(NOT_FOUND_RES));
      }
      restMock.onGet(CONTRACT_RESULTS_WITH_FILTER_URL).reply(200, JSON.stringify(defaultContractResults));
      restMock.onGet(BLOCKS_LIMIT_ORDER_URL).reply(200, JSON.stringify(DEFAULT_BLOCKS_RES));
    });

    it('eth_getBlockByNumber with latest tag', async function () {
      const result = await ethImpl.getBlockByNumber('latest', false, requestDetails);
      // check that we only made the expected number of requests with the expected urls
      expect(restMock.history.get.length).equal(TOTAL_GET_CALLS_EXECUTED);
      expect(restMock.history.get[0].url).equal(BLOCKS_LIMIT_ORDER_URL);
      expect(restMock.history.get[1].url).equal(
        'contracts/results?timestamp=gte:1651560386.060890949&timestamp=lte:1651560389.060890949&limit=100&order=asc',
      );
      expect(restMock.history.get[2].url).equal(
        'contracts/results/logs?timestamp=gte:1651560386.060890949&timestamp=lte:1651560389.060890949&limit=100&order=asc',
      );
      expect(restMock.history.get[TOTAL_GET_CALLS_EXECUTED - 1].url).equal('network/fees');
      confirmResult(result);
    });

    it('eth_getBlockByNumber with latest tag paginated', async function () {
      restMock.onGet(CONTRACT_RESULTS_WITH_FILTER_URL).reply(200, JSON.stringify(LINKS_NEXT_RES));
      restMock.onGet(CONTRACTS_RESULTS_NEXT_URL).reply(200, JSON.stringify(defaultContractResults));

      const result = await ethImpl.getBlockByNumber('latest', false, requestDetails);
      confirmResult(result);
    });

    it('eth_getBlockByNumber with pending tag', async function () {
      const result = await ethImpl.getBlockByNumber('pending', false, requestDetails);
      confirmResult(result);
    });

    it('eth_getBlockByNumber with earliest tag', async function () {
      restMock.onGet(`blocks/0`).reply(200, JSON.stringify(DEFAULT_BLOCK));

      const result = await ethImpl.getBlockByNumber('earliest', false, requestDetails);
      confirmResult(result);
    });

    it('eth_getBlockByNumber with finalized tag', async function () {
      const result = await ethImpl.getBlockByNumber('finalized', false, requestDetails);
      // check that we only made the expected number of requests with the expected urls
      expect(restMock.history.get.length).equal(TOTAL_GET_CALLS_EXECUTED);
      expect(restMock.history.get[0].url).equal(BLOCKS_LIMIT_ORDER_URL);
      expect(restMock.history.get[1].url).equal(
        'contracts/results?timestamp=gte:1651560386.060890949&timestamp=lte:1651560389.060890949&limit=100&order=asc',
      );
      expect(restMock.history.get[2].url).equal(
        'contracts/results/logs?timestamp=gte:1651560386.060890949&timestamp=lte:1651560389.060890949&limit=100&order=asc',
      );
      expect(restMock.history.get[TOTAL_GET_CALLS_EXECUTED - 1].url).equal('network/fees');
      confirmResult(result);
    });

    it('eth_getBlockByNumber with safe tag', async function () {
      const result = await ethImpl.getBlockByNumber('safe', false, requestDetails);
      // check that we only made the expected number of requests with the expected urls
      expect(restMock.history.get.length).equal(TOTAL_GET_CALLS_EXECUTED);
      expect(restMock.history.get[0].url).equal(BLOCKS_LIMIT_ORDER_URL);
      expect(restMock.history.get[1].url).equal(
        'contracts/results?timestamp=gte:1651560386.060890949&timestamp=lte:1651560389.060890949&limit=100&order=asc',
      );
      expect(restMock.history.get[2].url).equal(
        'contracts/results/logs?timestamp=gte:1651560386.060890949&timestamp=lte:1651560389.060890949&limit=100&order=asc',
      );
      expect(restMock.history.get[TOTAL_GET_CALLS_EXECUTED - 1].url).equal('network/fees');
      confirmResult(result);
    });

    it('eth_getBlockByNumber with hex number tag', async function () {
      restMock.onGet(`blocks/3735929054`).reply(200, JSON.stringify(DEFAULT_BLOCK));
      restMock.onGet(BLOCKS_LIMIT_ORDER_URL).reply(200, JSON.stringify(BLOCKS_RES));

      const result = await ethImpl.getBlockByNumber('0xdeadc0de', false, requestDetails);
      confirmResult(result);
    });
  });

  withOverriddenEnvsInMochaTest({ ETH_GET_TRANSACTION_COUNT_MAX_BLOCK_RANGE: 1 }, () => {
    it('eth_getBlockByNumber with greater number of transactions than the ETH_GET_TRANSACTION_COUNT_MAX_BLOCK_RANGE', async function () {
      // mirror node request mocks
      restMock.onGet(`blocks/${BLOCK_NUMBER}`).reply(200, JSON.stringify(DEFAULT_BLOCK));
      restMock.onGet(BLOCKS_LIMIT_ORDER_URL).reply(200, JSON.stringify(MOST_RECENT_BLOCK));
      restMock.onGet(CONTRACT_RESULTS_WITH_FILTER_URL).reply(200, JSON.stringify(defaultContractResults));
      restMock
        .onGet(`contracts/${CONTRACT_ADDRESS_1}/results/${CONTRACT_TIMESTAMP_1}`)
        .reply(200, JSON.stringify(defaultDetailedContractResults));
      restMock
        .onGet(`contracts/${CONTRACT_ADDRESS_2}/results/${CONTRACT_TIMESTAMP_2}`)
        .reply(200, JSON.stringify(defaultDetailedContractResults));
      restMock.onGet(CONTRACT_RESULTS_LOGS_WITH_FILTER_URL).reply(200, JSON.stringify(DEFAULT_ETH_GET_BLOCK_BY_LOGS));

      const args = [numberTo0x(BLOCK_NUMBER), true, requestDetails];

      await RelayAssertions.assertRejection(
        predefined.MAX_BLOCK_SIZE(77),
        ethImpl.getBlockByNumber,
        true,
        ethImpl,
        args,
      );
    });
  });

  [false, true].forEach((showDetails) => {
    ['WRONG_NONCE', 'INVALID_ACCOUNT_ID'].forEach((status) => {
      it(`eth_getBlockByNumber should skip ${status} transactions when showDetails = ${showDetails}`, async () => {
        // mirror node request mocks
        restMock.onGet(`blocks/${BLOCK_NUMBER}`).reply(200, JSON.stringify(DEFAULT_BLOCK));
        restMock.onGet(BLOCKS_LIMIT_ORDER_URL).reply(200, JSON.stringify(MOST_RECENT_BLOCK));
        restMock.onGet(CONTRACT_RESULTS_WITH_FILTER_URL).reply(
          200,
          JSON.stringify({
            results: [
              ...defaultContractResults.results,
              {
                ...defaultContractResults.results[0],
                result: status,
                hash: '0xf84b9a38205131431901ca6a945046369f5be81bb579167458d4992427d03bb1',
              },
              {
                ...defaultContractResults.results[0],
                error_message: prepend0x(ASCIIToHex(status)),
                hash: '0x9c8d9d99e033c56bec1669a0ea68887b7df69ec1bac55899150b6ed5bc3f4b79',
              },
            ],
          }),
        );
        restMock.onGet(CONTRACT_RESULTS_LOGS_WITH_FILTER_URL).reply(200, JSON.stringify(DEFAULT_ETH_GET_BLOCK_BY_LOGS));

        const result = await ethImpl.getBlockByNumber(numberTo0x(BLOCK_NUMBER), showDetails, requestDetails);

        RelayAssertions.assertBlock(
          result,
          {
            hash: BLOCK_HASH_TRIMMED,
            gasUsed: TOTAL_GAS_USED,
            number: BLOCK_NUMBER_HEX,
            parentHash: BLOCK_HASH_PREV_TRIMMED,
            timestamp: BLOCK_TIMESTAMP_HEX,
            // should not include the transaction with wrong nonce or invalid account id
            transactions: [CONTRACT_HASH_1, CONTRACT_HASH_2],
            receiptsRoot: DEFAULT_BLOCK_RECEIPTS_ROOT_HASH,
          },
          showDetails,
        );
      });
    });
  });

  it('eth_getBlockByNumber should throw an error if nullable entities found in logs', async function () {
    // mirror node request mocks
    restMock.onGet(`blocks/${BLOCK_HASH}`).reply(200, JSON.stringify(DEFAULT_BLOCK));
    restMock.onGet(CONTRACT_RESULTS_WITH_FILTER_URL).reply(200, JSON.stringify(defaultContractResults));
    restMock.onGet('network/fees').reply(200, JSON.stringify(DEFAULT_NETWORK_FEES));

    const nullEntitiedLogs = [
      {
        logs: [{ ...DEFAULT_LOGS.logs[0], block_number: null }],
      },
      {
        logs: [{ ...DEFAULT_LOGS.logs[0], index: null }],
      },
      {
        logs: [{ ...DEFAULT_LOGS.logs[0], block_hash: '0x' }],
      },
    ];

    for (const logEntry of nullEntitiedLogs) {
      try {
        restMock.onGet(CONTRACT_RESULTS_LOGS_WITH_FILTER_URL).reply(200, JSON.stringify(logEntry));

        await ethImpl.getBlockByNumber(BLOCK_HASH, false, requestDetails);
        expect.fail('should have thrown an error');
      } catch (error) {
        expect(error).to.exist;
        const predefinedError = predefined.DEPENDENT_SERVICE_IMMATURE_RECORDS;
        expect(error.code).to.equal(predefinedError.code);
        expect(error.message).to.equal(predefinedError.message);
      }
    }
  });
});
