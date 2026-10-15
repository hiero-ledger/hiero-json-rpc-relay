## Enhancements

- feat: return -32602 from eth\_getLogs for block ranges beyond head [#5878](https://github.com/hiero-ledger/hiero-json-rpc-relay/pull/5878)
- test: bump conformity suite to execution-apis v1.0.0-beta.7 [#5872](https://github.com/hiero-ledger/hiero-json-rpc-relay/pull/5872)
- feat: add `SEND_RAW_TRANSACTION_WAIT_TIME` config var [#5869](https://github.com/hiero-ledger/hiero-json-rpc-relay/pull/5869)
- Add `SEND_RAW_TRANSACTION_WAIT_TIME` env [#5868](https://github.com/hiero-ledger/hiero-json-rpc-relay/issues/5868)
- [DRAFT] feat: use MN ethereum\_nonce for the latest nonce [#5863](https://github.com/hiero-ledger/hiero-json-rpc-relay/pull/5863)
- fix: flaky CI tests and lost concurrent HBAR spend updates [#5857](https://github.com/hiero-ledger/hiero-json-rpc-relay/pull/5857)
- eth\_getLogs: return -32602 for block ranges beyond head instead of an empty array [#5846](https://github.com/hiero-ledger/hiero-json-rpc-relay/issues/5846)
- feat: add EIP-1898 support [#5845](https://github.com/hiero-ledger/hiero-json-rpc-relay/pull/5845)
- chore: bump Node.js to 24 LTS in Docker image and CI [#5841](https://github.com/hiero-ledger/hiero-json-rpc-relay/pull/5841)
- feat: add REAL\_IP\_ADDRESS\_MODE to stop forwarding-header IP spoofing [#5832](https://github.com/hiero-ledger/hiero-json-rpc-relay/pull/5832)
- EIP-1898 block parameter objects rejected on eth\_getBalance / eth\_getCode / eth\_getTransactionCount / eth\_getStorageAt (breaks Foundry >= 1.8) [#5826](https://github.com/hiero-ledger/hiero-json-rpc-relay/issues/5826)
- Conformity tests: the pinned `execution-apis` spec is 2.5 years out of date [#5825](https://github.com/hiero-ledger/hiero-json-rpc-relay/issues/5825)
- feat: support state overrides in eth\_call and eth\_estimateGas [#5817](https://github.com/hiero-ledger/hiero-json-rpc-relay/pull/5817)
- Missing expected, initcode size limit, RPC error from Relay [#5495](https://github.com/hiero-ledger/hiero-json-rpc-relay/issues/5495)
- [A4 EPIC] eth\_call overrides [#5114](https://github.com/hiero-ledger/hiero-json-rpc-relay/issues/5114)

## Bug Fixes

- Bump the CI mirror node pin to 0.164.1 and Solo pin to 0.92.0 [#5876](https://github.com/hiero-ledger/hiero-json-rpc-relay/issues/5876)
- feat: block Mirror Node blacklisted contracts in `eth_call` and `eth_estimateGas` [#5875](https://github.com/hiero-ledger/hiero-json-rpc-relay/pull/5875)
- fix: map mirror node y\_parity to yParity in authorization list entries [#5864](https://github.com/hiero-ledger/hiero-json-rpc-relay/pull/5864)
- Reject `eth_call` and `eth_estimateGas` to Mirror Node blacklisted contracts in the relay [#5849](https://github.com/hiero-ledger/hiero-json-rpc-relay/issues/5849)
- fix: wrong from and cumulativeGasUsed on synthetic receipts resolved by timestamp [#5843](https://github.com/hiero-ledger/hiero-json-rpc-relay/pull/5843)
- fix: eth\_getBalance returns wrong balances for recent blocks with allowance spends [#5831](https://github.com/hiero-ledger/hiero-json-rpc-relay/pull/5831)
- `eth_getBalance` returns wrong (sometimes negative) historical balances for accounts with HBAR allowance spends [#5829](https://github.com/hiero-ledger/hiero-json-rpc-relay/issues/5829)
- Synthetic transactions return different values depending on which eth method is called [#5784](https://github.com/hiero-ledger/hiero-json-rpc-relay/issues/5784)
- Aborted HTTP requests continue downstream eth\_getLogs fan-out after client disconnect [#5676](https://github.com/hiero-ledger/hiero-json-rpc-relay/issues/5676)
- Untrusted forwarding headers allow rate-limit bypass on eth\_newBlockFilter [#5675](https://github.com/hiero-ledger/hiero-json-rpc-relay/issues/5675)

## :heart: Contributors

Thank you to all the contributors who worked on this release:

@ValentinVPK, @natanasow, and @tgntr