// SPDX-License-Identifier: Apache-2.0

import MockAdapter from 'axios-mock-adapter';
import { expect, use } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import _ from 'lodash';
import sinon from 'sinon';

import { numberTo0x } from '../../../dist/formatters';
import { Eth } from '../../../src';
import { SDKClient } from '../../../src/lib/clients';
import type { ICacheClient } from '../../../src/lib/clients/cache/ICacheClient';
import { predefined } from '../../../src/lib/errors/JsonRpcError';
import { Transaction, Transaction1559, Transaction2930 } from '../../../src/lib/model';
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
  DEFAULT_NETWORK_FEES,
  EMPTY_LOGS_RESPONSE,
  EMPTY_RES,
  NOT_FOUND_RES,
  SYNTHETIC_LOG,
  SYNTHETIC_TX_HASH,
} from './eth-config';
import { contractResultsByHashByIndexURL, generateEthTestEnv } from './eth-helpers';

use(chaiAsPromised);

let sdkClientStub: sinon.SinonStubbedInstance<SDKClient>;
let getSdkClientStub: sinon.SinonStub;

function verifyAggregatedInfo(result: Transaction | null) {
  // verify aggregated info
  if (result) {
    expect(result.blockHash).equal(BLOCK_HASH_TRIMMED);
    expect(result.blockNumber).equal(BLOCK_NUMBER_HEX);
    expect(result.hash).equal(CONTRACT_HASH_1);
    expect(result.to).equal(CONTRACT_ADDRESS_1);
  }
}

describe('@ethGetTransactionByBlockHashAndIndex using MirrorNode', async function () {
  this.timeout(10000);
  const {
    restMock,
    hapiServiceInstance,
    ethImpl,
    cacheService,
  }: { restMock: MockAdapter; hapiServiceInstance: HAPIService; ethImpl: Eth; cacheService: ICacheClient } =
    generateEthTestEnv();

  const requestDetails = new RequestDetails({
    requestId: 'eth_getTransactionByBlockHashAndIndexTest',
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

  it('eth_getTransactionByBlockHashAndIndex with match', async function () {
    // mirror node request mocks
    restMock
      .onGet(contractResultsByHashByIndexURL(DEFAULT_BLOCK.hash, DEFAULT_BLOCK.count))
      .reply(200, JSON.stringify(defaultContractResults));
    restMock
      .onGet(`contracts/${CONTRACT_ADDRESS_1}/results/${CONTRACT_TIMESTAMP_1}`)
      .reply(200, JSON.stringify(defaultDetailedContractResults));
    const result = await ethImpl.getTransactionByBlockHashAndIndex(
      DEFAULT_BLOCK.hash,
      numberTo0x(DEFAULT_BLOCK.count),
      requestDetails,
    );
    expect(result).to.exist;
    expect(result).to.not.be.null;

    verifyAggregatedInfo(result);
  });

  it('eth_getTransactionByBlockHashAndIndex should throw for internal error', async function () {
    const randomBlock = {
      hash: '0x5f827a801c579c84eca738827b65612b28ed425b7578bfdd10177e24fc3db8d4b1a7f3d56d83c39b950cc5e4d175dd64',
      count: 9,
    };
    const defaultContractResultsWithNullableFrom = _.cloneDeep(defaultContractResults);
    defaultContractResultsWithNullableFrom.results[0].from = null;
    restMock
      .onGet(contractResultsByHashByIndexURL(randomBlock.hash, randomBlock.count))
      .reply(200, JSON.stringify(defaultContractResultsWithNullableFrom));

    const args = [randomBlock.hash, numberTo0x(randomBlock.count), requestDetails];
    const errMessage = "Cannot read properties of null (reading 'substring')";

    await RelayAssertions.assertRejection(
      predefined.INTERNAL_ERROR(errMessage),
      ethImpl.getTransactionByBlockHashAndIndex,
      true,
      ethImpl,
      args,
    );
  });

  it('eth_getTransactionByBlockHashAndIndex with no contract result match', async function () {
    // mirror node request mocks
    restMock
      .onGet(contractResultsByHashByIndexURL(DEFAULT_BLOCK.hash, DEFAULT_BLOCK.count))
      .reply(404, JSON.stringify(NOT_FOUND_RES));
    // Mock block endpoint returning 404 so synthetic transaction fallback also returns null
    restMock.onGet(`blocks/${DEFAULT_BLOCK.hash}`).reply(404, JSON.stringify(NOT_FOUND_RES));

    const result = await ethImpl.getTransactionByBlockHashAndIndex(
      DEFAULT_BLOCK.hash.toString(),
      numberTo0x(DEFAULT_BLOCK.count),
      requestDetails,
    );
    expect(result).to.equal(null);
  });

  it('eth_getTransactionByBlockHashAndIndex with no contract results', async function () {
    restMock
      .onGet(contractResultsByHashByIndexURL(DEFAULT_BLOCK.hash, DEFAULT_BLOCK.count))
      .reply(200, JSON.stringify(EMPTY_RES));
    // Mock block endpoint returning 404 so synthetic transaction fallback also returns null
    restMock.onGet(`blocks/${DEFAULT_BLOCK.hash}`).reply(404, JSON.stringify(NOT_FOUND_RES));

    const result = await ethImpl.getTransactionByBlockHashAndIndex(
      DEFAULT_BLOCK.hash.toString(),
      numberTo0x(DEFAULT_BLOCK.count),
      requestDetails,
    );
    expect(result).to.equal(null);
  });

  it('eth_getTransactionByBlockHashAndIndex returns 155 transaction for type 0', async function () {
    restMock.onGet(contractResultsByHashByIndexURL(DEFAULT_BLOCK.hash, DEFAULT_BLOCK.count)).reply(
      200,
      JSON.stringify({
        results: [
          {
            ...CONTRACT_RESULT_MOCK,
            type: 0,
          },
        ],
      }),
    );

    const result = await ethImpl.getTransactionByBlockHashAndIndex(
      DEFAULT_BLOCK.hash.toString(),
      numberTo0x(DEFAULT_BLOCK.count),
      requestDetails,
    );
    expect(result).to.be.an.instanceOf(Transaction);
  });

  it('eth_getTransactionByBlockHashAndIndex returns 2930 transaction for type 1', async function () {
    restMock.onGet(contractResultsByHashByIndexURL(DEFAULT_BLOCK.hash, DEFAULT_BLOCK.count)).reply(
      200,
      JSON.stringify({
        results: [
          {
            ...CONTRACT_RESULT_MOCK,
            type: 1,
            access_list: [],
          },
        ],
      }),
    );

    const result = await ethImpl.getTransactionByBlockHashAndIndex(
      DEFAULT_BLOCK.hash.toString(),
      numberTo0x(DEFAULT_BLOCK.count),
      requestDetails,
    );
    expect(result).to.be.an.instanceOf(Transaction2930);
  });

  it('eth_getTransactionByBlockHashAndIndex returns 1559 transaction for type 2', async function () {
    restMock.onGet(contractResultsByHashByIndexURL(DEFAULT_BLOCK.hash, DEFAULT_BLOCK.count)).reply(
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

    const result = await ethImpl.getTransactionByBlockHashAndIndex(
      DEFAULT_BLOCK.hash.toString(),
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
        .onGet(contractResultsByHashByIndexURL(DEFAULT_BLOCK.hash, SYNTHETIC_LOG.transaction_index))
        .reply(200, JSON.stringify(EMPTY_RES));

      // Mock block endpoint returning block with timestamp range
      restMock.onGet(`blocks/${DEFAULT_BLOCK.hash}`).reply(200, JSON.stringify(DEFAULT_BLOCK));

      // Mock logs endpoint returning synthetic log
      restMock.onGet(/contracts\/results\/logs.*/).reply(200, JSON.stringify({ logs: [SYNTHETIC_LOG] }));

      const result = await ethImpl.getTransactionByBlockHashAndIndex(
        DEFAULT_BLOCK.hash,
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
        .onGet(contractResultsByHashByIndexURL(DEFAULT_BLOCK.hash, DEFAULT_BLOCK.count))
        .reply(200, JSON.stringify(EMPTY_RES));

      // Mock block endpoint returning 404
      restMock.onGet(`blocks/${DEFAULT_BLOCK.hash}`).reply(404, JSON.stringify(NOT_FOUND_RES));

      const result = await ethImpl.getTransactionByBlockHashAndIndex(
        DEFAULT_BLOCK.hash,
        numberTo0x(DEFAULT_BLOCK.count),
        requestDetails,
      );

      expect(result).to.equal(null);
    });

    it('returns null when contract result is empty and no logs in block', async function () {
      // Mock contract results returning empty
      restMock
        .onGet(contractResultsByHashByIndexURL(DEFAULT_BLOCK.hash, DEFAULT_BLOCK.count))
        .reply(200, JSON.stringify(EMPTY_RES));

      // Mock block endpoint returning block
      restMock.onGet(`blocks/${DEFAULT_BLOCK.hash}`).reply(200, JSON.stringify(DEFAULT_BLOCK));

      // Mock logs endpoint returning empty
      restMock.onGet(/contracts\/results\/logs.*/).reply(200, JSON.stringify(EMPTY_LOGS_RESPONSE));

      const result = await ethImpl.getTransactionByBlockHashAndIndex(
        DEFAULT_BLOCK.hash,
        numberTo0x(DEFAULT_BLOCK.count),
        requestDetails,
      );

      expect(result).to.equal(null);
    });

    it('returns null when contract result is empty and no log matches transaction index', async function () {
      const nonMatchingTransactionIndex = 999;

      // Mock contract results returning empty
      restMock
        .onGet(contractResultsByHashByIndexURL(DEFAULT_BLOCK.hash, nonMatchingTransactionIndex))
        .reply(200, JSON.stringify(EMPTY_RES));

      // Mock block endpoint returning block
      restMock.onGet(`blocks/${DEFAULT_BLOCK.hash}`).reply(200, JSON.stringify(DEFAULT_BLOCK));

      // Mock logs endpoint returning log with different transaction index
      restMock.onGet(/contracts\/results\/logs.*/).reply(200, JSON.stringify({ logs: [SYNTHETIC_LOG] }));

      const result = await ethImpl.getTransactionByBlockHashAndIndex(
        DEFAULT_BLOCK.hash,
        numberTo0x(nonMatchingTransactionIndex),
        requestDetails,
      );

      expect(result).to.equal(null);
    });

    it('returns null when contract result returns 404 and no synthetic transaction found', async function () {
      // Mock contract results returning 404
      restMock
        .onGet(contractResultsByHashByIndexURL(DEFAULT_BLOCK.hash, DEFAULT_BLOCK.count))
        .reply(404, JSON.stringify(NOT_FOUND_RES));

      // Mock block endpoint returning block
      restMock.onGet(`blocks/${DEFAULT_BLOCK.hash}`).reply(200, JSON.stringify(DEFAULT_BLOCK));

      // Mock logs endpoint returning empty
      restMock.onGet(/contracts\/results\/logs.*/).reply(200, JSON.stringify(EMPTY_LOGS_RESPONSE));

      const result = await ethImpl.getTransactionByBlockHashAndIndex(
        DEFAULT_BLOCK.hash,
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
        .onGet(contractResultsByHashByIndexURL(DEFAULT_BLOCK.hash, syntheticLogForLargeBlock.transaction_index))
        .reply(200, JSON.stringify(EMPTY_RES));

      // Mock block endpoint returning large block
      restMock.onGet(`blocks/${DEFAULT_BLOCK.hash}`).reply(200, JSON.stringify(largeBlock));

      // Track the number of log requests (timestamp slicing makes parallel requests)
      let logRequestCount = 0;
      restMock.onGet(/contracts\/results\/logs.*/).reply(() => {
        logRequestCount++;
        return [200, JSON.stringify({ logs: [syntheticLogForLargeBlock] })];
      });

      const startTime = Date.now();
      const result = await ethImpl.getTransactionByBlockHashAndIndex(
        DEFAULT_BLOCK.hash,
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
