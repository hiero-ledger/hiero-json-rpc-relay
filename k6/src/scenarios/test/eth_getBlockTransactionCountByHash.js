// SPDX-License-Identifier: Apache-2.0

import http from 'k6/http';

import { setupTestParameters } from '../../lib/bootstrapEnvParameters.js';
import { TestScenarioBuilder } from '../../lib/common.js';
import { getPayLoad,httpParams, isNonErrorResponse } from './common.js';

const methodName = 'eth_getBlockTransactionCountByHash';
const { options, run } = new TestScenarioBuilder()
  .name(methodName) // use unique scenario name among all tests
  .request((testParameters) => {
    return http.post(
      testParameters.RELAY_BASE_URL,
      getPayLoad(methodName, [testParameters.DEFAULT_BLOCK_HASH]),
      httpParams,
    );
  })
  .check(methodName, (r) => isNonErrorResponse(r))
  .maxDuration(3500)
  .testDuration('4s')
  .build();

export { options, run };

export const setup = setupTestParameters;
