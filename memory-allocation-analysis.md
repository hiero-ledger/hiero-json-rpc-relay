# Memory Allocation Analysis

## **TL;DR**

- **Idle heap: ~48 MB.** The largest consumers are V8 compiled code (21.6 MB), module source strings (13.8 MB), and ethers.js data tables (11.3 MB).
- **~15 MB of idle heap seem to be unused data** — ethers ENS/BIP39 tables (11 MB) and pino transport buffers (4.2 MB) that the relay never uses at runtime. Need investigation
- **Under load (120 RPS): heap peaks at 75–78 MB** and stabilizes. No memory leaks. Growth is from gRPC buffers, JSON responses, and async coordination — all inherent to transaction processing.
- **After load: GC reclaims transient objects.** Heap settles at ~63 MB. Retained growth is LRU cache entries + JIT code, both tunable.
- **GC is healthy.** ~5% overhead, 2–3 ms pauses. Not a bottleneck.
- **Biggest optimization opportunity:** Replace full `ethers` import with submodule imports (~6–11 MB savings) and disable pino transport thread in silent mode (~14 MB savings including worker isolates), more to investigate

**Current container sizing (before any improvements):**

- **Minimum to start:** ~96 MB pod limit (`-max-old-space-size=50`). The idle heap is ~48 MB + ~40 MB native memory (V8 engine, libuv, OpenSSL, etc.).
- **Minimum to handle load (120 RPS):** ~124 MB pod limit (`-max-old-space-size=84`). Under load the heap peaks at ~7**5–78 MB**  MB + ~40 MB native memory.
- No memory leaks. GC is healthy (~5% overhead, 2–3 ms pauses). Heap recovers to near-baseline after load.

## **Introduction**

This document analyzes the runtime memory footprint of the Hedera JSON-RPC Relay HTTP server process. It answers three questions:

1. **What consumes memory at idle**, before any traffic?
2. **What additional memory is needed under load**, and what creates it?
3. **Is memory usage stable**, or does it grow over time?

All findings are based on V8 heap snapshots, heap allocation profiles, and GC traces captured from a live container.

---

## **Test Setup**

All measurements were taken from a relay instance running inside a Kubernetes pod on a local Hedera Solo network.

| Parameter              | Value                                          |
| ---------------------- | ---------------------------------------------- |
| Container memory limit | 512 Mi (to accommodate heap snapshot overhead) |
| V8 max old space       | 192 MB (`--max-old-space-size=192`)            |
| Worker threads         | Disabled (`WORKERS_POOL_ENABLED=false`)        |
| Load scenario          | `eth_sendRawTransaction` via k6                |
| Virtual users          | 10                                             |
| Target throughput      | 120 requests/second                            |
| Load duration          | 180 seconds                                    |
| Node.js version        | v22 (Alpine)                                   |

**6 heap snapshots** were captured at key moments during the test:

| #   | Label               | When                        | Heap Size |
| --- | ------------------- | --------------------------- | --------- |
| 1   | Idle                | Before load test            | 47.8 MB   |
| 2   | Mid-Load 1          | 45 seconds into load        | 78.1 MB   |
| 3   | Mid-Load 2          | 90 seconds into load        | 75.3 MB   |
| 4   | Mid-Load 3          | 135 seconds into load       | 77.8 MB   |
| 5   | Post-Load (pre-GC)  | Immediately after load ends | 73.8 MB   |
| 6   | Post-Load (post-GC) | After garbage collection    | 69.0 MB   |

Snapshots were triggered on-demand by sending a `SIGUSR2` signal to the Node.js process (enabled via `--heapsnapshot-signal=SIGUSR2`). The resulting `.heapsnapshot` files were extracted from the container and analyzed using Chrome DevTools Memory tab in Comparison view.
A separate GC trace analysis was also conducted using `--trace-gc` during a 30-second load test at the same throughput to measure garbage collection overhead.

---

## **How Node.js Uses Memory**

A typical Node.js process has two distinct areas of memory:

**V8 Heap** — Where JavaScript objects live (strings, arrays, functions, class instances, closures, etc.). This is the memory controlled by `--max-old-space-size`. The garbage collector manages this space. Heap snapshots capture exactly what is in this space.

**Native Memory** — Everything outside the V8 heap: the V8 engine itself, Node.js C++ bindings, libuv (event loop and thread pool), OpenSSL, ICU (Unicode tables), gRPC compression buffers, and thread stacks. A bare Node.js process uses approximately **30–40 MB** of native memory before any application code runs. This cannot be tuned via V8 flags.

The **30 MB** - **40 MB** RSS of a bare Node.js process, before any application code is loaded, is often surprising, but easy to verify:

```bash
# Simple barebones Node.js script to print memory usage
node -e "console.log(process.memoryUsage())"
```

A typical result:

```bash
{
  rss: 35485440,       // ~35 MB total resident memory (V8 engine, libuv, OpenSSL, etc.)
  heapTotal: 5603328,  // ~5.6 MB V8 heap allocated (old space, young space, code space, etc.)
  heapUsed: 3507080,   // ~3.5 MB V8 heap actually used by JS objects
  external: 1294310,   // ~1.3 MB C++ objects tied to JS (e.g., Buffer instances)
  arrayBuffers: 10515  // ~10 KB ArrayBuffer instances (subset of external)
}
```

Throughout this document, "heap size" refers to the V8 heap, the part visible in heap snapshots and controlled by garbage collection.

---

## **Memory at Idle**

Right after start up and before any traffic, the relay's V8 heap is approximately **40 MB - 50MB**. The process also uses ~40 MB of native memory and hosts 2 worker thread isolates (~5 MB each) created by the pino logging transport. The total idle RSS footprint is approximately around 90-100 **MB**.

<!-- Add screenshots-->

### **What's in the 40 MB - 50MB Idle Heap**

The idle heap snapshot (Summary view, sorted by Retained Size) reveals the following breakdown:

| Category                        | Retained Size | What It Is                                                                                                                     |
| ------------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| V8 compiled code                | 21.6 MB (45%) | Compiled bytecode and machine code for all 101,762 loaded functions across every imported module (relay code & its dependency) |
| Module source strings           | 13.8 MB (29%) | JavaScript source text of all loaded modules, retained by V8 for debugging and stack traces                                    |
| ethers ENS normalization tables | 6.1 MB (13%)  | Unicode lookup tables for Ethereum Name Service domain resolution, loaded by the `ethers` package at import time               |
| BIP39 mnemonic wordlist         | 5.2 MB (11%)  | English dictionary for mnemonic seed phrase generation, loaded by the `ethers` package at import time                          |
| Pino + ThreadStream buffers     | 4.2 MB (9%)   | Logging transport infrastructure including a 4.1 MB SharedArrayBuffer for worker thread communication                          |
| SDK protobuf definitions        | 1–2 MB        | Type definitions and enum mappings from `@hashgraph/proto`                                                                     |
| Prometheus metrics              | ~624 KB       | Metrics registry, histograms, counters, gauges                                                                                 |
| Other                           | ~5–6 MB       | Service graph, closures, configuration, HTTP agent pools, constants                                                            |

Retained sizes overlap (compiled code for ethers modules appears in both "V8 compiled code" and the ethers entry), so values do not sum to 48 MB.

### **Idle Memory That Could Be Reduced**

Two findings stand out:

- **ethers.js loads ~11 MB of data the relay does not use.** The relay imports the full `ethers` package for ABI encoding and transaction parsing. This causes `ethers` to eagerly load ENS normalization tables (6.1 MB) and BIP39 mnemonic wordlists (5.2 MB). The relay does not perform ENS resolution or mnemonic generation. Importing only the needed ethers submodules instead of the full package would avoid loading this data.
- **Pino allocates ~4.2 MB of buffers even when logging is silent.** The pino logger creates a ThreadStream worker thread with a 4.1 MB SharedArrayBuffer for inter-thread communication regardless of log level. This also creates the 2 worker thread isolates observed in the GC trace (~5 MB each, ~10 MB total), which are invisible to the main heap snapshot. Configuring pino to skip the transport thread when `LOG_LEVEL=silent` would eliminate this overhead.

Together, these account for approximately **15 MB of main heap** and **~10 MB of worker isolate heap,** roughly 25 MB of memory that serves no functional purpose at runtime.

---

## **Memory Under Load Test**

Under sustained load at 120 requests/second, the V8 heap grows to **75–78 MB** and stabilizes. The three mid-load snapshots taken 45 seconds apart show the heap oscillating within this range, not growing. This means the relay reaches a steady state quickly and does not accumulate memory over time.

| Snapshot            | Heap Size | Change from Previous |
| ------------------- | --------- | -------------------- |
| Idle                | 47.8 MB   | —                    |
| Mid-Load 1 (t=45s)  | 78.1 MB   | +30.3 MB             |
| Mid-Load 2 (t=90s)  | 75.3 MB   | -2.8 MB              |
| Mid-Load 3 (t=135s) | 77.8 MB   | +2.5 MB              |
| Post-Load (pre-GC)  | 73.8 MB   | -4.0 MB              |
| Post-Load (post-GC) | 69.0 MB   | -4.8 MB              |

The +30 MB growth from idle to mid-load represents the total cost of actively processing transactions. The following section breaks down what that 30 MB consists of.

### **What Consumes Memory Under Load**

Comparing the mid-load snapshot (t=45s) against the idle snapshot reveals every object type created during load and how much memory it holds.

<!-- Add screenshots-->

| Category                 | Size    | What It Is                                                                                                                                                                                                                                                                                 |
| ------------------------ | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| V8 JIT compiled code     | +7.3 MB | V8 compiles frequently-used functions into optimized machine code at runtime. This is internal to the JavaScript engine and not actionable.                                                                                                                                                |
| gRPC binary buffers      | +6.4 MB | Protobuf-encoded binary data exchanged with the Hedera Consensus Node during transaction submission and receipt polling via `@hashgraph/sdk`.                                                                                                                                              |
| JSON response strings    | +4.6 MB | Mirror Node HTTP response bodies. Each `/contracts/results` response is approximately 3.8 KB of JSON text. These are held as raw strings in the V8 heap.                                                                                                                                   |
| Parsed contract results  | +1.6 MB | 966 deserialized contract result objects (fields: `failed_initcode`, `max_fee_per_gas`, `result`, `call_result`, `from`, `r`, `logs`, `access_list`, etc.). Of these, 402 survive garbage collection (matching the transaction count); the remaining 564 are transient and get cleaned up. |
| Arrays                   | +1.5 MB | Arrays holding cached objects, function arguments, and intermediate computation results.                                                                                                                                                                                                   |
| Async coordination       | +1.0 MB | 5,159 active Promises and 8,700 closures, the async machinery keeping concurrent request pipelines alive while awaiting gRPC and HTTP responses.                                                                                                                                           |
| Sliced strings           | +813 KB | When V8 parses a JSON field from a large response string, it creates a "sliced string" that references the original rather than copying. This is a V8 optimization, but it means the entire ~3.8 KB JSON response stays in memory as long as any parsed field is referenced.               |
| State change objects     | +811 KB | 2,898 contract state change records (`address`, `slot`, `value_read`, `value_written`, `contract_id`), approximately 3 per transaction, nested inside the cached contract results.                                                                                                         |
| gRPC compression buffers | +460 KB | `zlib` decompression buffers used by the gRPC channel for consensus node communication. These sit in native memory but are tracked by V8.                                                                                                                                                  |
| Transaction log objects  | +456 KB | 966 event log objects (`contract_id`, `bloom`, `address`, `data`, `topics`), one per transaction, nested inside the cached contract results.                                                                                                                                               |
| Hedera SDK objects       | ~500 KB | In-flight transaction objects: `EthereumTransaction`, `TransactionReceiptQuery`, `TransactionId`, `Hbar`, `AccountId`, `ExchangeRate`, `Timestamp`, cryptographic keys, and signed transaction bytes.                                                                                      |
| Numbers and bigints      | +450 KB | Gas values, nonces, amounts, and other numeric fields from transaction results (~10 bigint values per transaction).                                                                                                                                                                        |
| Timeouts                 | +194 KB | 1,157 active timers managing request timeouts, retry delays, and polling intervals.                                                                                                                                                                                                        |

These objects are the inherent cost of processing `eth_sendRawTransaction` requests — receiving protobuf data from the consensus node, parsing JSON from the mirror node, and coordinating async I/O across both

---

## **What Stays After Load (Retained Memory)**

When the load test ends, the heap drops from 78 MB to ~63 MB - ~65MB after garbage collection. The **20 MB - 25MB of retained growth** above the 40 MB - 50MB idle baseline is almost entirely two things:

1. **LRU cache entries**, The relay caches Mirror Node responses to avoid redundant API calls. After processing hundreds of transactions, the cache holds the contract results, their nested state changes, logs, bigint values, and the underlying JSON response strings. This accounts for the majority of retained growth.
2. **V8 JIT compiled code**, Functions that were compiled to machine code during load remain compiled. V8 retains this code in case the same functions are called again.

The cache retainer chain, how cached objects hold onto memory, looks like this:

```
LRU Cache
 └─ 402 contract result objects ..................... 653 KB
     ├─ 1,206 state change objects ................. 338 KB
     ├─ 402 log objects ............................ 190 KB
     ├─ 4,354 bigints (gas, nonce, value) .......... 209 KB
     ├─ 10,535 sliced strings ...................... 337 KB
     │   └─ hold references to full JSON responses ─ 1.8 MB
     └─ raw JSON response strings .................. (included above)
```

Each cached contract result object holds references to its state changes, logs, numeric fields, and, through V8's sliced string optimization, the **entire original JSON response string**. This means the effective memory cost of each cached entry is larger than the parsed object alone.

### **Stability Under Sustained Load**

Comparing consecutive mid-load snapshots confirms the relay does not leak memory:

**Mid-Load 2 (t=90s) vs Mid-Load 1 (t=45s):** The heap shrank by 2.8 MB. Object creation and deletion are balanced, with near-zero net deltas across all types. V8 JIT code grew by 1.2 MB as the engine continued optimizing hot paths.

<!-- Add screenshots-->

**Mid-Load 3 (t=135s) vs Mid-Load 2 (t=90s):** The heap grew by 2.5 MB. Strings grew slightly (+246 KB). One notable observation: 34 new Hedera SDK client-related objects were created (NodeClient, NodeChannel, Network, CryptoService, SmartContractService, Logger, PrivateKey, PublicKey, etc.) with 0 deleted. This suggests periodic SDK client recreation. The memory impact is small (~100 KB) but is worth noting.

<!-- Add screenshots-->

**Post-Load (pre-GC) vs Mid-Load 3:** The heap dropped 4.0 MB with near-zero deltas, timers and HTTP connections cleaned up immediately when load stopped. The relay stops allocating as soon as traffic ceases.

<!-- Add screenshots-->

**Post-Load (post-GC) vs Post-Load (pre-GC):** Garbage collection freed another 4.8 MB, sweeping remaining transient objects.

<!-- Add screenshots-->

---

## **Garbage Collection Health**

A separate `--trace-gc` analysis during a 30-second load test at the same throughput measured garbage collection overhead:

| Metric                              | Value                        |
| ----------------------------------- | ---------------------------- |
| Total GC events                     | 4,335                        |
| Scavenge (young generation) pause   | avg ~0.2 ms, max ~1 ms       |
| Mark-Compact (old generation) pause | avg ~2.5 ms, max 17 ms       |
| Heap before test                    | 55 MB used / 66 MB allocated |
| Heap at peak                        | 81 MB used / 86 MB allocated |
| Heap after cleanup                  | 56 MB used / 62 MB allocated |
| GC time as % of wall time           | 4.91%                        |
| V8 marking utilization              | 0.99+ throughout             |

The heap grows under load as transaction processing creates transient objects (gRPC buffers, JSON response strings, parsed results, promises). When load stops, Mark-Compact reclaims the transient objects and the heap returns to near-baseline. The ~12 MB retained above the pre-load baseline is LRU cache entries and V8 JIT compiled code, both expected and tunable.

GC is healthy and not a performance concern. The ~5% overhead with sub-millisecond minor pauses and 2–3 ms major pauses is well within acceptable bounds. The heap grows under load, reclaims after, with no signs of leaks or unbounded growth.

---

## **Conclusions**

**The idle heap contains ~15 MB of unused data.** The ethers ENS normalization tables (6.1 MB) and BIP39 wordlist (5.2 MB) are loaded at import time but never used by the relay. The pino logging transport allocates 4.2 MB of shared buffers and creates 2 worker threads (~10 MB) even when logging is silent. Eliminating these would reduce the idle process footprint from ~98 MB to ~73 MB.

**Under load, memory grows by ~30 MB and stabilizes.** The transient growth consists of gRPC buffers, JSON response bodies, parsed objects, promises, and closures — all inherent to transaction processing. The heap oscillates between 75–78 MB during sustained 120 RPS load with no upward trend.

**After load, garbage collection reclaims transient objects.** The heap returns to ~69 MB post-GC. The 21 MB retained above idle is LRU cache entries and JIT compiled code, both tunable.

**No memory leaks detected.** Three mid-load snapshots taken 45 seconds apart show stable oscillation.

**GC is not a bottleneck.** 4.9% overhead with 2–3 ms pauses during load.

---

## **Recommendations**

| Priority | Action                                                | Impact                                                                     | Effort             |
| -------- | ----------------------------------------------------- | -------------------------------------------------------------------------- | ------------------ |
| High     | Replace full `ethers` import with submodule imports   | Eliminates ~6–11 MB of unused ENS/BIP39 data from idle heap                | Code change        |
| High     | Disable pino transport thread when `LOG_LEVEL=silent` | Eliminates ~4 MB main heap + ~10 MB worker isolates                        | Code change        |
| Medium   | Use `--lite-mode` and `--optimize-for-size` V8 flags  | Reduces compiled code footprint by ~3–5 MB                                 | Config change      |
| Medium   | Reduce `CACHE_MAX` for memory-constrained deployments | Reduces retained heap after load                                           | Config change      |
| Low      | Remove lodash (only 2 call sites)                     | Eliminates ~500 KB of source text                                          | Code change        |
| Low      | Investigate periodic SDK client recreation            | Minor memory impact (~100 KB) but may indicate suboptimal connection reuse | Code investigation |
| Done     | Set `--max-old-space-size=192` for 256 Mi containers  | Prevents V8 from over-claiming heap                                        | Config change      |
| Done     | Disable worker threads (`WORKERS_POOL_ENABLED=false`) | Eliminates ~35 MB per worker thread                                        | Config change      |

---

## **Appendix: Methodology**

### **Tools**

| Tool                                           | Purpose                                                                                                                |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `--trace-gc` (Node.js flag)                    | GC event logging, type, timing, heap sizes before and after each collection                                            |
| `--heapsnapshot-signal=SIGUSR2` (Node.js flag) | On-demand V8 heap snapshot generation, triggered by sending SIGUSR2 to the process                                     |
| `--heap-prof` (Node.js flag)                   | Sampling heap allocation profiler with stack trace attribution                                                         |
| `tini` (container init process)                | Runs as PID 1 so that signals are properly delivered to Node.js (Linux suppresses certain signals for PID 1 processes) |
| Chrome DevTools Memory tab                     | Heap snapshot loading, comparison view, and retainer chain analysis                                                    |
| k6                                             | Load generation                                                                                                        |
| Solo                                           | Local single-node Hedera network                                                                                       |

### **Container Configuration**

```docker
ENTRYPOINT ["/sbin/tini", "--", "node", "--trace-gc", "--heapsnapshot-signal=SIGUSR2", "--env-file=/home/node/app/.env.release"]
```

### **Snapshot Capture**

```bash
# Find the Node.js process PID inside the container
NODE_PID=$(kubectl exec -n solo $RELAY_POD -- sh -c \
  'for p in /proc/[0-9]*; do cat $p/cmdline 2>/dev/null | tr "\0" " " | \
   grep -Eq "^node .*dist/index.js" && basename $p && break; done')

# Trigger a heap snapshot
kubectl exec -n solo $RELAY_POD -- sh -c "kill -s USR2 $NODE_PID"

# Copy the snapshot file to the host
kubectl cp solo/$RELAY_POD:/home/node/app/$SNAPSHOT_FILE ./$SNAPSHOT_FILE
```

Each heap snapshot pauses the event loop during creation and temporarily requires approximately 2x the current heap size in memory. The profiling container was sized at 512 Mi to accommodate this overhead.

### **How to View Snapshots**

1. Open Chrome and go to DevTools (Cmd+Option+I)
2. Navigate to the **Memory** tab
3. Click **Load** and select a `.heapsnapshot` file
4. Load a second snapshot, select it, change the view to **Comparison**, and set the base to the first snapshot
5. Sort by **Size Delta** descending to see the largest memory consumers
