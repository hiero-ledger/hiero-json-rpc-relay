# Stress Test Implementation Design

## Overview

This document outlines the implementation of concurrent stress testing for K6 performance tests. All endpoints run simultaneously with realistic traffic distribution based on production data to find the relay's performance limits.

## Files to Create

### 1. Traffic Weight Configuration

**File:** `k6/src/lib/traffic-weights.js`

**What it stores:**

- Traffic weight percentages from production data
- VU allocation calculation logic

**Objects and Functions:**

```javascript
// Traffic distribution data
export const trafficWeights = {
  eth_getBlockByNumber: 0.687,
  eth_getLogs: 0.13,
  eth_chainId: 0.0594,
  // ... complete list from traffic-weights-report.md
};

// Calculates VU allocation based on total VUs and traffic weights
export function calculateVUAllocation(totalVUs = 10) {
  const allocation = {};
  Object.entries(trafficWeights).forEach(([endpoint, weight]) => {
    allocation[endpoint] = Math.max(1, Math.round(weight * totalVUs));
  });
  return allocation;
}
```

**Purpose:** Single source of truth for realistic traffic distribution and VU calculation logic.

### 2. Test Aggregator

**File:** `k6/src/scenarios/stress/index.js`

**What it stores:**

- Imports of all test modules
- Concurrent scenario configuration
- K6 options for stress testing

**Objects and Functions:**

```javascript
// Import all test functions
import { ethAccounts } from '../test/eth_accounts.js';
import { ethBlockNumber } from '../test/eth_blockNumber.js';
// ... all other test imports

// Build concurrent scenarios with traffic weights
import { trafficWeights, calculateVUAllocation } from '../lib/traffic-weights.js';

export const funcs = {
  ethAccounts,
  ethBlockNumber,
  // ... all test functions
};

export const options = {
  scenarios: {
    eth_accounts: {
      executor: 'constant-vus',
      startTime: '0s', // All start simultaneously
      duration: '60s',
      vus: vuAllocation.eth_accounts,
      gracefulStop: __ENV.DEFAULT_GRACEFUL_STOP,
    },
    // ... all other scenarios with startTime: '0s'
  },
};
```

**Purpose:** Configures all test scenarios to run concurrently with realistic VU allocation.

### 3. Entry Point

**File:** `k6/src/scenarios/stress-test.js`

**What it stores:**

- Main execution logic for stress tests
- Report generation configuration
- K6 lifecycle functions

**Objects and Functions:**

```javascript
import { funcs, options, scenarioDurationGauge } from './stress/index.js';

export { options };

export function handleSummary(data) {
  return {
    'stress-test-report.md': markdownReport(data),
  };
}

export function setup() {
  // Test setup logic
}

export default function () {
  // Main test execution
}
```

**Purpose:** Main entry point for executing concurrent stress tests and generating reports.

## Implementation Details

### Concurrent Execution Pattern

All scenarios use `startTime: '0s'` to run simultaneously:

```javascript
scenarios: {
  eth_getBlockByNumber: { startTime: '0s', duration: '60s', vus: 69 },  // 68.7% traffic
  eth_getLogs: { startTime: '0s', duration: '60s', vus: 13 },           // 13% traffic
  eth_chainId: { startTime: '0s', duration: '60s', vus: 6 },            // 5.94% traffic
  // All endpoints run simultaneously
}
```

### VU Allocation Logic

```javascript
function calculateVUAllocation(totalVUs = 10) {
  const allocation = {};
  Object.entries(trafficWeights).forEach(([endpoint, weight]) => {
    // Ensure minimum 1 VU, round to prevent fractional VUs
    allocation[endpoint] = Math.max(1, Math.round(weight * totalVUs));
  });
  return allocation;
}
```

### Environment Variables

- **DEFAULT_VUS**: Total VUs distributed across all concurrent scenarios
- **DEFAULT_GRACEFUL_STOP**: Clean shutdown time for all scenarios
- **DEFAULT_DURATION**: How long each scenario runs

## Usage

```bash
# Basic stress test
k6 run src/scenarios/stress-test.js

# Progressive load testing
DEFAULT_VUS=20 k6 run src/scenarios/stress-test.js   # Low load
DEFAULT_VUS=50 k6 run src/scenarios/stress-test.js   # Medium load
DEFAULT_VUS=100 k6 run src/scenarios/stress-test.js  # High load
DEFAULT_VUS=200 k6 run src/scenarios/stress-test.js  # Maximum load
```

## Output

- Report file: `stress-test-report.md`
- Contains metrics for all concurrent scenarios
- Shows performance under realistic traffic patterns
