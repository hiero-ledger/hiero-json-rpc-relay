// SPDX-License-Identifier: Apache-2.0

import http from 'k6/http';

import { setupTestParameters } from '../../lib/bootstrapEnvParameters.js';
import { TestScenarioBuilder } from '../../lib/common.js';
import { getPayLoad, httpParams, isNonErrorResponse } from './common.js';

const methodName = 'eth_getStorageAt';
const { options, run } = new TestScenarioBuilder()
  .name(methodName) // use unique scenario name among all tests
  .request((testParameters) => {
    return http.post(
      testParameters.RELAY_BASE_URL,
      getPayLoad(methodName, [testParameters.contractAddress, '0x0', 'latest']),
      httpParams,
    );
  })
  .check(methodName, (r) => isNonErrorResponse(r)) // how to scale since dependent on contract
  .build();

export { options, run };

export const setup = setupTestParameters;
