// SPDX-License-Identifier: Apache-2.0

import http from 'k6/http';

import { TestScenarioBuilder } from '../../lib/common.js';
import { httpParams, getPayLoad, is400Status } from './common.js';

const url = __ENV.RELAY_BASE_URL;

const methodName = 'eth_sign';
const { options, run } = new TestScenarioBuilder()
  .name(methodName) // use unique scenario name among all tests
  .request(() => http.post(url, getPayLoad(methodName), httpParams))
  .check(methodName, (r) => is400Status(r))
  .build();

export { options, run };
