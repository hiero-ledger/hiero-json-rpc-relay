# Implement Stress Test Configuration with Realistic Traffic Patterns

## Description

### Current Situation

The existing K6 test suite uses equal VU allocation across all RPC endpoints, with each endpoint receiving constant VUs from env for 1-5 seconds. This approach found in `k6/src/scenarios/test/index.js` and `k6/src/lib/common.js` doesn't reflect real-world usage patterns where some endpoints receive significantly more traffic than others.

### Rationale

Based on the traffic data collection from 90 days of HashIO metrics, we need to transform the K6 test suite to implement **stress testing with realistic traffic patterns** that reflects actual traffic distribution. This involves:

1. **Realistic load distribution** - Popular endpoints (high RPS) should get more VUs during stress testing
2. **Proportional testing** - Total VU allocation should mirror real traffic percentages
3. **Progressive stress testing** - Enable gradual load increases to find degradation points
4. **Simple implementation** - Use RPS percentages directly without complex multipliers

### The Core Concept

**Stress testing with realistic traffic patterns** means: **More popular endpoint = More VUs = More realistic stress on the system**

Instead of:

```javascript
// Current unrealistic equal weighting
eth_getBlockByNumber: 1 VU
eth_getLogs: 1 VU
eth_chainId: 1 VU
```

We need:

```javascript
// New stress testing with realistic patterns (from traffic data)
eth_getBlockByNumber: 69 VUs (68.7% of traffic)
eth_getLogs: 13 VUs (13% of traffic)
eth_chainId: 6 VUs (5.94% of traffic)
```

### Business Impact

Stress testing with realistic traffic patterns enables:

- **Accurate performance validation** - Tests reflect real production load patterns under stress
- **Proper bottleneck identification** - Heavy endpoints get appropriate stress testing focus
- **Realistic capacity planning** - Upper limit discovery based on actual usage patterns
- **Effective regression testing** - Performance comparisons based on realistic stress scenarios
- **Progressive load testing** - Find degradation points through incremental stress increases

## Acceptance Criteria

- [ ] Create or extend configuration system to support stress testing with realistic traffic patterns
- [ ] Implement traffic weights using actual data from traffic-weights-report.md
- [ ] Update scenario execution to use realistic VU allocation instead of equal allocation
- [ ] Ensure total VU allocation uses DEFAULT_VUS environment variable for progressive stress testing
- [ ] Validate stress tests execute correctly with proper VU distribution
- [ ] Preserve existing equal-weight tests alongside new stress tests
- [ ] Enable progressive stress testing through DEFAULT_VUS scaling
- [ ] Document implementation for future maintenance

## Suggested Solution

### Step 1: Use Traffic Weights Data

From traffic-weights-report.md, we have the actual traffic distribution for stress testing:

```javascript
// Real traffic data (90 days: April 29 - July 29, 2025)
eth_getBlockByNumber: 68.70% of traffic
eth_getLogs: 13.00% of traffic
eth_chainId: 5.94% of traffic
eth_blockNumber: 5.30% of traffic
eth_call: 3.26% of traffic
// ... (see traffic-weights-report.md for complete list)

// Simple VU calculation for stress testing:
// VUs = (endpoint_percentage / 100) × DEFAULT_VUS
```

### Step 2: Apply Traffic Weights to K6 VU Budget for Stress Testing

Use the existing `DEFAULT_VUS` configuration with actual traffic percentages for progressive stress testing:

```javascript
// Get current VU budget from environment
const totalVUs = parseInt(__ENV.DEFAULT_VUS) || 10;

// Apply traffic weights for realistic stress testing
const vuAllocation = {
  eth_getBlockByNumber: Math.round(0.687 * totalVUs), // 68.7% of available VUs
  eth_getLogs: Math.round(0.13 * totalVUs), // 13% of available VUs
  eth_chainId: Math.round(0.0594 * totalVUs), // 5.94% of available VUs
  eth_blockNumber: Math.round(0.053 * totalVUs), // 5.3% of available VUs
  eth_call: Math.round(0.0326 * totalVUs), // 3.26% of available VUs
  // ... (see traffic-weights-report.md for complete weights)
};

// Progressive stress testing examples:
// DEFAULT_VUS=20: eth_getBlockByNumber gets 14 VUs, eth_getLogs gets 3 VUs
// DEFAULT_VUS=100: eth_getBlockByNumber gets 69 VUs, eth_getLogs gets 13 VUs
// DEFAULT_VUS=200: eth_getBlockByNumber gets 137 VUs, eth_getLogs gets 26 VUs
```

### Step 3: Create New Stress Test Flow Files

Instead of modifying existing files, create new files for the stress test implementation:

**`k6/src/lib/traffic-weights.js`**

```javascript
// Traffic weights from traffic weights report (90-day data)
export const trafficWeights = {
  eth_getBlockByNumber: 0.687,
  eth_getLogs: 0.13,
  eth_chainId: 0.0594,
  eth_blockNumber: 0.053,
  eth_call: 0.0326,
  eth_getBlockByHash: 0.0197,
  eth_getTransactionReceipt: 0.0082,
  eth_getBalance: 0.0064,
  debug_traceBlockByNumber: 0.0048,
  eth_syncing: 0.0032,
  eth_gasPrice: 0.0029,
  eth_sendRawTransaction: 0.0028,
  eth_getTransactionCount: 0.0023,
  net_version: 0.0011,
  eth_getTransactionByHash: 0.0008,
  eth_estimateGas: 0.0005,
  eth_getFilterChanges: 0.0005,
  eth_getCode: 0.0003,
  debug_traceTransaction: 0.0002,
  web3_clientVersion: 0.0002,
  eth_getBlockReceipts: 0.0002,
  // ... (add remaining endpoints as needed)
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

**`k6/src/lib/stress-scenarios.js`**

```javascript
import { trafficWeights, calculateVUAllocation } from './traffic-weights.js';

// Create stress test scenario options
export function getStressScenarioOptions(endpoint, testDuration = '60s') {
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

**`k6/src/scenarios/stress/index.js`**

```javascript
import { getStressTestScenarios } from '../../lib/stress-common.js';

// Import all the same test modules as current test/index.js
import * as eth_getBlockByNumber from '../test/eth_getBlockByNumber.js';
import * as eth_getLogs from '../test/eth_getLogs.js';
import * as eth_chainId from '../test/eth_chainId.js';
import * as eth_blockNumber from '../test/eth_blockNumber.js';
import * as eth_call from '../test/eth_call.js';
import * as eth_getBalance from '../test/eth_getBalance.js';
// ... import all other test modules

// Create stress test scenarios
const tests = {
  eth_getBlockByNumber,
  eth_getLogs,
  eth_chainId,
  eth_blockNumber,
  eth_call,
  eth_getBalance,
  // ... add all other tests
};

const { funcs, options, scenarioDurationGauge } = getStressTestScenarios(tests);

export { funcs, options, scenarioDurationGauge };
```

### Step 4: Create New Stress Test Entry Point

**`k6/src/scenarios/stress-test.js`**

```javascript
// New entry point for stress testing (parallel to existing apis.js)
import exec from 'k6/execution';
import { textSummary } from 'https://jslib.k6.io/k6-summary/0.0.1/index.js';

import { markdownReport } from '../lib/common.js';
import { setupTestParameters } from '../lib/bootstrapEnvParameters.js';
import { funcs, options } from './stress/index.js';

function handleSummary(data) {
  return {
    stdout: textSummary(data, { indent: ' ', enableColors: true }),
    'stress-test-report.md': markdownReport(data),
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
2. **`k6/src/lib/stress-scenarios.js`** - Create stress test scenario options (alternative to current common.js logic)
3. **`k6/src/scenarios/stress/index.js`** - Stress test scenario collection (parallel to current test/index.js)
4. **`k6/src/scenarios/stress-test.js`** - New entry point for stress testing (parallel to current apis.js)

### Usage

Run stress tests alongside existing tests:

```bash
# Current equal-weight tests (unchanged):
npm run k6  # or k6 run src/scenarios/apis.js

# New stress tests:
k6 run src/scenarios/stress-test.js
```

## Deliverables

- [ ] Weight calculation system implemented and tested
- [ ] K6 scenarios updated to use traffic-based VU allocation for stress testing
- [ ] Stress tests execute successfully with proper VU distribution
- [ ] Documentation updated explaining weight calculation methodology
- [ ] Code reviewed and approved by team
- [ ] Integration with existing K6 test suite verified
