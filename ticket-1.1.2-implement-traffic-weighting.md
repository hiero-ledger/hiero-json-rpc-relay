# Implement Traffic-Weighted Configuration and Resource-Intensive Endpoint Focus

## Description

### Current Situation

The existing K6 test suite uses equal VU allocation across all RPC endpoints, with each endpoint receiving constant VUs from env for 1-5 seconds. This approach found in `k6/src/scenarios/test/index.js` and `k6/src/lib/common.js` doesn't reflect real-world usage patterns where some endpoints receive significantly more traffic than others.

### Rationale

Based on the traffic analysis from metrics in the last 3 months, we need to transform the K6 test suite to use **Traffic-Weighted** test distribution that reflects actual HashIO traffic patterns. This involves:

1. **Realistic load distribution** - Popular endpoints (high RPS) should get more VUs
2. **Resource-intensive endpoint focus** - Slow endpoints (> Xms latency) should get additional VU multipliers
3. **Proportional testing** - Total VU allocation should mirror real traffic percentages

### The Core Concept

**Traffic weighting** means: **More popular endpoint = More VUs = More concurrent requests**

Instead of:

```javascript
// unrealistic equal weighting
eth_call: 1 VU
eth_getBalance: 1 VU
eth_chainId: 1 VU
```

We need:

```javascript
eth_call: 10 VUs (67% of traffic, high latency)
eth_getBalance: 4 VUs (27% of traffic)
eth_chainId: 1 VU (6% of traffic)
```

### Business Impact

Traffic-weighted testing enables:

- **Accurate performance validation** - Tests reflect real production load patterns
- **Proper bottleneck identification** - Heavy endpoints get appropriate testing focus
- **Realistic capacity planning** - Upper limit discovery based on actual usage
- **Effective regression testing** - Performance comparisons based on realistic scenarios

## Acceptance Criteria

- [ ] Create or extend configuration system to support Traffic-Weighted Test
- [ ] Implement weight calculation logic using data from traffic analyzation
- [ ] Update scenario execution to use weighted VU allocation instead of equal allocation
- [ ] Apply latency-based multipliers for resource-intensive endpoints (> Xms)
- [ ] Ensure total VU allocation remains within reasonable limits
- [ ] Validate weighted tests execute correctly with proper VU distribution
- [ ] Document weight calculation methodology for future updates

## Suggested Solution

### Step 1: Use Traffic Analysis Data

Traffic Analysis Data will look somewhat like:

```javascript
eth_call: 15 RPS average, 800ms latency
eth_getBalance: 12 RPS average, 50ms latency
eth_chainId: 3 RPS average, 25ms latency
// Total: 30 RPS

// Calculated percentages:
eth_call: 50% of traffic (15/30) × 2 (latency >500ms) = 100 points
eth_getBalance: 40% of traffic (12/30) × 1 (latency <500ms) = 40 points
eth_chainId: 10% of traffic (3/30) × 1 (latency <500ms) = 10 points
// Total: 150 points

// Final normalized weights:
eth_call: 100/150 = 67% → Gets most VUs
eth_getBalance: 40/150 = 27% → Gets moderate VUs
eth_chainId: 10/150 = 6% → Gets minimum VUs
```

### Step 2: Apply Weights to Current K6 VU Budget

Instead of hardcoded VU numbers, use the existing `DEFAULT_VUS` configuration:

```javascript
// Get current VU budget from environment
const totalVUs = parseInt(__ENV.DEFAULT_VUS) || 10;

// Apply traffic weights (from Data analysis)
const vuAllocation = {
  eth_call: Math.round(0.67 * totalVUs), // 67% of available VUs
  eth_getBalance: Math.round(0.27 * totalVUs), // 27% of available VUs
  eth_chainId: Math.max(1, Math.round(0.06 * totalVUs)), // At least 1 VU
};

// Example with DEFAULT_VUS=15:
// eth_call: 10 VUs, eth_getBalance: 4 VUs, eth_chainId: 1 VU
```

### Step 3: Create New Weighted Test Flow Files

Instead of modifying existing files, create new files for the weighted test implementation:

**`k6/src/lib/traffic-weights.js`**

```javascript
// Store traffic weights from the analysis
export const trafficWeights = {
  eth_call: 0.67, // 67% of VUs
  eth_getBalance: 0.27, // 27% of VUs
  eth_chainId: 0.06, // 6% of VUs
  // ... add all other endpoints from analysis
};

// VU allocation function
export function calculateVUAllocation(totalVUs = 10) {
  const allocation = {};
  Object.keys(trafficWeights).forEach((endpoint) => {
    allocation[endpoint] = Math.max(1, Math.round(trafficWeights[endpoint] * totalVUs));
  });
  return allocation;
}
```

**`k6/src/lib/weighted-scenarios.js`**

```javascript
import { trafficWeights, calculateVUAllocation } from './traffic-weights.js';

// Create weighted scenario options
export function getWeightedScenarioOptions(endpoint, testDuration = '60s') {
  const totalVUs = parseInt(__ENV.DEFAULT_VUS) || 10;
  const vuAllocation = calculateVUAllocation(totalVUs);

  return {
    executor: 'constant-vus',
    vus: vuAllocation[endpoint] || 1,
    duration: testDuration,
    gracefulStop: __ENV.DEFAULT_GRACEFUL_STOP || '5s',
  };
}
```

**`k6/src/scenarios/weighted-test/index.js`**

```javascript
import { getWeightedTestScenarios } from '../../lib/weighted-scenarios.js';

// Import all the same test modules as current test/index.js
import * as eth_call from '../test/eth_call.js';
import * as eth_getBalance from '../test/eth_getBalance.js';
import * as eth_chainId from '../test/eth_chainId.js';
// ... import all other test modules

// Create weighted test scenarios
const tests = {
  eth_call,
  eth_getBalance,
  eth_chainId,
  // ... add all other tests
};

const { funcs, options, scenarioDurationGauge } = getWeightedTestScenarios(tests);

export { funcs, options, scenarioDurationGauge };
```

### Step 4: Create New Weighted Test Entry Point

**`k6/src/scenarios/weighted-apis.js`**

```javascript
// New entry point for weighted testing (parallel to existing apis.js)
import exec from 'k6/execution';
import { textSummary } from 'https://jslib.k6.io/k6-summary/0.0.1/index.js';

import { markdownReport } from '../lib/common.js';
import { setupTestParameters } from '../lib/bootstrapEnvParameters.js';
import { funcs, options } from './weighted-test/index.js';

function handleSummary(data) {
  return {
    stdout: textSummary(data, { indent: ' ', enableColors: true }),
    'weighted-test-summary.md': markdownReport(data),
  };
}

function run(testParameters) {
  return funcs[exec.scenario.name](testParameters);
}

export { handleSummary, options, run };
export const setup = setupTestParameters;
```

## Implementation Details

### New Files to Create

1. **`k6/src/lib/traffic-weights.js`** - Store traffic weight data and VU calculation logic
2. **`k6/src/lib/weighted-scenarios.js`** - Create weighted scenario options (alternative to current common.js logic)
3. **`k6/src/scenarios/weighted-test/index.js`** - Weighted test scenario collection (parallel to current test/index.js)
4. **`k6/src/scenarios/weighted-apis.js`** - New entry point for weighted testing (parallel to current apis.js)

### Usage

Run weighted tests alongside existing tests:

```bash
# Current equal-weight tests (unchanged):
npm run k6  # or k6 run src/scenarios/apis.js

# New weighted tests:
k6 run src/scenarios/weighted-apis.js
```

## Deliverables

- [ ] Weight calculation system implemented and tested
- [ ] K6 scenarios updated to use traffic-weighted VU allocation
- [ ] Weighted tests execute successfully with proper VU distribution
- [ ] Documentation updated explaining weight calculation methodology
- [ ] Code reviewed and approved by team
- [ ] Integration with existing K6 test suite verified
