# feat(k6): Implement staged RPS (ramp-up, stable, ramp-down) for stress tests using ramping-arrival-rate executor

This PR extends the existing K6 stress testing framework to support phase-based execution—adding ramp-up, stable, and ramp-down periods using the `ramping-arrival-rate` executor.

Unlike the previous solution with `constant-arrival-rate` which starts all tests at full speed right away, this change lets tests start slowly during ramp up phase, hold steady during stable phase, and then slow down at the end during ramp down phase.
These phases help avoid cold-start issues, make results more consistent, and let us see how the system recovers after heavy use.

Key updates include:

- Replaces the old `constant-arrival-rate` executor with `ramping-arrival-rate` to support ramp-up, stable, and ramp-down phases for all stress test scenarios.
- Adds new environment variables (`RAMP_UP_DURATION`, `STABLE_DURATION`, `RAMP_DOWN_DURATION`, `VU_BUFFER_MULTIPLIER`) for full configurability of test phases and VU allocation.
- Maintains production-traffic-weighted RPS allocation for each endpoint.
- Updates the markdown report to display only essential metrics for stress tests: Target RPS, Requests, Pass %, Avg. Req Duration, and P(95).
