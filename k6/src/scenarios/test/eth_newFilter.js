// SPDX-License-Identifier: Apache-2.0


import { randomIntBetween } from 'https://jslib.k6.io/k6-utils/1.4.0/index.js';
import http from 'k6/http';

import { setupTestParameters } from '../../lib/bootstrapEnvParameters.js';
import { TestScenarioBuilder } from '../../lib/common.js';
import { getPayLoad,httpParams, isNonErrorResponse } from './common.js';

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

    return http.post(testParameters.RELAY_BASE_URL, getPayLoad(methodName, [filterObject]), httpParams);
  })
  .check(methodName, (r) => isNonErrorResponse(r))
  .build();

export { options, run };

export const setup = setupTestParameters;
