// SPDX-License-Identifier: Apache-2.0

import { TestScenarioBuilder } from '../../lib/common.js';
import { connectToWebSocket, isNonErrorResponse } from './common.js';

const url = __ENV.WS_RELAY_BASE_URL;
const methodName = 'eth_chainId';
const scenarioName = methodName;

const { options, run } = new TestScenarioBuilder()
  .name(scenarioName) // use unique scenario name among all tests
  .request(() => connectToWebSocket(
    url,
    methodName,
    scenarioName,
    [],
    { methodName: (r) => isNonErrorResponse(r) }
  ))
  .build();

export { options, run };
