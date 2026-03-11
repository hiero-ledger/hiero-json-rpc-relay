// SPDX-License-Identifier: Apache-2.0

import { expect, use } from 'chai';
import chaiAsPromised from 'chai-as-promised';

import { RequestDetails } from '../../../src/lib/types';
import { BASE_FEE_PER_GAS_HEX, DEFAULT_NETWORK_FEES } from './eth-config';
import { generateEthTestEnv } from './eth-helpers';

use(chaiAsPromised);

describe('@ethGasPrice Gas Price spec', async function () {
  const { cacheService, ethImpl, restMock } = generateEthTestEnv();
  const requestDetails = new RequestDetails({ requestId: 'eth_maxPriorityFeePerGasTest', ipAddress: '0.0.0.0' });

  this.beforeEach(async () => {
    await cacheService.clear();
    restMock.reset();
  });

  describe.only('@maxPriorityFeePerGas', async function () {
    it('eth_maxPriorityFeePerGas should return the value of the gasPrice', async function () {
      restMock.onGet('network/fees').reply(200, JSON.stringify(DEFAULT_NETWORK_FEES));
      const result = await ethImpl.maxPriorityFeePerGas(requestDetails);
      const gasPrice = await ethImpl.gasPrice(requestDetails);
      expect(result).to.eq(gasPrice).to.be.eq(BASE_FEE_PER_GAS_HEX);
    });
  });

  this.afterEach(() => {
    restMock.resetHandlers();
  });
});
