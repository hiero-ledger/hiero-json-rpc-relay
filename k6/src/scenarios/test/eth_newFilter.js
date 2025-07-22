// SPDX-License-Identifier: Apache-2.0

import http from 'k6/http';
import { randomIntBetween } from 'https://jslib.k6.io/k6-utils/1.4.0/index.js';

import { TestScenarioBuilder } from '../../lib/common.js';
import { isNonErrorResponse, httpParams, getPayLoad } from './common.js';
import { setupTestParameters } from '../../lib/bootstrapEnvParameters.js';

const url = __ENV.RELAY_BASE_URL;

const methodName = 'eth_newFilter';
const { options, run } = new TestScenarioBuilder()
  .name(methodName) // use unique scenario name among all tests
  .request((testParameters) => {
    // Create filter object with basic parameters
    const filterObject = {
      fromBlock: 'latest',
      toBlock: 'latest',
    };

    // Add contract address if available
    if (testParameters && testParameters.contractsAddresses && testParameters.contractsAddresses.length > 0) {
      const contractIndex = randomIntBetween(0, testParameters.contractsAddresses.length - 1);
      filterObject.address = testParameters.contractsAddresses[contractIndex];
    }

    return http.post(url, getPayLoad(methodName, [filterObject]), httpParams);
  })
  .check(methodName, (r) => isNonErrorResponse(r))
  .build();

export { options, run };

export const setup = setupTestParameters;
