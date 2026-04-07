// SPDX-License-Identifier: Apache-2.0

import http from 'k6/http';

import { TestScenarioBuilder } from '../../lib/common.js';
import { isNonErrorResponse, httpParams, getPayLoad } from './common.js';
import { setupTestParameters } from '../../lib/bootstrapEnvParameters.js';

const methodName = 'eth_getBlockByHash';
const { options, run } = new TestScenarioBuilder()
  .name(methodName) // use unique scenario name among all tests
  .request((testParameters) =>
    http.post(
      testParameters.RELAY_BASE_URL,
      getPayLoad(methodName, [testParameters.DEFAULT_BLOCK_HASH, true]),
      httpParams,
    ),
  )
  .check(methodName, (r) => isNonErrorResponse(r))
  .testDuration('3s')
  .maxDuration(2000)
  .build();

export { options, run };

export const setup = setupTestParameters;
