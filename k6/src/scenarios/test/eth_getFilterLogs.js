// SPDX-License-Identifier: Apache-2.0

import http from 'k6/http';

import { setupTestParameters } from '../../lib/bootstrapEnvParameters.js';
import { TestScenarioBuilder } from '../../lib/common.js';
import { getPayLoad,httpParams, isNonErrorResponse } from './common.js';

const methodName = 'eth_getFilterLogs';
const { options, run } = new TestScenarioBuilder()
  .name(methodName) // use unique scenario name among all tests
  .request((testParameters) => {
    const filterId = testParameters.filters.logFilterId;
    return http.post(testParameters.RELAY_BASE_URL, getPayLoad(methodName, [filterId]), httpParams);
  })
  .check(methodName, (r) => isNonErrorResponse(r))
  .build();

export { options, run };

export const setup = setupTestParameters;
