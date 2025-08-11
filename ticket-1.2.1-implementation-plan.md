# Implementation Plan: Ramp-up and Stable Phases for K6 Stress Testing

## Overview

This document outlines the implementation plan for Ticket 1.2.1: Adding ramp-up and stable phases to the K6 stress test suite to follow industry best practices and provide reliable performance data.

## How the Complete Flow Works

When run `npm run stress-test`, the entire test should execute in **one continuous session** with three distinct phases:

### Phase 1: Ramp-up (2 minutes)

- **Start**: All endpoints begin at 0 VUs
- **Process**: VUs gradually increase linearly for each endpoint
- **End**: Each endpoint reaches its allocated VU count based on traffic weights
- **Example**: `eth_getBlockByNumber` ramps from 0 → 69 VUs, `eth_getLogs` ramps from 0 → 13 VUs

### Phase 2: Stable (20-60 minutes)

- **Start**: All endpoints maintain their allocated VU counts
- **Process**: Consistent load testing with realistic traffic distribution
- **Purpose**: Collect reliable performance metrics without cold-start artifacts
- **Example**: `eth_getBlockByNumber` stays at 69 VUs, `eth_getLogs` stays at 13 VUs

### Phase 3: Ramp-down (1-2 minutes)

- **Start**: All endpoints begin ramping down from their allocated VUss
- **Process**: VUs gradually decrease linearly for each endpoint
- **End**: All endpoints reach 0 VUs
- **Purpose**: Observe system recovery behavior

**Total Test Duration**: Ramp-up + Stable + Ramp-down = ~25-65 minutes in one continuous execution.

## Current State

- **Problem**: All K6 stress test scenarios currently start at full load using `constant-vus` executor
- **Impact**: Cold-start artifacts affect test results and no reliable baseline measurements
- **Current Implementation**: `getStressTestScenarios()` in `k6/src/lib/common.js` uses `startTime: '0s'` for all scenarios

## Solution Design

### Industry Best Practices Research Summary

Based on research from Grafana K6 documentation and performance testing best practices:

1. **Ramp-up Phase**: 1-2 minutes gradual load increase to eliminate cold-start artifacts
2. **Stable Phase**: 20-60 minutes sustained load for consistent measurements
3. **Ramp-down Phase**: Gradual decrease to observe recovery behavior
4. **Executor**: Use `ramping-vus` instead of `constant-vus` for staged execution
5. **Configuration**: Environment variables for flexible phase durations

### Technical Approach

#### 1. Environment Variables Configuration

Add new environment variables with sensible defaults:

```javascript
__ENV['RAMP_UP_DURATION'] = __ENV['RAMP_UP_DURATION'] || '2m';
__ENV['STABLE_DURATION'] = __ENV['STABLE_DURATION'] || '20m';
__ENV['RAMP_DOWN_DURATION'] = __ENV['RAMP_DOWN_DURATION'] || '1m';
```

#### 2. Staged Scenario Configuration

Create new function that uses `ramping-vus` executor:

```javascript
{
  executor: 'ramping-vus',
  startVUs: 0,
  stages: [
    { duration: rampUpDuration, target: allocatedVUs },   // Ramp-up
    { duration: stableDuration, target: allocatedVUs },   // Stable
    { duration: rampDownDuration, target: 0 }             // Ramp-down
  ],
  gracefulRampDown: '5s'
}
```

#### 3. VU Allocation Preservation

Maintain existing traffic-weighted VU distribution from ticket 1.1.2:

- Each endpoint gets VUs proportional to real traffic weights
- Total VUs distributed across all endpoints as before

**How Multi-Endpoint Ramping Works:**

The current `traffic-weights.js` calculates VU allocation like this:

```javascript
// With DEFAULT_VUS=100:
const allocation = {
  eth_getBlockByNumber: 69 VUs, // 68.7% of traffic
  eth_getLogs: 13 VUs,          // 13% of traffic
  eth_chainId: 6 VUs,           // 5.94% of traffic
  // ... etc for all endpoints
}
```

**Each endpoint gets its own independent ramping-vus configuration:**

```javascript
// eth_getBlockByNumber scenario:
{
  executor: 'ramping-vus',
  startVUs: 0,
  stages: [
    { duration: '2m', target: 69 },  // Ramp from 0 to 69 VUs
    { duration: '20m', target: 69 }, // Stay at 69 VUs
    { duration: '1m', target: 0 }    // Ramp down to 0 VUs
  ]
}

// eth_getLogs scenario (runs concurrently):
{
  executor: 'ramping-vus',
  startVUs: 0,
  stages: [
    { duration: '2m', target: 13 },  // Ramp from 0 to 13 VUs
    { duration: '20m', target: 13 }, // Stay at 13 VUs
    { duration: '1m', target: 0 }    // Ramp down to 0 VUs
  ]
}
```

**Key Point**: All endpoints ramp up **simultaneously** and independently. During the 2-minute ramp-up, `eth_getBlockByNumber` increases from 0→69 VUs while `eth_getLogs` increases from 0→13 VUs at the same time.

## Files to Modify

### 1. `k6/src/lib/parameters.js`

**Why**: Central location for environment variable defaults
**Changes**: Add 3 new environment variables for phase configuration

### 2. `k6/src/lib/common.js`

**Why**: Contains `getStressTestScenarios()` function that configures scenarios
**Changes**:

- Update existing `getStressScenarioOptions()` function to use `ramping-vus` executor with stages
- Rename to `getStagedStressScenarioOptions()` for clarity
- Remove the conditional logic - always use staged execution for stress tests

**Code Implementation**:

```javascript
// Updated function in common.js
export function getStagedStressScenarioOptions(endpoint, totalVUs = 10) {
  const vuAllocation = calculateVUAllocation(totalVUs);
  const rampUpDuration = __ENV.RAMP_UP_DURATION || '2m';
  const stableDuration = __ENV.STABLE_DURATION || '20m';
  const rampDownDuration = __ENV.RAMP_DOWN_DURATION || '1m';

  const allocatedVUs = vuAllocation[endpoint] || 1;

  return {
    executor: 'ramping-vus',
    startVUs: 0,
    stages: [
      { duration: rampUpDuration, target: allocatedVUs }, // Ramp-up phase
      { duration: stableDuration, target: allocatedVUs }, // Stable phase
      { duration: rampDownDuration, target: 0 }, // Ramp-down phase
    ],
    gracefulRampDown: __ENV.DEFAULT_GRACEFUL_STOP || '5s',
  };
}
```

### 3. `k6/.envexample`

**Why**: Document new environment variables for users
**Changes**: Add example values for new phase configuration variables

### 4. Documentation Updates

**Why**: Users need to understand new configuration options
**Changes**: Update README or create usage examples

## Implementation Steps

```markdown
- [ ] Add environment variables to parameters.js
- [ ] Update getStressScenarioOptions() to getStagedStressScenarioOptions() in common.js
- [ ] Update getStressTestScenarios() to use staged execution
- [ ] Add new environment variables to .envexample
- [ ] Test implementation with sample stress test scenario
- [ ] Validate VU allocation works correctly with staged execution
```

## Configuration Examples

### Default Configuration (20-minute test)

```bash
# For stress tests, DEFAULT_DURATION is ignored
# Total duration = 2m + 20m + 1m = 23 minutes
RAMP_UP_DURATION=2m
STABLE_DURATION=20m
RAMP_DOWN_DURATION=1m
```

### Long-duration Configuration (60-minute test)

```bash
# Total duration = 2m + 60m + 2m = 64 minutes
RAMP_UP_DURATION=2m
STABLE_DURATION=60m
RAMP_DOWN_DURATION=2m
```

## Key Changes from Current Implementation

### Duration Behavior Change

- **Before**: `DEFAULT_DURATION` controlled stress test length (e.g., 120s)
- **After**: Total stress test duration = `RAMP_UP_DURATION + STABLE_DURATION + RAMP_DOWN_DURATION`
- **Backward Compatibility**: `DEFAULT_DURATION` still works for non-stress tests
