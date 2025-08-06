# Implement Ramp-up and Stable Phases for Stress Test

## Description

### Current Situation

The new K6 stress test suite (see https://github.com/hiero-ledger/hiero-json-rpc-relay/pull/4169) now distributes VUs across endpoints based on real traffic weights. However, all scenarios currently start at full load, with no ramp-up or stable phase separation. This does not reflect best practices for professional performance testing, where a warm-up (ramp-up) period is used to avoid cold-start artifacts and a stable phase is used for consistent measurement.

In order to allow stress test to run more realistically,

- Add a configurable ramp-up period (e.g., 1-2 minutes) to gradually increase load.
- Follow with a stable throughput phase (e.g., 20 or 60 minutes) for consistent measurement.
- Ensure all stress test scenarios use these phases, with durations configurable via environment variables.

### Impact

Implementing ramp-up and stable phases will:

- Eliminate cold-start artifacts from test results.
- Provide more reliable, production-like performance data.
- Enable consistent regression and baseline comparisons across releases.

## Acceptance Criteria

- [ ] Extend the K6 stress test configuration to support staged execution phases (ramp-up and stable).
- [ ] Add a 1-2 minute ramp-up period to the stress test scenario options.
- [ ] Add a stable throughput phase with configurable duration (default: 20min or 60min).
- [ ] Ensure all scenarios use the traffic-weighted VU allocation from ticket 1.1.2.
- [ ] Make phase durations configurable via environment variables.
- [ ] Validate that the new phased execution works as expected in the stress test entry point.
- [ ] Document the new configuration and usage in the codebase.

## Suggested Solution

- Update the stress test scenario options (e.g., in `k6/src/lib/stress-scenarios.js` or similar) to use K6's `stages` or `ramping-vus` executor for each endpoint.
- Use environment variables (e.g., `RAMP_UP_DURATION`, `STABLE_DURATION`) to control phase lengths.
- Ensure the total VU allocation per endpoint matches the traffic weights.
- Update documentation and example usage.
