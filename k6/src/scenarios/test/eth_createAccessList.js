// SPDX-License-Identifier: Apache-2.0

import http from 'k6/http';
import { randomIntBetween } from 'https://jslib.k6.io/k6-utils/1.4.0/index.js';
import { setupTestParameters } from '../../lib/bootstrapEnvParameters.js';
import { TestScenarioBuilder } from '../../lib/common.js';
import { is400Status, httpParams, getPayLoad } from './common.js';

const methodName = 'eth_createAccessList';
const { options, run } = new TestScenarioBuilder()
  .name(methodName) // use unique scenario name among all tests
  .request((testParameters) => {
    // Select random wallet and contract addresses
    const walletIndex = randomIntBetween(0, testParameters.wallets.length - 1);
    const fromAddress = testParameters.wallets[walletIndex].address;

    const contractIndex = randomIntBetween(0, testParameters.contractsAddresses.length - 1);
    const toAddress = testParameters.contractsAddresses[contractIndex];

    // Create transaction object for access list creation
    const transactionObject = {
      from: fromAddress,
      to: toAddress,
      data: '0xcfae3217', // Example function call data
      gas: '0x5208', // 21000 in hex
      gasPrice: '0x9184e72a000', // 10000000000000 in hex
    };

    const blockParameter = 'latest';

    return http.post(
      testParameters.RELAY_BASE_URL,
      getPayLoad(methodName, [transactionObject, blockParameter]),
      httpParams,
    );
  })
  .check(methodName, (r) => is400Status(r))
  .build();

export { options, run };

export const setup = setupTestParameters;
