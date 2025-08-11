# Implementation Plan: Staged RPS Phases for K6 Rate-Based Stress Testing

## Overview

This document outlines the implementation plan for Ticket 1.2.1: Adding ramp-up, stable, and ramp-down phases to the K6 rate-based stress test suite to follow industry best practices and provide reliable performance data.

## How the Complete Flow Works

When running `npm run stress-test`, the entire test executes in **one continuous session** with three distinct phases, where each endpoint maintains its proportional RPS allocation based on real production traffic patterns:

### Phase 1: Ramp-up (2 minutes)

- **Start**: All endpoints begin at 0 RPS
- **Process**: Each endpoint's request rate gradually increases linearly to its allocated RPS based on traffic weights
- **End**: Each endpoint reaches its target RPS derived from production traffic analysis
- **Example**: `eth_getBlockByNumber` ramps from 0 → 69 RPS, `eth_getLogs` ramps from 0 → 13 RPS

### Phase 2: Stable (20-60 minutes)

- **Start**: All endpoints maintain their allocated RPS consistently
- **Process**: Sustained rate-based load testing with realistic traffic distribution patterns
- **Purpose**: Collect reliable performance metrics without cold-start artifacts or rate fluctuations
- **Example**: `eth_getBlockByNumber` maintains 69 RPS, `eth_getLogs` maintains 13 RPS

### Phase 3: Ramp-down (1-2 minutes)

- **Start**: All endpoints begin reducing RPS from their allocated rates
- **Process**: Request rates gradually decrease linearly from target RPS to 0
- **End**: All endpoints reach 0 RPS
- **Purpose**: Observe system recovery behavior and resource cleanup

**Total Test Duration**: Ramp-up + Stable + Ramp-down = ~25-65 minutes in one continuous execution.

## Current State

- **Implementation**: K6 stress test scenarios use `constant-arrival-rate` executor with rate-based traffic distribution
- **Traffic Weights**: Production data analysis determines RPS allocation per endpoint (69 RPS for `eth_getBlockByNumber`, 13 RPS for `eth_getLogs`, etc.)
- **Problem**: All scenarios start at full RPS using immediate rate allocation with `constant-arrival-rate` executor without staged phases
- **Impact**: Cold-start artifacts affect test results and no systematic warm-up/cool-down periods
- **Required Change**: Need to switch to `ramping-arrival-rate` executor to support staged RPS phases

## Solution Design

### Industry Best Practices Research Summary

Based on research from Grafana K6 documentation and performance testing standards (NIST, IEEE):

1. **Ramp-up Phase**: 1-2 minutes gradual rate increase to eliminate cold-start artifacts and allow JVM/system warm-up
2. **Stable Phase**: 20-60 minutes sustained rate for statistically significant measurements and steady-state analysis
3. **Ramp-down Phase**: Gradual rate decrease to observe recovery behavior and detect resource leaks
4. **Executor**: Use `ramping-arrival-rate` executor with `stages` array for precise rate control independent of response times
5. **Configuration**: Environment variables for flexible stage durations and different test scenarios

### Technical Approach

#### 1. Environment Variables Configuration

Add new environment variables with sensible defaults:

```javascript
__ENV['RAMP_UP_DURATION'] = __ENV['RAMP_UP_DURATION'] || '2m';
__ENV['STABLE_DURATION'] = __ENV['STABLE_DURATION'] || '20m';
__ENV['RAMP_DOWN_DURATION'] = __ENV['RAMP_DOWN_DURATION'] || '1m';
```

#### 2. Staged Rate Configuration

Switch from `constant-arrival-rate` to `ramping-arrival-rate` executor with stages:

```javascript
{
  executor: 'ramping-arrival-rate',
  startRate: 0,                                         // Start at 0 RPS
  timeUnit: '1s',                                       // Rate per second
  stages: [
    { target: allocatedRPS, duration: rampUpDuration }, // Ramp up to target RPS
    { target: allocatedRPS, duration: stableDuration }, // Maintain target RPS
    { target: 0, duration: rampDownDuration }           // Ramp down to 0 RPS
  ],
  preAllocatedVUs: Math.ceil(allocatedRPS * VU_BUFFER_MULTIPLIER),
  maxVUs: Math.ceil(3 * allocatedRPS * VU_BUFFER_MULTIPLIER)
}
```

#### 3. RPS Allocation Preservation

Maintain existing traffic-weighted RPS distribution:

- Each endpoint gets RPS proportional to real traffic weights
- Total RPS distributed via `STRESS_TEST_TARGET_TOTAL_RPS` environment variable

**How Multi-Endpoint Rate-Based Ramping Works:**

The current `calculateRateAllocation()` function calculates RPS allocation like this:

```javascript
// With STRESS_TEST_TARGET_TOTAL_RPS=100:
const allocation = {
  eth_getBlockByNumber: 69 RPS, // 68.7% of traffic
  eth_getLogs: 13 RPS,          // 13% of traffic
  eth_chainId: 6 RPS,           // 5.94% of traffic
  // ... etc for all endpoints
}
```

**Each endpoint gets its own independent staged rate configuration:**

```javascript
// eth_getBlockByNumber scenario:
{
  executor: 'ramping-arrival-rate',
  startRate: 0,
  timeUnit: '1s',
  stages: [
    { target: 69, duration: '2m' },  // Ramp up from 0 to 69 RPS over 2 minutes
    { target: 69, duration: '20m' }, // Maintain 69 RPS for 20 minutes
    { target: 0, duration: '1m' }    // Ramp down from 69 to 0 RPS over 1 minute
  ]
}

// eth_getLogs scenario (runs concurrently):
{
  executor: 'ramping-arrival-rate',
  startRate: 0,
  timeUnit: '1s',
  stages: [
    { target: 13, duration: '2m' },  // Ramp up from 0 to 13 RPS over 2 minutes
    { target: 13, duration: '20m' }, // Maintain 13 RPS for 20 minutes
    { target: 0, duration: '1m' }    // Ramp down from 13 to 0 RPS over 1 minute
  ]
}
```

**Key Point**: All endpoints execute staged phases **simultaneously** and independently. During the 2-minute ramp-up, `eth_getBlockByNumber` increases from 0→69 RPS while `eth_getLogs` increases from 0→13 RPS at the same time, maintaining realistic production traffic ratios.

## Files to Modify

### 1. `k6/src/lib/parameters.js`

**Why**: Central location for environment variable defaults
**Changes**: Add 3 new environment variables for phase configuration

### 2. `k6/src/lib/common.js`

**Why**: Contains `getStressScenarioOptions()` function that configures rate-based scenarios
**Changes**:

- Switch from `constant-arrival-rate` to `ramping-arrival-rate` executor for staged execution
- Add `stages` array configuration to define ramp-up, stable, and ramp-down phases
- Preserve existing RPS allocation logic from `calculateRateAllocation()`

**Code Implementation**:

```javascript
// Updated function in common.js
export function getStressScenarioOptions(endpoint, targetTotalRPS = 100, duration = '60s') {
  const rateAllocation = calculateRateAllocation(targetTotalRPS);
  const targetRate = rateAllocation[endpoint];
  const VU_BUFFER_MULTIPLIER = parseFloat(__ENV.VU_BUFFER_MULTIPLIER) || 3;

  // Get stage durations from environment variables
  const rampUpDuration = __ENV.RAMP_UP_DURATION || '2m';
  const stableDuration = __ENV.STABLE_DURATION || '20m';
  const rampDownDuration = __ENV.RAMP_DOWN_DURATION || '1m';

  return {
    executor: 'ramping-arrival-rate',
    startRate: 0, // Start at 0 RPS
    timeUnit: '1s', // Rate per second
    stages: [
      { target: Math.max(1, Math.round(targetRate)), duration: rampUpDuration }, // Ramp up
      { target: Math.max(1, Math.round(targetRate)), duration: stableDuration }, // Stable
      { target: 0, duration: rampDownDuration }, // Ramp down
    ],
    preAllocatedVUs: Math.max(1, Math.ceil(targetRate * VU_BUFFER_MULTIPLIER)),
    maxVUs: Math.max(1, Math.ceil(3 * targetRate * VU_BUFFER_MULTIPLIER)),
    exec: 'run',
  };
}
```

### 3. `k6/.envexample`

**Why**: Document new environment variables for users  
**Changes**: Add example values for new phase configuration variables

### 4. Documentation Updates

**Why**: Users need to understand new staged rate configuration options
**Changes**: Update README or create usage examples

## Implementation Steps

```markdown
- [ ] Add environment variables to parameters.js for staged phase configuration
- [ ] Switch getStressScenarioOptions() from constant-arrival-rate to ramping-arrival-rate executor in common.js
- [ ] Add stages array configuration to define ramp-up, stable, and ramp-down phases
- [ ] Implement proper VU buffer sizing based on target RPS and response time estimates
- [ ] Add new environment variables to .envexample for user guidance
- [ ] Test implementation with sample stress test scenario using staged rates
- [ ] Validate RPS allocation works correctly with staged execution phases
- [ ] Verify all endpoints execute staged phases simultaneously with proper traffic distribution
- [ ] Performance validation: Ensure no RPS throttling during high-load phases
```

## Performance Optimization Considerations

### VU Buffer Sizing Strategy

- **preAllocatedVUs**: Set to `targetRPS * VU_BUFFER_MULTIPLIER` to handle baseline load
- **maxVUs**: Set to `3 * targetRPS * VU_BUFFER_MULTIPLIER` for burst capacity
- **Rationale**: Prevents VU starvation during ramp-up and maintains steady RPS during stable phase

### Memory and Resource Management

- **Graceful Stop**: 5-second buffer for iteration completion during phase transitions
- **Start Rate**: Always begin at 0 RPS to ensure clean system state
- **Time Unit**: 1-second granularity for precise rate control

## Configuration Examples

### Default Configuration (20-minute test)

```bash
# Total duration = 2m + 20m + 1m = 23 minutes
RAMP_UP_DURATION=2m
STABLE_DURATION=20m
RAMP_DOWN_DURATION=1m
STRESS_TEST_TARGET_TOTAL_RPS=100  # Total RPS distributed across endpoints
```

### Long-duration Configuration (60-minute test)

```bash
# Total duration = 2m + 60m + 2m = 64 minutes
RAMP_UP_DURATION=2m
STABLE_DURATION=60m
RAMP_DOWN_DURATION=2m
STRESS_TEST_TARGET_TOTAL_RPS=200  # Higher RPS for intensive testing
```

## Key Changes from Current Implementation

### Rate-Based Execution Behavior Change

- **Before**: `constant-arrival-rate` executor starts at full RPS immediately (e.g., 69 RPS for `eth_getBlockByNumber`)
- **After**: `ramping-arrival-rate` executor with staged execution - ramp-up (0→69 RPS), stable (69 RPS), and ramp-down (69→0 RPS) phases
- **Traffic Distribution**: Maintains existing production-based RPS allocation per endpoint
- **Executor Change**: Switch from `constant-arrival-rate` to `ramping-arrival-rate` to enable stages
- **Backward Compatibility**: `STRESS_TEST_TARGET_TOTAL_RPS` still controls total RPS distribution across endpoints
