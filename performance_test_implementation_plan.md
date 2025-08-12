# Performance Test Implementation Plan

Based on the goals and requirements outlined in `performance_test_goal.md`, this document provides a comprehensive, prioritized implementation plan broken down into actionable tickets. |

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

**Goal**: Implement comprehensive Node.js performance monitoring using Clinic.js to provide deep insights into CPU usage, memory allocation, garbage collection, and async operations during stress testing.

### Why Clinic.js?

[Clinic.js](https://clinicjs.org/) is the industry-standard toolkit for Node.js performance analysis, providing specialized tools for different aspects of performance monitoring:

- **`clinic flame`**: Advanced CPU profiling with interactive flame graphs
- **`clinic doctor`**: System health monitoring (memory, CPU, GC, I/O)
- **`clinic bubbleprof`**: Async operations and event loop analysis

### Clinic.js Advantages

- **Professional-Grade Analysis**: Purpose-built for Node.js performance engineering
- **Visual Insights**: Rich, interactive dashboards and flame graphs
- **Comprehensive Coverage**: CPU, memory, async operations, and system health in one toolkit
- **Production-Ready**: Battle-tested by enterprise Node.js applications
- **Specialized Tools**: Each tool focuses on specific performance aspects

### Performance Monitoring Strategy

The Clinic.js suite provides complete coverage of all required performance metrics through specialized tools:

**Tool Mapping:**

| Clinic.js Tool      | Primary Focus             | Key Metrics Provided                      |
| ------------------- | ------------------------- | ----------------------------------------- |
| `clinic flame`      | CPU Performance Analysis  | Function-level CPU usage, call stacks     |
| `clinic doctor`     | System Health Monitoring  | Memory usage, GC stats, I/O operations    |
| `clinic bubbleprof` | Async Operations Analysis | Event loop performance, async bottlenecks |

### 2.1 Clinic.js Setup and Installation

#### Ticket 2.1.1: Install Clinic.js Toolkit

- [ ] Install Clinic.js locally in k6 project: `cd k6 && npm install --save-dev clinic`
- [ ] Verify local installation: `cd k6 && npx clinic --help`
- [ ] Test individual tools:
  - `npx clinic flame --help`
  - `npx clinic doctor --help`
  - `npx clinic bubbleprof --help`
- [ ] **Deliverable**: Complete Clinic.js toolkit installation in k6 project

#### Ticket 2.1.2: Create Profiled Server Scripts

- [ ] Create npm scripts for each Clinic.js tool in k6/package.json with meaningful names
- [ ] Configure output directories for organized report storage
- [ ] Test each profiling mode with the relay server
- [ ] **Deliverable**: Ready-to-use profiled server startup scripts with clear naming

### 2.2 Comprehensive Performance Analysis Workflow

#### Multi-Tool Analysis Strategy

Each Clinic.js tool provides unique insights that complement the others:

**Complete Performance Analysis Workflow:**

1. **CPU Analysis**: `npm run start-monitored-relay:cpu` → CPU flame graphs
2. **System Health**: `npm run start-monitored-relay:health` → Memory, GC, I/O analysis
3. **Async Analysis**: `npm run start-monitored-relay:async` → Event loop performance

**Understanding Each Analysis:**

| Tool                  | What It Shows                     | When to Use                              |
| --------------------- | --------------------------------- | ---------------------------------------- |
| **clinic flame**      | CPU hotspots and function timing  | Identifying slow functions and CPU usage |
| **clinic doctor**     | Memory patterns and system health | Debugging memory leaks and GC issues     |
| **clinic bubbleprof** | Async operation performance       | Analyzing event loop and I/O bottlenecks |

**Note on HeapProfiler**: We **do not include** `clinic heapprofiler` because:

- **Redundant**: `clinic doctor` already provides comprehensive memory analysis for our needs
- **Wrong granularity**: Function-level memory allocation is too detailed for performance stress testing
- **Performance overhead**: Adds unnecessary load during stress tests
- **Our focus**: System-level performance monitoring, not developer-level memory debugging

### 2.3 Performance Metrics Coverage

**Complete Coverage of Required Metrics:**

| Required Metric                  | Clinic.js Tool    | Coverage Status | Analysis Method                        |
| -------------------------------- | ----------------- | --------------- | -------------------------------------- |
| Transactions Per Second (TPS)    | K6                | ✅ Full         | K6 stress test output                  |
| TPS per RPC endpoint             | K6                | ✅ Full         | K6 scenario-based reporting            |
| Latency                          | K6                | ✅ Full         | K6 response time metrics               |
| CPU usage (% and wait time)      | clinic flame      | ✅ Full         | Interactive flame graphs               |
| Memory usage                     | clinic doctor     | ✅ Full         | Heap analysis and allocation tracking  |
| Garbage collector time           | clinic doctor     | ✅ Full         | GC event timing and frequency          |
| I/O                              | clinic doctor     | ✅ Full         | File system and network I/O statistics |
| Thread count                     | clinic doctor     | ✅ Full         | Process and thread monitoring          |
| Error rate for failed requests   | K6                | ✅ Full         | HTTP error rate tracking               |
| Event loop (delay and execution) | clinic bubbleprof | ✅ Full         | Event loop lag and async analysis      |
| Active handles                   | clinic doctor     | ✅ Full         | Handle and resource tracking           |
| Standard K6 output               | K6                | ✅ Full         | Median response times, data transfer   |

**Coverage Summary: 12/12 metrics fully covered (100% complete)**

### 2.4 Professional Analysis Dashboard

**Clinic.js Dashboard Features:**

- **Interactive Flame Graphs**: Click and zoom through CPU performance data
- **Memory Timeline**: Visual memory allocation and GC patterns over time
- **Async Bubble Charts**: Visual representation of async operation delays
- **System Health Metrics**: Real-time CPU, memory, and I/O monitoring
- **Performance Recommendations**: Automated suggestions for optimization

**Analysis Workflow:**

1. **Start Monitored Relay**: `cd k6 && npm run start-monitored-relay:health`
2. **Run Stress Test**: `cd k6 && npm run stress-test` (separate terminal)
3. **Complete Analysis**: Let K6 finish completely
4. **Stop Server**: `Ctrl+C` triggers automatic report generation
5. **Review Dashboard**: Open generated HTML reports for detailed analysis

### 2.5 Priority 2 Implementation Checklist

**Setup Requirements:**

- [ ] Install complete Clinic.js toolkit locally in k6 project
- [ ] Configure profiled server scripts with meaningful names for each analysis type
- [ ] Set up organized report output directories
- [ ] Create comprehensive documentation for each analysis tool

**Integration Testing:**

- [ ] Test clinic flame for CPU analysis with K6 stress tests
- [ ] Test clinic doctor for system health monitoring during load
- [ ] Test clinic bubbleprof for async performance analysis
- [ ] Validate combined analysis workflow provides complete performance picture

**Documentation and Training:**

- [ ] Create analysis guides for each Clinic.js tool
- [ ] Document interpretation of flame graphs, memory patterns, and async metrics
- [ ] Establish baseline performance data collection process
- [ ] Train team on professional performance analysis techniques

**Success Criteria:**

- ✅ Complete Clinic.js toolkit operational for all analysis types
- ✅ 12/12 required metrics fully covered (100% complete)
- ✅ Professional-grade performance analysis capabilities established
- ✅ Ready for Priority 3 capacity testing with comprehensive monitoring

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
- [ ] Monitor and document system behavior using Clinic.js tools and enhanced K6 metrics
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

- [ ] Use enhanced K6 + Clinic.js tools from Priority 2 to analyze bottlenecks
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

- [ ] Design JSON export format for K6 and Clinic.js data
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
