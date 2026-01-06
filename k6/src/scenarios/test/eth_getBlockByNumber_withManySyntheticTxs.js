// SPDX-License-Identifier: Apache-2.0

import http from 'k6/http';

import { TestScenarioBuilder } from '../../lib/common.js';
import { isNonErrorResponse, httpParams, getPayLoad } from './common.js';

const methodName = 'eth_getBlockByNumber';
const { options, run } = new TestScenarioBuilder()
  .name(methodName)
  .request((testParameters) => {
    const blockNumber = '0x' + testParameters.blockNumberWithManySyntheticTxs.toString(16);
    return http.post(__ENV.RELAY_BASE_URL, getPayLoad(methodName, [blockNumber, true]), httpParams);
  })
  .check(methodName, (r) => isNonErrorResponse(r))
  .testDuration('60s')
  .build();

export { options, run };
