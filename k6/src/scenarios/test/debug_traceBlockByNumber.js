// SPDX-License-Identifier: Apache-2.0

import http from 'k6/http';

import { setupTestParameters } from '../../lib/bootstrapEnvParameters.js';
import { TestScenarioBuilder } from '../../lib/common.js';
import { getPayLoad,httpParams, isNonErrorResponse } from './common.js';

const methodName = 'debug_traceBlockByNumber';
const { options, run } = new TestScenarioBuilder()
  .name(methodName) // use unique scenario name among all tests
  .request((testParameters) => {
    // Use 'latest' block for consistent testing
    const blockNumber = 'latest';
    return http.post(testParameters.RELAY_BASE_URL, getPayLoad(methodName, [blockNumber]), httpParams);
  })
  .check(methodName, (r) => isNonErrorResponse(r))
  .maxDuration(5000) // Extended timeout for potentially slow debug responses
  .testDuration('3s')
  .build();

export { options, run };

export const setup = setupTestParameters;
