// SPDX-License-Identifier: Apache-2.0

import { textSummary } from 'https://jslib.k6.io/k6-summary/0.0.1/index.js';
import exec from 'k6/execution';

import { setupTestParameters } from '../lib/bootstrapEnvParameters.js';
import { markdownReport } from '../lib/common.js';
import { funcs, options, scenarioDurationGauge } from './stress/index.js';

function handleSummary(data) {
  return {
    stdout: textSummary(data, { indent: ' ', enableColors: true }),
    'stress-test-report.md': markdownReport(data, false, options.scenarios),
  };
}

function run(testParameters) {
  const scenario = exec.scenario;
  funcs[scenario.name](testParameters, scenario.iterationInTest, exec.vu.idInInstance - 1, exec.vu.iterationInScenario);
  scenarioDurationGauge.add(Date.now() - scenario.startTime, { scenario: scenario.name });
}

export { handleSummary, options, run };

export const setup = setupTestParameters;
