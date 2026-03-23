# Memory Optimization Findings — Round 3 (Under Load)

**Date:** 2026-03-23
**Heap snapshots analyzed:**
- `v2-idle.Heap.20260323.170805.10.0.001` (27.6 MB) — idle
- `v2-ML.Heap.20260323.170858.10.0.002` (56.0 MB) — 45 seconds into load test
- `v2-AL.Heap.20260323.170931.10.0.003` (46.7 MB) — after load test

---

## Problem Statement

After Milestone 2 idle optimizations (idle heap reduced from ~45 MB to ~27 MB), peak memory during load testing still hits **~70-75 MB** — the same as before the optimizations. Expected peak was ~50-55 MB. This investigation explains why and identifies actionable improvements.

---

## The Core Answer: Why Peak Didn't Drop

The idle optimization **deferred** module loading — it didn't **eliminate** it. Under load, those deferred modules load on the first request and **stay forever** (cached by `require.cache`).

```
Before optimizations:
  Idle: 45 MB (everything loaded eagerly)
  Peak: 45 + 25-30 MB in-flight = ~70-75 MB

After optimizations:
  Idle: 27 MB (modules deferred)
  First request: 27 + 12 MB (lazy modules) + 7 MB (ENS) = ~46 MB
  Peak: 46 + 25-30 MB in-flight = ~70-75 MB  ← same!
```

The in-flight cost (~25-30 MB) is unchanged. The deferred modules shift from idle to first-request time. Peak = baseline-after-first-request + in-flight, and in-flight didn't change.

---

## Smoking Gun: ENS Normalization Tables — 6.6 MB (Never Used!)

A `VALID` Set at 5.2 MB plus `IGNORED`, `MAPPED`, `EMOJI_ROOT` tables totaling **6.6 MB** come from ENS (Ethereum Name Service) normalization code that **the relay never uses**.

**Load chain:**
```
hashgraph-sdk.ts (lazy) → EthereumTransaction.cjs
  → Transaction.cjs → TransactionResponse.cjs → TransactionRecord.cjs
  → ContractFunctionResult.cjs → @ethersproject/abi (barrel index.js)
  → @ethersproject/abi/interface.js → @ethersproject/hash
  → @ethersproject/hash/lib/namehash.js → ./ens-normalize/lib.js  ← 6.6 MB!
```

The SDK only needs `defaultAbiCoder.decode()` from `@ethersproject/abi/lib/abi-coder.js`. But the barrel `index.js` also imports `interface.js`, which pulls in `@ethersproject/hash` and the entire Unicode code-point validation tables for ENS name normalization.

**The relay never resolves ENS names. This is 6.6 MB of pure waste.**

---

## Full Breakdown: What the ~30 MB Load Delta Contains

Comparison of mid-load (56 MB) vs idle (27.6 MB):

| Category | Delta | Explanation |
|---|---|---|
| **ENS normalization (VALID Set + tables)** | **+6.6 MB** | Module-level `const VALID = new Set(...)` — permanent, never GC'd |
| Compiled code (V8 JIT) | +7.7 MB | Lazy SDK modules compiled on first use |
| Strings | +2.6 MB | Transaction IDs, log messages, hex data |
| HTTP response buffers (JSArrayBufferData) | +2.3 MB | Mirror node HTTP responses in-flight |
| In-flight SDK objects (EthereumTransaction ×404, TransactionId ×1236, Hbar ×1262, etc.) | ~2 MB | Active async operations — 0 deleted because still in-flight |
| Promises ×7,308 + Timeouts ×1,307 | ~4 MB retained | Receipt polling loops, async chains |
| Sets (beyond VALID) | ~0.2 MB | SDK internal node lists, channels |
| Arrays, Objects, system/Context | ~4-5 MB | V8 closure environments for async ops |

### Comparison View Details (mid-load vs idle)

| Constructor | # New | # Deleted | # Delta | Alloc. Size | Size Delta |
|---|---|---|---|---|---|
| (compiled code) | 42,052 | 13,433 | +28,119 | 8.8 MB | +7.7 MB |
| Set | 590 | 0 | +590 | 5.4 MB | +5.4 MB |
| (string) | 23,403 | 413 | +22,990 | 2.7 MB | +2.6 MB |
| system/JSArrayBufferData | 314 | 2 | +312 | 2.3 MB | +2.3 MB |
| Array | 18,488 | 10 | +18,478 | 1.6 MB | +1.6 MB |
| (object shape) | 9,317 | 294 | +9,023 | 924 kB | +867 kB |
| Promise | 7,308 | 1 | +7,307 | 795 kB | +795 kB |
| system/Context | 11,647 | 2 | +11,645 | 657 kB | +657 kB |
| Object | 1,291 | 11 | +1,280 | 558 kB | +558 kB |
| (concatenated string) | 11,652 | 121 | +11,531 | 373 kB | +369 kB |
| (number) | 20,388 | 41 | +20,347 | 326 kB | +326 kB |
| Buffer | 2,286 | 1 | +2,285 | 221 kB | +221 kB |
| Long | 4,589 | 0 | +4,589 | 220 kB | +220 kB |
| Timeout | 1,307 | 0 | +1,307 | 220 kB | +220 kB |
| (bigint) | 4,636 | 27 | +4,609 | 216 kB | +215 kB |
| EthereumTransaction | 404 | 0 | +404 | 103 kB | +103 kB |
| TransactionReceiptQuery | 416 | 0 | +416 | 73.2 kB | +73.2 kB |
| TransactionId | 1,236 | 0 | +1,236 | 69.2 kB | +69.2 kB |
| BigNumber | 1,262 | 0 | +1,262 | 60.6 kB | +60.6 kB |
| AccountId | 603 | 0 | +603 | 43.4 kB | +43.4 kB |
| Hbar | 1,262 | 0 | +1,262 | 40.4 kB | +40.4 kB |
| ClientRequest | 76 | 0 | +76 | 40.1 kB | +40.1 kB |
| ExchangeRate | 764 | 0 | +764 | 36.7 kB | +36.7 kB |
| TransactionGetReceiptResponse | 638 | 0 | +638 | 35.7 kB | +35.7 kB |
| TransactionReceipt | 638 | 0 | +638 | 33.4 kB | +33.4 kB |
| Timestamp | 836 | 0 | +836 | 33.4 kB | +33.4 kB |

---

## Why Post-Load is 46.7 MB (Not Back to 27.6 MB)

The 19 MB gap after load ends is **not a leak**:

| What stays permanently | Size |
|---|---|
| Lazy SDK modules (loaded on first request, cached by `require.cache`) | ~12 MB |
| ENS normalization tables (module-scope `const`) | ~6.6 MB |
| **Total** | **~18.6 MB** |

18.6 MB closely matches the 19 MB observed delta. Everything else (Promises, Timeouts, SDK objects, HTTP buffers) was GC'd properly.

---

## Heap Composition at Mid-Load (56 MB)

| Category | Shallow | Retained | % |
|---|---|---|---|
| (compiled code) ×109,009 | 16,490 kB (29%) | 24,804 kB (44%) |
| system/Context ×15,274 | 926 kB (2%) | 20,690 kB (37%) |
| Object ×3,453 | 1,755 kB (3%) | 18,294 kB (33%) |
| (string) ×76,032 | 11,157 kB (20%) | 11,157 kB (20%) |
| Array ×23,876 | 2,876 kB (5%) | 8,340 kB (15%) |
| Set ×634 | 5,588 kB (10%) | 6,238 kB (11%) |
| Timeout ×1,309 | 220 kB | 3,984 kB (7%) |
| Promise ×7,317 | 220 kB | 3,984 kB (7%) |
| (constructor) ×900 | 796 kB (1%) | 3,468 kB (6%) |

---

## Actionable Improvements

### 1. Eliminate ENS Normalization — SAVE ~7-8 MB (peak AND post-load)

This is the biggest win available. The relay never resolves ENS names. Three implementation options:

**(A) `patch-package` on `@ethersproject/abi`** — Patch `@ethersproject/abi/lib/index.js` to not import `interface.js`. Quick, low-risk since the SDK only calls `defaultAbiCoder.decode()`.

**(B) Module require hook** — Intercept `require('@ethersproject/abi')` to return only `abi-coder` exports.

**(C) Upstream PR to `@hashgraph/sdk`** — Change `ContractFunctionResult.cjs` to import `@ethersproject/abi/lib/abi-coder` directly instead of the barrel.

**Impact:** Peak drops from ~70-75 MB to **~63-67 MB**. Post-load drops from 46.7 MB to ~40 MB.

### 2. Reduce `MIRROR_NODE_HTTP_MAX_SOCKETS` — SAVE ~1-2 MB peak

Default is 300. For a single relay pod, 50-100 is more realistic and reduces connection pool buffer memory during concurrent requests.

### 3. Request Concurrency Limiting — SAVE ~5-10 MB peak

A semaphore on `submitEthereumTransaction` would cap the number of in-flight SDK operations. Each in-flight operation holds: EthereumTransaction + TransactionReceiptQuery + polling Timeouts + Promises + closure Contexts.

---

## Summary

| Improvement | Est. Savings | Affects | Risk |
|---|---|---|---|
| Eliminate ENS normalization via patch | **~7-8 MB** | Peak + post-load + idle-after-first-request | Low |
| Reduce mirror node maxSockets (300 → 50) | ~1-2 MB | Peak only | Low |
| Request concurrency limiter | ~5-10 MB | Peak only | Medium |
| **Total realistic** | **~13-20 MB peak** | | |

**Revised projections:**
- Peak: 70-75 MB → **~55-60 MB** (with all three improvements)
- Post-load settled: 46.7 MB → **~40 MB** (ENS fix only)
- Idle: 27 MB → unchanged (ENS tables don't load until first request)

---

## What Is NOT Reducible Under Load

| Item | Size | Reason |
|---|---|---|
| V8 JIT compiled code for active modules | ~8 MB delta | Required for execution |
| In-flight Promises and Timeouts | ~4 MB | Proportional to active requests |
| gRPC/NodeClient base cost | ~4 MB | Required for consensus node communication |
| Lazy-loaded SDK modules (post-first-request) | ~12 MB | Permanently cached by Node.js `require.cache` |
| HTTP response buffers (transient) | ~2.3 MB | In-flight mirror node responses |
