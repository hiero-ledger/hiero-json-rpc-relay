# Performance Test Implementation Plan

Based on the goals and requirements outlined in `performance_test_goal.md`, this document provides a comprehensive, prioritized implementation plan broken down into actionable tickets.

## Overview

**Objective**: Transform the existing K6 test suite into a professional-grade performance engineering platform that can:

- Accurately reflect real-world traffic patterns
- Identify system upper limits and bottlenecks
- Provide comprehensive performance monitoring
- Enable systematic regression testing across releases

## Priority 1: Enhanced K6 Script Foundation

### 1.1 Traffic-Weighted Test Distribution

**Goal**: Weight RPC calls based on actual HashIO traffic patterns from the last 3 months

#### Ticket 1.1.1: Analyze HashIO Traffic Patterns

- [ ] Coordinate with DevOps to access HashIO logs from last 3 months
- [ ] Extract RPC method call frequency and distribution
- [ ] Calculate percentage breakdown of each RPC method
- [ ] Document findings in data analysis report
- [ ] **Deliverable**: Traffic analysis report with RPC method weights

#### Ticket 1.1.2: Implement Traffic-Weighted Configuration and Resource-Intensive Endpoint Focus

- [ ] Create new traffic weight configuration file or extend existing `k6/src/lib/common.js`
- [ ] Apply traffic weights from analysis (1.1.1) to scenario VU allocation
- [ ] Update `k6/src/scenarios/test/index.js` to use weighted distribution instead of equal allocation
- [ ] Add resource-intensive endpoint multipliers for heavy endpoints
- [ ] **Deliverable**: Weighted test execution reflecting real traffic patterns

### 1.2 Proper Test Anatomy Implementation

**Goal**: Implement professional performance test structure with ramp-up and stable phases

#### Ticket 1.2.1: Implement Ramp-up and Stable Phases

- [ ] Extend existing `k6/src/lib/common.js` to support staged execution phases
- [ ] Add 1-2 minute ramp-up period to existing load test configuration
- [ ] Add stable throughput phase with configurable duration (20min or 60min)
- [ ] Use weighted traffic distribution from step 1.1
- [ ] **Deliverable**: Updated K6 configuration supporting phased execution

## Priority 2: APM Integration for Performance Monitoring

### 2.1 Clinic.js Integration

**Goal**: Integrate Node.js performance monitoring tools with K6 testing

#### Ticket 2.1.1: Clinic.js Setup and Integration

- [ ] Install and configure Clinic.js tools in relay environment
- [ ] Create npm scripts to run relay with Clinic.js during K6 tests
- [ ] Document setup process for local and test environments
- [ ] Test integration with sample performance run
- [ ] **Deliverable**: Working Clinic.js integration with relay

#### Ticket 2.1.2: Performance Data Collection Automation

- [ ] Implement automated collection of flame graphs during tests
- [ ] Set up CPU, memory, and I/O monitoring
- [ ] Configure event loop and garbage collection tracking
- [ ] Create data export formats for analysis
- [ ] **Deliverable**: Automated performance data collection

### 2.2 Enhanced Metrics Collection

**Goal**: Expand K6 metrics to include comprehensive performance indicators

#### Ticket 2.2.1: Custom K6 Metrics Implementation

- [ ] Add custom metrics for TPS per RPC endpoint
- [ ] Implement latency percentile tracking (P50, P95, P99)
- [ ] Add error rate monitoring with 0% target
- [ ] Create memory and CPU usage correlation with K6 output
- [ ] **Deliverable**: Enhanced K6 metrics collection

#### Ticket 2.2.2: Grafana Integration Planning

- [ ] Document required Grafana dashboard queries
- [ ] Define metrics export format for Grafana consumption
- [ ] Create manual process for Grafana data visualization
- [ ] Plan future automation of dashboard updates
- [ ] **Deliverable**: Grafana integration documentation

## Priority 3: Upper Limit Discovery and Capacity Testing

### 3.1 Progressive Load Testing Implementation

**Goal**: Systematically identify maximum stable traffic capacity for single relay instance

#### Ticket 3.1.1: Progressive Load Testing Framework

- [ ] Create systematic VU progression methodology (start low, increase until degradation)
- [ ] Implement degradation detection criteria using APM metrics from Priority 2
- [ ] Build automated load discovery script or manual testing process
- [ ] Document upper limit discovery procedure for repeatable execution
- [ ] **Deliverable**: Framework for finding relay instance capacity limits

#### Ticket 3.1.2: Capacity Discovery Test Execution

- [ ] Execute progressive load tests using weighted traffic patterns and APM monitoring
- [ ] Start with baseline VU count and systematically increase until degradation occurs
- [ ] Monitor and document system behavior using Clinic.js and enhanced K6 metrics
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

### 4.1 Reference Data and Baseline Management

**Goal**: Create systematic approach to track performance across releases

#### Ticket 4.1.1: Performance Data Export Format

- [ ] Design JSON export format for K6 and Clinic.js data
- [ ] Include all key metrics: TPS, latency, CPU, memory, GC time
- [ ] Add metadata: test configuration, environment, relay version
- [ ] Implement automated export generation
- [ ] **Deliverable**: Standardized performance data export

#### Ticket 4.1.2: Baseline Management System

- [ ] Create process for establishing performance baselines
- [ ] Design comparison methodology for release-to-release analysis
- [ ] Implement regression detection criteria
- [ ] Document baseline update procedures
- [ ] **Deliverable**: Performance baseline management process

### 4.2 Tracking and Documentation

#### Ticket 4.2.1: Notion Integration Planning

- [ ] Design Notion workspace structure for performance tracking
- [ ] Create templates for performance test execution logs
- [ ] Document manual data entry process
- [ ] Plan future automation possibilities
- [ ] **Deliverable**: Notion-based tracking system

#### Ticket 4.2.2: Performance Engineering Process Documentation

- [ ] Document complete performance testing procedure
- [ ] Create runbooks for different test scenarios
- [ ] Include troubleshooting guides and escalation procedures
- [ ] Design onboarding materials for new team members
- [ ] **Deliverable**: Comprehensive performance engineering documentation

#### Ticket 4.2.3: KPI Definition for Autoscaling

- [ ] Extract KPIs from enhanced metrics for Kubernetes autoscaling
- [ ] Define thresholds for scaling decisions
- [ ] Coordinate with DevOps on implementation requirements
- [ ] Document cost optimization strategies
- [ ] **Deliverable**: Autoscaling KPI framework

## Implementation Timeline

**Weeks 1-2**: Priority 1 (Enhanced K6 Script Foundation)
**Weeks 3-4**: Priority 2 (APM Integration)  
**Weeks 5-6**: Priority 3 (Upper Limit Discovery and Capacity Testing)
**Weeks 7-8**: Priority 4 (Targeted Performance Issues)
**Weeks 9-10**: Priority 5 (Reporting and Tracking)

## Success Criteria

- [ ] K6 tests reflect real HashIO traffic patterns
- [ ] Professional test anatomy with proper phases implemented
- [ ] Comprehensive Node.js performance monitoring operational
- [ ] Maximum stable traffic capacity identified with detailed bottleneck analysis
- [ ] High-transaction block degradation issues identified and documented
- [ ] Baseline performance data established for release comparisons
- [ ] Complete performance engineering process documented
- [ ] Team capable of independent performance testing execution

## Notes

- Each ticket should be assigned to specific team members
- Regular progress reviews should be conducted weekly
- Coordination with DevOps and Mirror Node teams is critical
- All deliverables should be peer-reviewed before completion
- Documentation should be updated continuously throughout implementation
