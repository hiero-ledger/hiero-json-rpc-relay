# Implement Ramp-up and Stable Phases for Rate-Based Stress Testing

## Description

### Current Situation

The K6 stress test suite now uses rate-based testing with the `constant-arrival-rate` executor to distribute requests per second (RPS) across endpoints based on real traffic weights from production data. This rate-based approach ensures each endpoint receives traffic proportional to its real-world usage patterns, providing accurate and production-representative stress testing results.

However, all scenarios currently start at full RPS immediately using the `constant-arrival-rate` executor, with no gradual ramp-up or stable phase separation. This does not reflect best practices for professional performance testing, where a warm-up (ramp-up) period gradually increases the request rate to avoid cold-start artifacts, followed by a stable phase for consistent measurement.

To enable industry-standard stress testing practices:

- Switch to the `ramping-arrival-rate` executor to support staged RPS phases instead of immediate full-rate execution.
- Add a configurable ramp-up period (e.g., 1-2 minutes) to gradually increase RPS from 0 to target rate.
- Follow with a stable throughput phase (e.g., 20 or 60 minutes) maintaining consistent RPS for measurement.
- Include a ramp-down phase to observe system recovery behavior.
- Ensure all rate-based scenarios use these staged phases, with durations configurable via environment variables.

### Impact

Implementing staged RPS phases will:

- Eliminate cold-start artifacts from test results by gradually warming up the system.
- Provide more reliable, production-like performance data through consistent rate maintenance.
- Enable systematic regression and baseline comparisons across releases.
- Follow industry best practices for professional performance testing.

## Acceptance Criteria

- [ ] Switch from `constant-arrival-rate` executor to `ramping-arrival-rate` executor to enable staged RPS execution phases.
- [ ] Add a 1-2 minute ramp-up stage where each endpoint's RPS gradually increases from 0 to its allocated target rate.
- [ ] Add a stable throughput stage with configurable duration (default: 20-60min) where each endpoint maintains its target RPS consistently.
- [ ] Add a 1-2 minute ramp-down stage where RPS gradually decreases from target rate to 0 for recovery observation.
- [ ] Ensure all scenarios maintain the traffic-weighted RPS allocation from the production data analysis.
- [ ] Make stage durations configurable via environment variables (e.g., `RAMP_UP_DURATION`, `STABLE_DURATION`, `RAMP_DOWN_DURATION`).
- [ ] Update the executor configuration to use `ramping-arrival-rate` with proper `stages` array instead of single-rate execution.
- [ ] Validate that the new staged RPS execution works correctly with realistic traffic distribution.
- [ ] Document the new staged configuration and usage patterns in the codebase.

## Suggested Solution

### Rate-Based Staged Execution Approach

The solution involves extending the current `constant-arrival-rate` executor implementation to support K6's staged rate phases. Instead of starting at full RPS immediately, each endpoint will follow a three-phase pattern:

1. **Ramp-up Phase**: Gradually increase RPS from 0 to target rate over configurable duration
2. **Stable Phase**: Maintain consistent target RPS for reliable measurement
3. **Ramp-down Phase**: Gradually decrease RPS to 0 for recovery observation

### Technical Implementation

Update the stress test scenario configuration to use K6's `ramping-arrival-rate` executor for staged execution:

- Switch from `constant-arrival-rate` to `ramping-arrival-rate` executor to enable staged RPS phases
- Use the `stages` array to define ramp-up, stable, and ramp-down phases
- Use environment variables for configurable stage durations
- Maintain existing traffic-weighted RPS allocation per endpoint
- Ensure all endpoints execute staged phases simultaneously for realistic system stress

### Environment Variables

```bash
RAMP_UP_DURATION=2m      # Gradual RPS increase phase (eliminate cold-start artifacts)
STABLE_DURATION=20m      # Consistent RPS maintenance phase (reliable measurements)
RAMP_DOWN_DURATION=1m    # Gradual RPS decrease phase (observe system recovery)
STRESS_TEST_TARGET_TOTAL_RPS=100  # Total RPS distributed across endpoints based on traffic weights
```

### Performance Engineering Benefits

- **Cold-Start Elimination**: Ramp-up phase allows JVM warm-up, connection pooling, and system optimization
- **Reliable Baselines**: Stable phase provides consistent measurement windows for accurate performance comparisons
- **Recovery Analysis**: Ramp-down phase reveals resource cleanup patterns and potential memory leaks
- **Production Fidelity**: Maintains real traffic distribution throughout all phases

### Expected Behavior

Each endpoint will independently execute its staged RPS phases:

- `eth_getBlockByNumber` (68.7% traffic): 0 → 69 RPS → 69 RPS → 0
- `eth_getLogs` (13% traffic): 0 → 13 RPS → 13 RPS → 0
- `eth_chainId` (5.94% traffic): 0 → 6 RPS → 6 RPS → 0

All endpoints execute phases simultaneously, creating realistic production-like traffic patterns throughout the entire test duration.
