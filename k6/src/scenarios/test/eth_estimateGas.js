// SPDX-License-Identifier: Apache-2.0

import http from 'k6/http';

import { TestScenarioBuilder } from '../../lib/common.js';
import { isNonErrorResponse, httpParams, getPayLoad } from './common.js';

const url = __ENV.RELAY_BASE_URL;

const methodName = 'eth_estimateGas';
const { options, run } = new TestScenarioBuilder()
  .name(methodName) // use unique scenario name among all tests
  .request((testParameters) => {
    const contractAddress = testParameters.contractAddress;
    const from = testParameters.wallets[0].address;
    const payload = getPayLoad(methodName, [
      {
        from: from,
        to: contractAddress,
        data: '0xa41368620000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000002e4772656574696e67732066726f6d204175746f6d617465642054657374204e756d62657220692c2048656c6c6f21000000000000000000000000000000000000',
      },
      'latest',
    ]);
    return http.post(url, payload, httpParams);
  })
  .check(methodName, (r) => isNonErrorResponse(r))
  .build();

export { options, run };
