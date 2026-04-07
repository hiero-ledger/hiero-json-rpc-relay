// SPDX-License-Identifier: Apache-2.0

import http from 'k6/http';
import { randomIntBetween } from 'https://jslib.k6.io/k6-utils/1.4.0/index.js';

import { TestScenarioBuilder } from '../../lib/common.js';
import { isNonErrorResponse, httpParams, getPayLoad } from './common.js';
import { setupTestParameters } from '../../lib/bootstrapEnvParameters.js';

const methodName = 'eth_getCode';
const { options, run } = new TestScenarioBuilder()
  .name(methodName) // use unique scenario name among all tests
  .request((testParameters) => {
    // select a random contract address
    const contractIndex = randomIntBetween(0, testParameters.contractsAddresses.length - 1);
    const contractAddress = testParameters.contractsAddresses[contractIndex];

    return http.post(testParameters.RELAY_BASE_URL, getPayLoad(methodName, [contractAddress, 'latest']), httpParams);
  })
  .check(methodName, (r) => isNonErrorResponse(r))
  .build();

export { options, run };

export const setup = setupTestParameters;
