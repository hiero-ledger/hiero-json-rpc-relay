// SPDX-License-Identifier: Apache-2.0

import { check, sleep } from 'k6';
import { Gauge } from 'k6/metrics';
import { randomIntBetween } from 'https://jslib.k6.io/k6-utils/1.4.0/index.js';
import { calculateVUAllocation } from './traffic-weights.js';

import { setDefaultValuesForEnvParameters } from './parameters.js';

setDefaultValuesForEnvParameters();

const SCENARIO_DURATION_METRIC_NAME = 'scenario_duration';

function getOptions(maxDuration = __ENV['DEFAULT_MAX_DURATION']) {
  if (parseInt(__ENV['DEFAULT_MAX_DURATION']) > parseInt(maxDuration)) {
    maxDuration = __ENV['DEFAULT_MAX_DURATION'];
  }

  return {
    thresholds: {
      checks: [`rate>=${__ENV['DEFAULT_PASS_RATE']}`], // min % that should pass the checks,
      http_req_duration: [`p(95)<${maxDuration}`], // 95% requests should receive response in less than max duration
    },
    insecureSkipTLSVerify: true,
    noConnectionReuse: true,
    noVUConnectionReuse: true,
  };
}

function getScenarioOptions(testDuration = __ENV.DEFAULT_DURATION) {
  if (
    parseInt(__ENV['DEFAULT_DURATION'].toString().substring(0, __ENV['DEFAULT_DURATION'].toString().length - 1)) >
    parseInt(testDuration.substring(0, testDuration.length - 1))
  ) {
    testDuration = __ENV['DEFAULT_DURATION'];
  }

  return {
    duration: testDuration,
    exec: 'run',
    executor: 'constant-vus',
    gracefulStop: (__ENV.DEFAULT_GRACEFUL_STOP != null && __ENV.DEFAULT_GRACEFUL_STOP) || '5s',
    vus: __ENV.DEFAULT_VUS,
  };
}

function getMetricNameWithTags(name, ...tags) {
  return tags.length === 0 ? name : `${name}{${tags}}`;
}

const timeRegex = /^\d+s$/;

function getNextStartTime(startTime, duration, gracefulStop) {
  if (!timeRegex.test(startTime)) {
    throw new Error(`Invalid startTime ${startTime}`);
  }

  if (!timeRegex.test(duration)) {
    throw new Error(`Invalid duration ${duration}`);
  }

  if (!timeRegex.test(gracefulStop)) {
    throw new Error(`Invalid gracefulStop ${gracefulStop}`);
  }

  return `${parseInt(startTime) + parseInt(duration) + parseInt(gracefulStop)}s`;
}

function getOptionsWithScenario(name, tags = {}, maxDuration = undefined, testDuration = undefined) {
  return Object.assign({}, getOptions(maxDuration), {
    scenarios: {
      [name]: Object.assign({}, getScenarioOptions(testDuration), { tags }),
    },
  });
}

function isLoadTest() {
  return __ENV.TEST_TYPE === 'load';
}

function getFilteredTests(tests) {
  if (__ENV.FILTER_TEST && __ENV.FILTER_TEST !== '*') {
    const filteredTests = __ENV.FILTER_TEST.split(',');

    const newTests = {};
    for (let i = 0; i < filteredTests.length; i++) {
      const testName = filteredTests[i];
      newTests[testName] = tests[testName];
    }

    return newTests;
  } else {
    return tests;
  }
}

function getSequentialTestScenarios(tests) {
  tests = getFilteredTests(tests);

  let startTime = '0s';
  let duration = '0s';
  let gracefulStop = '0s';

  const funcs = {};
  const scenarios = {};
  const thresholds = {};
  for (const testName of Object.keys(tests).sort()) {
    const testModule = tests[testName];
    const testScenarios = testModule.options.scenarios;
    const testThresholds = testModule.options.thresholds;
    for (const [scenarioName, testScenario] of Object.entries(testScenarios)) {
      const scenario = Object.assign({}, testScenario);
      funcs[scenarioName] = testModule[scenario.exec];
      scenarios[scenarioName] = scenario;

      // update the scenario's startTime, so scenarios run in sequence
      if (isLoadTest()) {
        scenario.startTime = 0;
      } else {
        scenario.startTime = getNextStartTime(startTime, duration, gracefulStop);
      }
      startTime = scenario.startTime;
      duration = scenario.duration;
      gracefulStop = scenario.gracefulStop;

      // thresholds
      const tag = `scenario:${scenarioName}`;
      for (const [name, threshold] of Object.entries(testThresholds)) {
        if (name === 'http_req_duration') {
          thresholds[getMetricNameWithTags(name, tag, 'expected_response:true')] = threshold;
        } else {
          thresholds[getMetricNameWithTags(name, tag)] = threshold;
        }
      }
      thresholds[getMetricNameWithTags('http_reqs', tag)] = ['count>0'];
      thresholds[getMetricNameWithTags(SCENARIO_DURATION_METRIC_NAME, tag)] = ['value>0'];
    }
  }

  const testOptions = Object.assign({}, getOptions(), { scenarios, thresholds });

  return { funcs, options: testOptions, scenarioDurationGauge: new Gauge(SCENARIO_DURATION_METRIC_NAME) };
}

const checksRegex = /^checks{.*scenario:.*}$/;
const httpReqDurationRegex = /^http_req_duration{.*scenario:.*}$/;
const httpReqsRegex = /^http_reqs{.*scenario:.*}$/;
const scenarioDurationRegex = /^scenario_duration{.*scenario:.*}$/;
const scenarioRegex = /scenario:([^,}]+)/;

function getScenario(metricKey) {
  const match = scenarioRegex.exec(metricKey);
  return match[1];
}

function defaultMetrics() {
  return {
    checks: {
      values: {
        rate: 0,
      },
    },
    http_req_duration: {
      values: {
        avg: 0,
      },
    },
    http_reqs: {
      values: {
        count: 0,
      },
    },
    scenario_duration: {
      values: {
        value: 0,
      },
    },
  };
}

function getTestType() {
  return __ENV.TEST_TYPE !== undefined && __ENV.TEST_TYPE === 'load' ? 'load' : 'performance';
}

function markdownReport(data, isFirstColumnUrl, scenarios) {
  const firstColumnName = isFirstColumnUrl ? 'URL' : 'Scenario';
  const header = `| ${firstColumnName} | VUS | Reqs | Pass % | RPS (1/s) | Pass RPS (1/s) | Avg. Req Duration (ms) | Median (ms) | Min (ms) | Max (ms) | P(90) (ms) | P(95) (ms) | Comment |
|----------|-----|------|--------|-----|----------|-------------------|-------|-----|-----|-------|-------|---------|`;

  // collect the metrics
  const { metrics } = data;

  const isDebugMode = __ENV['DEBUG_MODE'] === 'true';
  if (isDebugMode) {
    console.log('Raw metrics:');
    console.log(JSON.stringify(metrics, null, 2));
  }

  const scenarioMetrics = {};

  for (const [key, value] of Object.entries(metrics)) {
    let name;
    if (checksRegex.test(key)) {
      name = 'checks';
    } else if (httpReqDurationRegex.test(key)) {
      name = 'http_req_duration';
    } else if (httpReqsRegex.test(key)) {
      name = 'http_reqs';
    } else if (scenarioDurationRegex.test(key)) {
      name = 'scenario_duration';
    } else {
      continue;
    }

    const scenario = getScenario(key);
    const existingMetrics = scenarioMetrics[scenario] || defaultMetrics();
    scenarioMetrics[scenario] = Object.assign(existingMetrics, { [name]: value });
  }

  const scenarioUrls = {};
  if (isFirstColumnUrl) {
    for (const [name, scenario] of Object.entries(scenarios)) {
      scenarioUrls[name] = scenario.tags.url;
    }
  }

  // Generate the markdown report
  let markdown = '# K6 Performance Test Results \n\n';
  markdown += `JSON-RPC-RELAY URL:  ${__ENV['RELAY_BASE_URL']}\n\n`;
  markdown += `Timestamp: ${new Date(Date.now()).toISOString()} \n\n`;
  markdown += `Duration: ${__ENV['DEFAULT_DURATION']} \n\n`;
  markdown += `Test Type: ${getTestType()} \n\n`;
  markdown += `Virtual Users (VUs): ${__ENV['DEFAULT_VUS']} \n\n`;

  markdown += `${header}\n`;
  for (const scenario of Object.keys(scenarioMetrics).sort()) {
    try {
      const scenarioMetric = scenarioMetrics[scenario];
      const passPercentage = (scenarioMetric['checks'].values.rate * 100.0).toFixed(2);
      const httpReqs = scenarioMetric['http_reqs'].values.count;
      const duration = scenarioMetric['scenario_duration'].values.value; // in ms
      const rps = (((httpReqs * 1.0) / duration) * 1000).toFixed(2);
      const passRps = ((rps * passPercentage) / 100.0).toFixed(2);
      const httpReqDuration = scenarioMetric['http_req_duration'].values.avg.toFixed(2);
      const httpP95Duration = scenarioMetric['http_req_duration'].values['p(95)'].toFixed(2);
      const httpP90Duration = scenarioMetric['http_req_duration'].values['p(90)'].toFixed(2);
      const httpMedDuration = scenarioMetric['http_req_duration'].values['med'].toFixed(2);
      const httpMinDuration = scenarioMetric['http_req_duration'].values['min'].toFixed(2);
      const httpMaxDuration = scenarioMetric['http_req_duration'].values['max'].toFixed(2);

      const firstColumn = isFirstColumnUrl ? scenarioUrls[scenario] : scenario;

      // Get actual VU allocation for this scenario, fallback to DEFAULT_VUS
      const actualVUs = (globalThis.vuAllocation && globalThis.vuAllocation[scenario]) || __ENV.DEFAULT_VUS;

      markdown += `| ${firstColumn} | ${actualVUs} | ${httpReqs} | ${passPercentage} | ${rps} | ${passRps} | ${httpReqDuration} | ${httpMedDuration} | ${httpMinDuration} | ${httpMaxDuration} | ${httpP90Duration} | ${httpP95Duration} | |\n`;
    } catch (err) {
      console.error(`Unable to render report for scenario ${scenario}`);
    }
  }

  return markdown;
}

function TestScenarioBuilder() {
  this._checks = {};
  this._name = null;
  this._request = null;
  this._tags = {};
  this._testDuration = undefined;
  this._maxDuration = undefined;

  this.build = function () {
    const that = this;
    return {
      options: getOptionsWithScenario(that._name, that._tags, that._maxDuration, that._testDuration),
      run: function (testParameters, iteration = 0, vuIndex = 0, iterationByVu = 0) {
        const response = that._request(testParameters, iteration, vuIndex, iterationByVu);
        check(response, that._checks);
        // if Load test, then we need to sleep for random time between 1 and 5 seconds
        if (getTestType() === 'load') {
          sleep(randomIntBetween(1, 5));
        }
      },
    };
  };

  this.check = function (name, func) {
    this._checks[name] = func;
    return this;
  };

  this.name = function (name) {
    this._name = name;
    return this;
  };

  this.request = function (func) {
    this._request = func;
    return this;
  };

  this.tags = function (tags) {
    this._tags = tags;
    return this;
  };

  this.testDuration = function (testDuration) {
    this._testDuration = testDuration;
    return this;
  };

  this.maxDuration = function (maxDuration) {
    this._maxDuration = maxDuration;
    return this;
  };

  return this;
}

/**
 * Get stress test scenario options for a specific endpoint
 * @param {string} endpoint - The endpoint name
 * @param {number} totalVUs - Total VUs to distribute
 * @param {string} duration - Test duration
 * @returns {Object} K6 scenario configuration
 */
export function getStressScenarioOptions(endpoint, totalVUs = 10, duration = '60s') {
  const vuAllocation = calculateVUAllocation(totalVUs);

  return {
    executor: 'constant-vus',
    vus: vuAllocation[endpoint] || 1,
    duration: duration,
    startTime: '0s', // All scenarios start simultaneously for stress testing
    gracefulStop: __ENV.DEFAULT_GRACEFUL_STOP || '5s',
  };
}

/**
 * Create concurrent stress test scenarios with realistic traffic distribution
 * @param {Object} tests - Test modules object
 * @returns {Object} Stress test configuration
 */
function getStressTestScenarios(tests) {
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
    scenarioDurationGauge: new Gauge(SCENARIO_DURATION_METRIC_NAME),
  };
}

export {
  getSequentialTestScenarios,
  getStressTestScenarios,
  markdownReport,
  TestScenarioBuilder,
  getFilteredTests,
  getOptions,
};
