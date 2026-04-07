// SPDX-License-Identifier: Apache-2.0

import http from 'k6/http';

import { TestScenarioBuilder } from '../../lib/common.js';
import { isNonErrorResponse, httpParams, getPayLoad } from './common.js';
import { setupTestParameters } from '../../lib/bootstrapEnvParameters.js';

const methodName = 'eth_getTransactionByBlockHashAndIndex';
const { options, run } = new TestScenarioBuilder()
  .name(methodName) // use unique scenario name among all tests
  .request((testParameters) => {
    return http.post(
      testParameters.RELAY_BASE_URL,
      getPayLoad(methodName, [testParameters.DEFAULT_BLOCK_HASH, '0x0']),
      httpParams,
    );
  })
  .check(methodName, (r) => isNonErrorResponse(r))
  .build();

export { options, run };

export const setup = setupTestParameters;
