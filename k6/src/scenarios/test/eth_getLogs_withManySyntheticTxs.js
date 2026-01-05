// SPDX-License-Identifier: Apache-2.0

import http from 'k6/http';

import { TestScenarioBuilder } from '../../lib/common.js';
import { isNonErrorResponse, httpParams, getPayLoad } from './common.js';

const url = __ENV.RELAY_BASE_URL;

const methodName = 'eth_getLogs';
const { options, run } = new TestScenarioBuilder()
  .name(methodName) // use unique scenario name among all tests
  .request((testParameters) => {
    const blockNumber = '0x' + testParameters.blockNumberWithManySyntheticTxs.toString(16);
    return http.post(url, getPayLoad(methodName, [{ fromBlock: blockNumber, toBlock: blockNumber }]), httpParams);
  })
  .check(methodName, (r) => isNonErrorResponse(r))
  .testDuration('60s')
  .build();

export { options, run };
