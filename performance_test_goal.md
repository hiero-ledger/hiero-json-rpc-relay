HashIO / Json RPC Performance Engineering

# Introduction

The Hashio Team runs a K6 script with each release to collect basic metrics and compare them against the previous release to ensure no performance degradation. This script is outdated, has not been updated recently, and does not test the relay's upper limits.

In Q1 and Q2, we observed performance degradation in RPC calls retrieving block details, particularly for blocks with thousands of transactions. Two issues were identified:

1. The relay experiences degradation during information gathering.
2. High-transaction blocks hit a functional limit, preventing users from retrieving details.

# Objectives

## Extend Functionality of the K6 Script

We aim to enhance the existing K6 script to align with current JSON-RPC relay trends, with quarterly reviews. The plan includes:

- Incorporating all RPC methods into the script.
- Analyzing the last three months of traffic to assign weights to each RPC call, reflecting their distribution in the K6 script.
- Adding extra weight to the most resource-intensive endpoints.
- Defining test data for execution on testnet (previewnet lacks sufficient data):
  - Use blocks with over 5,000 transactions.
  - Coordinate with the Mirror Node team to explore using mainnet staging for performance testing.
- Configuring Hashio to handle these tests.

To address past degradation, create a custom K6 script (separate from the global script) to reproduce issues. Identify a specific block in testnet or mainnet and perform local executions:

- Start with one execution and increase as needed to identify bottlenecks.

## Anatomy of a Performance Test

The performance test should include:

- A 1–2 minute ramp-up period to warm up the context.
- A stable throughput phase.
- Two test durations per release to observe behavior:
  - 20 minutes
  - 60 minutes
- Determining the upper limits of a single relay instance to identify the maximum stable traffic it can handle. Conduct multiple test series until degradation occurs, then adjust to find a stable traffic level.
  - Extract metrics per execution to identify the most stable configuration, which will serve as the baseline for release comparisons.
  - Metrics (with trends) to extract from the performance monitoring tool and Grafana:
    - Transactions Per Second (TPS)
    - TPS per RPC endpoint
    - Latency
    - CPU usage (% and wait time)
    - Memory usage
    - Garbage collector time
    - I/O
    - Thread count
    - Error rate for failed requests (target: 0%)
    - Event loop (delay and execution time)
    - Active handles
    - Standard K6 output (e.g., median, bytes exchanged)

These metrics will guide DevOps in setting thresholds for scaling Hashio relays dynamically, optimizing costs across environments.

## Define the APM and Performance Tool for Node.js

We will use K6 combined with a Node.js performance monitoring tool, starting with local testing to evaluate tools and exhaust system limits.

**Why K6?**

- It reliably generates significant external traffic to our infrastructure when needed.

**Performance Monitoring Tools for Node.js:**

- [Clinic.js](https://clinicjs.org/):
  - [node-clinic-flame](https://github.com/nearform/node-clinic-flame): Programmable interface for flame graphs (uses 0x under the hood).
  - [node-clinic](https://github.com/nearform/node-clinic): Dashboard for diagnosing Node.js performance issues.
  - [node-clinic-bubbleprof](https://github.com/nearform/node-clinic-bubbleprof): Programmable interface for async profiling.
  - [node-clinic-doctor](https://github.com/nearform/node-clinic-doctor): Programmable interface for memory, CPU, and process statistics.

**Why Clinic.js?**

- It is a mature, standard tool for Node.js performance analysis, beyond built-in Node.js --prof profiling.

## DevOps and Mirror Node Coordination

- Collaborate with the Mirror Node team and DevOps to define the optimal test setup, considering dependencies on Mirror Node and infrastructure.
- Consult Performance Engineering for guidance on metrics and the testing process.

## Address Degradation for High-Transaction-Count Blocks

- Configure Hashio to process all transactions within a block.
- Execute the custom K6 script to collect performance data using Clinic.js and other tools.

## Determine the Upper Limit of a Single Relay Instance

- Test locally and in an environment with one pod to identify the maximum capacity of a single relay instance.

## Extract Key KPIs for Performance Tests (Regression and Autoscaling)

Using metrics from K6, Clinic.js, Node.js, and Grafana:

- Create a reference data report stored in Notion for comparison across releases.
- Define KPIs for autoscaling Kubernetes clusters.

## Performance Engineering Process

- Develop a detailed process to enable anyone to conduct performance tests per release or degradation event.

## Performance Engineering Audit Log/Tracking

- Create a dedicated Notion section to track all performance test executions, enabling historical comparisons.
