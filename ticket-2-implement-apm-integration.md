# Implement APM Integration for Node.js Performance Monitoring

## Overview

The Hedera JSON-RPC Relay has robust K6 stress testing but lacks visibility into internal Node.js performance during tests. This ticket implements comprehensive Application Performance Monitoring (APM) using Clinic.js to provide deep insights into CPU usage, memory patterns, and async operations.

**Problem**: We can see external behavior (response times, errors) but not internal bottlenecks.
**Solution**: Integrate Clinic.js for professional Node.js performance analysis.

## Why Clinic.js?

[Clinic.js](https://clinicjs.org/) is the industry-standard toolkit for Node.js performance engineering:

- **Specialized Tools**: CPU profiling, memory analysis, async operations monitoring
- **Visual Dashboards**: Interactive flame graphs and performance visualizations
- **Production-Ready**: Battle-tested by enterprise Node.js applications
- **Complete Coverage**: All critical Node.js performance metrics in one toolkit

## Implementation Approach

### Clinic.js Toolkit Components

| Tool                | Focus            | Output                                                 |
| ------------------- | ---------------- | ------------------------------------------------------ |
| `clinic flame`      | CPU Performance  | Interactive flame graphs showing function-level timing |
| `clinic doctor`     | System Health    | Memory, GC, I/O statistics with recommendations        |
| `clinic bubbleprof` | Async Operations | Event loop and async bottleneck analysis               |

### Performance Monitoring Workflow

```bash
# Install locally in k6 project
cd k6 && npm install --save-dev clinic

# Start monitored relay (example: CPU monitoring)
cd k6 && npm run start-monitored-relay:cpu

# Run stress test (separate terminal)
cd k6 && npm run stress-test

# Stop server (Ctrl+C) → Generates interactive HTML reports
```

## Performance Metrics Coverage

✅ **Complete Coverage**:

| Metric Category       | Clinic.js Tool    | What You Get                                     |
| --------------------- | ----------------- | ------------------------------------------------ |
| **CPU Performance**   | clinic flame      | Function-level usage, hotspots, call stacks      |
| **Memory & GC**       | clinic doctor     | Allocation patterns, GC frequency, heap analysis |
| **I/O Operations**    | clinic doctor     | File system, network, database statistics        |
| **Async Performance** | clinic bubbleprof | Event loop lag, async bottlenecks                |
| **External Behavior** | K6 integration    | Response times, error rates, throughput          |

## Suggested Solution

### Clinic.js: Professional Node.js Performance Analysis

[Clinic.js](https://clinicjs.org/) is the industry-standard toolkit for Node.js performance engineering, providing comprehensive performance analysis through specialized tools designed specifically for Node.js applications.

### Why Clinic.js?

Clinic.js offers unparalleled insights into Node.js application performance through its suite of professional-grade analysis tools:

- **Specialized Analysis**: Each tool focuses on specific performance aspects (CPU, memory, async operations)
- **Visual Dashboards**: Rich, interactive HTML reports with professional-grade visualizations
- **Production-Ready**: Battle-tested by enterprise Node.js applications worldwide
- **Comprehensive Coverage**: Complete monitoring of all critical Node.js performance metrics
- **Expert Insights**: Built by Node.js performance experts with deep understanding of V8 engine internals

### Clinic.js Toolkit Components

| Tool                | Primary Focus             | Key Benefits                                    |
| ------------------- | ------------------------- | ----------------------------------------------- |
| `clinic flame`      | CPU Performance Analysis  | Interactive flame graphs, function-level timing |
| `clinic doctor`     | System Health Monitoring  | Memory patterns, GC analysis, I/O statistics    |
| `clinic bubbleprof` | Async Operations Analysis | Event loop performance, async bottlenecks       |

## Acceptance Criteria

### 🛠️ Setup & Installation

- [ ] Install Clinic.js locally in k6 project: `cd k6 && npm install --save-dev clinic`
- [ ] Create npm scripts for monitored relay servers with clear naming
- [ ] Configure organized report output directories

### 📊 Performance Analysis Integration

- [ ] Implement all 3 monitoring types:
  - `start-monitored-relay:cpu` - CPU flame graph analysis
  - `start-monitored-relay:health` - Memory, GC, I/O monitoring
  - `start-monitored-relay:async` - Event loop and async analysis
- [ ] Integrate with existing K6 stress testing workflow
- [ ] Verify 12/12 required performance metrics are captured

### 📈 Validation & Documentation

- [ ] Test end-to-end workflow: monitored relay → K6 stress test → analysis reports
- [ ] Generate interactive HTML reports for each analysis type
- [ ] Create user guides for interpreting performance data
- [ ] Establish baseline performance data collection

### 🎯 Expected Outcomes

1. **Working APM Integration**: Complete Clinic.js toolkit operational with three specialized monitoring scripts
2. **Comprehensive Performance Visibility**: Both external (K6) and internal (Clinic.js) metrics
3. **Professional Analysis Workflow**: Systematic approach to Node.js performance engineering
4. **Foundation for Optimization**: Data-driven insights for performance improvements

### Performance Metrics Coverage

Clinic.js provides comprehensive coverage of all required performance engineering metrics:

**Complete Coverage Mapping:**

| Required Metric                  | Clinic.js Tool    | Analysis Method                        | Coverage |
| -------------------------------- | ----------------- | -------------------------------------- | -------- |
| Transactions Per Second (TPS)    | K6 Integration    | K6 stress test output                  | ✅ Full  |
| TPS per RPC endpoint             | K6 Integration    | K6 scenario-based reporting            | ✅ Full  |
| Latency (avg, P95, P99)          | K6 Integration    | K6 response time metrics               | ✅ Full  |
| CPU usage (% and wait time)      | clinic flame      | Interactive flame graphs               | ✅ Full  |
| Memory usage patterns            | clinic doctor     | Heap analysis and allocation tracking  | ✅ Full  |
| Garbage collector time           | clinic doctor     | GC event timing and frequency          | ✅ Full  |
| I/O operations                   | clinic doctor     | File system and network I/O statistics | ✅ Full  |
| Thread count and utilization     | clinic doctor     | Process and thread monitoring          | ✅ Full  |
| Error rate for failed requests   | K6 Integration    | HTTP error rate tracking               | ✅ Full  |
| Event loop (delay and execution) | clinic bubbleprof | Event loop lag and async analysis      | ✅ Full  |
| Active handles and resources     | clinic doctor     | Handle and resource tracking           | ✅ Full  |
| Standard K6 metrics              | K6 Integration    | Median response times, data transfer   | ✅ Full  |

**Coverage Summary: 12/12 metrics fully covered (100% complete)**
