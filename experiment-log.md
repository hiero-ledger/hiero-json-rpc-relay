# Experiment Log

Running log of measurements, observations, and results from memory optimization work on the Hedera JSON-RPC Relay.

---

## Container Sizing Progress

### Idle (startup, no traffic)

| State                                                  | Main Heap | From Heap Snapshot | Workers | Native | Total RSS | Pod Limit | old-space | Change   |
| ------------------------------------------------------ | --------- | ------------------ | ------- | ------ | --------- | --------- | --------- | -------- |
| **Original** (no changes)                              | 40.0 MB   | ~48.0 MB           | 10.6 MB | ~40 MB | ~90.6 MB  | 96 Mi     | 50        | baseline |
| **+ Ethers submodule imports**                         | 37.8 MB   | ~42.0 MB           | 10.6 MB | ~40 MB | ~88.4 MB  | 90 Mi     | 48        | -2.2 MB  |
| **+ Pino worker elimination**                          | 37.9 MB   | ~41.1 MB           | 0 MB    | ~40 MB | ~77.9 MB  | 82 Mi     | 42        | -10.5 MB |
| **+ Lodash + @ethersproject/keccak256 + lazy piscina** | 36.6 MB   | ~39.8 MB           | 0 MB    | ~40 MB | ~76.6 MB  | 79 Mi     | 39        | -1.3 MB  |
| **+ Relay Minimal Mode + Skip collectDefaultMetrics**  | 36.6 MB   | ~39 MB             | 0 MB    | ~40 MB | ~76.6 MB  | 79 Mi     | 39        | -1.3 MB  |
| **+ Selective SDK Import**                             | 26.6 MB   | ~27.2 MB           | 0 MB    | ~x MB  | ~76.6 MB  | 64 Mi     | 39-48     | -1.3 MB  |

### Under load (120 RPS, 30 VUs, 30s, standard mode)

| State                                                                       | Peak Heap | Workers | Native | Total RSS | Pod Limit | old-space |
| --------------------------------------------------------------------------- | --------- | ------- | ------ | --------- | --------- | --------- |
| **Original** (no changes)                                                   | ~84 MB    | 10.6 MB | ~40 MB | ~134 MB   | 128 Mi    | 84        |
| **+ Ethers + Pino**                                                         | ~63 MB    | 0 MB    | ~40 MB | ~103 MB   | 102 Mi    | 63-66     |
| **+ Lodash + @keccak256 + lazy piscina + Min Mode + collectDefaultMetrics** | ~56 MB    | 0 MB    | ~24 MB | ~88 MB    | 88 Mi     | 57-63     |
| **+ Selective SDK Import**                                                  | ~56 MB    | 0 MB    | ~24 MB | ~80 MB    | 84 Mi     | 63        |

**Cumulative idle savings from baseline: ~14 MB (~15% reduction)** — 40.0 MB → 36.6 MB heap + 10.6 MB workers eliminated
**Cumulative load savings from baseline: ~31 MB (~23% reduction)**

**Note: We want lowest Pod Limit but highest old-space possible**: Low old space means there will be more GC events, and each GC event pauses the event loop, making throughput worse. So we want to minimize the Pod Limit while maximizing the old-space size.

need to test LOG_LEVEL=error and LOG_LEVEL=warn to see how it works with the pino worker elimination

default - 27/30MB [baseline]
revert minimal mode (w or w/o collectDefaultMetrics) - 29/32MB [works for underload 88-66old, 120RPS, 30s]
revert lodash removal and keccak - 30/33MB [works for underload 88-66old, 120RPS, 30s]
revert pino worker elimination - 30/33MB (but not able to run load test when 88-66old due to hitting RSS limit as the worker threads consume more memory)
revert Selective SDK Import - 39.4 (43.1) (able to start with 64-48old, and able to survive load test with 88-66old)

So looks like we justneed Ethers Submodule imports, Pino worker elimination and that's it for it to be able to start with 64-48old and survive load test with 88-66old. The other three optimizations just basically add deferred memory footprint at startup, but when under load, it makes no difference.
