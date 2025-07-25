// SPDX-License-Identifier: Apache-2.0

import http from 'k6/http';
import { randomIntBetween } from 'https://jslib.k6.io/k6-utils/1.4.0/index.js';
import { TestScenarioBuilder } from '../../lib/common.js';
import { is400Status, httpParams, getPayLoad } from './common.js';
import { setupTestParameters } from '../../lib/bootstrapEnvParameters.js';

const methodName = 'eth_getProof';
const { options, run } = new TestScenarioBuilder()
  .name(methodName) // use unique scenario name among all tests
  .request((testParameters) => {
    // Select a random wallet address
    const walletIndex = randomIntBetween(0, testParameters.wallets.length - 1);
    const accountAddress = testParameters.wallets[walletIndex].address;

    // Use static storage keys for testing
    const storageKeys = [
      '0x0000000000000000000000000000000000000000000000000000000000000000',
      '0x0000000000000000000000000000000000000000000000000000000000000001',
    ];

    const blockParameter = 'latest';

    return http.post(
      testParameters.RELAY_BASE_URL,
      getPayLoad(methodName, [accountAddress, storageKeys, blockParameter]),
      httpParams,
    );
  })
  .check(methodName, (r) => is400Status(r))
  .build();

export { options, run };

export const setup = setupTestParameters;
