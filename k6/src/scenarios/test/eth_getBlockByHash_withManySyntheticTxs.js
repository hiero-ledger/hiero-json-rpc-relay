// SPDX-License-Identifier: Apache-2.0

import http from 'k6/http';

import { TestScenarioBuilder } from '../../lib/common.js';
import { isNonErrorResponse, httpParams, getPayLoad } from './common.js';

const methodName = 'eth_getBlockByHash';
const { options, run } = new TestScenarioBuilder()
  .name(`${methodName}_withManySyntheticTxs`)
  .request((testParameters) => {
    return http.post(
      __ENV.RELAY_BASE_URL,
      getPayLoad(methodName, [testParameters.blockHashWithManySyntheticTxs, true]),
      httpParams
    );
  })
  .check(methodName, isNonErrorResponse)
  .testDuration('60s')
  .build();

export { options, run };
