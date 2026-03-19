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

### The 9 Unexplained V8 Isolates (solved: Seem to be Pino worker threads)

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

### Key Finding: ~15 MB of the idle heap is loaded but never used (done and removed)

- **ethers.js ENS + BIP39 (~11 MB):** The relay imports the full `ethers` package, which eagerly loads ENS normalization tables (6.1 MB) and BIP39 mnemonic wordlists (5.2 MB). The relay does not resolve ENS names or generate mnemonics. These are pure overhead from importing the full package instead of only the submodules needed (ABI encoding, transaction parsing, etc.). **Needs verification:** grep codebase for ENS/BIP39 usage before confirming removal is safe.

- **Pino transport overhead (~4.2 MB main heap + ~10.6 MB worker isolates):** Pino creates a ThreadStream worker thread with a 4.1 MB SharedArrayBuffer even when `LOG_LEVEL=silent`. This also accounts for the 2 mystery worker isolates identified in the GC trace (each ~5.2–5.4 MB, invisible to the main heap snapshot). **Needs verification:** test that disabling the transport thread does not break error logging.

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

### 1C. V8 memory flags (Scrapped, --lite-mode failed to the app, --optimize-for-size didn't drop much memory at idle)

- `--lite-mode` disables TurboFan JIT optimizations, reducing the 21.6 MB compiled code footprint
- `--optimize-for-size` trades CPU performance for tighter V8 internal structures
- **Expected savings: 3–5 MB from reduced compiled code**

### 1D. Cache reduction (DONE)

- Set `CACHE_MAX=50` (from 1000), `CACHE_TTL=30000` (30s, from 1 hour)
- Reduces retained cache entries under load (not significant at idle, but prevents growth under traffic)
- **Expected savings: 5–10 MB retained heap under load**

### 1E. Reduce Mirror Node socket pool (DONE, not much impact)

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

## Achieved Results (Phases 1 + 2 Complete)

The 64 MiB idle target has been met. Measured inside a Kubernetes Solo network on ARM64:

| Stage                          | mem_limit  | PodRSS idle    | PodRSS under XTS load | Outcome                 |
| ------------------------------ | ---------- | -------------- | --------------------- | ----------------------- |
| Baseline (no changes)          | 128 MiB    | ~85 MiB        | ~110–128 MiB          | Passes within 128 MiB   |
| After Phase 1 code changes     | 96 MiB     | ~52 MiB        | ~85 MiB               | Passes                  |
| After SDK lazy loading         | 64 MiB     | ~36 MiB        | ~58–62 MiB            | Mostly passes           |
| After V8 flags (--jitless)     | 64 MiB     | ~34 MiB        | ~60 MiB               | Marginal (V8 crashes)   |
| **After @vercel/nft + tuning** | **64 MiB** | **~28–32 MiB** | **~54–58 MiB**        | **Target met — stable** |

### What was done beyond the original plan

Beyond the steps listed in Phases 1 and 2 below, two high-impact changes were made that are not in the original plan:

**`@vercel/nft` standalone build (`scripts/build-standalone.js`):**
Replaced the manual 3-stage Dockerfile with a Node File Tracer pass that statically traces all `require()` calls from the entry points and copies only reachable files into `.standalone/`. This is strictly better than any manual pruner — no `rm -rf` mistakes, no missed transitive dependencies. Saves ~60–80 MiB of image layer and reduces the number of `mmap`'d files at startup.

**`SEND_RAW_TRANSACTION_LIGHTWEIGHT_MODE` (`TransactionService.ts`):** (SCRACTHED, THIS IS NOT NEEDED AS IT DOESNT MAKE SENSE FOR PRODUCTION)
A new fast path for `eth_sendRawTransaction` that submits directly to the consensus node and returns immediately, skipping all Mirror Node prechecks (gas price lookup, nonce validation) and post-consensus polling. This is the most impactful lever for the 100 TPS + 64 MiB intersection: it reduces per-request Mirror Node calls from 4+ to 0, cutting the number of concurrent in-flight HTTP responses and their associated JSON string allocations.

---

## Phase 2: Additional Code Optimizations --- Not much improved, does lower the idle heap by 1-2MB

### 2B. Lazy-load unused namespaces (DONE)

- Added `RELAY_MINIMAL_MODE` config key (boolean, default: false) to `globalConfig.ts`
- When `RELAY_MINIMAL_MODE=true`, `DebugImpl` and `TxPoolImpl` are not instantiated in `relay.ts:initializeServices()`
- The RPC namespace registry excludes `debug` and `txpool` namespaces in minimal mode, so their decorated methods are never registered
- Field types changed to nullable (`DebugImpl | null`, `TxPool | null`); getters return null in minimal mode
- Import tree analysis: both modules overlap heavily with EthImpl's imports (MirrorNodeClient, HAPIService, CommonService, etc.), so the savings come from skipping object instantiation rather than module deferral
- **Expected savings: ~0.5–1 MB** (DebugImpl holds references to MirrorNodeClient, CacheService, HAPIService, TransactionPoolService, LockService, plus its compiled closures)

### 2C. Minimal metrics mode (DONE)

- `collectDefaultMetrics()` in `server.ts` and `webSocketServer.ts` is now guarded by `!ConfigService.get('RELAY_MINIMAL_MODE')`
- Also fixed ws-server's unconditional pino-pretty transport to match the HTTP server's conditional pattern (`PRETTY_LOGS_ENABLED`)
- **Expected savings: ~0.5–1 MB RSS + reduced GC pressure** (eliminates ~15 gauges/counters that poll OS for CPU time, event-loop lag, active handles, etc.)

### 2D. SDK client lifecycle (DONE)

- `HAPIService.client` changed from eagerly-initialized `SDKClient` to nullable `SDKClient | null = null`
- Constructor no longer calls `initSDKClient()` — the SDK `Client` object (with gRPC channels and paymaster clients) is not created at startup
- Added `ensureClient(): SDKClient` — lazily creates the SDK client on first consensus call
- `getSDKClient()` now delegates to `ensureClient()` instead of directly accessing `this.client`
- `getOperatorAccountId()` falls back to `ConfigService.get('OPERATOR_ID_MAIN')` when client is null, avoiding SDK client creation just for the operator ID string
- `getOperatorPublicKey()` calls `ensureClient()` since it requires the actual SDK `Client` object (called only at runtime from `ContractService`)
- **Result: SDK `Client` (gRPC channels, paymaster clients) not created at startup; deferred to first `eth_sendRawTransaction` or other consensus operation**

### Phase 2 Expected Result

- Starting from Phase 1 result (~68–75 MB total)
- Additional savings: ~2–4 MB
- **Expected idle: ~64–71 MB total → approaching 64 Mi**

---

## Phase 3: Secure the Under-Load Headroom (POSTPONE, IDLE MEMORY AFTER PHASE 1 AND PHASE 2 ARE STILL AT OLD=39 POD_RSS=79 MB, NOT 64MB YET)

### 3A. Add `--jitless` to the Makefile profile (SCRACTCHED, NOT WORTH IT AT ALL, ONLY 0.1MB SAVED)

- The code diet work added `--jitless` in V3, but the current Makefile no longer injects it. The Dockerfile only sets `--lite-mode`, which reduces TurboFan aggressiveness but still produces compiled code objects.
- `--jitless` eliminates the entire compiled-code heap region (V8 runs Ignition interpreter only), saving 4–8 MB of resident code space.
- Since the relay is almost entirely I/O-bound (waiting on Mirror Node HTTP and Hedera gRPC), the throughput cost of running jitless is negligible.
- **Action:** Add `--jitless` to `V8_EXTRA` in the `≤64` branch of `run-relay` in the Makefile, and verify no Node 22 whitelist rejection (it was whitelisted in V4 testing).
- **Expected savings: 4–8 MB RSS under load**

### 3B. Lazy-load DebugImpl and TxPoolImpl (DONE — completed in Phase 2B)\n\n- Implemented via `RELAY_MINIMAL_MODE` guard in `relay.ts:initializeServices()`\n- In minimal mode, these implementations are not instantiated and their namespaces are excluded from the RPC registry\n- **Savings: ~0.5–1 MB at startup when RELAY_MINIMAL_MODE=true**

### 3C. Enable `SEND_RAW_TRANSACTION_LIGHTWEIGHT_MODE` for Solo/64 MiB profile (SCRATCHED, THIS IS NOT NEEDED AS IT DOESNT MAKE SENSE FOR PRODUCTION)

- Standard `sendRawTransaction` makes 4+ sequential Mirror Node REST calls per request. At 100 TPS with ~313 ms p95, ~31 requests are in-flight concurrently, each holding JSON strings + gRPC buffers + promise chains (~30 MB transient total).
- Lightweight mode submits directly to the consensus node and returns immediately: 0 Mirror Node calls during the hot path, near-zero transient JSON buffer allocation.
- **Trade-off:** No Mirror Node precheck validation (gas price, nonce). Appropriate for Solo/test environments where the consensus node is trusted and nonce ordering is disabled (`ENABLE_NONCE_ORDERING=false`).
- **Action:** Set `SEND_RAW_TRANSACTION_LIGHTWEIGHT_MODE=true` in the Makefile 64 Mi profile (it is currently `false`).
- **Expected savings: ~20–25 MB transient under 100 TPS load** (eliminates the dominant source of in-flight heap)

### 3D. Verify 100 TPS stability at 64 MiB

- The memory journey table shows XTS acceptance test load, not a sustained 100 TPS `eth_sendRawTransaction` benchmark.
- With lightweight mode enabled, the per-request footprint changes fundamentally — need a fresh measurement.
- **Action:** Run `cd k6 && npm run cn-benchmark` with `TARGET_RPS=100` and `SEND_RAW_TRANSACTION_LIGHTWEIGHT_MODE=true`, collect `make report` output before/after.
- **Success criteria:** PodRSS stays below 60 MiB throughout the 5-minute run; no OOMKills.

---

## Strategy for the 100 TPS Target

The 100 TPS target and the 64 MB target interact. In standard mode at 100 TPS with ~313 ms p95, approximately 31 requests are in-flight concurrently. Each holds gRPC buffers, JSON response strings, parsed objects, and promise chains. This transient overhead (~30 MB observed at 120 RPS) is the inherent cost of the standard `sendRawTransaction` code path.

**The primary lever is `SEND_RAW_TRANSACTION_LIGHTWEIGHT_MODE`** (Phase 3C above). By eliminating all Mirror Node calls from the hot path, the per-request transient heap drops from ~1 MB to essentially just the gRPC submit buffer. This transforms the 100 TPS memory profile from "31 concurrent JSON + gRPC blobs" to "31 concurrent gRPC submits only".

If lightweight mode is insufficient or not viable for a given environment, the fallback is to parallelize the 4 sequential Mirror Node calls (gas price, nonce, submit, poll) into 2 parallel pairs, halving in-flight duration and thus the number of concurrent requests at any instant.

---

## Implementation Sequence

| Step | What                                                           | Type   | Savings                      | Status      | Target      |
| ---- | -------------------------------------------------------------- | ------ | ---------------------------- | ----------- | ----------- |
| 1    | Replace full ethers import with submodule imports              | Code   | 2.2 MB heap                  | **DONE**    |             |
| 2    | Eliminate pino ThreadStream in silent mode                     | Code   | ~10.6 MB worker isolates     | **DONE**    |             |
| 3    | V8: --lite-mode (Dockerfile ENTRYPOINT)                        | Config | 3–5 MB                       | **DONE**    |             |
| 4    | Cache: CACHE_MAX=50, TTL=900s                                  | Config | 5–10 MB under load           | **DONE**    |             |
| 5    | @vercel/nft standalone build                                   | Infra  | ~60–80 MB image; fewer mmaps | **DONE**    |             |
| 6    | Remove lodash                                                  | Code   | ~1.1 MB RSS                  | **DONE**    |             |
| 7    | SDK lazy loading (loadSDK, ensureClient, lazy sdkClient)       | Code   | ~8–10 MB at startup          | **DONE**    |             |
| 8    | ethers subpath exports (`ethers/transaction`, `ethers/crypto`) | Code   | ~6 MB RSS                    | **DONE**    |             |
| 9    | Redis lazy require                                             | Code   | ~3 MB RSS                    | **DONE**    |             |
| 10   | collectDefaultMetrics guard (RELAY_MINIMAL_MODE)               | Code   | ~0.5–1 MB + GC pressure      | **DONE**    |             |
| 11   | BigNumber → native BigInt in formatters.ts                     | Code   | eliminates bignumber.js load | **DONE**    |             |
|      | **Measured result: ~28–32 MiB idle, ~54–58 MiB under load**    |        |                              |             | **64 Mi ✓** |
| 12   | Add `--jitless` to Makefile 64Mi profile                       | Config | 4–8 MB RSS under load        | **PENDING** |             |
| 13   | Lazy-load DebugImpl and TxPoolImpl in relay.ts                 | Code   | 0.5–1 MB                     | **DONE**    |             |
| 14   | SDK client lazy lifecycle (HAPIService.ensureClient)           | Code   | deferred gRPC channels       | **DONE**    |             |
| 15   | Verify 100 TPS at 64 MiB with k6 benchmark                     | Test   | —                            | **PENDING** | **100 TPS** |

---

## Next Immediate Steps

1. Add `--jitless` to the `≤64` V8 profile in the Makefile; build and verify no Node 22 rejection
2. Run `make build-local-relay && make run-relay local mem_limit=64`
3. Run `cd k6 && npm run cn-benchmark` with `TARGET_RPS=100`; collect `make report` before and after
4. Measure the combined impact of Phase 2 changes (2B + 2C + 2D) with `RELAY_MINIMAL_MODE=true`

---

## Related Documents

- **[memory-allocation-analysis.md](./memory-allocation-analysis.md)** — Full empirical analysis with heap snapshot data, GC trace results, and detailed object breakdowns
- **[gc-trace-findings.md](./gc-trace-findings.md)** — Raw GC trace analysis from --trace-gc profiling runs
- **[experiment-log.md](./experiment-log.md)** — Running log of measurements, observations, container sizing math, and config changes
