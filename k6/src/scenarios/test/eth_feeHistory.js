// SPDX-License-Identifier: Apache-2.0

import http from 'k6/http';

import { TestScenarioBuilder } from '../../lib/common.js';
import { isNonErrorResponse, httpParams, getPayLoad } from './common.js';

const url = __ENV.RELAY_BASE_URL;

const methodName = 'eth_feeHistory';
const { options, run } = new TestScenarioBuilder()
  .name(methodName) // use unique scenario name among all tests
  .request(() => http.post(url, getPayLoad(methodName, ['0x1', 'latest', []]), httpParams))
  .check(methodName, (r) => isNonErrorResponse(r))
  .testDuration('5s')
  .maxDuration(4500)
  .build();

export { options, run };
