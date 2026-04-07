// SPDX-License-Identifier: Apache-2.0

import { TestScenarioBuilder } from '../../lib/common.js';
import { subscribeEvents } from '../../lib/constants.js';
import { connectToWebSocket, isNonErrorResponse } from './common.js';

const url = __ENV.WS_RELAY_BASE_URL;
const methodName = 'eth_subscribe';
const scenarioName = methodName + '_newHeads';

const { options, run } = new TestScenarioBuilder()
  .name(scenarioName) // use unique scenario name among all tests
  .request(() => connectToWebSocket(
    url,
    methodName,
    scenarioName,
    [subscribeEvents.newHeads],
    { methodName: (r) => isNonErrorResponse(r) }
  ))
  .build();

export { options, run };
