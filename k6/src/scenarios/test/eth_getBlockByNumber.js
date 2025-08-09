// SPDX-License-Identifier: Apache-2.0

import http from 'k6/http';
import { randomIntBetween } from 'https://jslib.k6.io/k6-utils/1.4.0/index.js';

import { TestScenarioBuilder } from '../../lib/common.js';
import { isNonErrorResponse, httpParams, getPayLoad } from './common.js';

const url = __ENV.RELAY_BASE_URL;

const methodName = 'eth_getBlockByNumber';
const { options, run } = new TestScenarioBuilder()
  .name(methodName) // use unique scenario name among all tests
  .request((testParameters) => {
    const latestBlock = testParameters.latestBlock;
    // 20% of times we want  to  do  latest, otherwise, we want to  do  a random block
    const isLatest = Math.random() < 0.2;
    const lowerBound = Math.max(0, latestBlock - 1000);
    const blockNumber = isLatest ? 'latest' : '0x' + randomIntBetween(lowerBound, latestBlock).toString(16);

    return http.post(url, getPayLoad(methodName, [blockNumber, true]), httpParams);
  })
  .check(methodName, (r) => isNonErrorResponse(r))
  .build();

export { options, run };
