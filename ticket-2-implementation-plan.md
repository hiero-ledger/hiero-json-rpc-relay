# Ticket-2 Implementation Plan: Clinic.js APM Integration

## Overview

Implement comprehensive Application Performance Monitoring (APM) using the Clinic.js toolkit for professional Node.js performance analysis during stress testing. This provides deep internal visibility into CPU usage, memory allocation, garbage collection, async operations, and system health to complement existing K6 external metrics.

## Strategy

Deploy the complete Clinic.js toolkit (`clinic flame`, `clinic doctor`, `clinic bubbleprof`, and unified `clinic` dashboard) to provide professional-grade Node.js performance analysis. Configure organized report storage and establish workflows for systematic performance engineering across all analysis types.

## Required Changes

### 1. Install Clinic.js Toolkit

**Target**: k6 package development dependencies (local installation only)
**Action**: Install complete Clinic.js suite locally in k6 project

```bash
# Navigate to k6 directory and install locally
cd k6 && npm install --save-dev clinic
```

### 2. Create Clinic.js NPM Scripts

**Target**: k6/package.json scripts section
**Action**: Add comprehensive Clinic.js analysis scripts with meaningful names

Add these scripts to k6/package.json:

```json
{
  "start-monitored-relay:cpu": "DOTENV_CONFIG_PATH=../.env npx clinic flame --dest ./stress-test-reports/cpu -- node -r dotenv/config ../packages/server/dist/index.js",
  "start-monitored-relay:health": "DOTENV_CONFIG_PATH=../.env npx clinic doctor --dest ./stress-test-reports/health -- node -r dotenv/config ../packages/server/dist/index.js",
  "start-monitored-relay:async": "DOTENV_CONFIG_PATH=../.env npx clinic bubbleprof --dest ./stress-test-reports/async -- node -r dotenv/config ../packages/server/dist/index.js"
}
```

#### Command Analysis Breakdown

Each Clinic.js command provides specialized performance analysis:

**Environment Configuration**:

- `DOTENV_CONFIG_PATH=../.env` - Points dotenv to the project root .env file
- `-r dotenv/config` - Requires dotenv before application startup to load environment variables

**Clinic.js Monitored Relay Scripts**:

1. **`start-monitored-relay:cpu`** - CPU Performance Monitoring
   - Uses: `clinic flame` for interactive flame graphs
   - Shows: Function-level CPU usage and call stack relationships
   - Output: Interactive HTML flame graph for detailed CPU analysis
   - **Metrics Covered**: CPU usage (%), function-level timing, call stack analysis, performance hotspots

2. **`start-monitored-relay:health`** - System Health Monitoring
   - Uses: `clinic doctor` for system health monitoring
   - Shows: Memory usage, garbage collection patterns, and I/O operations
   - Output: Comprehensive system health dashboard with recommendations
   - **Metrics Covered**: Memory usage patterns, garbage collection time, I/O operations, thread count, active handles, CPU wait time

3. **`start-monitored-relay:async`** - Async Operations Monitoring
   - Uses: `clinic bubbleprof` for async operations analysis
   - Shows: Event loop performance and async operation delays
   - Output: Visual bubble chart analysis of async operations
   - **Metrics Covered**: Event loop delay and execution time, async operation bottlenecks, promise/callback performance

**Output Organization**:

- `--dest ./stress-test-reports/{analysis-type}` - Organizes reports by analysis type
- Each analysis gets its own subdirectory for clear organization
- All reports stored in centralized `stress-test-reports` location

### 3. Enhance K6 Stress Test Report Output

**Target**: k6/src/scenarios/stress-test.js
**Action**: Update handleSummary function for organized report storage

```javascript
export function handleSummary(data) {
  const report = markdownReport(data, false, options.scenarios);

  // Ensure stress-test-reports directory structure exists
  return {
    stdout: report,
    './stress-test-reports/k6/report.md': report,
  };
}
```

### 4. Update Project .gitignore

**Target**: k6/.gitignore (create if doesn't exist)
**Action**: Add Clinic.js report patterns and temporary files

```gitignore
# Clinic.js Reports and Analysis
stress-test-reports/
.clinic/
*.clinic-*
flamegraph.html
clinic-flame-*
clinic-doctor-*
clinic-bubbleprof-*

# Clinic.js temporary files
*.log
isolate-*
```

## Implementation Steps

### Step 1: Clinic.js Toolkit Installation

```bash
# Navigate to k6 directory and install locally
cd k6

# Add Clinic.js to development dependencies
npm install --save-dev clinic

# Verify local installation
npx clinic --help
npx clinic flame --help
npx clinic doctor --help
npx clinic bubbleprof --help
```

### Step 2: Package.json Configuration

- Add all Clinic.js analysis scripts to k6/package.json
- Ensure proper environment variable configuration
- Test script syntax and command validation

### Step 3: Report Structure Setup

- Create stress-test-reports directory structure
- Configure K6 report output to organized directories
- Update .gitignore patterns for report files

### Step 4: End-to-End Workflow Testing

**CPU Monitoring Workflow:**

```bash
# Terminal 1: Start CPU monitored relay
cd k6 && npm run start-monitored-relay:cpu

# Terminal 2: Run stress test
cd k6 && npm run stress-test

# Terminal 1: Stop server (Ctrl+C) to generate flame graph
# Analysis: Open stress-test-reports/cpu/clinic-flame-*.html
```

**System Health Monitoring Workflow:**

```bash
# Terminal 1: Start health monitored relay
cd k6 && npm run start-monitored-relay:health

# Terminal 2: Run stress test
cd k6 && npm run stress-test

# Terminal 1: Stop server (Ctrl+C) to generate health report
# Analysis: Open stress-test-reports/health/clinic-doctor-*.html
```

**Async Operations Monitoring Workflow:**

```bash
# Terminal 1: Start async monitored relay
cd k6 && npm run start-monitored-relay:async

# Terminal 2: Run stress test
cd k6 && npm run stress-test

# Terminal 1: Stop server (Ctrl+C) to generate bubble chart
# Analysis: Open stress-test-reports/async/clinic-bubbleprof-*.html
```

### Step 5: Comprehensive Analysis Documentation

- Create analysis guides for each Clinic.js tool
- Document interpretation of flame graphs, system health metrics, and async patterns
- Establish baseline data collection procedures

## File Modifications

### k6/package.json

```diff
  "devDependencies": {
    "@types/k6": "^1.1.1",
+   "clinic": "^7.0.0"
  },
  "scripts": {
    "stress-test": "TEST_TYPE=stress env-cmd --use-shell k6 run src/scenarios/stress-test.js",
+   "start-monitored-relay:cpu": "DOTENV_CONFIG_PATH=../.env npx clinic flame --dest ./stress-test-reports/cpu -- node -r dotenv/config ../packages/server/dist/index.js",
+   "start-monitored-relay:health": "DOTENV_CONFIG_PATH=../.env npx clinic doctor --dest ./stress-test-reports/health -- node -r dotenv/config ../packages/server/dist/index.js",
+   "start-monitored-relay:async": "DOTENV_CONFIG_PATH=../.env npx clinic bubbleprof --dest ./stress-test-reports/async -- node -r dotenv/config ../packages/server/dist/index.js",
+   "start-monitored-relay:suite": "DOTENV_CONFIG_PATH=../.env npx clinic --dest ./stress-test-reports/complete -- node -r dotenv/config ../packages/server/dist/index.js",
    "prep-and-stress": "npm run prep && npm run stress-test"
  }
```

### k6/src/scenarios/stress-test.js

```diff
  export function handleSummary(data) {
    const report = markdownReport(data, false, options.scenarios);
+
+   // Save comprehensive K6 reports to organized structure
+   return {
+     stdout: report,
+     './stress-test-reports/k6/report.md': report,
+     './stress-test-reports/k6/summary.json': JSON.stringify(data, null, 2),
+   };
-   return {
-     stdout: report,
-   };
  }
```

### k6/.gitignore

```gitignore
# Clinic.js Reports and Analysis Output
stress-test-reports/

# Clinic.js Temporary Files (may be created during collection)
.clinic/
*.log
isolate-*
```

## Success Criteria

- [ ] Complete Clinic.js toolkit installed locally in k6 dev dependencies
- [ ] Three monitored relay scripts operational in k6/package.json (CPU, health, async)
- [ ] Organized report structure with tool-specific subdirectories
- [ ] K6 stress test reports integrated with Clinic.js workflow
- [ ] Professional monitoring workflows documented for each tool type
- [ ] End-to-end testing validates all monitoring types work with existing stress tests

## Testing Checklist

- [ ] `cd k6 && npm install --save-dev clinic` adds to dev dependencies
- [ ] `cd k6 && npm run start-monitored-relay:cpu` starts CPU monitored relay server
- [ ] `cd k6 && npm run start-monitored-relay:health` starts health monitored relay server
- [ ] `cd k6 && npm run start-monitored-relay:async` starts async monitored relay server
- [ ] `cd k6 && npm run stress-test` executes against monitored relay servers
- [ ] Ctrl+C properly stops servers and generates analysis reports
- [ ] Reports organized in proper subdirectories:
  - `stress-test-reports/cpu/clinic-flame-*.html` (CPU analysis)
  - `stress-test-reports/health/clinic-doctor-*.html` (system health)
  - `stress-test-reports/async/clinic-bubbleprof-*.html` (async analysis)
  - `stress-test-reports/k6/report.md` (K6 results)
- [ ] All HTML reports open successfully and display interactive analysis dashboards
- [ ] No errors during complete workflow execution

## Performance Analysis Capabilities

### Complete Metrics Coverage

| Required Metric               | Clinic.js Tool    | Report Location                     | Analysis Method                         |
| ----------------------------- | ----------------- | ----------------------------------- | --------------------------------------- |
| CPU usage and function timing | clinic flame      | `stress-test-reports/cpu/*.html`    | Interactive flame graphs                |
| Memory allocation patterns    | clinic doctor     | `stress-test-reports/health/*.html` | Memory timeline and heap analysis       |
| Garbage collection statistics | clinic doctor     | `stress-test-reports/health/*.html` | GC frequency and duration charts        |
| I/O operations and throughput | clinic doctor     | `stress-test-reports/health/*.html` | I/O operation statistics and patterns   |
| Event loop performance        | clinic bubbleprof | `stress-test-reports/async/*.html`  | Async delay visualization               |
| Async operations analysis     | clinic bubbleprof | `stress-test-reports/async/*.html`  | Promise and callback performance        |
| System health recommendations | clinic doctor     | `stress-test-reports/health/*.html` | Automated performance recommendations   |
| External API performance      | K6 integration    | `stress-test-reports/k6/report.md`  | Response times, error rates, throughput |

### Professional Analysis Workflow

**Comprehensive Performance Engineering Process:**

1. **Baseline Establishment**: Run each analysis type to establish performance baselines
2. **Targeted Analysis**: Use specific tools based on suspected performance issues
3. **Cross-Tool Validation**: Compare insights across multiple analysis types
4. **Performance Optimization**: Apply findings to improve system performance
5. **Regression Testing**: Use baselines to detect performance degradation across releases

## Conclusion

✅ **Complete Professional APM Integration** - The Clinic.js implementation provides comprehensive Node.js performance analysis capabilities covering all required metrics through three specialized, professional-grade tools designed specifically for Node.js performance engineering.
