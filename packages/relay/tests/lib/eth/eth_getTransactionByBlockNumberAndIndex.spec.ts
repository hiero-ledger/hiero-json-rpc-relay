// SPDX-License-Identifier: Apache-2.0

import MockAdapter from 'axios-mock-adapter';
import { expect, use } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import * as _ from 'lodash';
import sinon from 'sinon';

import { numberTo0x } from '../../../dist/formatters';
import { Eth } from '../../../src';
import { SDKClient } from '../../../src/lib/clients';
import type { ICacheClient } from '../../../src/lib/clients/cache/ICacheClient';
import { predefined } from '../../../src/lib/errors/JsonRpcError';
import { Transaction, Transaction1559 } from '../../../src/lib/model';
import HAPIService from '../../../src/lib/services/hapiService/hapiService';
import { RequestDetails } from '../../../src/lib/types';
import RelayAssertions from '../../assertions';
import { defaultContractResults, defaultDetailedContractResults } from '../../helpers';
import {
  BLOCK_HASH_TRIMMED,
  BLOCK_NUMBER_HEX,
  CONTRACT_ADDRESS_1,
  CONTRACT_HASH_1,
  CONTRACT_RESULT_MOCK,
  CONTRACT_TIMESTAMP_1,
  DEFAULT_BLOCK,
  DEFAULT_BLOCKS_RES,
  DEFAULT_NETWORK_FEES,
  EMPTY_LOGS_RESPONSE,
  NO_SUCH_CONTRACT_RESULT,
  NOT_FOUND_RES,
  SYNTHETIC_LOG,
  SYNTHETIC_TX_HASH,
} from './eth-config';
import { contractResultsByNumberByIndexURL, generateEthTestEnv } from './eth-helpers';

use(chaiAsPromised);

let sdkClientStub: sinon.SinonStubbedInstance<SDKClient>;
let getSdkClientStub: sinon.SinonStub;

function verifyAggregatedInfo(result: Transaction | null) {
  // verify aggregated info
  expect(result).to.exist;
  expect(result).to.not.be.null;
  if (result) {
    expect(result.blockHash).equal(BLOCK_HASH_TRIMMED);
    expect(result.blockNumber).equal(BLOCK_NUMBER_HEX);
    expect(result.hash).equal(CONTRACT_HASH_1);
    expect(result.to).equal(CONTRACT_ADDRESS_1);
  }
}

describe('@ethGetTransactionByBlockNumberAndIndex using MirrorNode', async function () {
  this.timeout(10000);
  const {
    restMock,
    hapiServiceInstance,
    ethImpl,
    cacheService,
  }: { restMock: MockAdapter; hapiServiceInstance: HAPIService; ethImpl: Eth; cacheService: ICacheClient } =
    generateEthTestEnv();

  const requestDetails = new RequestDetails({
    requestId: 'eth_getTransactionByBlockNumberAndIndexTest',
    ipAddress: '0.0.0.0',
  });

  this.beforeEach(async () => {
    // reset cache and restMock
    await cacheService.clear(requestDetails);
    restMock.reset();
    sdkClientStub = sinon.createStubInstance(SDKClient);
    getSdkClientStub = sinon.stub(hapiServiceInstance, 'getSDKClient').returns(sdkClientStub);
    restMock.onGet('network/fees').reply(200, JSON.stringify(DEFAULT_NETWORK_FEES));
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
    restMock.resetHandlers();
  });

  it('eth_getTransactionByBlockNumberAndIndex with match', async function () {
    // mirror node request mocks
    restMock
      .onGet(contractResultsByNumberByIndexURL(DEFAULT_BLOCK.number, DEFAULT_BLOCK.count))
      .reply(200, JSON.stringify(defaultContractResults));
    restMock
      .onGet(`contracts/${CONTRACT_ADDRESS_1}/results/${CONTRACT_TIMESTAMP_1}`)
      .reply(200, JSON.stringify(defaultDetailedContractResults));

    const result = await ethImpl.getTransactionByBlockNumberAndIndex(
      numberTo0x(DEFAULT_BLOCK.number),
      numberTo0x(DEFAULT_BLOCK.count),
      requestDetails,
    );

    verifyAggregatedInfo(result);
  });

  it('eth_getTransactionByBlockNumberAndIndex with null amount', async function () {
    const randomBlock = {
      number: 1009,
      count: 37,
    };
    const nullableDefaultContractResults = _.cloneDeep(defaultContractResults);
    // @ts-ignore
    nullableDefaultContractResults.results[0].amount = null;
    restMock
      .onGet(contractResultsByNumberByIndexURL(randomBlock.number, randomBlock.count))
      .reply(200, JSON.stringify(nullableDefaultContractResults));

    const result = await ethImpl.getTransactionByBlockNumberAndIndex(
      numberTo0x(randomBlock.number),
      numberTo0x(randomBlock.count),
      requestDetails,
    );
    expect(result).to.exist;
    expect(result).to.not.be.null;

    if (result) {
      // verify aggregated info
      expect(result.value).equal('0x0');
    }
  });

  it('eth_getTransactionByBlockNumberAndIndex with no contract result match', async function () {
    restMock
      .onGet(contractResultsByNumberByIndexURL(DEFAULT_BLOCK.number, DEFAULT_BLOCK.count))
      .reply(404, JSON.stringify(NO_SUCH_CONTRACT_RESULT));
    // Mock block endpoint returning 404 so synthetic transaction fallback also returns null
    restMock.onGet(`blocks/${DEFAULT_BLOCK.number}`).reply(404, JSON.stringify(NOT_FOUND_RES));

    const result = await ethImpl.getTransactionByBlockNumberAndIndex(
      numberTo0x(DEFAULT_BLOCK.number),
      numberTo0x(DEFAULT_BLOCK.count),
      requestDetails,
    );
    expect(result).to.equal(null);
  });

  it('eth_getTransactionByBlockNumberAndIndex should throw for internal error', async function () {
    const defaultContractResultsWithNullableFrom = _.cloneDeep(defaultContractResults);
    defaultContractResultsWithNullableFrom.results[0].from = null;
    const randomBlock = {
      number: 5644,
      count: 33,
    };
    restMock
      .onGet(contractResultsByNumberByIndexURL(randomBlock.number, randomBlock.count))
      .reply(200, JSON.stringify(defaultContractResultsWithNullableFrom));

    const args = [numberTo0x(randomBlock.number), numberTo0x(randomBlock.count), requestDetails];
    const errMessage = "Cannot read properties of null (reading 'substring')";

    await RelayAssertions.assertRejection(
      predefined.INTERNAL_ERROR(errMessage),
      ethImpl.getTransactionByBlockNumberAndIndex,
      true,
      ethImpl,
      args,
    );
  });

  it('eth_getTransactionByBlockNumberAndIndex with no contract results', async function () {
    restMock
      .onGet(contractResultsByNumberByIndexURL(DEFAULT_BLOCK.number, DEFAULT_BLOCK.count))
      .reply(200, JSON.stringify({ results: [] }));
    // Mock block endpoint returning 404 so synthetic transaction fallback also returns null
    restMock.onGet(`blocks/${DEFAULT_BLOCK.number}`).reply(404, JSON.stringify(NOT_FOUND_RES));

    const result = await ethImpl.getTransactionByBlockNumberAndIndex(
      numberTo0x(DEFAULT_BLOCK.number),
      numberTo0x(DEFAULT_BLOCK.count),
      requestDetails,
    );
    expect(result).to.equal(null);
  });

  it('eth_getTransactionByBlockNumberAndIndex with latest tag', async function () {
    // mirror node request mocks
    restMock.onGet('blocks?limit=1&order=desc').reply(200, JSON.stringify(DEFAULT_BLOCKS_RES));
    restMock
      .onGet(contractResultsByNumberByIndexURL(DEFAULT_BLOCK.number, DEFAULT_BLOCK.count))
      .reply(200, JSON.stringify(defaultContractResults));

    const result = await ethImpl.getTransactionByBlockNumberAndIndex(
      'latest',
      numberTo0x(DEFAULT_BLOCK.count),
      requestDetails,
    );
    verifyAggregatedInfo(result);
  });

  it('eth_getTransactionByBlockNumberAndIndex with finalized tag', async function () {
    // mirror node request mocks
    restMock.onGet('blocks?limit=1&order=desc').reply(200, JSON.stringify(DEFAULT_BLOCKS_RES));
    restMock
      .onGet(contractResultsByNumberByIndexURL(DEFAULT_BLOCK.number, DEFAULT_BLOCK.count))
      .reply(200, JSON.stringify(defaultContractResults));

    const result = await ethImpl.getTransactionByBlockNumberAndIndex(
      'finalized',
      numberTo0x(DEFAULT_BLOCK.count),
      requestDetails,
    );
    verifyAggregatedInfo(result);
  });

  it('eth_getTransactionByBlockNumberAndIndex with safe tag', async function () {
    // mirror node request mocks
    restMock.onGet('blocks?limit=1&order=desc').reply(200, JSON.stringify(DEFAULT_BLOCKS_RES));
    restMock
      .onGet(contractResultsByNumberByIndexURL(DEFAULT_BLOCK.number, DEFAULT_BLOCK.count))
      .reply(200, JSON.stringify(defaultContractResults));

    const result = await ethImpl.getTransactionByBlockNumberAndIndex(
      'safe',
      numberTo0x(DEFAULT_BLOCK.count),
      requestDetails,
    );
    verifyAggregatedInfo(result);
  });

  it('eth_getTransactionByBlockNumberAndIndex with match pending tag', async function () {
    // mirror node request mocks
    restMock.onGet('blocks?limit=1&order=desc').reply(200, JSON.stringify(DEFAULT_BLOCKS_RES));
    restMock
      .onGet(contractResultsByNumberByIndexURL(DEFAULT_BLOCK.number, DEFAULT_BLOCK.count))
      .reply(200, JSON.stringify(defaultContractResults));

    const result = await ethImpl.getTransactionByBlockNumberAndIndex(
      'pending',
      numberTo0x(DEFAULT_BLOCK.count),
      requestDetails,
    );
    verifyAggregatedInfo(result);
  });

  it('eth_getTransactionByBlockNumberAndIndex with earliest tag', async function () {
    // mirror node request mocks
    restMock
      .onGet(contractResultsByNumberByIndexURL(0, DEFAULT_BLOCK.count))
      .reply(200, JSON.stringify(defaultContractResults));

    const result = await ethImpl.getTransactionByBlockNumberAndIndex(
      'earliest',
      numberTo0x(DEFAULT_BLOCK.count),
      requestDetails,
    );
    verifyAggregatedInfo(result);
  });

  it('eth_getTransactionByBlockNumberAndIndex with hex number', async function () {
    restMock
      .onGet(contractResultsByNumberByIndexURL(3735929054, DEFAULT_BLOCK.count))
      .reply(200, JSON.stringify(defaultContractResults));

    const result = await ethImpl.getTransactionByBlockNumberAndIndex(
      '0xdeadc0de' + '',
      numberTo0x(DEFAULT_BLOCK.count),
      requestDetails,
    );
    verifyAggregatedInfo(result);
  });

  it('eth_getTransactionByBlockNumberAndIndex returns 1559 transaction for type 2 with converted fee caps', async function () {
    restMock.onGet(contractResultsByNumberByIndexURL(DEFAULT_BLOCK.number, DEFAULT_BLOCK.count)).reply(
      200,
      JSON.stringify({
        results: [
          {
            ...CONTRACT_RESULT_MOCK,
            type: 2,
            access_list: [],
            max_fee_per_gas: '0x47',
            max_priority_fee_per_gas: '0x47',
          },
        ],
      }),
    );

    const result = await ethImpl.getTransactionByBlockNumberAndIndex(
      numberTo0x(DEFAULT_BLOCK.number),
      numberTo0x(DEFAULT_BLOCK.count),
      requestDetails,
    );
    expect(result).to.be.an.instanceOf(Transaction1559);
    if (result) {
      expect((result as Transaction1559).maxFeePerGas).to.equal('0xa54f4c3c00');
      expect((result as Transaction1559).maxPriorityFeePerGas).to.equal('0xa54f4c3c00');
    }
  });

  describe('synthetic transaction handling', function () {
    it('returns synthetic transaction when contract result is empty but logs exist', async function () {
      // Mock contract results returning empty (no EVM transaction)
      restMock
        .onGet(contractResultsByNumberByIndexURL(DEFAULT_BLOCK.number, SYNTHETIC_LOG.transaction_index))
        .reply(200, JSON.stringify({ results: [] }));

      // Mock block endpoint returning block with timestamp range
      restMock.onGet(`blocks/${DEFAULT_BLOCK.number}`).reply(200, JSON.stringify(DEFAULT_BLOCK));

      // Mock logs endpoint returning synthetic log
      restMock.onGet(/contracts\/results\/logs.*/).reply(200, JSON.stringify({ logs: [SYNTHETIC_LOG] }));

      const result = await ethImpl.getTransactionByBlockNumberAndIndex(
        numberTo0x(DEFAULT_BLOCK.number),
        numberTo0x(SYNTHETIC_LOG.transaction_index),
        requestDetails,
      );

      expect(result).to.not.be.null;
      expect(result?.hash).to.equal(SYNTHETIC_TX_HASH.slice(0, 66)); // toHash32 truncates
      expect(result?.transactionIndex).to.equal(numberTo0x(SYNTHETIC_LOG.transaction_index));
      expect(result?.from).to.equal(SYNTHETIC_LOG.address);
      expect(result?.to).to.equal(SYNTHETIC_LOG.address);
    });

    it('returns null when contract result is empty and block not found', async function () {
      // Mock contract results returning empty
      restMock
        .onGet(contractResultsByNumberByIndexURL(DEFAULT_BLOCK.number, DEFAULT_BLOCK.count))
        .reply(200, JSON.stringify({ results: [] }));

      // Mock block endpoint returning 404
      restMock.onGet(`blocks/${DEFAULT_BLOCK.number}`).reply(404, JSON.stringify(NOT_FOUND_RES));

      const result = await ethImpl.getTransactionByBlockNumberAndIndex(
        numberTo0x(DEFAULT_BLOCK.number),
        numberTo0x(DEFAULT_BLOCK.count),
        requestDetails,
      );

      expect(result).to.equal(null);
    });

    it('returns null when contract result is empty and no logs in block', async function () {
      // Mock contract results returning empty
      restMock
        .onGet(contractResultsByNumberByIndexURL(DEFAULT_BLOCK.number, DEFAULT_BLOCK.count))
        .reply(200, JSON.stringify({ results: [] }));

      // Mock block endpoint returning block
      restMock.onGet(`blocks/${DEFAULT_BLOCK.number}`).reply(200, JSON.stringify(DEFAULT_BLOCK));

      // Mock logs endpoint returning empty
      restMock.onGet(/contracts\/results\/logs.*/).reply(200, JSON.stringify(EMPTY_LOGS_RESPONSE));

      const result = await ethImpl.getTransactionByBlockNumberAndIndex(
        numberTo0x(DEFAULT_BLOCK.number),
        numberTo0x(DEFAULT_BLOCK.count),
        requestDetails,
      );

      expect(result).to.equal(null);
    });

    it('returns null when contract result is empty and no log matches transaction index', async function () {
      const nonMatchingTransactionIndex = 999;

      // Mock contract results returning empty
      restMock
        .onGet(contractResultsByNumberByIndexURL(DEFAULT_BLOCK.number, nonMatchingTransactionIndex))
        .reply(200, JSON.stringify({ results: [] }));

      // Mock block endpoint returning block
      restMock.onGet(`blocks/${DEFAULT_BLOCK.number}`).reply(200, JSON.stringify(DEFAULT_BLOCK));

      // Mock logs endpoint returning log with different transaction index
      restMock.onGet(/contracts\/results\/logs.*/).reply(200, JSON.stringify({ logs: [SYNTHETIC_LOG] }));

      const result = await ethImpl.getTransactionByBlockNumberAndIndex(
        numberTo0x(DEFAULT_BLOCK.number),
        numberTo0x(nonMatchingTransactionIndex),
        requestDetails,
      );

      expect(result).to.equal(null);
    });

    it('returns null when contract result returns 404 and no synthetic transaction found', async function () {
      // Mock contract results returning 404
      restMock
        .onGet(contractResultsByNumberByIndexURL(DEFAULT_BLOCK.number, DEFAULT_BLOCK.count))
        .reply(404, JSON.stringify(NO_SUCH_CONTRACT_RESULT));

      // Mock block endpoint returning block
      restMock.onGet(`blocks/${DEFAULT_BLOCK.number}`).reply(200, JSON.stringify(DEFAULT_BLOCK));

      // Mock logs endpoint returning empty
      restMock.onGet(/contracts\/results\/logs.*/).reply(200, JSON.stringify(EMPTY_LOGS_RESPONSE));

      const result = await ethImpl.getTransactionByBlockNumberAndIndex(
        numberTo0x(DEFAULT_BLOCK.number),
        numberTo0x(DEFAULT_BLOCK.count),
        requestDetails,
      );

      expect(result).to.equal(null);
    });

    it('uses timestamp slicing for blocks with high transaction count', async function () {
      // Create a block with high transaction count to trigger timestamp slicing
      const largeBlock = {
        ...DEFAULT_BLOCK,
        count: 10000, // High transaction count triggers slicing (sliceCount = count / MIRROR_NODE_TIMESTAMP_SLICING_MAX_LOGS_PER_SLICE)
        timestamp: {
          from: '1651560386.000000000',
          to: '1651560390.000000000',
        },
      };

      const syntheticLogForLargeBlock = {
        ...SYNTHETIC_LOG,
        transaction_index: 5000,
      };

      // Mock contract results returning empty
      restMock
        .onGet(contractResultsByNumberByIndexURL(DEFAULT_BLOCK.number, syntheticLogForLargeBlock.transaction_index))
        .reply(200, JSON.stringify({ results: [] }));

      // Mock block endpoint returning large block
      restMock.onGet(`blocks/${DEFAULT_BLOCK.number}`).reply(200, JSON.stringify(largeBlock));

      // Track the number of log requests (timestamp slicing makes parallel requests)
      let logRequestCount = 0;
      restMock.onGet(/contracts\/results\/logs.*/).reply(() => {
        logRequestCount++;
        return [200, JSON.stringify({ logs: [syntheticLogForLargeBlock] })];
      });

      const startTime = Date.now();
      const result = await ethImpl.getTransactionByBlockNumberAndIndex(
        numberTo0x(DEFAULT_BLOCK.number),
        numberTo0x(syntheticLogForLargeBlock.transaction_index),
        requestDetails,
      );
      const elapsedTime = Date.now() - startTime;

      expect(result).to.not.be.null;
      // Verify timestamp slicing was applied (multiple parallel requests should have been made)
      expect(logRequestCount).to.be.greaterThan(1, 'Expected multiple parallel requests for timestamp slicing');
      // Performance check: parallel execution should complete within reasonable time (100ms)
      expect(elapsedTime).to.be.lessThan(100, 'Expected parallel execution to complete within 100ms');
    });
  });
});
