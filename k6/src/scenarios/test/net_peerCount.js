// SPDX-License-Identifier: Apache-2.0



import http from 'k6/http';

import { TestScenarioBuilder } from '../../lib/common.js';
import { getPayLoad,httpParams, is400Status } from './common.js';

const methodName = 'net_peerCount';
const { options, run } = new TestScenarioBuilder()
  .name(methodName) // use unique scenario name among all tests
  .request((testParameters) => http.post(testParameters.RELAY_BASE_URL, getPayLoad(methodName), httpParams))
  .check(methodName, (r) => is400Status(r))
  .build();

export { options, run };
