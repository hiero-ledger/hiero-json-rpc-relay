// SPDX-License-Identifier: Apache-2.0

import MockAdapter from 'axios-mock-adapter';
import { expect, use } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import sinon from 'sinon';

import { numberTo0x } from '../../../dist/formatters';
import { SDKClient } from '../../../src/lib/clients';
import constants from '../../../src/lib/constants';
import { EthImpl } from '../../../src/lib/eth';
import { CacheService } from '../../../src/lib/services/cacheService/cacheService';
import HAPIService from '../../../src/lib/services/hapiService/hapiService';
import { RequestDetails } from '../../../src/lib/types';
import { defaultContractResults, defaultContractResultsOnlyHash2, defaultLogs1 } from '../../helpers';
import {
  BLOCK_HASH,
  BLOCK_HASH_TRIMMED,
  BLOCK_NUMBER,
  BLOCK_NUMBER_HEX,
  CONTRACT_RESULTS_LOGS_WITH_FILTER_URL_2,
  CONTRACTS_RESULTS_BLOCK_NUMBER_URL,
  DEFAULT_BLOCK,
  DEFAULT_ETH_GET_BLOCK_BY_LOGS,
  DEFAULT_NETWORK_FEES,
} from './eth-config';
import { generateEthTestEnv } from './eth-helpers';

use(chaiAsPromised);

let sdkClientStub: sinon.SinonStubbedInstance<SDKClient>;
let getSdkClientStub: sinon.SinonStub;
let currentGasPriceStub: sinon.SinonStub;
let extractBlockNumberOrTagStub: sinon.SinonStub;

describe('@ethGetBlockReceipts using MirrorNode', async function () {
  this.timeout(10000);
  const {
    restMock,
    hapiServiceInstance,
    ethImpl,
    cacheService,
  }: {
    restMock: MockAdapter;
    hapiServiceInstance: HAPIService;
    ethImpl: EthImpl;
    cacheService: CacheService;
  } = generateEthTestEnv(true);
  const results = defaultContractResults.results;
  const requestDetails = new RequestDetails({ requestId: 'eth_getBlockReceiptsTest', ipAddress: '0.0.0.0' });

  this.beforeEach(async () => {
    // reset cache and restMock
    await cacheService.clear(requestDetails);
    currentGasPriceStub = sinon.stub(ethImpl, 'getCurrentGasPriceForBlock').resolves('0x25');
    extractBlockNumberOrTagStub = sinon.stub(ethImpl, 'extractBlockNumberOrTag').resolves(BLOCK_NUMBER);
    sdkClientStub = sinon.createStubInstance(SDKClient);
    getSdkClientStub = sinon.stub(hapiServiceInstance, 'getSDKClient').returns(sdkClientStub);
    restMock.onGet('network/fees').reply(200, JSON.stringify(DEFAULT_NETWORK_FEES));
    restMock.reset();
  });

  this.afterEach(() => {
    getSdkClientStub.restore();
    currentGasPriceStub.restore();
    extractBlockNumberOrTagStub.restore();
    restMock.resetHandlers();
  });

  function setupStandardResponses() {
    restMock.onGet(CONTRACTS_RESULTS_BLOCK_NUMBER_URL).reply(200, JSON.stringify(defaultContractResults));
    restMock.onGet(`blocks/${BLOCK_NUMBER}`).reply(200, JSON.stringify(DEFAULT_BLOCK));
    restMock.onGet(CONTRACT_RESULTS_LOGS_WITH_FILTER_URL_2).reply(200, JSON.stringify(DEFAULT_ETH_GET_BLOCK_BY_LOGS));
  }

  function expectValidReceipt(receipt, contractResult) {
    expect(receipt.blockHash).to.equal(BLOCK_HASH_TRIMMED);
    expect(receipt.blockNumber).to.equal(BLOCK_NUMBER_HEX);
    expect(receipt.transactionHash).to.equal(contractResult.hash);
    expect(receipt.gasUsed).to.equal(numberTo0x(contractResult.gas_used));
  }

  describe('Success cases', () => {
    it('eth_getBlockReceipts with matching block hash', async function () {
      // mirror node request mocks
      setupStandardResponses();

      const receipts = await ethImpl.getBlockReceipts({ blockHash: BLOCK_HASH }, requestDetails);
      expect(receipts).to.exist;
      expect(receipts.length).to.equal(2);

      receipts.forEach((receipt, index) => {
        const contractResult = results[index];
        expectValidReceipt(receipt, contractResult);
      });
    });

    it('eth_getBlockReceipts with matching block number', async function () {
      setupStandardResponses();

      const receipts = await ethImpl.getBlockReceipts(BLOCK_NUMBER_HEX, requestDetails);
      expect(receipts).to.exist;
      expect(receipts.length).to.equal(2);

      receipts.forEach((receipt, index) => {
        const contractResult = results[index];
        expectValidReceipt(receipt, contractResult);
      });
    });

    it('eth_getBlockReceipts with matching block tag latest', async function () {
      const latestBlockNumStub = sinon.stub(ethImpl.common, 'getLatestBlockNumber').resolves(BLOCK_NUMBER_HEX);

      setupStandardResponses();

      const receipts = await ethImpl.getBlockReceipts('latest', requestDetails);
      expect(receipts).to.exist;
      expect(receipts.length).to.equal(2);

      receipts.forEach((receipt, index) => {
        const contractResult = results[index];
        expectValidReceipt(receipt, contractResult);
      });

      latestBlockNumStub.restore();
    });

    it('eth_getBlockReceipts with matching block tag earliest', async function () {
      // mirror node request mocks
      const latestBlockNumStub = sinon.stub(ethImpl.common, 'getLatestBlockNumber').resolves(BLOCK_NUMBER_HEX);

      setupStandardResponses();
      restMock.onGet(`blocks/0`).reply(200, JSON.stringify(DEFAULT_BLOCK));

      const receipts = await ethImpl.getBlockReceipts('earliest', requestDetails);
      expect(receipts).to.exist;
      expect(receipts.length).to.equal(2);

      receipts.forEach((receipt, index) => {
        const contractResult = results[index];
        expectValidReceipt(receipt, contractResult);
      });

      latestBlockNumStub.restore();
    });

    it('should return empty array for block with no transactions', async function () {
      restMock.onGet(CONTRACTS_RESULTS_BLOCK_NUMBER_URL).reply(200, JSON.stringify({ results: [] }));

      const receipts = await ethImpl.getBlockReceipts({ blockHash: BLOCK_HASH }, requestDetails);
      expect(receipts).to.be.an('array').that.is.empty;
    });

    it('should properly format all receipt fields', async function () {
      setupStandardResponses();

      const receipts = await ethImpl.getBlockReceipts({ blockHash: BLOCK_HASH }, requestDetails);
      expect(receipts[0]).to.include.all.keys([
        'blockHash',
        'blockNumber',
        'transactionHash',
        'transactionIndex',
        'from',
        'to',
        'cumulativeGasUsed',
        'gasUsed',
        'contractAddress',
        'logs',
        'logsBloom',
        'status',
        'effectiveGasPrice',
        'type',
        'root',
      ]);
    });

    it('should return receipts with empty logs arrays when transactions have no matching logs', async function () {
      restMock.onGet(CONTRACTS_RESULTS_BLOCK_NUMBER_URL).reply(200, JSON.stringify(defaultContractResultsOnlyHash2));
      restMock.onGet(`blocks/${BLOCK_NUMBER}`).reply(200, JSON.stringify(DEFAULT_BLOCK));
      restMock.onGet(CONTRACT_RESULTS_LOGS_WITH_FILTER_URL_2).reply(200, JSON.stringify({ logs: defaultLogs1 }));

      const receipts = await ethImpl.getBlockReceipts(BLOCK_NUMBER_HEX, requestDetails);

      expect(receipts[0].logs.length).to.equal(0);
    });
  });

  describe('Error cases', () => {
    it('should handle transactions with no contract results', async function () {
      restMock.onGet(CONTRACTS_RESULTS_BLOCK_NUMBER_URL).reply(200, JSON.stringify({ results: [] }));
      restMock.onGet(`blocks/${BLOCK_NUMBER}`).reply(200, JSON.stringify(DEFAULT_BLOCK));

      const receipts = await ethImpl.getBlockReceipts(BLOCK_NUMBER_HEX, requestDetails);

      expect(receipts.length).to.equal(0);
    });
  });

  describe('Cache behavior', () => {
    it('should use cached results for subsequent calls', async function () {
      const cacheKey = `${constants.CACHE_KEY.ETH_GET_BLOCK_RECEIPTS}_${BLOCK_NUMBER}`;

      setupStandardResponses();
      const specificCacheServiceSpy = sinon
        .spy(cacheService, 'getAsync')
        .withArgs(cacheKey, EthImpl.ethGetBlockReceipts, requestDetails);
      const firstResponse = await ethImpl.getBlockReceipts({ blockHash: BLOCK_HASH }, requestDetails);

      // Subsequent calls should use cache
      const secondResponse = await ethImpl.getBlockReceipts({ blockHash: BLOCK_HASH }, requestDetails);
      const thirdResponse = await ethImpl.getBlockReceipts({ blockHash: BLOCK_HASH }, requestDetails);

      expect(specificCacheServiceSpy.calledThrice).to.be.true;
      expect(specificCacheServiceSpy.callCount).to.equal(3);
      expect(secondResponse).to.deep.equal(firstResponse);
      expect(thirdResponse).to.deep.equal(firstResponse);
    });

    it('should set cache when not previously cached', async function () {
      const cacheKey = `${constants.CACHE_KEY.ETH_GET_BLOCK_RECEIPTS}_${BLOCK_NUMBER}`;
      const cacheSetSpy = sinon.spy(cacheService, 'set');

      setupStandardResponses();

      await ethImpl.getBlockReceipts(BLOCK_NUMBER_HEX, requestDetails);

      expect(cacheSetSpy.calledWith(cacheKey, sinon.match.any, EthImpl.ethGetBlockReceipts, requestDetails)).to.be.true;

      cacheSetSpy.restore();
    });
  });
});
