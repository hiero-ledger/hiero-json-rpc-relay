// SPDX-License-Identifier: Apache-2.0

import http from 'k6/http';
import { randomIntBetween } from 'https://jslib.k6.io/k6-utils/1.4.0/index.js';

import { TestScenarioBuilder } from '../../lib/common.js';
import { isNonErrorResponse, httpParams, getPayLoad } from './common.js';

const url = __ENV.RELAY_BASE_URL;

const methodName = 'eth_call';
const { options, run } = new TestScenarioBuilder()
  .name(methodName) // use unique scenario name among all tests
  .request((testParameters) => {
    // select a random contract address
    const contractIndex = randomIntBetween(0, testParameters.contractsAddresses.length - 1);
    const contractAddress = testParameters.contractsAddresses[contractIndex];
    // select a random  from  address
    const fromIndex = randomIntBetween(0, testParameters.wallets.length - 1);
    const from = testParameters.wallets[fromIndex].address;

    return http.post(
      url,
      getPayLoad(methodName, [{ from: from, to: contractAddress, data: '0xcfae3217' }, 'latest']),
      httpParams,
    );
  })
  .check(methodName, (r) => isNonErrorResponse(r))
  .testDuration('3s')
  .maxDuration(2000)
  .build();

export { options, run };
