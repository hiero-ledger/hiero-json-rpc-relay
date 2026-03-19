# Experiment Log

Running log of measurements, observations, and results from memory optimization work on the Hedera JSON-RPC Relay.

---

## Container Sizing Progress

### Idle (startup, no traffic)

| State                          | Main Heap | Workers | Native | Total RSS | Pod Limit | old-space | Change   |
| ------------------------------ | --------- | ------- | ------ | --------- | --------- | --------- | -------- |
| **Original** (no changes)      | 40.0 MB   | 10.6 MB | ~40 MB | ~90.6 MB  | 96 Mi     | 50        | baseline |
| **+ Ethers submodule imports** | 37.8 MB   | 10.6 MB | ~40 MB | ~88.4 MB  | 90 Mi     | 48        | -2.2 MB  |
| **+ Pino worker elimination**  | 37.9 MB   | 0 MB    | ~40 MB | ~77.9 MB  | 82 Mi     | 42        | -10.5 MB |

### Under load (120 RPS, 30 VUs, 30s, standard mode)

| State                     | Peak Heap | Workers | Native | Total RSS | Pod Limit | old-space | Change (Pod Limit) |
| ------------------------- | --------- | ------- | ------ | --------- | --------- | --------- | ------------------ |
| **Original** (no changes) | ~84 MB    | 10.6 MB | ~40 MB | ~134 MB   | 128 Mi    | 84        | baseline           |
| **+ Ethers + Pino**       | ~63 MB    | 0 MB    | ~40 MB | ~103 MB   | 102 Mi    | 63-66     | -26 MB             |

**Cumulative idle savings from baseline: ~12.7 MB (~14% reduction)**
**Cumulative load savings from baseline: ~31 MB (~23% reduction)**

---

## 2026-03-17: Heap Snapshot Analysis (256 Mi, old=192, 120 RPS, 180s)

**Config:** `mem_limit=256`, `old=192`, `WORKERS_POOL_ENABLED=false`, `LOG_LEVEL=silent`, standard mode (LIGHTWEIGHT_MODE=false)

**Snapshot Results:**

| Snapshot            | Heap Size |
| ------------------- | --------- |
| Idle                | 47.8 MB   |
| Mid-Load 1 (t=45s)  | 78.1 MB   |
| Mid-Load 2 (t=90s)  | 75.3 MB   |
| Mid-Load 3 (t=135s) | 77.8 MB   |
| Post-Load (pre-GC)  | 73.8 MB   |
| Post-Load (post-GC) | 69.0 MB   |

**Key observations:**

- No memory leaks — heap oscillates 75–78 MB under sustained load
- Transient peak: +30.3 MB above idle (gRPC buffers, JSON strings, parsed objects, promises)
- Retained after GC: +21 MB above idle (LRU cache entries + JIT code)
- Full breakdown documented in `memory-allocation-analysis.md`

---

## 2026-03-17: GC Trace Analysis (256 Mi, old=192, 120 RPS, 10s)

**Config:** Same as above but 10-second load test with `--trace-gc`

**Results:**

| Metric             | Value                        |
| ------------------ | ---------------------------- |
| GC overhead        | 4.91% of wall time           |
| Mark-Compact pause | 2–3 ms typical, max 17 ms    |
| Heap idle          | 55 MB used / 66 MB allocated |
| Heap peak          | 81 MB used / 86 MB allocated |
| Heap after GC      | 56 MB used / 62 MB allocated |

**Key observations:**

- GC is healthy — not the bottleneck
- ~313 ms p95 latency is Mirror Node I/O, not GC pauses
- 9 unexplained V8 isolates at boot (~6–8 MB each, ~63 MB total, completely idle during load)

---

## 2026-03-17: Container Sizing Math (from GC monitoring)

From live GC monitoring during load tests, observed heap behavior:

| State               | Heap Used | Heap Allocated |
| ------------------- | --------- | -------------- |
| Idle (just started) | ~44–50 MB | ~50–55 MB      |
| Peak under load     | ~78–81 MB | ~84–86 MB      |
| After GC cleanup    | ~55–56 MB | ~62 MB         |

**Minimum container sizing formula:**

```
Container limit = V8 heap allocated (peak) + Native memory overhead

Native memory overhead ≈ 37–40 MB (V8 engine, libuv, OpenSSL, ICU, thread stacks)
```

**For sustained load (120 RPS, standard mode):**

- Peak heap allocated: ~84 MB
- Native overhead: ~40 MB
- Minimum container: **~124 MB** (comfortably fits 128 Mi)
- `--max-old-space-size=84` would cap V8 at observed peak

**For idle / just to start the pod:**

- Idle heap allocated: ~50 MB
- Native overhead: ~40 MB
- Minimum container: **~90 MB** (fits 96 Mi)
- `--max-old-space-size=50` would allow startup

**Note:** These numbers are with `CACHE_MAX=1000` (default), `WORKERS_POOL_ENABLED=false`, standard mode. Reducing cache and enabling LIGHTWEIGHT_MODE would lower the peak significantly.

---

## 2026-03-17: Dockerfile Changes

- Added `tini` as PID 1 init process (required for SIGUSR2 signal delivery for heap snapshots)
- Added `--heapsnapshot-signal=SIGUSR2` to ENTRYPOINT
- Added `chown node:node /home/node/app` for write permission (heap snapshot files)
- Kept `--trace-gc` for ongoing monitoring

---

## 2026-03-17: Makefile Changes

- Added `CACHE_MAX: "50"` and `CACHE_TTL: "900"` to relay config in `run-relay` target
- Fixed `extract-heap-snapshots` target to look in `/home/node/app/` (CWD) instead of `/home/node/app/packages/server/`

---

## 2026-03-18: Ethers Submodule Optimization (Phase 1A)

**Change:** Replaced all `import ... from 'ethers'` in production code with selective submodule imports via a wrapper module (`packages/relay/src/lib/ethers.ts`). The wrapper uses `require('ethers/transaction')` and `require('ethers/crypto')` at runtime, avoiding the full ethers package load. Also replaced `randomBytes`/`uuidV4` from ethers with native `crypto.randomUUID()`, and `ethers.ZeroAddress` with the existing `constants.ZERO_ADDRESS_HEX`.

**Files changed:** 9 production files + 1 new wrapper module + tsconfig.json (no changes to test files)

**Verification:**

- Confirmed `require('ethers')` does NOT appear in any compiled output
- Confirmed ENS modules, BIP39/wallet modules, and hash modules are NOT loaded at runtime
- ethers files loaded: 61 (down from 159 with full package, 62% reduction)

**Measured result (from GC trace comparison):**

| Metric                             | Before (90-rc.log) | After (ethers-improved-gc-tracing.log) | Delta       |
| ---------------------------------- | ------------------ | -------------------------------------- | ----------- |
| Main isolate idle heap (used)      | 40.0 MB            | 37.8 MB                                | **-2.2 MB** |
| Main isolate idle heap (allocated) | 44.1 MB            | 41.9 MB                                | **-2.2 MB** |

**Isolated measurement:**

- `require('ethers')` heap cost: 4.74 MB
- `require('ethers/transaction') + require('ethers/crypto')` heap cost: 2.21 MB
- Difference: 2.53 MB

**Why less than expected:** The heap snapshot had shown ENS tables at 6.1 MB and BIP39 at 5.2 MB retained size. However, retained sizes in heap snapshots overlap with V8 compiled code and source strings shared across modules. The actual unique memory saved by not loading ENS/BIP39 is ~2.5 MB, not 11 MB. The retained size numbers were misleading due to double-counting.

**Updated container sizing:**

- Idle heap: ~38 MB (was ~40 MB)
- Minimum to start pod: ~90 Mi with `--max-old-space-size=48` (was 96 Mi with old=50)
- Still 2 worker thread isolates present (~10 MB), unchanged by this optimization

---

## 2026-03-18: Pino Worker Thread Elimination (Phase 1B)

**Root cause investigation:** Used `worker_threads.Worker` monkey-patching to trace worker thread creation during relay startup. Found 2 sources:

1. **config-service** (`packages/config-service/src/services/index.ts`) — Creates a pino logger at module load time with hardcoded `transport: { target: 'pino-pretty' }`. This unconditionally spawns a pino-pretty worker thread regardless of `PRETTY_LOGS_ENABLED` or `LOG_LEVEL` settings.

2. **@hashgraph/sdk Logger** — Created during `SDKClient.createNewOperatorClient()` via `new HederaLogger(level)`. The SDK Logger uses `pino-pretty` transport when no logFile is specified, even with `level: 'silent'`. The relay immediately replaces the SDK's internal pino with its own logger via `setLogger()`, but the worker is already created.

**Changes:**

1. `config-service/src/services/index.ts`:
   - Load `.env` via dotenv before creating the logger (so `LOG_LEVEL` and `PRETTY_LOGS_ENABLED` are available)
   - Made pino-pretty transport conditional on `process.env.PRETTY_LOGS_ENABLED !== 'false'`
   - Added `level: process.env.LOG_LEVEL || 'info'` to respect log level from env

2. `relay/src/lib/clients/sdkClient.ts`:
   - Changed `new HederaLogger(level)` to `new HederaLogger(level, '/dev/null')`
   - Passing `/dev/null` as logFile makes the SDK use `pino.destination()` instead of `pino-pretty` transport, avoiding the worker thread
   - The internal pino instance is immediately replaced by `setLogger()` anyway, so `/dev/null` is never written to

**Verification:**

- With `PRETTY_LOGS_ENABLED=false`: config-service creates 0 workers (was 1)
- With `/dev/null` logFile: SDK Logger creates 0 workers (was 1)
- Combined: total worker threads reduced from 2 to 0

**Measured result (from GC trace: pino-gc.log vs ethers-improved-gc-tracing.log):**

| Metric                 | Before (ethers fix only) | After (ethers + pino fixes) | Delta                   |
| ---------------------- | ------------------------ | --------------------------- | ----------------------- |
| V8 isolates            | 3 (main + 2 workers)     | **1 (main only)**           | -2 isolates             |
| Main isolate idle heap | 37.8 MB                  | 37.9 MB                     | ~0 (no change expected) |
| Worker isolate heap    | ~10.6 MB (5.4 + 5.2)     | **0 MB**                    | **-10.6 MB**            |
| Total process memory   | ~88.4 MB                 | **~77.9 MB**                | **-10.5 MB**            |

Main heap did not change because the SharedArrayBuffer and worker data lived in the worker isolates, not the main heap.

**Cumulative savings (ethers + pino combined):**

| Metric            | Original (90-rc.log) | Current (pino-gc.log) | Total Savings |
| ----------------- | -------------------- | --------------------- | ------------- |
| Main idle heap    | 40.0 MB              | 37.9 MB               | -2.1 MB       |
| Worker isolates   | ~10.6 MB             | 0 MB                  | -10.6 MB      |
| Native memory     | ~40 MB               | ~40 MB                | 0             |
| **Total process** | **~90.6 MB**         | **~77.9 MB**          | **-12.7 MB**  |

**Updated container sizing:**

- Idle heap: ~38 MB
- Minimum to start pod: **~82 Mi with `--max-old-space-size=42`** (was 90 Mi with old=48)
- Sustainable under 120 RPS 30 vus 30s (38 TPS): **~102 Mi with `--max-old-space-size=63 (very tight 66 is more comfortable)`** (was 124 Mi with old=84)
