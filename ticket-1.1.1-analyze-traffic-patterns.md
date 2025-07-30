# Analyze HashIO Traffic Patterns

## Description

### Current Situation

The existing K6 performance test suite treats all RPC endpoints equally, allocating a constant VU for 1-5 seconds to each endpoint regardless of actual usage patterns. This creates unrealistic test scenarios that don't reflect real-world traffic distribution on HashIO.

### Rationale

To enhance the K6 performance test suite, we need to analyze the last three months of traffic to assign weights to each RPC call, reflecting their distribution in the test scenarios. This analysis is the foundation for creating realistic performance tests that:

1. **Reflect actual user behavior** - Popular endpoints should receive more testing resources
2. **Identify resource-intensive endpoints** - Slow endpoints need additional weight multipliers
3. **Enable accurate capacity planning** - Understanding real traffic patterns helps determine system limits
4. **Support regression testing** - Baseline performance data must be based on realistic workloads

### Business Impact

Without traffic-weighted testing, our performance tests may miss critical bottlenecks in heavily-used endpoints while over-testing rarely-used ones. This could lead to production performance issues going undetected during release validation.

## Suggested Solution

### Step 1: Grafana Data Collection

Collect data using available metrics:

- **Use RPS data** (available for 90-day range) to calculate traffic distribution
- **Use Response Latency data** (available for 90-day range) to identify resource-intensive endpoints

### Step 2: Data Analysis Process

```javascript
// PRIMARY APPROACH: RPS-based weighting (simple and effective)
// 1. Extract average RPS per endpoint over 90 days
eth_call: 15 RPS average
eth_getBalance: 12 RPS average
eth_chainId: 3 RPS average
// Total: 30 RPS

// 2. Calculate percentage distribution based on RPS
eth_call: 15/30 = 50% of traffic
eth_getBalance: 12/30 = 40% of traffic
eth_chainId: 3/30 = 10% of traffic

// 3. Assign VUs directly from traffic percentages
eth_call: 50% × totalVUs = x VUs
eth_getBalance: 40% × totalVUs = y VUs
eth_chainId: 10% × totalVUs = z VUs

// In k6/src/lib/common.js or wherever scenario options are defined:
const trafficWeights = {
  eth_call: { vus: x, duration: '60s' },
  eth_getBalance: { vus: y, duration: '60s' },
  eth_chainId: { vus: z, duration: '60s' }
}
```

```javascript
// FUTURE ENHANCEMENT: Latency-based multipliers (for advanced resource weighting)
// This approach can be implemented later if we need to account for resource-intensive endpoints

// 1. Extract both RPS and latency data
eth_call: 15 RPS, 800ms latency
eth_getBalance: 12 RPS, 50ms latency
eth_chainId: 3 RPS, 25ms latency

// 2. Apply latency-based multipliers to RPS percentages
eth_call: 800ms > 500ms threshold = 2x multiplier
eth_getBalance: 50ms < 500ms threshold = 1x multiplier
eth_chainId: 25ms < 500ms threshold = 1x multiplier

// 3. Calculate weighted points
eth_call: 50% × 2 (latency multiplier) = 100 points
eth_getBalance: 40% × 1 (no multiplier) = 40 points
eth_chainId: 10% × 1 (no multiplier) = 10 points
// Total weighted points = 150

// 4. Normalize to final percentages
eth_call: 100/150 = 67% final weight
eth_getBalance: 40/150 = 27% final weight
eth_chainId: 10/150 = 6% final weight

// This approach gives more weight to resource-intensive endpoints
// Implement this later if RPS-only approach shows gaps in bottleneck detection
```

### Step 3: Report Structure

Create a markdown report with:

1. **Executive Summary** - Key findings and recommendations
2. **Methodology** - Data collection approach and timeframe
3. **Traffic Distribution Table** - All endpoints with RPS, percentages, latencies
4. **Resource-Intensive Endpoint Analysis** - Endpoints requiring multipliers
5. **Recommended Weights** - Final weight calculations for K6 implementation

## Acceptance Criteria

- [ ] Successfully extract 90-day traffic data from Grafana for all RPC endpoints
- [ ] Calculate average RPS (Requests Per Second) for each endpoint over the 90-day period
- [ ] Calculate percentage distribution of traffic across all endpoints based on RPS
- [ ] Document findings in a comprehensive traffic analysis report
- [ ] Provide clear data table showing: Endpoint Name, Average RPS, Traffic Percentage, Recommended VU Weight
- [ ] _(Future enhancement)_ Extract average response latency for each endpoint for potential latency-based multipliers
- [ ] _(Future enhancement)_ Identify endpoints with >500ms average latency for resource-intensive multipliers

## Deliverables

- [ ] Traffic analysis report completed and reviewed with RPS-based weights
- [ ] Clear VU allocation recommendations ready for implementation
- [ ] Report stored in project documentation for future reference
- [ ] _(Future reference)_ Latency data collected and documented for potential advanced weighting
