// SPDX-License-Identifier: Apache-2.0



import http from 'k6/http';
import { TestScenarioBuilder } from '../../lib/common.js';
import { is400Status, httpParams, getPayLoad } from './common.js';

const methodName = 'eth_newPendingTransactionFilter';
const { options, run } = new TestScenarioBuilder()
  .name(methodName) // use unique scenario name among all tests
  .request((testParameters) => http.post(testParameters.RELAY_BASE_URL, getPayLoad(methodName), httpParams))
  .check(methodName, (r) => is400Status(r))
  .build();

export { options, run };
