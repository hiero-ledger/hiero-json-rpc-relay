/*-
 *
 * Hedera JSON RPC Relay
 *
 * Copyright (C) 2022-2024 Hedera Hashgraph, LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 */

import exec from 'k6/execution';
import { textSummary } from 'https://jslib.k6.io/k6-summary/0.0.1/index.js';

import { markdownReport } from '../lib/common.js';
import { setupTestParameters } from '../lib/bootstrapEnvParameters.js';
import { funcs, options } from './test-ws/index.js';

function handleSummary(data) {
  return {
    stdout: textSummary(data, { indent: ' ', enableColors: true }),
    'report.md': markdownReport(data, false, options.scenarios),
  };
}

function run(testParameters) {
  const scenario = exec.scenario;
  funcs[scenario.name](testParameters, scenario.iterationInTest, exec.vu.idInInstance - 1, exec.vu.iterationInScenario);
}

export { handleSummary, options, run };

export const setup = setupTestParameters;
