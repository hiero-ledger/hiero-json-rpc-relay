// SPDX-License-Identifier: Apache-2.0
import { expect, use } from 'chai';
import chaiAsPromised from 'chai-as-promised';

import { numberTo0x } from '../../../dist/formatters';
import { predefined } from '../../../src';
import constants from '../../../src/lib/constants';
import { RequestDetails } from '../../../src/lib/types';
import RelayAssertions from '../../assertions';
import { overrideEnvsInMochaDescribe, toHex } from '../../helpers';
import { DEFAULT_NETWORK_FEES, NOT_FOUND_RES } from './eth-config';
import { generateEthTestEnv } from './eth-helpers';

use(chaiAsPromised);

describe('@ethGasPrice Gas Price spec', async function () {
  this.timeout(10000);
  const { restMock, ethImpl, cacheService } = generateEthTestEnv();

  const requestDetails = new RequestDetails({ requestId: 'eth_getPriceTest', ipAddress: '0.0.0.0' });

  overrideEnvsInMochaDescribe({ ETH_GET_TRANSACTION_COUNT_MAX_BLOCK_RANGE: 1 });

  this.beforeEach(async () => {
    // reset cache and restMock
    await cacheService.clear(requestDetails);
    restMock.reset();
    restMock.onGet('network/fees').reply(200, JSON.stringify(DEFAULT_NETWORK_FEES));
  });

  this.afterEach(() => {
    restMock.resetHandlers();
  });

  describe('@ethGasPrice', async function () {
    it('eth_gasPrice', async function () {
      const weiBars = await ethImpl.gasPrice(requestDetails);
      const expectedWeiBars = DEFAULT_NETWORK_FEES.fees[2].gas * constants.TINYBAR_TO_WEIBAR_COEF;
      expect(weiBars).to.equal(numberTo0x(expectedWeiBars));
    });

    it('eth_gasPrice with cached value', async function () {
      const firstGasResult = await ethImpl.gasPrice(requestDetails);

      const modifiedNetworkFees = { ...DEFAULT_NETWORK_FEES };
      modifiedNetworkFees.fees[2].gas = DEFAULT_NETWORK_FEES.fees[2].gas * 100;

      restMock.onGet(`network/fees`).reply(200, JSON.stringify(modifiedNetworkFees));

      const secondGasResult = await ethImpl.gasPrice(requestDetails);

      expect(firstGasResult).to.equal(secondGasResult);
    });

    it('eth_gasPrice with no EthereumTransaction gas returned', async function () {
      // deep copy DEFAULT_NETWORK_FEES to avoid mutating the original object
      const partialNetworkFees = JSON.parse(JSON.stringify(DEFAULT_NETWORK_FEES));
      partialNetworkFees.fees.splice(2);

      restMock.onGet(`network/fees`).reply(200, JSON.stringify(partialNetworkFees));

      await RelayAssertions.assertRejection(predefined.COULD_NOT_ESTIMATE_GAS_PRICE, ethImpl.gasPrice, true, ethImpl, [
        requestDetails,
      ]);
    });

    describe('@ethGasPrice different value for GAS_PRICE_PERCENTAGE_BUFFER env', async function () {
      const GAS_PRICE_PERCENTAGE_BUFFER_TESTCASES = {
        'eth_gasPrice with GAS_PRICE_PERCENTAGE_BUFFER set to 10%': '10',
        'eth_gasPrice with GAS_PRICE_PERCENTAGE_BUFFER set to floating % that results in floating number for buffered gas price':
          '10.25',
      };

      let initialGasPrice: string;

      it('should return gas price without buffer', async function () {
        await cacheService.clear(requestDetails);
        initialGasPrice = await ethImpl.gasPrice(requestDetails);
        expect(initialGasPrice).to.equal(toHex(DEFAULT_NETWORK_FEES.fees[2].gas * constants.TINYBAR_TO_WEIBAR_COEF));
      });

      for (const testCaseName in GAS_PRICE_PERCENTAGE_BUFFER_TESTCASES) {
        const GAS_PRICE_PERCENTAGE_BUFFER = GAS_PRICE_PERCENTAGE_BUFFER_TESTCASES[testCaseName];

        describe(testCaseName, async function () {
          overrideEnvsInMochaDescribe({ GAS_PRICE_PERCENTAGE_BUFFER: GAS_PRICE_PERCENTAGE_BUFFER });

          it(`should return gas price with buffer`, async function () {
            const expectedInitialGasPrice = toHex(DEFAULT_NETWORK_FEES.fees[2].gas * constants.TINYBAR_TO_WEIBAR_COEF);
            const expectedGasPriceWithBuffer = toHex(
              Number(expectedInitialGasPrice) +
                Math.round(
                  (Number(expectedInitialGasPrice) / constants.TINYBAR_TO_WEIBAR_COEF) *
                    (Number(GAS_PRICE_PERCENTAGE_BUFFER || 0) / 100),
                ) *
                  constants.TINYBAR_TO_WEIBAR_COEF,
            );

            const gasPriceWithBuffer = await ethImpl.gasPrice(requestDetails);

            expect(gasPriceWithBuffer).to.not.equal(initialGasPrice);
            expect(gasPriceWithBuffer).to.equal(expectedGasPriceWithBuffer);
          });
        });
      }
    });

    describe('eth_gasPrice not found', async function () {
      beforeEach(() => {
        restMock.onGet(`network/fees`).reply(404, JSON.stringify(NOT_FOUND_RES));
      });

      it('eth_gasPrice with no network fees records found', async function () {
        await RelayAssertions.assertRejection(
          predefined.COULD_NOT_ESTIMATE_GAS_PRICE,
          ethImpl.gasPrice,
          true,
          ethImpl,
          [requestDetails],
        );
      });
    });
  });
});
