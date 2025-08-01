// SPDX-License-Identifier: Apache-2.0

import { Gauge } from 'k6/metrics';
import { getStressScenarioOptions } from './traffic-weights.js';
import { getOptions, getFilteredTests } from './common.js';

const SCENARIO_DURATION_METRIC_NAME = 'scenario_duration';

/**
 * Create concurrent stress test scenarios with realistic traffic distribution
 * @param {Object} tests - Test modules object
 * @returns {Object} Stress test configuration
 */
export function getStressTestScenarios(tests) {
  tests = getFilteredTests(tests);
  
  const totalVUs = parseInt(__ENV.DEFAULT_VUS) || 10;
  const testDuration = __ENV.DEFAULT_DURATION || '60s';
  
  const funcs = {};
  const scenarios = {};
  const thresholds = {};
  
  // Create concurrent scenarios for all endpoints
  for (const testName of Object.keys(tests).sort()) {
    const testModule = tests[testName];
    const testScenarios = testModule.options.scenarios;
    const testThresholds = testModule.options.thresholds;
    
    for (const [scenarioName, testScenario] of Object.entries(testScenarios)) {
      // Get stress scenario options with realistic VU allocation
      const stressOptions = getStressScenarioOptions(scenarioName, totalVUs, testDuration);
      
      // Merge with existing scenario options but override key stress test properties
      const scenario = Object.assign({}, testScenario, stressOptions);
      
      funcs[scenarioName] = testModule[scenario.exec];
      scenarios[scenarioName] = scenario;
      
      // Set up thresholds
      const tag = `scenario:${scenarioName}`;
      for (const [name, threshold] of Object.entries(testThresholds)) {
        if (name === 'http_req_duration') {
          thresholds[`${name}{${tag},expected_response:true}`] = threshold;
        } else {
          thresholds[`${name}{${tag}}`] = threshold;
        }
      }
      thresholds[`http_reqs{${tag}}`] = ['count>0'];
      thresholds[`${SCENARIO_DURATION_METRIC_NAME}{${tag}}`] = ['value>0'];
    }
  }
  
  const testOptions = Object.assign({}, getOptions(), { scenarios, thresholds });
  
  return { 
    funcs, 
    options: testOptions, 
    scenarioDurationGauge: new Gauge(SCENARIO_DURATION_METRIC_NAME) 
  };
}
