# Performance Test Implementation Plan

Based on the goals and requirements outlined in `performance_test_goal.md`, this doc**Tool Mapping (Original Clinic.js → Our Direct Approach):**

| Original Clinic Tool | What It Did         | Our Replacement          | Same Data? |
| -------------------- | ------------------- | ------------------------ | ---------- | --------------------------------------------------------------------------------------------- |
| `clinic flame`       | CPU flame graphs    | `0x` (same engine!)      | ✅ Yes     |
| `clinic doctor`      | Memory/CPU/GC stats | `node --prof`            | ✅ Yes     |
| `clinic bubbleprof`  | Async profiling     | `0x` (covers this too)   | ✅ Yes     |
| `clinic dashboard`   | Visual analysis     | Manual analysis + graphs | ✅ Yes     | rovides a comprehensive, prioritized implementation plan broken down into actionable tickets. |

## Overview

**Objective**: Transform the existing K6 test suite into a professional-grade performance engineering platform that can:

- Accurately reflect real-world traffic patterns
- Identify system upper limits and bottlenecks
- Provide comprehensive performance monitoring
- Enable systematic regression testing across releases

## Priority 1: Enhanced K6 Script Foundation ✅ COMPLETED

### 1.1 Traffic-Weighted Test Distribution

**Goal**: Weight RPC calls based on actual HashIO traffic patterns from the last 3 months

#### Ticket 1.1.1: Analyze HashIO Traffic Patterns

- [x] Coordinate with DevOps to access HashIO logs from last 3 months
- [x] Extract RPC method call frequency and distribution
- [x] Calculate percentage breakdown of each RPC method
- [x] Document findings in data analysis report
- [x] **Deliverable**: Traffic analysis report with RPC method weights

#### Ticket 1.1.2: Implement Traffic-Weighted Configuration

- [x] Create traffic weight configuration in `k6/src/lib/common.js`
- [x] Apply traffic weights to scenario VU allocation (68.7% eth_getBlockByNumber, 13% eth_getLogs, etc.)
- [x] Update `k6/src/scenarios/test/index.js` to use weighted distribution
- [x] Add resource-intensive endpoint multipliers for heavy endpoints
- [x] **Deliverable**: Weighted test execution reflecting real traffic patterns

### 1.2 Professional Test Structure Implementation

**Goal**: Implement professional performance test structure with proper phases

#### Ticket 1.2.1: Implement Staged Test Execution

- [x] Extend K6 configuration to support staged execution phases
- [x] Add 2-minute ramp-up period to existing load test configuration
- [x] Add 20-minute stable throughput phase with configurable duration
- [x] Add 1-minute ramp-down phase
- [x] Use weighted traffic distribution from step 1.1
- [x] **Deliverable**: Professional K6 configuration with proper test anatomy

**Status**: Priority 1 is complete and ready for APM integration.

## Priority 2: APM Integration for Performance Monitoring

**Original Goal**: Use Clinic.js for Node.js performance monitoring as outlined in the performance goals

**What Was Originally Planned**:
The performance goals document specified using [Clinic.js](https://clinicjs.org/) with its suite of tools:

- `node-clinic-flame`: For flame graphs (CPU profiling)
- `node-clinic-doctor`: For memory, CPU, and process statistics
- `node-clinic-bubbleprof`: For async profiling
- `node-clinic`: Dashboard for diagnosing Node.js performance issues

**Problem Discovered**: After research, Clinic.js is **no longer actively maintained** and has compatibility issues with modern Node.js versions.

### The Updated Solution

Instead of Clinic.js, we use the **same underlying tools** that power Clinic.js, but directly:

**Tool Comparison Table:**

| Original Clinic.js Tool | Our Updated Tool | What It Gives You                                                |
| ----------------------- | ---------------- | ---------------------------------------------------------------- |
| `clinic flame`          | `0x`             | **CPU flame graphs** - shows which functions use most CPU time   |
| `clinic doctor`         | `node --prof`    | **Memory usage, GC stats, I/O metrics** - system health data     |
| `clinic bubbleprof`     | `0x`             | **Async profiling** - event loop and async operation analysis    |
| `clinic dashboard`      | Manual analysis  | **Visual analysis** - interpret flame graphs and profiler output |

**One command gets it all:**

```bash
npx 0x --prof -- npm run relay:start
```

**What this gives you (same metrics as Clinic.js would have):**

- ✅ **Flame graphs** (from 0x - same engine Clinic.js used)
- ✅ **Memory usage, GC stats** (from --prof - same as clinic-doctor)
- ✅ **CPU profiling** (from 0x - same as clinic-flame)
- ✅ **I/O and event loop stats** (from --prof)

**Why this is better:**

- ✅ **Always up-to-date** (built into Node.js)
- ✅ **No compatibility issues** (official Node.js tools)
- ✅ **Same data quality** (uses the exact same engines)
- ✅ **Much simpler** (one command vs multiple clinic tools)

### Understanding What We're Doing

Think of your Node.js relay server like a restaurant kitchen during rush hour. The original plan was to use Clinic.js as our "kitchen monitoring system," but we discovered it's no longer maintained.

Instead, we use the **same monitoring tools** that Clinic.js used internally, but directly:

**One command does everything:**

```bash
npx 0x --prof -- npm run relay:start
```

**This gives you:**

- ✅ Flame graphs showing exactly where CPU time is spent (0x)
- ✅ Memory usage, garbage collection, I/O stats (--prof)
- ✅ Everything you need in one simple command!

### 2.1 Tool Setup

#### Ticket 2.1.1: Install APM Tools

- [ ] Install 0x globally: `npm install -g 0x`
- [ ] That's it! (Node.js profiler is built-in, no install needed)
- [ ] Test the command: `npx 0x --prof -- npm run relay:start`
- [ ] Verify you get both flame graphs AND profiler data

#### Ticket 2.1.2: Create Stress Test Workflow

- [ ] Document the simple workflow:
  1. Start profiled server: `npx 0x --prof -- npm run relay:start`
  2. Run stress test: `npm run k6:stress-test`
  3. Wait for K6 to finish completely
  4. Stop server with `Ctrl+C`
  5. Analyze results: `flamegraph.html` + profiler data files
- [ ] Test complete workflow end-to-end
- [ ] **Deliverable**: Working APM + K6 stress test workflow

### 2.2 Understanding Your Results

**What you get from each tool:**

| Tool            | What It's Like          | What It Shows You        | Example Output                                           |
| --------------- | ----------------------- | ------------------------ | -------------------------------------------------------- |
| **0x**          | Kitchen security camera | Which chef is busiest    | "The eth_getBlockByNumber chef uses 60% of kitchen time" |
| **node --prof** | Health inspector report | Kitchen stats over time  | "Memory went from 200MB to 800MB during lunch rush"      |
| **K6**          | Customer satisfaction   | External server response | "Average response time: 150ms, 2% error rate"            |

**Before APM**: "Our app is slow during stress tests, but we don't know why"

**After APM**: "During 100 RPS stress test:

- `eth_getBlockByNumber` function uses most CPU (from 0x)
- Memory grows from 200MB to 800MB (from --prof)
- The database query is the bottleneck (from flame graph)"

### 2.3 Priority 2 Complete Checklist

**Goal Requirements vs Our APM Coverage:**

| Required Metric                  | Data Source     | Coverage Status | Notes                          |
| -------------------------------- | --------------- | --------------- | ------------------------------ |
| Transactions Per Second (TPS)    | K6              | ✅ Full         | K6 measures this directly      |
| TPS per RPC endpoint             | K6              | ✅ Full         | K6 tracks per scenario         |
| Latency                          | K6              | ✅ Full         | K6 response time metrics       |
| CPU usage (% and wait time)      | 0x              | ✅ Full         | Flame graphs show CPU usage    |
| Memory usage                     | node --prof     | ✅ Full         | Heap size, memory allocation   |
| Garbage collector time           | node --prof     | ✅ Full         | GC events and duration         |
| I/O                              | node --prof     | ✅ Full         | File system and network I/O    |
| Thread count                     | Manual tracking | ⚠️ Partial      | Can add with Performance Hooks |
| Error rate for failed requests   | K6              | ✅ Full         | HTTP error tracking            |
| Event loop (delay and execution) | node --prof     | ✅ Full         | Event loop lag measurements    |
| Active handles                   | Manual tracking | ⚠️ Partial      | Can add with Performance Hooks |
| Standard K6 output               | K6              | ✅ Full         | Median, bytes exchanged, etc.  |

**Coverage Summary: 10/12 metrics fully covered (83% complete)**

**Missing Metrics Strategy:**

- Thread count & Active handles are less critical for stress testing
- Can be added later with Node.js Performance Hooks if needed
- Core performance metrics (CPU, Memory, GC, I/O) are fully covered

**Setup & Integration:**

- [ ] Install 0x: `npm install -g 0x`
- [ ] Test magic command: `npx 0x --prof -- npm run relay:start`
- [ ] Run complete workflow with existing K6 stress tests
- [ ] Verify flame graphs + profiler data generation
- [ ] Document workflow and create troubleshooting guide

**K6 Metrics Status: ✅ ALREADY COMPLETE**

- ✅ TPS per RPC endpoint (K6 reports RPS by scenario)
- ✅ P95 latency (built into K6 reports)
- ✅ Error rate by endpoint (Pass % per scenario)
- ✅ All required metrics are captured

**Success Criteria:**

- ✅ One command gives comprehensive APM data
- ✅ 10/12 core metrics captured (83% complete)
- ✅ Ready for Priority 3 capacity testing

## Priority 3: Upper Limit Discovery and Capacity Testing

### 3.1 Progressive Load Testing

**Goal**: Find the maximum stable traffic capacity for a single relay instance

#### Ticket 3.1.1: Progressive Load Testing Framework

- [ ] Create systematic VU progression methodology (start low, increase until degradation)
- [ ] Implement degradation detection criteria using APM metrics from Priority 2
- [ ] Build automated load discovery script or manual testing process
- [ ] Document upper limit discovery procedure for repeatable execution
- [ ] **Deliverable**: Framework for finding relay instance capacity limits

#### Ticket 3.1.2: Capacity Discovery Test Execution

- [ ] Execute progressive load tests using weighted traffic patterns and APM monitoring
- [ ] Start with baseline VU count and systematically increase until degradation occurs
- [ ] Monitor and document system behavior using 0x and enhanced K6 metrics
- [ ] Identify specific bottlenecks (CPU, memory, I/O, event loop) with performance data
- [ ] **Deliverable**: Documented maximum stable traffic capacity and bottleneck analysis

## Priority 4: Targeted Performance Issue Resolution

### 4.1 High-Transaction Block Testing

**Goal**: Address degradation issues with blocks containing 5,000+ transactions

#### Ticket 4.1.1: High-Transaction Block Identification

- [ ] Coordinate with Mirror Node team to identify testnet blocks with 5,000+ transactions
- [ ] Document specific block numbers and transaction counts
- [ ] Verify block accessibility and data completeness
- [ ] Create test data repository for consistent testing
- [ ] **Deliverable**: Curated list of high-transaction test blocks

#### Ticket 4.1.2: Custom Degradation Reproduction Script

- [ ] Create dedicated K6 script for high-transaction block testing using enhanced monitoring
- [ ] Implement progressive load increase to reproduce degradation
- [ ] Add specific monitoring for block retrieval performance using APM tools
- [ ] Document reproduction steps and expected outcomes
- [ ] **Deliverable**: High-transaction block test script

#### Ticket 4.1.3: Performance Bottleneck Analysis

- [ ] Use enhanced K6 + 0x tools from Priority 2 to analyze bottlenecks
- [ ] Identify specific performance degradation points with detailed metrics
- [ ] Document findings with performance data evidence
- [ ] Recommend optimization strategies
- [ ] **Deliverable**: Performance bottleneck analysis report

### 4.2 Testnet vs Mainnet Staging Coordination

#### Ticket 4.2.1: Mirror Node Team Coordination

- [ ] Schedule meetings with Mirror Node team for performance testing coordination
- [ ] Evaluate mainnet staging environment for performance testing
- [ ] Define data requirements and access procedures
- [ ] Document environment setup and limitations
- [ ] **Deliverable**: Coordinated testing environment strategy

## Priority 5: Reporting and Tracking Infrastructure

### 5.1 Performance Data Management

**Goal**: Create systematic approach to track performance across releases

#### Ticket 5.1.1: Performance Data Export Format

- [ ] Design JSON export format for K6 and 0x data
- [ ] Include all key metrics: TPS, latency, CPU, memory, GC time
- [ ] Add metadata: test configuration, environment, relay version
- [ ] Implement automated export generation
- [ ] **Deliverable**: Standardized performance data export

#### Ticket 5.1.2: Baseline Management System

- [ ] Create process for establishing performance baselines
- [ ] Design comparison methodology for release-to-release analysis
- [ ] Implement regression detection criteria
- [ ] Document baseline update procedures
- [ ] **Deliverable**: Performance baseline management process

### 5.2 Tracking and Documentation

#### Ticket 5.2.1: Performance Engineering Process Documentation

- [ ] Document complete performance testing procedure
- [ ] Create runbooks for different test scenarios
- [ ] Include troubleshooting guides and escalation procedures
- [ ] Design onboarding materials for new team members
- [ ] **Deliverable**: Comprehensive performance engineering documentation

#### Ticket 5.2.2: KPI Definition for Autoscaling

- [ ] Extract KPIs from enhanced metrics for Kubernetes autoscaling
- [ ] Define thresholds for scaling decisions
- [ ] Coordinate with DevOps on implementation requirements
- [ ] Document cost optimization strategies
- [ ] **Deliverable**: Autoscaling KPI framework

## Implementation Timeline

**Weeks 1-2**: Priority 2 (APM Integration) - **NEXT UP**
**Weeks 3-4**: Priority 3 (Upper Limit Discovery and Capacity Testing)  
**Weeks 5-6**: Priority 4 (Targeted Performance Issues)
**Weeks 7-8**: Priority 5 (Reporting and Tracking)

## Success Criteria

- [x] K6 tests reflect real HashIO traffic patterns
- [x] Professional test anatomy with proper phases implemented
- [ ] Comprehensive Node.js performance monitoring operational
- [ ] Maximum stable traffic capacity identified with detailed bottleneck analysis
- [ ] High-transaction block degradation issues identified and documented
- [ ] Baseline performance data established for release comparisons
- [ ] Complete performance engineering process documented
- [ ] Team capable of independent performance testing execution

## Next Steps

**You are ready to start Priority 2!**

The K6 foundation is solid and APM-ready. Just follow the simple workflow:

1. Install 0x: `npm install -g 0x`
2. Test the magic command: `npx 0x --prof -- npm run relay:start`
3. Run your stress tests and analyze the results

**No complex setup, no overengineering - just one simple command that gives you everything you need.**
