// SPDX-License-Identifier: Apache-2.0



import http from 'k6/http';
import { TestScenarioBuilder } from '../../lib/common.js';
import { isNonErrorResponse, httpParams, getPayLoad } from './common.js';

const methodName = 'web3_sha3';
const { options, run } = new TestScenarioBuilder()
  .name(methodName) // use unique scenario name among all tests
  .request((testParameters) => {
    // Use static hex-encoded data for testing
    const testData = '0x68656c6c6f20776f726c64'; // "hello world" in hex
    return http.post(testParameters.RELAY_BASE_URL, getPayLoad(methodName, [testData]), httpParams);
  })
  .check(methodName, (r) => isNonErrorResponse(r))
  .build();

export { options, run };
