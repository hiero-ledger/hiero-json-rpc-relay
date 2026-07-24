// SPDX-License-Identifier: Apache-2.0

import BigNumber from 'bignumber.js';

/**
 * Mirror Node REST responses can contain integers larger than JavaScript's safe
 * range (e.g. the wei `value`/`amount` fields). `mirrorNodeClient` parses those
 * with `json-bigint`, which turns them into `bignumber.js` `BigNumber` instances
 * to preserve precision.
 *
 * By default bignumber.js renders a value whose exponent is >= 21 in exponential
 * notation, so `new BigNumber('1e21').toString()` is `"1e+21"`. That bites us on
 * the Redis cache path: `RedisCache` serializes cached Mirror Node objects with
 * native `JSON.stringify` (which invokes `BigNumber.prototype.toJSON`) on set and
 * `JSON.parse` on get, so the field comes back as the string `"1e+21"`. Formatters
 * such as `nanOrNumberInt64To0x` then call `BigInt("1e+21")`, which throws and
 * surfaces as an HTTP 500 on `eth_getTransactionByHash` / `debug_traceTransaction`.
 * (The in-memory LRU cache stores objects by reference and never serializes, so it
 * sidesteps this — the bug is Redis-only.)
 *
 * Setting `EXPONENTIAL_AT` to its maximum (1e9, the documented "never use
 * exponential" value) makes `toString`/`toJSON` always emit full decimal digits, so
 * the round-trip yields `"1000000000000000000000"` and `BigInt(...)` succeeds. EVM
 * `value` is a uint256 (max ~1.16e77), so any threshold below ~78 would still break
 * real values; 1e9 clears that range with a wide margin.
 *
 * IMPORTANT: this configures the bignumber.js instance that `json-bigint` uses. Two
 * major versions are installed — `json-bigint` resolves the hoisted top-level
 * `bignumber.js` (v9), while the Hedera SDK carries its own nested v10. `import
 * BigNumber from 'bignumber.js'` resolves to the same v9 instance json-bigint
 * `require`s, so the config takes effect; the SDK's v10 (used for Hbar/amount math)
 * is left untouched, keeping the blast radius to Mirror Node response parsing.
 *
 * This module is imported for its side effect by `mirrorNodeClient`, guaranteeing
 * the configuration is applied before the first response is parsed, on every
 * entrypoint (HTTP, WS) and in tests.
 */
BigNumber.config({ EXPONENTIAL_AT: 1e9 });
