// SPDX-License-Identifier: Apache-2.0



import http from 'k6/http';

import { TestScenarioBuilder } from '../../lib/common.js';
import { getPayLoad,httpParams, isNonErrorResponse } from './common.js';

const methodName = 'eth_newBlockFilter';
const { options, run } = new TestScenarioBuilder()
  .name(methodName) // use unique scenario name among all tests
  .request((testParameters) => http.post(testParameters.RELAY_BASE_URL, getPayLoad(methodName), httpParams))
  .check(methodName, (r) => isNonErrorResponse(r))
  .build();

export { options, run };
