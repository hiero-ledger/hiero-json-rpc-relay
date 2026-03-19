# Master Plan: Run the Relay in a 64 MB Pod at 100 TPS

## Context

Management has set a target of running the Hedera JSON-RPC Relay in a **64 MB container** while surviving **100 TPS** (`eth_sendRawTransaction`). This plan synthesizes all empirical findings from the GC trace analysis, heap snapshot analysis, and load testing to define a realistic strategy for reaching that goal — or the closest achievable point.

## What We Know (Empirically Proven)

### Memory Anatomy (from heap snapshots at 120 RPS, 256 Mi container)

- **Idle heap:** 47.8 MB (all loaded modules, service graph, V8 compiled code)
- **Peak heap under load:** 78.1 MB (+30.3 MB transient)
- **Post-GC settled:** 69.0 MB (+21 MB retained = LRU cache + JIT code)
- **No memory leaks** — 3 mid-load snapshots over 180s show stable oscillation (75–78 MB)
- **Node.js native memory (outside V8 heap):** ~37 MB (V8 engine, libuv, OpenSSL, ICU, thread stacks)
- **Total idle process footprint:** ~85 MB (48 MB heap + 37 MB native)

### Transient Peak Breakdown (+30 MB under load)

- V8 JIT compiled code: 7.3 MB
- gRPC binary buffers (consensus node): 6.4 MB
- JSON strings (mirror node responses): 4.6 MB
- Parsed contract results + state changes + logs: 2.9 MB
- Async coordination (promises, closures, timers): 1.2 MB
- Sliced strings (retain full JSON response bodies): 813 KB
- Everything else (arrays, SDK objects, numbers, zlib): ~7 MB

### GC Health (from --trace-gc at 120 RPS)

- GC overhead: 4.91% of wall time — healthy, not the bottleneck
- Mark-Compact pauses: 2–3 ms typical, max 17 ms (post-load only)
- V8 marking utilization: 0.99+ throughout

### Latency Bottleneck

- **~313 ms p95 is Mirror Node I/O**, not GC
- Standard `sendRawTransaction` makes 4+ sequential MN REST calls per request (gas price lookup, nonce validation, post-consensus polling)
- At 100 TPS with 313 ms p95, ~31 requests are in-flight concurrently, each holding gRPC buffers + JSON strings + promises

### The 9 Unexplained V8 Isolates

- 9 idle V8 isolates found at process boot, each ~6–8 MB, ~63 MB total
- Zero GC activity during load — completely dormant
- Likely from: pino-pretty worker thread, paymaster SDK clients, leaked gRPC channels on SDK client reset
- **This is the single biggest unexplored optimization opportunity**

---

## Phase 0: Understand the Idle Baseline (Why Is It ~40-50 MB?)

Before optimizing, we need to understand exactly what makes up the idle heap. The `90-rc.log` captures the full startup GC trace from the moment the pod starts until idle.

### What the GC Log Actually Shows (Facts)

**Main isolate (0xffff9b240000):**

- Heap grows continuously from 4.8 MB to 42.6 MB over the first 659 ms
- 5 Mark-Compact events during startup progressively compact the old space
- After the final Mark-Compact at t=659ms: **41.0 MB used / 45.9 MB allocated** — this is the true idle baseline
- From t=659ms onward, heap drifts slowly from 41.0 to 42.5 MB over ~1000 seconds (idle timers, periodic Scavenge every ~50s). Stable.

| Mark-Compact | Time   | Before → After     | What Got Cleaned                   |
| ------------ | ------ | ------------------ | ---------------------------------- |
| 1st          | 161 ms | 13.0 → **10.0 MB** | 3 MB transient import garbage      |
| 2nd          | 229 ms | 25.4 → **16.8 MB** | 8.6 MB transient (biggest cleanup) |
| 3rd          | 375 ms | 27.1 → **25.1 MB** | 2 MB                               |
| 4th          | 502 ms | 37.0 → **34.7 MB** | 2.3 MB                             |
| 5th          | 659 ms | 42.6 → **41.0 MB** | 1.6 MB                             |

Each Mark-Compact cleans less — meaning more of what's loaded is permanently retained. By the 5th GC, almost everything in the heap is long-lived.

**2 non-main isolates (0xffff8a820000 and 0xffff79a20000):**

- Both boot at t=7ms (within the same process)
- Both grow to ~6.5 MB, then Mark-Compact (reduce) at t=~8100ms settles them to **5.4 MB** and **5.2 MB**
- **We do not know what creates them.** `WORKERS_POOL_ENABLED=false` means Piscina should not be used. Candidates: pino transport thread, `thread-stream`, or something else. This needs investigation.
- Combined cost: **~10.6 MB of heap**, invisible to the main isolate's heap snapshots

### Phase 0 Results: What's in the Idle Heap (Completed)

Two profiling tools were used to answer this question:

- **`--heap-prof`** (Sampling Heap Profiler) — captured allocation stack traces during startup to identify which files/functions allocated the most memory
- **Idle heap snapshot in Summary view** — examined the retained objects in the idle heap grouped by constructor type, sorted by retained size

The idle heap snapshot (Summary view, sorted by Retained Size) provides the definitive breakdown:

| What                                    | Retained Size | Count   | What It Is                                                                                                                               |
| --------------------------------------- | ------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| (compiled code)                         | 21.6 MB (45%) | 101,762 | V8 compiled bytecode/machine code for every loaded function across all modules                                                           |
| (string)                                | 13.8 MB (29%) | 64,251  | Module source text retained by V8 (includes lodash source at 545 kB, gRPC modules, SDK modules)                                          |
| ethers ENS normalization tables         | 6.1 MB (13%)  | —       | Unicode lookup tables for ENS domain resolution (`ens_normalize`), loaded at import time even if never used                              |
| Set (BIP39 wordlist)                    | 5.2 MB (11%)  | 232     | Mnemonic seed phrase dictionary ("aback", "abbey", "dollar"...) from ethers.js, loaded at import time even if never used                 |
| Pino + ThreadStream + SharedArrayBuffer | 4.2 MB (9%)   | —       | Pino logging transport buffers including a 4.1 MB SharedArrayBuffer for worker thread communication, active even with `LOG_LEVEL=silent` |
| SDK protobuf definitions                | 1–2 MB        | —       | `@hashgraph/proto` type definitions, enum mappings, namespace objects                                                                    |
| Prometheus metrics                      | ~624 kB       | —       | Registry, histograms, counters, gauges                                                                                                   |
| Other (closures, arrays, objects, maps) | ~5–6 MB       | —       | Service graph, configuration, constants, HTTP agent pools                                                                                |

Note: Retained sizes overlap (compiled code for ENS modules is counted in both "compiled code" and the ENS module's retained size), so columns do not sum to 48 MB.

### Key Finding: ~15 MB of the idle heap is loaded but never used

- **ethers.js ENS + BIP39 (~11 MB):** The relay imports the full `ethers` package, which eagerly loads ENS normalization tables (6.1 MB) and BIP39 mnemonic wordlists (5.2 MB). The relay does not resolve ENS names or generate mnemonics. These are pure overhead from importing the full package instead of only the submodules needed (ABI encoding, transaction parsing, etc.). **Needs verification:** grep codebase for ENS/BIP39 usage before confirming removal is safe.

- **Pino transport overhead (~4.2 MB main heap + ~10.6 MB worker isolates):** Pino creates a ThreadStream worker thread with a 4.1 MB SharedArrayBuffer even when `LOG_LEVEL=silent`. This also accounts for the 2 mystery worker isolates identified in the GC trace (each ~5.2–5.4 MB, invisible to the main heap snapshot). **Needs verification:** test that disabling the transport thread does not break error logging.

### Revised Container Sizing

After ethers + pino optimizations (measured):
- Idle heap: 40.0 MB → **37.9 MB** (saved 2.1 MB from ethers submodule imports)
- Worker isolates: 10.6 MB → **0 MB** (eliminated by pino fixes)
- **Total process: ~90 MB → ~78 MB (saved ~12.7 MB)**
- **Minimum pod to start: ~82 Mi with `--max-old-space-size=42`** (was 96 Mi with old=50)

---

## Container Sizing Assessment

With the current codebase (no changes):

```
48 MB idle heap + ~40 MB native memory = ~88 MB minimum to start
```

With ethers and pino optimizations (Phase 1 code changes):

```
~28–33 MB idle heap + ~40 MB native memory = ~68–73 MB minimum to start
(plus ~10 MB saved from eliminating pino worker isolates)
```

**Realistic targets (updated based on Phase 0 findings):**

- **96 MB** — achievable with configuration changes only
- **80 MB** — achievable with ethers submodule imports + pino transport fix
- **64 MB** — potentially achievable if ethers and pino optimizations deliver expected savings, combined with V8 flags and cache tuning. Requires verification.

---

## Phase 1: High-Impact Optimizations (Target: 80 MB)

Based on Phase 0 findings, these are the highest-value changes ranked by expected savings.

### 1A. Replace full ethers import with submodule imports (DONE)

- Created a wrapper module (`lib/ethers.ts`) that imports from `ethers/transaction` and `ethers/crypto` submodules instead of the full `ethers` package
- Replaced `randomBytes`/`uuidV4` with native `crypto.randomUUID()`, `ethers.ZeroAddress` with existing `constants.ZERO_ADDRESS_HEX`
- Confirmed ENS normalization tables and BIP39 wordlists are no longer loaded at runtime
- Ethers files loaded reduced from 159 to 61 (62% reduction)
- **Measured savings: ~2.2 MB heap** (40.0 MB to 37.8 MB idle)
- Note: Original estimate of 6-11 MB was based on retained sizes from heap snapshot which double-count memory shared with V8 compiled code and source strings. Actual unique savings are ~2.2 MB.

### 1B. Eliminate pino worker threads (DONE)

- Traced worker thread creation to 2 sources: config-service's hardcoded pino-pretty logger and @hashgraph/sdk's Logger class
- config-service fix: made pino-pretty transport conditional on `PRETTY_LOGS_ENABLED`, added early dotenv loading so `LOG_LEVEL` is respected
- SDK fix: pass `/dev/null` as logFile to `HederaLogger` to avoid pino-pretty transport (internal logger is immediately replaced by `setLogger()`)
- **Measured savings: 0 MB main heap change, ~10.6 MB worker isolates eliminated (2 V8 isolates removed)**
- Note: main heap did not shrink because the SharedArrayBuffer/ThreadStream data lived in the worker isolates, not the main heap

### 1C. V8 memory flags

- `--lite-mode` disables TurboFan JIT optimizations, reducing the 21.6 MB compiled code footprint
- `--optimize-for-size` trades CPU performance for tighter V8 internal structures
- **Expected savings: 3–5 MB from reduced compiled code**

### 1D. Cache reduction

- Set `CACHE_MAX=50` (from 1000), `CACHE_TTL=30000` (30s, from 1 hour)
- Reduces retained cache entries under load (not significant at idle, but prevents growth under traffic)
- **Expected savings: 5–10 MB retained heap under load**

### 1E. Reduce Mirror Node socket pool

- Set `MIRROR_NODE_HTTP_MAX_SOCKETS=10` (from 300)
- **Expected savings: 1–3 MB native memory**

### Phase 1 Expected Result

- Original idle: ~40 MB heap + ~40 MB native + ~10 MB worker isolates = ~90 MB total
- After ethers fix (done): heap drops ~2.2 MB → **37.8 MB heap**
- After pino fix (done): worker isolates eliminated → **0 MB worker overhead**
- **Current idle: ~38 MB heap + ~40 MB native = ~78 MB total (was ~90 MB)**
- After V8 flags: heap drops ~3–5 MB → needs measurement
- **Current minimum pod to start: ~90 Mi with old=48 (was 96 Mi with old=50)**

### Phase 1 Verification

```bash
make build-local-relay

# Step 1: Verify startup at 80 Mi
make run-relay local mem_limit=80 old=35

# Step 2: If stable, tighten further
make run-relay local mem_limit=72 old=30

# Step 3: Measure idle + load
make report
cd k6 && npm run cn-benchmark  # with TARGET_RPS=100
make report
```

---

## Phase 2: Additional Code Optimizations (Target: 64 MB)

### 2A. Remove lodash

- Only 2 uses in the relay core: `_.isNil()` and `_.last()`
- Replace with native: `value == null` and `array[array.length - 1]`
- Lodash source text alone is 545 kB in the heap
- **Expected savings: ~500 kB heap**

### 2B. Lazy-load unused namespaces

- `DebugImpl` and `TxPoolImpl` are always instantiated even if disabled via config
- Skip their initialization when not needed to avoid loading their import chains
- **Expected savings: 1–2 MB**

### 2C. Minimal metrics mode

- Skip `collectDefaultMetrics()` and worker pool metrics when not needed
- **Expected savings: ~624 kB**

### 2D. Investigate SDK client lifecycle

- In `hapiService.ts`, `resetClient()` replaces `this.client` without calling `client.close()` on the old instance
- This may leak gRPC channels over time
- **Fix:** Call `this.client.close()` before reassignment
- **Expected savings: prevents memory growth over time**

### Phase 2 Expected Result

- Starting from Phase 1 result (~68–75 MB total)
- Additional savings: ~2–4 MB
- **Expected idle: ~64–71 MB total → approaching 64 Mi**

---

## Phase 3: Architecture Changes (if needed)

If Phase 1 and 2 do not reach 64 MB:

### 3A. External Redis cache

- Move all caching to Redis sidecar, eliminate in-process LRU cache
- **Expected savings: 5–10 MB retained heap under load**

### 3B. SDK-lite or consensus node sidecar

- Replace full `@hashgraph/sdk` with a minimal gRPC client using only needed protobuf definitions
- Or move consensus node communication to a lightweight sidecar process
- **Expected savings: 10–15 MB heap from reduced module loading**

---

## Strategy for the 100 TPS Target

The 100 TPS target and the 64 MB target interact. In standard mode at 100 TPS with ~313 ms p95, approximately 31 requests are in-flight concurrently. Each holds gRPC buffers, JSON response strings, parsed objects, and promise chains. This transient overhead (~30 MB observed at 120 RPS) is the inherent cost of the `sendRawTransaction` code path and its sequential Mirror Node REST calls.

Reducing transient memory at 100 TPS requires reducing per-request overhead — primarily by optimizing the Mirror Node interaction pattern (batching, parallelizing, or reducing the number of REST calls in the standard path). This is a code-level optimization in `TransactionService.ts`.

---

## Implementation Sequence

| Step | What                                              | Type   | Est. Savings                  | Target    |
| ---- | ------------------------------------------------- | ------ | ----------------------------- | --------- |
| 1    | Replace full ethers import with submodule imports | Code   | **2.2 MB (done)**             |           |
| 2    | Eliminate pino ThreadStream in silent mode        | Code   | **~10.6 MB workers (done)**   |           |
| 3    | V8: --lite-mode --optimize-for-size               | Config | 3–5 MB                        |           |
| 4    | Cache: CACHE_MAX=50, TTL=30s                      | Config | 5–10 MB under load            |           |
| 5    | MN sockets: 10                                    | Config | 1–3 MB native                 |           |
|      | **Measure → expect ~68-75 MB total**              |        |                               | **80 Mi** |
| 6    | Remove lodash                                     | Code   | ~500 KB                       |           |
| 7    | Lazy-load debug/txpool namespaces                 | Code   | 1–2 MB                        |           |
| 8    | Minimal metrics mode                              | Code   | ~624 KB                       |           |
| 9    | Fix SDK client lifecycle (resetClient)            | Code   | prevents growth               |           |
|      | **Measure → expect ~64-71 MB total**              |        |                               | **64 Mi** |
| 10   | Redis external cache (if needed)                  | Arch   | 5–10 MB                       |           |
| 11   | SDK-lite (if needed)                              | Arch   | 10–15 MB                      |           |

---

## Next Immediate Steps

1. Grep relay codebase for ENS and BIP39 usage to confirm ethers submodule replacement is safe
2. Implement ethers submodule imports — highest single-item savings (~6–11 MB)
3. Implement pino transport fix for silent mode — second highest savings (~15 MB total)
4. Build, deploy at 80 Mi, and measure idle heap + 100 TPS load
5. If 80 Mi passes, tighten toward 64 Mi with Phase 2 changes

---

## Related Documents

- **[memory-allocation-analysis.md](./memory-allocation-analysis.md)** — Full empirical analysis with heap snapshot data, GC trace results, and detailed object breakdowns
- **[gc-trace-findings.md](./gc-trace-findings.md)** — Raw GC trace analysis from --trace-gc profiling runs
- **[experiment-log.md](./experiment-log.md)** — Running log of measurements, observations, container sizing math, and config changes
