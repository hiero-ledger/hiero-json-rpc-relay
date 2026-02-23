# Heap Dump Implementation Plan: Live Node.js Snapshot Capture

This document outlines the exact, battle-tested process for capturing Node.js heap snapshots from the Hedera JSON-RPC Relay. This workflow accounts for distroless container limitations and V8's memory serialization overhead.

## The Strategy

We trigger heap dumps using the native Node.js flag: `--heapsnapshot-signal=SIGUSR2`.

When the Node process receives **SIGUSR2**, it pauses execution, serializes the entire V8 heap to a `.heapsnapshot` file, and resumes. We capture snapshots at two points:

1. **Idle State**: Immediately after the Relay boots and stabilizes.
2. **Post-Load State**: Immediately after a heavy acceptance test suite (`@xts`).

---

## Technical Note: The 512Mi Buffer

To profile a **256MB** environment, we must set the pod's `MEMORY_LIMIT` to **512Mi**.

**Why?**
V8 generates heap snapshots by first converting the entire binary heap into a massive JSON string in C++ memory _before_ writing to disk. This temporary spike in memory usage will instantly violate a strict 256Mi container limit, causing an `OOMKilled` crash (Exit Code 137).

We maintain profiling accuracy by strictly enforcing `--max-old-space-size=192` (75% of 256MB) for the V8 engine. This ensures the application experiences the exact memory pressure of a 256MB environment, while the extra 256MB of container RAM serves as a buffer for the snapshot serialization process.

---

## Phase 1: Preparation (Makefile)

The `Makefile` targets have been updated to automate the discovery and extraction process.

1. **`run-relay-256-profile-with-heapdump`**: Configured with a 512Mi limit and the 192MB old-space cap.
2. **`capture-heap-snapshot`**: Automatically discovers the correct Node.js PID by scanning `/proc/*/cmdline` for `dist/index.js` and sends the signal using shell-native `kill`.
3. **`extract-heap-snapshots`**: Automatically locates snapshots in the monorepo path (`/home/node/app/packages/server/`) and copies them to the host root.

---

## Phase 2: Step-by-Step Execution

Follow these steps exactly to reproduce the profiling results:

### 1. Reset and Bootstrap Cluster

Ensure a clean environment with the Consensus and Mirror nodes ready.

```bash
make setup-solo
```

### 2. Deploy the Profiled Relay

Launch the Relay with profiling flags and the OOM-safety buffer.

```bash
make run-relay-256-profile-with-heapdump
```

_Wait for the pod to reach `Running` and `Ready` status._

### 3. Capture "Idle" Snapshot

```bash
make capture-heap-snapshot
```

_V8 will write the first `.heapsnapshot` file inside the pod._

### 4. Execute Load Test

Run the Heavy Acceptance suite to stress and populate the V8 heap.

```bash
npm run acceptancetest:xts
```

_Wait for the tests to complete (approx. 5-10 minutes)._

### 5. Capture "Post-Load" Snapshot

```bash
make capture-heap-snapshot
```

_V8 will write the second `.heapsnapshot` file._

### 6. Extract Snapshots to Host

```bash
make extract-heap-snapshots
```

---

## Final Deliverable

You will find two `.heapsnapshot` files in your project root (e.g., `Heap.YYYYMMDD.HHMMSS.pid.0.001.heapsnapshot`).

They can be opened in **Google Chrome** (F12 -> Memory -> Load) to inspect exactly which objects are responsible for memory retention.
