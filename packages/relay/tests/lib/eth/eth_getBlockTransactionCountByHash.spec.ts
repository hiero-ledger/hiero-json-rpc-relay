// SPDX-License-Identifier: Apache-2.0

import { expect, use } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import sinon from 'sinon';

import { numberTo0x } from '../../../dist/formatters';
import { SDKClient } from '../../../src/lib/clients';
import { RequestDetails } from '../../../src/lib/types';
import {
  BLOCK_HASH,
  BLOCK_TRANSACTION_COUNT,
  DEFAULT_BLOCK,
  DEFAULT_NETWORK_FEES,
  NO_SUCH_BLOCK_EXISTS_RES,
} from './eth-config';
import { generateEthTestEnv } from './eth-helpers';

use(chaiAsPromised);

let sdkClientStub: sinon.SinonStubbedInstance<SDKClient>;
let getSdkClientStub: sinon.SinonStub;

describe('@ethGetBlockTransactionCountByHash using MirrorNode', async function () {
  this.timeout(10000);
  const { restMock, hapiServiceInstance, ethImpl, cacheService } = generateEthTestEnv();

  const requestDetails = new RequestDetails({
    requestId: 'eth_getBlockTransactionCountByHashTest',
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

  it('eth_getBlockTransactionCountByHash with match', async function () {
    // mirror node request mocks
    restMock.onGet(`blocks/${BLOCK_HASH}`).reply(200, JSON.stringify(DEFAULT_BLOCK));

    const result = await ethImpl.getBlockTransactionCountByHash(BLOCK_HASH, requestDetails);
    expect(result).equal(numberTo0x(BLOCK_TRANSACTION_COUNT));
  });

  it('eth_getBlockTransactionCountByHash with match should hit cache', async function () {
    restMock.onGet(`blocks/${BLOCK_HASH}`).replyOnce(200, JSON.stringify(DEFAULT_BLOCK));

    for (let i = 0; i < 3; i++) {
      const result = await ethImpl.getBlockTransactionCountByHash(BLOCK_HASH, requestDetails);
      expect(result).equal(numberTo0x(BLOCK_TRANSACTION_COUNT));
    }
  });

  it('eth_getBlockTransactionCountByHash with no match', async function () {
    // mirror node request mocks
    restMock.onGet(`blocks/${BLOCK_HASH}`).reply(404, JSON.stringify(NO_SUCH_BLOCK_EXISTS_RES));

    const result = await ethImpl.getBlockTransactionCountByHash(BLOCK_HASH, requestDetails);
    expect(result).to.equal(null);
  });
});
