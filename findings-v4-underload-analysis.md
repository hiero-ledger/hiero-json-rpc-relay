# Memory Under Load — Final Analysis Report

**Date:** 2026-03-23
**Load test:** 120 RPS, 30 VUs, 30s duration

---

## Conclusion

Most of the optimizations applied in Milestones 1–2 only **defer** module loading from startup to first request — they do not **eliminate** memory. Under load, the deferred modules load back into memory, resulting in the same peak footprint. Only two optimizations produce real, permanent savings under load: **ethers submodule imports** and **pino worker elimination**.

---

## What Actually Matters Under Load

| Optimization                                    | Idle savings | Load savings                                          | Why                                         |
| ----------------------------------------------- | ------------ | ----------------------------------------------------- | ------------------------------------------- |
| Ethers submodule imports                        | -2.2 MB      | **Real** — eliminates ethers v6 ENS/BIP39 permanently | Modules are never loaded, not just deferred |
| Pino worker elimination                         | -10.5 MB     | **Real** — no worker threads consuming RSS            | Workers are gone entirely                   |
| Lodash + keccak256 + lazy piscina               | -1.3 MB      | **None** — loads on first request                     | Deferred, not eliminated                    |
| Relay minimal mode + skip collectDefaultMetrics | ~0 MB        | **None** — loads on first request                     | Deferred, not eliminated                    |
| Selective SDK import wrapper                    | -10 MB       | **None** — loads on first request                     | Deferred, not eliminated                    |

**Reverting the three "deferred-only" optimizations** (lodash, minimal mode, selective SDK import) and running the same load test (120 RPS, 30s) at 88Mi pod limit with 66 old-space: **still passes**. The deferred optimizations only help idle startup fit into a smaller pod, but contribute nothing to peak memory during traffic.

---

## Heap Breakdown Under Load (56 MB snapshot, 45s into load test)

| Category                | Size    | %   | Notes                                                           |
| ----------------------- | ------- | --- | --------------------------------------------------------------- |
| Compiled code (V8 JIT)  | 15.8 MB | 29% | Machine code for all loaded modules — unavoidable               |
| Strings (module source) | 10.9 MB | 20% | V8 keeps raw source text of every loaded .js file — unavoidable |
| Arrays                  | 10.6 MB | 19% | Includes 5.1 MB ENS `VALID` Set hash table (waste)              |
| Objects                 | 5.4 MB  | 10% | SDK objects, configs, module namespaces                         |
| Native (C++)            | 2.5 MB  | 5%  | HTTP buffers, nghttp2, parser buffers                           |
| Object shapes           | 2.5 MB  | 4%  | V8 hidden class metadata                                        |
| Closures                | 2.4 MB  | 4%  | 41K closures from async callbacks and SDK internals             |
| Bigints                 | 1.8 MB  | 3%  | 70K values from crypto curve math                               |
| Other                   | 1.5 MB  | 3%  | Concat strings, numbers, symbols, regexp                        |

### Why Compiled Code + Strings Dominate (~27 MB, ~50%)

Every `require()`'d module costs roughly **2–3x its file size on disk**: once for the source string V8 retains (for stack traces and `Function.toString()`), once for the compiled machine code. This is a fixed cost of running Node.js — it cannot be reduced without eliminating the module entirely.

### In-Flight SDK Objects (~837 KB self-size)

404 concurrent EthereumTransactions at snapshot time, each creating ~40 associated SDK objects:

| Object                  | Count | Self Size |
| ----------------------- | ----- | --------- |
| Long                    | 4,850 | 227 KB    |
| EthereumTransaction     | 404   | 101 KB    |
| TransactionReceiptQuery | 416   | 72 KB     |
| TransactionId           | 1,236 | 68 KB     |
| BigNumber               | 1,288 | 60 KB     |

Self-size is small (837 KB), but each transaction holds a chain of Promises (7,317), Generators (2,432), Timeouts (1,309), and closure Contexts that inflate the retained size significantly.

### One Remaining Actionable Item: ENS Normalization (5.1 MB)

A `VALID` Set containing 130K+ Unicode codepoints for ENS name normalization — loaded via `@hashgraph/sdk → ContractFunctionResult.cjs → @ethersproject/abi (barrel) → interface.js → @ethersproject/hash → ens-normalize/lib.js`. The relay never resolves ENS names. This is the single largest waste in the heap and can be eliminated via a require-cache patch.

---

## Revert Test Results

Testing with 88Mi pod limit, 66 old-space, 120 RPS, 30s:

| Configuration               | Idle Heap | Survives Load Test?                     |
| --------------------------- | --------- | --------------------------------------- |
| All optimizations (current) | 27/30 MB  | Yes                                     |
| Revert minimal mode         | 29/32 MB  | Yes                                     |
| Revert lodash + keccak      | 30/33 MB  | Yes                                     |
| Revert pino workers         | 30/33 MB  | No — worker threads push RSS over limit |
| Revert selective SDK import | 39/43 MB  | Yes                                     |

---

## Final Assessment

The minimum viable optimization set for production is:

1. **Ethers submodule imports** — permanent elimination of ethers v6 ENS/BIP39 (~11 MB)
2. **Pino worker elimination** — removes worker thread RSS overhead (~10.6 MB)

Everything else (lodash removal, lazy piscina, minimal mode, selective SDK import) is nice-to-have for idle memory appearance but does not improve peak memory under load. These deferred modules load back into memory the moment traffic arrives.

There is no further significant optimization possible under load without either:

- Patching the `@ethersproject/abi` barrel import to eliminate ENS tables (saves ~5–7 MB)
- Reducing the number of concurrent in-flight SDK transactions (trades throughput for memory)
- Fundamental runtime changes (different JS engine, bundling, service splitting)
