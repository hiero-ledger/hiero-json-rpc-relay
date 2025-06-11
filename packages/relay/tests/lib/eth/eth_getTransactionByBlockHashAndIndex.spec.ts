// SPDX-License-Identifier: Apache-2.0

import MockAdapter from 'axios-mock-adapter';
import { expect, use } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import _ from 'lodash';
import sinon from 'sinon';

import { numberTo0x } from '../../../dist/formatters';
import { Eth } from '../../../src';
import { SDKClient } from '../../../src/lib/clients';
import { predefined } from '../../../src/lib/errors/JsonRpcError';
import { Transaction, Transaction1559, Transaction2930 } from '../../../src/lib/model';
import { CacheService } from '../../../src/lib/services/cacheService/cacheService';
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
  EMPTY_RES,
  NOT_FOUND_RES,
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
  }: { restMock: MockAdapter; hapiServiceInstance: HAPIService; ethImpl: Eth; cacheService: CacheService } =
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
  });
});
