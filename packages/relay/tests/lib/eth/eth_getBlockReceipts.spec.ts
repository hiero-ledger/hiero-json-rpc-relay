// SPDX-License-Identifier: Apache-2.0

import MockAdapter from 'axios-mock-adapter';
import { expect, use } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import sinon from 'sinon';

import { numberTo0x } from '../../../dist/formatters';
import { predefined } from '../../../src';
import { SDKClient } from '../../../src/lib/clients';
import { EthImpl } from '../../../src/lib/eth';
import { CacheService } from '../../../src/lib/services/cacheService/cacheService';
import HAPIService from '../../../src/lib/services/hapiService/hapiService';
import { RequestDetails } from '../../../src/lib/types';
import RelayAssertions from '../../assertions';
import { defaultContractResults, defaultContractResultsOnlyHash2, defaultLogs1 } from '../../helpers';
import {
  BLOCK_HASH,
  BLOCK_HASH_TRIMMED,
  BLOCK_NUMBER,
  BLOCK_NUMBER_HEX,
  BLOCKS_LIMIT_ORDER_URL,
  CONTRACT_RESULTS_LOGS_WITH_FILTER_URL_2,
  CONTRACT_RESULTS_WITH_FILTER_URL_2,
  DEFAULT_BLOCK,
  DEFAULT_ETH_GET_BLOCK_BY_LOGS,
  DEFAULT_NETWORK_FEES,
} from './eth-config';
import { generateEthTestEnv } from './eth-helpers';

use(chaiAsPromised);

let sdkClientStub: sinon.SinonStubbedInstance<SDKClient>;
let getSdkClientStub: sinon.SinonStub;
let extractBlockNumberOrTagStub: sinon.SinonStub;

const DEFAULTS: Record<string, any> = {
  [CONTRACT_RESULTS_WITH_FILTER_URL_2]: defaultContractResults,
  [CONTRACT_RESULTS_LOGS_WITH_FILTER_URL_2]: DEFAULT_ETH_GET_BLOCK_BY_LOGS,
  [BLOCKS_LIMIT_ORDER_URL]: { blocks: [DEFAULT_BLOCK] },
  [`blocks/${BLOCK_NUMBER}`]: DEFAULT_BLOCK,
  [`blocks/${BLOCK_HASH}`]: DEFAULT_BLOCK,
  ['network/fees']: DEFAULT_NETWORK_FEES,
};

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
    extractBlockNumberOrTagStub = sinon
      .stub(ethImpl['contractService'], 'extractBlockNumberOrTag')
      .resolves(BLOCK_NUMBER.toString());
    sdkClientStub = sinon.createStubInstance(SDKClient);
    getSdkClientStub = sinon.stub(hapiServiceInstance, 'getSDKClient').returns(sdkClientStub);
    restMock.reset();
  });

  this.afterEach(() => {
    getSdkClientStub.restore();
    extractBlockNumberOrTagStub.restore();
    restMock.resetHandlers();
  });

  function setupStandardResponses(overrides: Partial<Record<string, any>> = {}) {
    Object.entries(DEFAULTS).forEach(([url, body]) => {
      const toReply = overrides[url] !== undefined ? overrides[url] : body;
      restMock.onGet(url).reply(200, JSON.stringify(toReply));
    });
  }

  function expectValidReceipt(receipt, contractResult) {
    expect(receipt.blockHash).to.equal(BLOCK_HASH_TRIMMED);
    expect(receipt.blockNumber).to.equal(BLOCK_NUMBER_HEX);
    expect(receipt.transactionHash).to.equal(contractResult.hash);
    expect(receipt.gasUsed).to.equal(numberTo0x(contractResult.gas_used));
  }

  describe('Success cases', () => {
    it('eth_getBlockReceipts with matching block hash', async function () {
      setupStandardResponses();

      const receipts = await ethImpl.getBlockReceipts(BLOCK_HASH, requestDetails);
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
      setupStandardResponses();

      const receipts = await ethImpl.getBlockReceipts('latest', requestDetails);
      expect(receipts).to.exist;
      expect(receipts.length).to.equal(2);

      receipts.forEach((receipt, index) => {
        const contractResult = results[index];
        expectValidReceipt(receipt, contractResult);
      });
    });

    it('eth_getBlockReceipts with matching block tag earliest', async function () {
      // mirror node request mocks
      setupStandardResponses();
      restMock.onGet(`blocks/0`).reply(200, JSON.stringify(DEFAULT_BLOCK));

      const receipts = await ethImpl.getBlockReceipts('earliest', requestDetails);
      expect(receipts).to.exist;
      expect(receipts.length).to.equal(2);

      receipts.forEach((receipt, index) => {
        const contractResult = results[index];
        expectValidReceipt(receipt, contractResult);
      });
    });

    ['WRONG_NONCE', 'INVALID_ACCOUNT_ID'].forEach((status) => {
      it('should filter out transactions with Hedera-specific validation failures', async function () {
        const modifiedContractResults = {
          results: [
            { ...results[0] }, // Normal transaction
            { ...results[1], result: status }, // Transaction with a Hedera-specific revert status
          ],
          links: { next: null },
        };

        setupStandardResponses({
          [CONTRACT_RESULTS_WITH_FILTER_URL_2]: modifiedContractResults,
        });

        const receipts = await ethImpl.getBlockReceipts(BLOCK_HASH, requestDetails);

        // Verify only one receipt was returned (the non-reverted one)
        expect(receipts).to.exist;
        expect(receipts.length).to.equal(1);
        expect(receipts[0].transactionHash).to.equal(results[0].hash);

        expectValidReceipt(receipts[0], results[0]);
      });
    });

    it('should return empty array for block with no transactions', async function () {
      restMock.onGet(CONTRACT_RESULTS_WITH_FILTER_URL_2).reply(200, JSON.stringify({ results: [] }));
      restMock.onGet(`blocks/${BLOCK_HASH}`).reply(200, JSON.stringify(DEFAULT_BLOCK));

      const receipts = await ethImpl.getBlockReceipts(BLOCK_HASH, requestDetails);
      expect(receipts).to.be.an('array').that.is.empty;
    });

    it('should properly format all receipt fields', async function () {
      setupStandardResponses();

      const receipts = await ethImpl.getBlockReceipts(BLOCK_HASH, requestDetails);
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
      setupStandardResponses({
        [CONTRACT_RESULTS_WITH_FILTER_URL_2]: defaultContractResultsOnlyHash2,
        [CONTRACT_RESULTS_LOGS_WITH_FILTER_URL_2]: { logs: defaultLogs1 },
      });

      const receipts = await ethImpl.getBlockReceipts(BLOCK_NUMBER_HEX, requestDetails);

      expect(receipts[0].logs.length).to.equal(0);
      expect(receipts[1].logs.length).to.equal(1);
      expect(receipts[1].transactionHash).to.equal(defaultLogs1[0].transaction_hash);
      expect(receipts[1].transactionHash).to.equal(defaultLogs1[1].transaction_hash);
    });
  });

  describe('Error cases', () => {
    it('should handle transactions with no contract results', async function () {
      restMock.onGet(CONTRACT_RESULTS_WITH_FILTER_URL_2).reply(200, JSON.stringify({ results: [] }));
      restMock.onGet(BLOCKS_LIMIT_ORDER_URL).reply(200, JSON.stringify({ blocks: [DEFAULT_BLOCK] }));
      restMock.onGet(`blocks/${BLOCK_NUMBER}`).reply(200, JSON.stringify(DEFAULT_BLOCK));

      const receipts = await ethImpl.getBlockReceipts(BLOCK_NUMBER_HEX, requestDetails);

      expect(receipts.length).to.equal(0);
    });

    it('should return null when block is not found', async function () {
      const getHistoricalBlockResponseStub = sinon
        .stub(ethImpl['blockService']['common'], 'getHistoricalBlockResponse')
        .resolves(null);

      const result = await ethImpl.getBlockReceipts('0x123456', requestDetails);

      expect(result).to.be.null;

      getHistoricalBlockResponseStub.restore();
    });
  });

  describe('Cache behavior', () => {
    let spyCommonGetHistoricalBlockResponse;

    beforeEach(() => {
      spyCommonGetHistoricalBlockResponse = sinon.spy(ethImpl.common, 'getHistoricalBlockResponse');
    });

    afterEach(() => {
      spyCommonGetHistoricalBlockResponse.restore();
    });

    it('should use cached results for subsequent calls', async function () {
      setupStandardResponses();

      const firstResponse = await ethImpl.getBlockReceipts(BLOCK_HASH, requestDetails);

      // Subsequent calls should use cache
      const secondResponse = await ethImpl.getBlockReceipts(BLOCK_HASH, requestDetails);
      const thirdResponse = await ethImpl.getBlockReceipts(BLOCK_HASH, requestDetails);

      expect(spyCommonGetHistoricalBlockResponse.calledOnce).to.be.true;
      expect(secondResponse).to.deep.equal(firstResponse);
      expect(thirdResponse).to.deep.equal(firstResponse);
    });

    it('should set cache when not previously cached', async function () {
      setupStandardResponses();

      await ethImpl.getBlockReceipts(BLOCK_NUMBER_HEX, requestDetails);

      expect(spyCommonGetHistoricalBlockResponse.calledOnce).to.be.true;
    });
  });
});
