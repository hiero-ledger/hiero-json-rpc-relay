// SPDX-License-Identifier: Apache-2.0

import http from 'k6/http';

import { TestScenarioBuilder } from '../../lib/common.js';
import { isNonErrorResponse, httpParams, getPayLoad } from './common.js';

const methodName = 'eth_getBlockReceipts';
const { options, run } = new TestScenarioBuilder()
  .name(methodName)
  .request((testParameters) => {
    return http.post(
      testParameters.RELAY_BASE_URL,
      getPayLoad(methodName, [testParameters.DEFAULT_BLOCK_HASH]),
      httpParams,
    );
  })
  .check(methodName, (r) => isNonErrorResponse(r))
  .testDuration('3s')
  .build();

export { options, run };
