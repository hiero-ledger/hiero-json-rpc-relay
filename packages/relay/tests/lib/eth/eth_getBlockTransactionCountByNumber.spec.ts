// SPDX-License-Identifier: Apache-2.0

import { expect, use } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import sinon from 'sinon';

import { numberTo0x } from '../../../dist/formatters';
import { SDKClient } from '../../../src/lib/clients';
import { RequestDetails } from '../../../src/lib/types';
import {
  BLOCK_NUMBER,
  BLOCK_TRANSACTION_COUNT,
  BLOCKS_LIMIT_ORDER_URL,
  DEFAULT_BLOCK,
  DEFAULT_BLOCKS_RES,
  DEFAULT_NETWORK_FEES,
  NO_SUCH_BLOCK_EXISTS_RES,
} from './eth-config';
import { generateEthTestEnv } from './eth-helpers';

use(chaiAsPromised);

let sdkClientStub: sinon.SinonStubbedInstance<SDKClient>;
let getSdkClientStub: sinon.SinonStub;

describe('@ethGetBlockTransactionCountByNumber using MirrorNode', async function () {
  this.timeout(10000);
  const { restMock, hapiServiceInstance, ethImpl, cacheService } = generateEthTestEnv();

  const requestDetails = new RequestDetails({
    requestId: 'eth_getBlockTransactionCountByNumberTest',
    ipAddress: '0.0.0.0',
  });

  this.beforeEach(async () => {
    // reset cache and restMock
    await cacheService.clear(requestDetails);
    restMock.reset();
    sdkClientStub = sinon.createStubInstance(SDKClient);
    getSdkClientStub = sinon.stub(hapiServiceInstance, 'getSDKClient').returns(sdkClientStub);
    restMock.onGet('network/fees').reply(200, JSON.stringify(DEFAULT_NETWORK_FEES));
  });

  this.afterEach(() => {
    getSdkClientStub.restore();
    restMock.resetHandlers();
  });

  it('eth_getBlockTransactionCountByNumber with match', async function () {
    // mirror node request mocks
    restMock.onGet(`blocks/${BLOCK_NUMBER}`).reply(200, JSON.stringify(DEFAULT_BLOCK));

    const result = await ethImpl.getBlockTransactionCountByNumber(BLOCK_NUMBER.toString(), requestDetails);
    expect(result).equal(numberTo0x(BLOCK_TRANSACTION_COUNT));
  });

  it('eth_getBlockTransactionCountByNumber with match should hit cache', async function () {
    restMock.onGet(`blocks/${BLOCK_NUMBER}`).replyOnce(200, JSON.stringify(DEFAULT_BLOCK));

    for (let i = 0; i < 3; i++) {
      const result = await ethImpl.getBlockTransactionCountByNumber(BLOCK_NUMBER.toString(), requestDetails);
      expect(result).equal(numberTo0x(BLOCK_TRANSACTION_COUNT));
    }
  });

  it('eth_getBlockTransactionCountByNumber with no match', async function () {
    await cacheService.clear(requestDetails);
    restMock.onGet(`blocks/${BLOCK_NUMBER}`).reply(404, JSON.stringify(NO_SUCH_BLOCK_EXISTS_RES));

    const result = await ethImpl.getBlockTransactionCountByNumber(BLOCK_NUMBER.toString(), requestDetails);
    expect(result).to.equal(null);
  });

  it('eth_getBlockTransactionCountByNumber with latest tag', async function () {
    // mirror node request mocks
    restMock.onGet(BLOCKS_LIMIT_ORDER_URL).reply(200, JSON.stringify(DEFAULT_BLOCKS_RES));
    restMock.onGet(`blocks/${BLOCK_NUMBER}`).reply(200, JSON.stringify(DEFAULT_BLOCK));

    const result = await ethImpl.getBlockTransactionCountByNumber('latest', requestDetails);
    expect(result).equal(numberTo0x(BLOCK_TRANSACTION_COUNT));
  });

  it('eth_getBlockTransactionCountByNumber with finalized tag', async function () {
    // mirror node request mocks
    restMock.onGet(BLOCKS_LIMIT_ORDER_URL).reply(200, JSON.stringify(DEFAULT_BLOCKS_RES));
    restMock.onGet(`blocks/${BLOCK_NUMBER}`).reply(200, JSON.stringify(DEFAULT_BLOCK));

    const result = await ethImpl.getBlockTransactionCountByNumber('finalized', requestDetails);
    expect(result).equal(numberTo0x(BLOCK_TRANSACTION_COUNT));
  });

  it('eth_getBlockTransactionCountByNumber with safe tag', async function () {
    // mirror node request mocks
    restMock.onGet(BLOCKS_LIMIT_ORDER_URL).reply(200, JSON.stringify(DEFAULT_BLOCKS_RES));
    restMock.onGet(`blocks/${BLOCK_NUMBER}`).reply(200, JSON.stringify(DEFAULT_BLOCK));

    const result = await ethImpl.getBlockTransactionCountByNumber('safe', requestDetails);
    expect(result).equal(numberTo0x(BLOCK_TRANSACTION_COUNT));
  });

  it('eth_getBlockTransactionCountByNumber with pending tag', async function () {
    // mirror node request mocks
    restMock.onGet(BLOCKS_LIMIT_ORDER_URL).reply(200, JSON.stringify(DEFAULT_BLOCKS_RES));
    restMock.onGet(`blocks/${BLOCK_NUMBER}`).reply(200, JSON.stringify(DEFAULT_BLOCK));

    const result = await ethImpl.getBlockTransactionCountByNumber('pending', requestDetails);
    expect(result).equal(numberTo0x(BLOCK_TRANSACTION_COUNT));
  });

  it('eth_getBlockTransactionCountByNumber with earliest tag', async function () {
    // mirror node request mocks
    restMock.onGet(`blocks/0`).reply(200, JSON.stringify(DEFAULT_BLOCK));

    const result = await ethImpl.getBlockTransactionCountByNumber('earliest', requestDetails);
    expect(result).equal(numberTo0x(BLOCK_TRANSACTION_COUNT));
  });

  it('eth_getBlockTransactionCountByNumber with hex number', async function () {
    // mirror node request mocks
    restMock.onGet(`blocks/3735929054`).reply(200, JSON.stringify(DEFAULT_BLOCK));

    const result = await ethImpl.getBlockTransactionCountByNumber('0xdeadc0de', requestDetails);
    expect(result).equal(numberTo0x(BLOCK_TRANSACTION_COUNT));
  });
});
