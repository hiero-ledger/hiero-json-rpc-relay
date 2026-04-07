// SPDX-License-Identifier: Apache-2.0

import http from 'k6/http';

import { TestScenarioBuilder } from '../../lib/common.js';
import { isNonErrorResponse, httpParams, getPayLoad } from './common.js';

const url = __ENV.RELAY_BASE_URL;

const methodName = 'eth_getBlockTransactionCountByNumber';
const { options, run } = new TestScenarioBuilder()
  .name(methodName) // use unique scenario name among all tests
  .request(() => http.post(url, getPayLoad(methodName, ['latest']), httpParams))
  .check(methodName, (r) => isNonErrorResponse(r))
  .maxDuration(2500)
  .testDuration('3s')
  .build();

export { options, run };
