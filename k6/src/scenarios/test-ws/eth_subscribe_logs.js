// SPDX-License-Identifier: Apache-2.0

import { setupTestParameters } from '../../lib/bootstrapEnvParameters.js';
import { TestScenarioBuilder } from '../../lib/common.js';
import { subscribeEvents } from '../../lib/constants.js';
import { connectToWebSocket, isNonErrorResponse } from './common.js';

const url = __ENV.WS_RELAY_BASE_URL;
const methodName = 'eth_subscribe';
const scenarioName = methodName + '_logs';

const { options, run } = new TestScenarioBuilder()
  .name(scenarioName) // use unique scenario name among all tests
  .request((testParameters) => {
    return connectToWebSocket(
      url,
      methodName,
      scenarioName,
      [subscribeEvents.logs, { address: testParameters.contractsAddresses[0] }],
      { methodName: (r) => isNonErrorResponse(r) }
    );
  })
  .build();

export { options, run };

export const setup = setupTestParameters;
