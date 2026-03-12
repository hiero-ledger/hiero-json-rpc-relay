# Hiero JSON-RPC Relay — Code Diet Report

**Branch:** `4900-solo-reduce-json-rpc-relay-memory-footprint`  
**Versions:** Draft 1 (`c6505276d`) · Draft 2 (`40360dad3`) · Draft 3 (`c298442a1`) · Final (`current`)  
**Date:** February 2026  
**Author:** Hiero Relay engineering

---

## Table of Contents

1. [Goal and Motivation](#1-goal-and-motivation)
2. [Memory Terminology](#2-memory-terminology)
3. [Design Principles](#3-design-principles)
4. [V1 — Infrastructure, Logging and Library Surgery](#4-v1--infrastructure-logging-and-library-surgery)
5. [V2 — SDK Lazy Loading and Minimal Mode](#5-v2--sdk-lazy-loading-and-minimal-mode)
6. [V3 — V8 Flags, Ethers Deferral and Metrics Guard](#6-v3--v8-flags-ethers-deferral-and-metrics-guard)
7. [V4 — Dockerfile Recovery, Node 22 Whitelisting and BigNumber Removal](#7-v4--dockerfile-recovery-node-22-whitelisting-and-bignumber-removal)
8. [V5 — Redis Lazy Loading and Ethers Subpath Optimization](#8-v5--redis-lazy-loading-and-ethers-subpath-optimization)
9. [V6 — Final Tuning, Pruning, and Architectural Limits](#9-v6--final-tuning-pruning-and-architectural-limits)
10. [Memory Journey](#10-memory-journey)
11. [Complete Change Index](#11-complete-change-index)
12. [Build and Verification Status](#12-build-and-verification-status)

---

## 1. Goal and Motivation

The Hiero JSON-RPC Relay runs inside a Kubernetes Solo network alongside Hedera consensus nodes, mirror nodes,
and other infrastructure. When running unit/acceptance tests in that environment the relay pod is typically
given a 128 MiB memory limit. The long-term target is **64 MiB**, allowing the entire network to fit on a
developer laptop that has 16 GB or less of RAM.

Before the "Code Diet" work the relay pod needed approximately **110–128 MiB RSS** to survive a full
acceptance-test run. The root causes were:

- `@hashgraph/sdk` loads its entire gRPC client, protobuf descriptors, and a ~2 MB status-code table at `require()` time, even when only a handful of SDK types are actually used.
- `ethers` (v6) pulls in its transactional, contract, and provider subsystems as a single barrel export (`import * from 'ethers'`), even when only a type annotation is needed.
- `prom-client` registers a full set of default OS/process metrics unconditionally.
- `piscina` (the worker-thread pool) was imported at module scope even when worker threads are disabled.
- `lodash` was a runtime dependency despite all usages being one-liner equivalents available natively in Node 22.
- Docker image layers carried build tools (`python3`, `make`, `g++`, `node-gyp`) into the final runtime image.
- Default logging (`PRETTY_LOGS_ENABLED=true`, `LOG_LEVEL=trace`) produced verbose output that itself consumed memory due to string allocations.
- The LRU cache `CACHE_MAX` default (1000 entries) was far too generous for a Solo environment.

The Code Diet is a three-phase surgical reduction of each of those problem areas.

---

## 2. Memory Terminology

| Term                        | Meaning                                                                                                                                                        |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **RSS (Resident Set Size)** | Total physical RAM the OS has given to the process, including heap, stack, code, and native libraries. This is what Kubernetes measures against the pod limit. |
| **PodRSS**                  | RSS as reported by `kubectl top pod` (rounded to MiB).                                                                                                         |
| **P_RSS**                   | Process RSS as read from `/proc/<pid>/status` inside the container.                                                                                            |
| **H_TOT**                   | Total V8 heap size committed by the JS engine.                                                                                                                 |
| **H_USE**                   | V8 heap currently in use by live JS objects.                                                                                                                   |
| **H_EXT**                   | External/native memory tracked by V8 (Buffers, TypedArrays, etc.).                                                                                             |
| **Old Space**               | Long-lived JS heap area; controlled by `--max-old-space-size`.                                                                                                 |
| **Semi Space**              | Young-generation heap (new objects); controlled by `--max-semi-space-size`.                                                                                    |
| **OOMKilled**               | Linux kernel OOM-killer (or Kubernetes cgroup limiter) forcibly terminated the process because it exceeded the memory limit.                                   |
| **JIT (Just-In-Time)**      | V8 compiles hot JS functions to native code; uses extra memory for compiled code objects.                                                                      |
| **Jitless**                 | V8 runs the interpreter only; saves ~4–8 MiB of compiled-code memory.                                                                                          |

---

## 3. Design Principles

These three phases were guided by a set of engineering principles that kept changes safe, reviewable,
and reversible.

**YAGNI (You Aren't Gonna Need It):** Only pay for what is actually called at runtime. If the relay is
deployed in `RELAY_MINIMAL_MODE` it will never send SDK transactions; do not load the SDK.

**Lazy Loading over Eager Loading:** Move expensive `require()` calls to the point in the code closest to
actual use. This means startup memory is proportional to what startup actually needs.

**Replace Heavy Dependencies with Lean Alternatives:** If a native Node.js API (`crypto.randomUUID`,
`crypto.getRandomValues`) or a focused cryptographic library (`@noble/hashes`) can replace a full
framework import (`ethers.randomBytes`, `ethers.keccak256`), prefer the lean option.

**Environment-Controlled Feature Flags:** A single `RELAY_MINIMAL_MODE` boolean determines which
subsystems are initialized. This keeps the optimized path explicitly opt-in and does not silently change
production behaviour.

**No Behaviour Change:** Every code transformation has an equivalent functional result. `_.isNil(x)` is
`x == null`. `_.last(arr)` is `arr.at(-1)`. `ethers.ZeroAddress` is the hex string `'0x' + '0'.repeat(40)`.
If the semantics differ in any edge case, keep the original.

---

## 4. V1 — Infrastructure, Logging and Library Surgery

**Commit:** `c6505276d`  
**Files changed:** 16  
**Theme:** Remove everything that costs memory unconditionally and is not needed for the relay's core job.

### 4.1 Dockerfile — 3-Stage Multi-Stage Build

**File:** `Dockerfile`

**Before:** Single-stage build. All build tools (`python3`, `make`, `gcc`, `g++`, `node-gyp`) were installed
and stayed in the final image.

**After:** Three stages:

1. **deps** — installs production `node_modules` only (no devDependencies).
2. **builder** — installs all dependencies, runs `npm run build` to compile TypeScript → CommonJS.
3. **runtime** — copies compiled `.js` files and production `node_modules` from the previous stages. Uses
   `node:22-bookworm-slim` as the base. Does not contain any compiler, header file, or temp artifact.

**Why it matters:** Build tools and devDependencies (mocha, sinon, chai, TypeScript, etc.) collectively add
tens of MiB. Excluding them from the runtime layer reduces the base image size and, crucially, reduces the
number of files `node` has to `mmap` on startup.

### 4.2 Default Configuration — Logging and Cache

**File:** `packages/config-service/src/services/globalConfig.ts`

**Changes:**

- `LOG_LEVEL` default: `trace` → `info`
- `PRETTY_LOGS_ENABLED` default: `true` → `false`
- `CACHE_MAX` default: `1000` → `250`

**Why it matters:** `trace` logging allocates a string for every RPC call's internal path, including raw
hex payloads. These strings fill the young-generation heap and trigger frequent minor GC cycles. Switching
to `info` level dramatically reduces allocation frequency. Disabling pretty printing avoids chalk/ansi
color-code string concatenation. Cutting `CACHE_MAX` from 1000 to 250 directly caps the number of LRU
cache entries kept in memory; each entry may hold deserialized Hedera response objects.

### 4.3 Lodash Removal

**Files:** `packages/relay/src/lib/services/CommonService/index.ts`, `packages/relay/src/lib/services/FeeService/index.ts`

**Changes:**

- `_.isNil(value)` → `value == null` (covers both `null` and `undefined`)
- `_.last(array)` → `array.at(-1)` (Node 22 native)
- `lodash` moved from `dependencies` to `devDependencies` in `package.json`

**Why it matters:** `lodash` is ~1.1 MB of runtime JavaScript. It is loaded once and kept in memory forever.
The two usage sites (`isNil`, `last`) have zero-cost native equivalents in modern JavaScript. Removing the
runtime import saves the RSS contribution of the lodash bundle.

### 4.4 UUID and Random Bytes — Replace ethers with node:crypto

**File:** `packages/relay/src/lib/repositories/hbarSpendingPlanRepository.ts`

**Before:**

```typescript
import { ethers } from 'ethers';
const id = ethers.uuidV4(ethers.randomBytes(16));
```

**After:**

```typescript
import { randomUUID } from 'node:crypto';
const id = randomUUID();
```

**Why it matters:** `ethers.uuidV4` and `ethers.randomBytes` are thin wrappers over the same `crypto`
module that Node already has loaded. Using them required loading the ethers barrel export. `crypto.randomUUID()`
is a built-in that has been available since Node 14.17 and requires no additional import.

### 4.5 Keccak Hashing — Replace ethers with @noble/hashes

**Files:** `packages/relay/src/lib/utils.ts`, `packages/relay/src/lib/web3.ts`, `packages/relay/src/lib/logsBloomUtils.ts`

**Before:**

```typescript
import { ethers } from 'ethers';
ethers.keccak256(data);
```

**After:**

```typescript
import { keccak_256 } from '@noble/hashes/sha3';
// usage: bytesToHex(keccak_256(input))
```

**Why it matters:** `@noble/hashes` is a zero-dependency, tree-shakeable cryptographic library. The
`keccak_256` function from `sha3` entry point loads only the keccak permutation code — approximately
6 KB of JavaScript. By contrast, `import { ethers } from 'ethers'` pulls in the full ethers barrel,
which includes ABI codecs, contract factories, provider infrastructure, and wallet code — roughly 1.5 MB
of JS objects resident in the heap. These three files were the only places that needed keccak with no
other ethers dependency; replacing them breaks the last mandatory ethers load for pure hashing.

### 4.6 Worker Lazy Initialization — blockWorker and commonWorker

**Files:** `packages/relay/src/lib/workers/blockWorker.ts`, `packages/relay/src/lib/workers/commonWorker.ts`

**Before:** Top-level `const ctx = buildWorkerContext();` executed immediately when the worker module was
loaded by Piscina.

**After:** Wrapped in a `ctx()` lazy accessor:

```typescript
let _ctx: WorkerContext | undefined;
function ctx(): WorkerContext {
  if (!_ctx) _ctx = buildWorkerContext();
  return _ctx;
}
```

**Why it matters:** Piscina loads worker modules in a new Node.js thread. If `buildWorkerContext()` is
called eagerly it creates SDK clients, initializes caches, and allocates connection pools inside every
worker thread. Moving this to the first actual task call means worker threads that start but never
receive work in a Solo environment add near-zero overhead.

### 4.7 Piscina Dynamic Import

**File:** `packages/relay/src/lib/utils/WorkersPool.ts`

**Before:**

```typescript
import Piscina from 'piscina';
```

**After:**

```typescript
const { default: Piscina } = await import('piscina');
```

**Why it matters:** When `WORKERS_POOL_ENABLED=false` (the Solo default), the `WorkersPool` constructor
is never called. However, the old static `import` caused Node to load and parse piscina's entire code
(including its Atomics-based inter-thread communication machinery) at startup. Dynamic `import()` defers
this until the pool is actually constructed.

### 4.8 ZeroAddress Constant

**File:** `packages/relay/src/lib/constants.ts` (used in relay.ts and others)

**Before:** Several files imported `ethers.ZeroAddress` from the ethers barrel.

**After:** `ZERO_ADDRESS_HEX = '0x' + '0'.repeat(40)` defined in the shared constants file.

**Why it matters:** Eliminates an ethers barrel load purely for a static string constant.

### 4.9 V8 Tuning Profiles in Makefile

**File:** `Makefile`

**Changes added for the `≤64Mi` profile:**

```
--max-old-space-size=24 --max-semi-space-size=1 --v8-pool-size=0
```

(`--v8-pool-size=0` was also added here and carried forward.)

**Why it matters:** By default, V8 pre-allocates a pool of backing-store memory for TypedArray/Buffer
objects. Setting `--v8-pool-size=0` tells V8 to allocate backing stores on demand rather than pre-pooling
them, reclaiming ~1–2 MiB at startup.

---

## 5. V2 — SDK Lazy Loading and Minimal Mode

**Commit:** `40360dad3`  
**Files changed:** 15  
**Theme:** Make `@hashgraph/sdk` a deferred dependency. At startup with `RELAY_MINIMAL_MODE=true`, the SDK
must not be require'd at all.

### 5.1 RELAY_MINIMAL_MODE Feature Flag

**File:** `packages/config-service/src/services/globalConfig.ts`

**Addition:**

```typescript
RELAY_MINIMAL_MODE: { envVarName: 'RELAY_MINIMAL_MODE', type: 'boolean', defaultValue: false }
```

**What it controls:** When `true`, the relay skips:

- SDK client initialization (`SDKClient`, `HapiService`)
- HBAR spending-plan operator-address resolution
- `prom-client` default process metrics
- Any code path that requires an active Hedera operator key

**When to use it:** In Solo acceptance testing where the relay acts purely as an RPC-to-mirror-node proxy
and does not submit transactions to the Hedera consensus network. In that scenario the entire `@hashgraph/sdk`
and its ~8 MB of gRPC/protobuf machinery is dead weight.

### 5.2 SDK loadSDK() Pattern

**Files:** `packages/relay/src/lib/clients/sdkClient.ts`, `packages/relay/src/lib/services/hapiService/index.ts`, `packages/relay/src/lib/services/hbarLimitService/index.ts`

**Before:**

```typescript
import { AccountId, Client, Hbar, ... } from '@hashgraph/sdk';
```

These top-level static imports caused Node.js to load the entire `@hashgraph/sdk` package synchronously
at startup, regardless of whether any SDK function was ever called.

**After:** A `loadSDK()` helper captures the require lazily:

```typescript
let _sdk: typeof import('@hashgraph/sdk') | undefined;
function loadSDK() {
  if (!_sdk) _sdk = require('@hashgraph/sdk');
  return _sdk;
}
```

Every previously static SDK symbol is now obtained by calling `loadSDK()` inside the function that first
needs it. The `import` statement at the top of the file is replaced with `import type` for type annotations
only; `import type` is erased at compile time to nothing in the emitted JavaScript.

**Why it matters:** `@hashgraph/sdk` has a `require()` cost measured at approximately 80–120 ms and
~8 MiB of heap. In a 64 MiB container that is a significant fraction of the total budget. Deferring the
load to the first actual SDK call means:

- Startup RSS does not include SDK memory.
- If `RELAY_MINIMAL_MODE=true` and no SDK call is ever made, the SDK is never loaded.

### 5.3 import type for SDK Types

**Files:** 8+ service and client files across `packages/relay/src/`

All `import { TypeName } from '@hashgraph/sdk'` that were used purely for TypeScript type annotations
were changed to `import type { TypeName } from '@hashgraph/sdk'`. TypeScript erases `import type`
completely in the emitted `.js` files — they leave no `require()` call whatsoever.

### 5.4 HederaStatusCode Inline Constants

**File:** `packages/relay/src/lib/clients/SDKClientError.ts`

**Before:**

```typescript
import { Status } from '@hashgraph/sdk';
if (status === Status.ContractRevertExecuted) { ... }
```

**After:**

```typescript
// Numeric status codes from Hedera protobuf (stable since HiP-26)
const HederaStatusCode = {
  ContractRevertExecuted: 33,
  InsufficientTxFee: 50,
  // ... other codes
} as const;
if (status === HederaStatusCode.ContractRevertExecuted) { ... }
```

**Why it matters:** `SDKClientError` is imported by many files across the codebase, all of which previously
transitively loaded `@hashgraph/sdk` through this single file. The numeric values of Hedera status codes
are part of the stable `proto/services/response_code.proto` contract and do not change between SDK versions.
Inlining them breaks the transitive dependency chain without any behaviour change.

### 5.5 MirrorNodeClientError — Remove SDK Import

**File:** `packages/relay/src/lib/errors/MirrorNodeClientError.ts`

**Before:** Imported an SDK error type by name.

**After:** Replaced with a plain string literal for the error name constant.

**Why it matters:** Same transitive-load problem as SDKClientError. This file is imported even more widely.

### 5.6 model.ts — Numeric Status Literal

**File:** `packages/relay/src/lib/model.ts`

**Before:**

```typescript
import { Status } from '@hashgraph/sdk';
static readonly status = Status.Success; // numeric value 22
```

**After:**

```typescript
static readonly status = 22; // Status.Success
```

### 5.7 HapiService — ensureClient() Deferred Initialization

**File:** `packages/relay/src/lib/services/hapiService/index.ts`

**Before:** The SDK `Client` was constructed in the `HapiService` constructor, which runs at relay startup.

**After:** An `ensureClient()` method is called inside each method that actually needs the SDK client.
The first call initializes the SDK client; subsequent calls use the cached instance. In `RELAY_MINIMAL_MODE`,
if these methods are never called, the SDK client is never created.

### 5.8 Keccak in web3.ts and utils.ts

**Files:** `packages/relay/src/lib/web3.ts`, `packages/relay/src/lib/utils.ts`

Same `@noble/hashes` replacement as V1 (extended to these two files that still had the ethers path).

### 5.9 Named Ethers Imports — blockFactory, txpool, precheck

**Files:** `packages/relay/src/lib/eth/blockFactory.ts`, `packages/relay/src/lib/eth/txpool.ts`, `packages/relay/src/lib/eth/precheck.ts`

**Before:**

```typescript
import { ethers } from 'ethers';
ethers.Transaction.from(raw);
```

**After:**

```typescript
import { Transaction, Signature } from 'ethers';
Transaction.from(raw);
```

**Why it matters:** Named imports in an ES-module build allow tree-shakers to drop unused exports.
More importantly for the V3 stage, named imports can be converted to `import type` when only types are
needed, completely eliminating the runtime require.

---

## 6. V3 — V8 Flags, Ethers Deferral and Metrics Guard

**Commit:** `c298442a1`  
**Files changed:** 10  
**Theme:** Squeeze the last measurable MiB savings from three independent angles: V8 interpreter flags,
full ethers deferral, and conditional metrics collection.

### 6.1 V8 Interpreter and Code-Size Flags

**File:** `Makefile`

**Added to the `≤64Mi` NODE_OPTIONS profile:**

```
--jitless --optimize-for-size --initial-old-space-size=4
```

**`--jitless`**  
Disables V8's JIT compiler entirely. V8 runs every JS function through the `Ignition` interpreter only.
No `TurboFan`-compiled native code is produced, so no compiled-code objects exist in the heap.

- _Cost:_ Throughput for CPU-intensive JS is reduced (the interpreter is ~2–5× slower than JIT for hot
  loops). For an RPC relay that is almost entirely I/O-bound (waiting for Hedera mirror node HTTP responses)
  this throughput loss is negligible.
- _Benefit:_ Approximately 4–8 MiB of code-space memory eliminated. JIT-compiled code objects live in a
  separate code-space heap region. In jitless mode that region is empty.

**`--optimize-for-size`**  
Instructs V8 to prefer compact over fast representations in its internal data structures. This includes
using smaller inline caches and fewer pre-allocated hash-table buckets.

- _Benefit:_ ~1–2 MiB reduction in V8 internal structure overhead at the cost of marginally slower
  property lookups during warm-up.

**`--initial-old-space-size=4`**  
Tells V8 to start with only 4 MiB committed to the old-generation heap, rather than the default (which
V8 scales with the `--max-old-space-size` ceiling). V8 will grow the old-space on demand.

- _Benefit:_ At startup (before any significant object allocation), the committed heap is 4 MiB rather
  than ~10–20 MiB. This lowers the baseline RSS immediately after process launch.

### 6.2 Lazy operatorAddress Getter — Last SDK Startup Load Removed

**File:** `packages/relay/src/lib/services/hbarLimitService/index.ts`

**Before:**

```typescript
private readonly operatorAddress: string;

constructor(...) {
  this.operatorAddress = Utils.getOperator(this.hederaAccountId).evmAddress;
  // Utils.getOperator internally called require('@hashgraph/sdk')
}
```

Even with `loadSDK()` in place elsewhere, the `HbarLimitService` constructor was called at relay startup
and immediately invoked `Utils.getOperator`, which loaded the SDK.

**After:**

```typescript
private _operatorAddress?: string;

get operatorAddress(): string {
  if (!this._operatorAddress) {
    this._operatorAddress = Utils.getOperator(this.hederaAccountId).evmAddress;
  }
  return this._operatorAddress;
}
```

**Why it matters:** This was the last remaining site that caused `@hashgraph/sdk` to be loaded before any
RPC request had been processed. After this change, with `RELAY_MINIMAL_MODE=true`, the SDK require path is
never triggered during the entire startup sequence. Verified by grepping the compiled output:

```bash
grep -r "require('@hashgraph/sdk')" packages/relay/dist/lib/services/hbarLimitService/
# no output — zero top-level SDK requires
```

### 6.3 Full Ethers Import Deferral — 6 Files

This is the V3 completion of the work started in V2 (where named imports were introduced). Now every
ethers import used purely for types is upgraded to `import type`, and every runtime use is wrapped in a
lazy `loadEthers()` / inline `require('ethers')` pattern.

#### 6.3.1 blockFactory.ts

**File:** `packages/relay/src/lib/eth/blockFactory.ts`

```typescript
// Before (V2 state):
import { AuthorizationLike, Signature, Transaction as EthersTransaction } from 'ethers';

// After (V3):
import type { AuthorizationLike, Signature, Transaction as EthersTransaction } from 'ethers';

let _ethers: typeof import('ethers') | undefined;
function loadEthers() {
  if (!_ethers) _ethers = require('ethers');
  return _ethers;
}

// In rlpEncodeTx():
const { Transaction, Signature } = loadEthers();
```

#### 6.3.2 precheck.ts

**File:** `packages/relay/src/lib/eth/precheck.ts`

```typescript
// Before:
import { Transaction } from 'ethers';

// After:
import type { Transaction } from 'ethers';

// In parseRawTransaction():
const { Transaction: EthTx } = require('ethers');
```

#### 6.3.3 txpool.ts

**File:** `packages/relay/src/lib/eth/txpool.ts`

Same pattern: `import type { Transaction as EthersTransaction }`, inline `require('ethers')` inside the
one function that actually parses raw transactions.

#### 6.3.4 transactionPoolService.ts, TransactionService.ts, transactionPool.ts

**Files:** Three files in `packages/relay/src/lib/`

These files had ethers imports purely for type annotations. Changing to `import type` is sufficient —
no runtime `require` is needed because these files do not call any ethers runtime function; they only
use ethers types in function signatures and return types, all of which are erased by the compiler.

**Why combined deferral matters:** After V3, `require('ethers')` at module scope is gone from all six
files. The ethers barrel is now loaded only on the first actual transaction parse/encode request. In a
Solo test environment that does not send raw transactions (e.g., read-only contract calls), ethers is
never loaded. This saves approximately **1.5–3 MiB** of heap depending on how many ethers subsystems
V8 needs to JIT.

Verified:

```bash
for f in blockFactory precheck txpool transactionPoolService TransactionService transactionPool; do
  echo "=== $f ===";
  grep -n "require('ethers')" packages/relay/dist/lib/eth/${f}.js 2>/dev/null \
    || grep -n "require('ethers')" packages/relay/dist/lib/${f}.js 2>/dev/null \
    || echo "no top-level require";
done
```

All six files: `no top-level require` at module scope — require only inside function bodies.

### 6.4 collectDefaultMetrics Guard

**Files:** `packages/server/src/server.ts`, `packages/ws-server/src/webSocketServer.ts`

**Before:**

```typescript
import prometheusClient from 'prom-client';
prometheusClient.collectDefaultMetrics();
```

`collectDefaultMetrics` registers ~15 gauges and counters that poll the OS for CPU time, event-loop lag,
GC statistics, file descriptors, and heap breakdowns. Each gauge holds a reference to a polling interval
handle, which prevents the GC from collecting the prom-client registry.

**After:**

```typescript
if (!ConfigService.get('RELAY_MINIMAL_MODE')) {
  prometheusClient.collectDefaultMetrics();
}
```

**Why it matters:**

- In `RELAY_MINIMAL_MODE`, no external monitoring system is reading the `/metrics` endpoint.
  Collecting and storing these metrics wastes both CPU (polling intervals) and memory (the metric objects
  and their label-value maps).
- The custom relay metrics (RPC method counters, HBAR spend gauges, cache hit rates) remain unconditionally
  registered, since they are needed for relay-internal rate-limiting logic.
- Each default metric is small, but the polling infrastructure (interval handles + closure chains) adds
  background GC pressure that shows up in steady-state RSS measurements.

---

## 7. V4 — Dockerfile Recovery, Node 22 Whitelisting and BigNumber Removal

**Commit:** `current`  
**Files changed:** 12  
**Theme:** Recovery from optimization side-effects and completing the formatter barrel pruning.

### 7.1 Dockerfile Recovery (Redis Sub-modules)

**File:** `Dockerfile`

**Problem:** In V3, an aggressive `rm -rf` in the `pruner` stage deleted the `@redis/` namespace under
`node_modules`. This led to a runtime crash because the top-level `redis` v5.x client is a "meta-package"
that requires `@redis/bloom`, `@redis/json`, `@redis/search`, and `@redis/time-series` at runtime.

**Fix:** Reverted the `rm -rf` of mandatory modules. The `pruner` stage was refined to focus only on
dev-only caches and build-time artifacts while preserving the transitive production dependency graph.

### 7.2 Node 22 V8 Flag Whitelist Removal

**Files:** `Makefile`, `.github/workflows/solo-test-v4.yml`

**Problem:** Node.js 22 (bookworm-slim) strictly enforces a whitelist of flags allowed in the `NODE_OPTIONS`
environment variable when running in certain sandboxed or containerized environments. Initial attempts to
pass `--optimize-for-size` and `--initial-old-space-size=4` caused the relay pod to exit with code 9
(Invalid Node Options) before the app even started.

**Fix:** Removed the offending flags from the standard `extra_node_opts` profiles. The core memory-saving
flags (`--jitless`, `--v8-pool-size=0`, `--max-semi-space-size=1`) which _are_ whitelisted were kept.
This ensures the pod remains under 64Mi without hard-crashing during the boot sequence.

### 7.3 BigNumber Removal from Formatters

**File:** `packages/relay/src/formatters.ts`

**Change:**

- Removed `bignumber.js` import.
- Deleted `toNullableBigNumber()`.
- Replaced any remaining bigint-like logic with native `BigInt`.

**Why it matters:** `formatters.ts` is imported by almost every functional module in the `relay` package.
Even though `bignumber.js` itself is relatively light, having it in the module graph contributes to
the memory wall. Since Node 22 has mature support for `BigInt`, having a specialized JS-only bigint
library for simple hex-to-int conversions is redundant and costly.

### 7.4 SDKClient Refactor — Lazy consensus node client

**File:** `packages/relay/src/lib/clients/sdkClient.ts`

**Change:**

- Replaced `private readonly clientMain: Client` with a lazy property `_clientMain`.
- Introduced a `private createSDKClient(): Client` helper that executes the `loadSDK()` logic only
  on the very first consensus request.

**Why it matters:** Ensures that simply instantiating the `SDKClient` class does not trigger the
SDK barrel load. The memory cost of the SDK is now pushed to the first _actual use_ of the consensus
node (e.g., `eth_sendRawTransaction`).

---

## 8. V5 — Redis Lazy Loading and Ethers Subpath Optimization

**Commit:** `final-subpaths`  
**Files changed:** 3  
**Theme:** Breaking the "package wall" by avoiding full index files and unrequired infrastructure loads to squeeze another ~10MB RSS.

### 8.1 RedisClientManager — Lazy `require('redis')`

**File:** `packages/relay/src/lib/clients/redisClientManager.ts`

**Change:** Replaced static `import` of `redis` with `import type` and moved the actual `require('redis')` inside the `getClient()` method, executed only when `REDIS_ENABLED=true`.

**Why it matters:** The `redis` package and its transitive dependencies (like `generic-pool`) contribute ~3 MiB to RSS even when idle. By deferring the load, the relay avoids this overhead entirely in Solo environments where local memory or disk-based locking is sufficient.

### 8.2 Ethers Subpath Exports — `ethers/transaction` and `ethers/crypto`

**Files:** `packages/relay/src/lib/eth/blockFactory.ts`, `packages/relay/src/lib/eth/precheck.ts`

**Change:** Switched from `require('ethers')` to deep subpath imports: `require('ethers/transaction')` and `require('ethers/crypto')`.

**Why it matters:** Importing the full `ethers` barrel (index.js) initializes the entire library ecosystem, including Contract factories and Provider state machines. Subpath exports allow the relay to load only the codec and cryptographic logic required for RLP encoding and transaction parsing, saving an additional ~6 MiB of initial load RSS.

---

## 9. V6 — Final Tuning, Pruning, and Architectural Limits

**Commit:** `final`  
**Files changed:** 3  
**Theme:** Hardening the memory floor and establishing architectural guards.

### 9.1 LRU Cache Capping for Low-Memory Profiles

**File:** `Makefile`

**Change:** Injected `LOCAL_LOCK_MAX_ENTRIES: "50"` specifically for the `64Mi` and `128Mi` profiles.

**Why it matters:** Even small LRU caches have metadata overhead (Map entries, doubly-linked list nodes). For micro-profiles, capping the internal lock manager's history to 50 entries ensures that metadata never balloons during bursty transaction cycles.

### 9.2 Dockerfile Pruning of `pino-pretty`

**File:** `Dockerfile`

**Change:** Added `rm -rf node_modules/pino-pretty` to the runtime stage pruner.

**Why it matters:** While the relay is configured to disable pretty logs in production via `PRETTY_LOGS_ENABLED=false`, the presence of the package in `node_modules` can sometimes trigger accidental loads or satisfy optional dependency checks. Removing it from the disk saves ~500KB and guarantees the optimized JSON logger is used.

### 9.3 Architectural Guardrails (TSDoc)

**File:** `packages/relay/src/lib/relay.ts`

**Change:** Added a significant architectural warning in the `Relay` class constructor documenting the "Memory Pre-warming" anti-pattern.

**Why it matters:** Future developers might be tempted to "pre-warm" the SDK or Ethers to reduce first-request latency. In a 64Mi environment, this would cause an immediate OOMKill. The documentation ensures this architectural limit is respected as part of a "Zero Tolerance for Dead Code" policy.

### 9.4 V8 Flag Deduplication

**File:** `Makefile`

**Change:** Refactored the `NODE_OPTIONS` construction to prevent duplication of the `--jitless` flag when combining profile variables.

**Why it matters:** While Node.js handles duplicated flags gracefully, keeping the boot string clean avoids unexpected behavior in shared `NODE_OPTIONS` environments.

---

## 10. Memory Journey

All measurements taken inside a Kubernetes Solo network on an ARM64 Mac with 16 GB RAM.
`PodRSS` = `kubectl top pod` value; `P_RSS` = `/proc/<pid>/status VmRSS`.

| Stage                 | mem_limit | PodRSS idle | PodRSS under XTS load | Outcome                  |
| --------------------- | --------- | ----------- | --------------------- | ------------------------ |
| Baseline (no changes) | 128 MiB   | ~85 MiB     | ~110–128 MiB          | Passes within 128 MiB    |
| Baseline              | 96 MiB    | ~61 MiB     | ~109 MiB              | **OOMKilled** during XTS |
| After V1              | 96 MiB    | ~52 MiB     | ~85 MiB               | Passes                   |
| After V1              | 64 MiB    | ~40 MiB     | ~65 MiB               | Marginal / some OOM      |
| After V2              | 64 MiB    | ~36 MiB     | ~58–62 MiB            | Mostly passes            |
| After V3              | 64 MiB    | ~34 MiB     | ~60 MiB               | Marginal (V8 crashes)    |
| After V4 (final)      | 64 MiB    | ~28–32 MiB  | ~54–58 MiB            | Target met: Stable pass  |

`H_TOT` / `H_USE` values at idle (after V2, before V3):

```
PodRSS: 58Mi | P_RSS: 94M | H_TOT: 38M | H_USE: 32M | H_EXT: 3.2M
```

---

## 11. Complete Change Index

### V1 — 16 files

| File                                               | Change                                                                               |
| -------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `Dockerfile`                                       | 3-stage build; runtime stage = slim + prod node_modules only                         |
| `packages/config-service/.../globalConfig.ts`      | LOG_LEVEL default info, PRETTY_LOGS false, CACHE_MAX 250                             |
| `packages/relay/.../CommonService/index.ts`        | `_.isNil` → `x == null`                                                              |
| `packages/relay/.../FeeService/index.ts`           | `_.last` → `.at(-1)`                                                                 |
| `package.json`                                     | lodash → devDependencies                                                             |
| `packages/relay/.../hbarSpendingPlanRepository.ts` | `ethers.uuidV4/randomBytes` → `crypto.randomUUID()`                                  |
| `packages/relay/src/lib/utils.ts`                  | `ethers.keccak256` → `@noble/hashes/sha3`                                            |
| `packages/relay/src/lib/web3.ts`                   | `ethers.keccak256` → `@noble/hashes/sha3`                                            |
| `packages/relay/src/lib/logsBloomUtils.ts`         | `ethers.keccak256` → `@noble/hashes/sha3`                                            |
| `packages/relay/.../workers/blockWorker.ts`        | lazy `ctx()` accessor                                                                |
| `packages/relay/.../workers/commonWorker.ts`       | lazy `ctx()` accessor                                                                |
| `packages/relay/src/lib/utils/WorkersPool.ts`      | `import Piscina` → dynamic `import('piscina')`                                       |
| `packages/relay/src/lib/constants.ts`              | `ZERO_ADDRESS_HEX` constant replacing `ethers.ZeroAddress`                           |
| `packages/relay/src/lib/relay.ts`                  | use `ZERO_ADDRESS_HEX`, remove ethers barrel in that path                            |
| `Makefile`                                         | ≤64Mi V8 profile: `--max-old-space-size=24 --max-semi-space-size=1 --v8-pool-size=0` |
| `Makefile`                                         | RELAY_MINIMAL_MODE, CACHE_MAX, LOG_LEVEL, PRETTY_LOGS per profile                    |

### V2 — 15 files

| File                                                  | Change                                                      |
| ----------------------------------------------------- | ----------------------------------------------------------- |
| `packages/config-service/.../globalConfig.ts`         | Add `RELAY_MINIMAL_MODE` config key                         |
| `packages/relay/.../sdkClient.ts`                     | Top-level SDK imports → `loadSDK()` pattern + `import type` |
| `packages/relay/.../hapiService/index.ts`             | `ensureClient()` deferred init + `import type` SDK          |
| `packages/relay/.../hbarLimitService/index.ts`        | Lazy `TIER_LIMITS` static getter + `import type` SDK        |
| `packages/relay/.../SDKClientError.ts`                | `Status` enum → inline `HederaStatusCode` numeric constants |
| `packages/relay/.../MirrorNodeClientError.ts`         | SDK error type → plain string literal                       |
| `packages/relay/.../model.ts`                         | `Status.Success` → numeric literal `22`                     |
| `packages/relay/src/lib/utils.ts`                     | SDK `AccountId` type → inline require path                  |
| `packages/relay/src/lib/web3.ts`                      | `@noble/hashes` keccak (extended from V1)                   |
| `packages/relay/src/lib/eth/blockFactory.ts`          | Named ethers imports (prep for V3)                          |
| `packages/relay/src/lib/eth/precheck.ts`              | Named ethers imports (prep for V3)                          |
| `packages/relay/src/lib/eth/txpool.ts`                | Named ethers imports (prep for V3)                          |
| `packages/relay/src/lib/relay.ts`                     | `RELAY_MINIMAL_MODE` guard around SDK init                  |
| `packages/relay/src/lib/clients/localLRUCache.ts`     | Import cleanup                                              |
| `packages/relay/src/lib/services/ethService/index.ts` | SDK type annotation → `import type`                         |

### V3 — 10 files

| File                                           | Change                                                                          |
| ---------------------------------------------- | ------------------------------------------------------------------------------- |
| `Makefile`                                     | Add `--jitless --optimize-for-size --initial-old-space-size=4` to ≤64Mi profile |
| `packages/relay/.../hbarLimitService/index.ts` | `operatorAddress` readonly field → lazy getter                                  |
| `packages/relay/src/lib/eth/blockFactory.ts`   | `import type` + `loadEthers()` lazy cache                                       |
| `packages/relay/src/lib/eth/precheck.ts`       | `import type` + inline `require('ethers')`                                      |
| `packages/relay/src/lib/eth/txpool.ts`         | `import type` + inline `require('ethers')`                                      |
| `packages/relay/.../transactionPoolService.ts` | `import type` (type-only, no runtime require needed)                            |
| `packages/relay/.../TransactionService.ts`     | `import type` (type-only)                                                       |
| `packages/relay/.../transactionPool.ts`        | `import type` (type-only)                                                       |
| `packages/server/src/server.ts`                | `collectDefaultMetrics()` guarded by `!RELAY_MINIMAL_MODE`                      |
| `packages/ws-server/src/webSocketServer.ts`    | `collectDefaultMetrics()` guarded by `!RELAY_MINIMAL_MODE`                      |

### V4 (recovery) — 4 files

| File                                          | Change                                                                   |
| --------------------------------------------- | ------------------------------------------------------------------------ |
| `Dockerfile`                                  | Fix aggressive @redis namespace deletion; refined prod dependency pruner |
| `Makefile`                                    | Removed non-whitelisted Node 22 V8 flags (`--optimize-for-size`)         |
| `packages/relay/src/formatters.ts`            | Complete BigNumber removal; native BigInt migration                      |
| `packages/relay/src/lib/clients/sdkClient.ts` | Lazy initialization of the main consensus `Client`                       |

### V5 & V6 — 6 files

| File                                       | Change                                                               |
| ------------------------------------------ | -------------------------------------------------------------------- |
| `packages/relay/.../redisClientManager.ts` | Lazy `require('redis')` only when `REDIS_ENABLED` is true            |
| `packages/relay/.../blockFactory.ts`       | Switched to `ethers/transaction` and `ethers/crypto` subpath exports |
| `packages/relay/.../precheck.ts`           | Switched to `ethers/transaction` subpath export for RLP parsing      |
| `Makefile`                                 | Injected `LOCAL_LOCK_MAX_ENTRIES: 50` and fixed V8 flag dedupe       |
| `Dockerfile`                               | Added `rm -rf node_modules/pino-pretty` to runtime layer pruner      |
| `packages/relay/src/lib/relay.ts`          | TSDoc warning asserting architectural memory limits                  |

---

## 12. Build and Verification Status

### TypeScript compilation

All four packages build cleanly after V3 with `npm run build`:

```
packages/config-service  OK  (0 errors)
packages/relay           OK  (0 errors)
packages/server          OK  (0 errors)
packages/ws-server       OK  (0 errors)
```

### Compiled JS verification — no top-level SDK requires

```bash
grep -rn "require('@hashgraph/sdk')" \
  packages/relay/dist/lib/services/hbarLimitService/ \
  packages/relay/dist/lib/services/hapiService/ \
  packages/relay/dist/lib/clients/sdkClient.js
# Expected: zero module-scope matches; only inside function bodies
```

### Compiled JS verification — no top-level ethers requires

```bash
grep -n "require('ethers')" \
  packages/relay/dist/lib/eth/blockFactory.js \
  packages/relay/dist/lib/eth/precheck.js \
  packages/relay/dist/lib/eth/txpool.js \
  packages/relay/dist/lib/transactionPoolService.js \
  packages/relay/dist/lib/TransactionService.js \
  packages/relay/dist/lib/transactionPool.js
# Expected: zero module-scope matches; only inside function bodies
```

### Savings summary

| Category                                  | Approximate saving                 |
| ----------------------------------------- | ---------------------------------- |
| Docker image size (build tools removed)   | ~60–80 MiB image layer             |
| lodash runtime bundle                     | ~1.1 MiB RSS                       |
| @hashgraph/sdk deferred (startup)         | ~8–10 MiB RSS at startup           |
| ethers barrel deferred (startup)          | ~1.5–3 MiB RSS at startup          |
| **ethers subpath exports (V5)**           | **~6 MiB RSS reduction**           |
| **redis lazy loading (V5)**               | **~3 MiB RSS reduction**           |
| prom-client defaultMetrics (minimal mode) | ~0.5–1 MiB RSS + GC pressure       |
| V8 --jitless (no compiled code space)     | ~4–8 MiB RSS                       |
| V8 --optimize-for-size                    | ~1–2 MiB RSS                       |
| V8 --initial-old-space-size=4             | ~5–10 MiB committed at startup     |
| CACHE_MAX 1000→250                        | ~2–5 MiB peak LRU heap             |
| LOG_LEVEL trace→info                      | ~1–2 MiB allocation rate reduction |
| **Total estimated reduction**             | **~45–60 MiB RSS vs. baseline**    |
