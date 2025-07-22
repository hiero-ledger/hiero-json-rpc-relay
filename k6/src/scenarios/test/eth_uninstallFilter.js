// SPDX-License-Identifier: Apache-2.0

import http from 'k6/http';

import { TestScenarioBuilder } from '../../lib/common.js';
import { isNonErrorResponse, isErrorResponse, httpParams, getPayLoad } from './common.js';

const url = __ENV.RELAY_BASE_URL;

const methodName = 'eth_uninstallFilter';
const { options, run } = new TestScenarioBuilder()
  .name(methodName) // use unique scenario name among all tests
  .request(() => {
    // Use placeholder filter ID - may return error response which is acceptable for performance testing
    const placeholderFilterId = '0x1';
    return http.post(url, getPayLoad(methodName, [placeholderFilterId]), httpParams);
  })
  .check(methodName, (r) => isNonErrorResponse(r) || isErrorResponse(r))
  .build();

export { options, run };
