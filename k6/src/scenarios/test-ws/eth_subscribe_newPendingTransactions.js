// SPDX-License-Identifier: Apache-2.0

import { TestScenarioBuilder } from '../../lib/common.js';
import { subscribeEvents } from '../../lib/constants.js';
import { connectToWebSocket, isNonErrorResponse } from './common.js';

const url = __ENV.WS_RELAY_BASE_URL;
const methodName = 'eth_subscribe';
const scenarioName = methodName + '_newPendingTransactions';

const { options, run } = new TestScenarioBuilder()
  .name(methodName + '_newPendingTransactions') // use unique scenario name among all tests
  .request(() => connectToWebSocket(
    url,
    methodName,
    scenarioName,
    [subscribeEvents.newPendingTransactions],
    { methodName: (r) => isNonErrorResponse(r) }
  ))
  .build();

export { options, run };
