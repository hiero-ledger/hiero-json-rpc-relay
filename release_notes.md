## Enhancements

- feat: cherry-pick optimize Redis usage in txpool metrics and add configurable com… [#5973](https://github.com/hiero-ledger/hiero-json-rpc-relay/pull/5973)
- feat: cherry-pick populated aborted request as 499 instead of 500 to 0.81 [#5972](https://github.com/hiero-ledger/hiero-json-rpc-relay/pull/5972)
- feat: populated aborted request as 499 instead of 500 [#5971](https://github.com/hiero-ledger/hiero-json-rpc-relay/pull/5971)
- Populate aborted request as 499 instead of 500 on send raw transaction [#5970](https://github.com/hiero-ledger/hiero-json-rpc-relay/issues/5970)
- feat: cherry-pick add `INSUFFICIENT_PAYER_BALANCE` in hedera specific statuses array (#5966) to 0.81 [#5968](https://github.com/hiero-ledger/hiero-json-rpc-relay/pull/5968)
- feat: optimize Redis usage in txpool metrics and add configurable command timeout [#5967](https://github.com/hiero-ledger/hiero-json-rpc-relay/pull/5967)
- feat: add `INSUFFICIENT_PAYER_BALANCE` in hedera specific statuses array [#5966](https://github.com/hiero-ledger/hiero-json-rpc-relay/pull/5966)
- Redis improvements [#5963](https://github.com/hiero-ledger/hiero-json-rpc-relay/issues/5963)
- chore: group Dependabot updates into weekly PRs [#5955](https://github.com/hiero-ledger/hiero-json-rpc-relay/pull/5955)
- feat: support disableCode, disableStorage and includeEmpty for prestateTracer [#5954](https://github.com/hiero-ledger/hiero-json-rpc-relay/pull/5954)
- feat: add newPendingTransactions WebSocket subscription [#5950](https://github.com/hiero-ledger/hiero-json-rpc-relay/pull/5950)
- feat: move per-request logs to debug and log params only on error [#5949](https://github.com/hiero-ledger/hiero-json-rpc-relay/pull/5949)
- fix: Recheck mirror results before synthesizing transactions [#5947](https://github.com/hiero-ledger/hiero-json-rpc-relay/pull/5947)
- fix: return only the touched storage slots from prestateTracer [#5945](https://github.com/hiero-ledger/hiero-json-rpc-relay/pull/5945)
- Support `disableCode`, `disableStorage` and `includeEmpty` for `prestateTracer` [#5944](https://github.com/hiero-ledger/hiero-json-rpc-relay/issues/5944)
- feat: unhandled rejection is left behind when the request is abandoned [#5942](https://github.com/hiero-ledger/hiero-json-rpc-relay/pull/5942)
- Unhandled rejection is left behind when the request is abandoned [#5941](https://github.com/hiero-ledger/hiero-json-rpc-relay/issues/5941)
- Review the Hedera Frontier results and debug the nonce issue [#5940](https://github.com/hiero-ledger/hiero-json-rpc-relay/issues/5940)
- eth\_getTransactionByHash returns a synthetic transaction when the contract result lags behind logs, hanging polling clients [#5933](https://github.com/hiero-ledger/hiero-json-rpc-relay/issues/5933)
- feat: revisit codecov [#5929](https://github.com/hiero-ledger/hiero-json-rpc-relay/pull/5929)
- feat: make the block gas limit configurable via BLOCK\_GAS\_LIMIT [#5924](https://github.com/hiero-ledger/hiero-json-rpc-relay/pull/5924)
- Make the block gas limit configurable via `BLOCK_GAS_LIMIT` (default 150M) [#5918](https://github.com/hiero-ledger/hiero-json-rpc-relay/issues/5918)
- Bound the "method" label set on per-method metrics [#5913](https://github.com/hiero-ledger/hiero-json-rpc-relay/issues/5913)
- feat: bump versions [#5912](https://github.com/hiero-ledger/hiero-json-rpc-relay/pull/5912)
- Bump versions [#5911](https://github.com/hiero-ledger/hiero-json-rpc-relay/issues/5911)
- feat: bound the "method" label set on per-method metrics [#5909](https://github.com/hiero-ledger/hiero-json-rpc-relay/pull/5909)
- Bound the "method" label set on per-method metrics [#5908](https://github.com/hiero-ledger/hiero-json-rpc-relay/issues/5908)
- feat: cherry-pick detect contract deployments on block-stream mirror nodes to 0.80 [#5905](https://github.com/hiero-ledger/hiero-json-rpc-relay/pull/5905)
- feat: cherry-pick fix `eth_getTransactionCount` race condition to 0.80 [#5895](https://github.com/hiero-ledger/hiero-json-rpc-relay/pull/5895)
- feat: fix `eth_getTransactionCount` race condition [#5894](https://github.com/hiero-ledger/hiero-json-rpc-relay/pull/5894)
- Relay clean-up [#5856](https://github.com/hiero-ledger/hiero-json-rpc-relay/issues/5856)
- Pre Consensus rejected transactions are not shown as -32003 error in eth\_getTransactionReceipt [#5802](https://github.com/hiero-ledger/hiero-json-rpc-relay/issues/5802)
- Log only what is purely needed [#5126](https://github.com/hiero-ledger/hiero-json-rpc-relay/issues/5126)
- Future Improvement: `newPendingTransactions` Subscription Event [#5047](https://github.com/hiero-ledger/hiero-json-rpc-relay/issues/5047)
- Return only  touched slots in the `debug_trace*` methods using `prestateTracer` [#4920](https://github.com/hiero-ledger/hiero-json-rpc-relay/issues/4920)

## Bug Fixes

- fix: cherry-pick use the earliest recorded gas price for blocks to 0.81 [#5974](https://github.com/hiero-ledger/hiero-json-rpc-relay/pull/5974)
- fix: use the earliest recorded gas price for blocks before the fee schedule has one [#5969](https://github.com/hiero-ledger/hiero-json-rpc-relay/pull/5969)
- fix: fall back to the current gas price for blocks before the EthereumTransaction fee schedule [#5965](https://github.com/hiero-ledger/hiero-json-rpc-relay/pull/5965)
- Methods that read the historical gas price fail for blocks before August 2022 [#5964](https://github.com/hiero-ledger/hiero-json-rpc-relay/issues/5964)
- [Track] `baseFeePerGas` returned in tinybars for blocks with HAPI contract calls (hiero-mirror-node#14531) [#5923](https://github.com/hiero-ledger/hiero-json-rpc-relay/issues/5923)
- fix: detect contract deployments on block-stream mirror nodes [#5900](https://github.com/hiero-ledger/hiero-json-rpc-relay/pull/5900)
- Deployment receipts return `contractAddress: null` when the mirror node imports from the block stream [#5899](https://github.com/hiero-ledger/hiero-json-rpc-relay/issues/5899)
- `eth_getTransactionCount` race condition [#5893](https://github.com/hiero-ledger/hiero-json-rpc-relay/issues/5893)

## Dependency Upgrades

- chore(deps): Update CODEOWNERS for dependabot updates [#5960](https://github.com/hiero-ledger/hiero-json-rpc-relay/pull/5960)
- Make the maintainers owners of dependabot config and PRs. [#5959](https://github.com/hiero-ledger/hiero-json-rpc-relay/issues/5959)
- Group Dependabot updates into weekly PRs [#5932](https://github.com/hiero-ledger/hiero-json-rpc-relay/issues/5932)
- build(deps): install envsubst for chart-testing-action cosign step [#5917](https://github.com/hiero-ledger/hiero-json-rpc-relay/pull/5917)
- Charts jobs fail on chart-testing-action 2.9.0: `envsubst` not found on our runners (blocks #5901) [#5916](https://github.com/hiero-ledger/hiero-json-rpc-relay/issues/5916)
- build(deps): scope protobufjs override to `@grpc`/proto-loader [#5915](https://github.com/hiero-ledger/hiero-json-rpc-relay/pull/5915)
- Global `protobufjs` override breaks `@hiero-ledger/sdk` 2.90.1 (blocks #5910) [#5914](https://github.com/hiero-ledger/hiero-json-rpc-relay/issues/5914)

## Internal Changes

- ci(publish): cherry-pick add repo config to package.json and add .npmignore (#5976) to 0.81 [#5979](https://github.com/hiero-ledger/hiero-json-rpc-relay/pull/5979)
- ci(publish): remove duplicate bin key and align package metadata [#5978](https://github.com/hiero-ledger/hiero-json-rpc-relay/pull/5978)
- ci(publish): Add repo config to package.json and add .npmignore [#5976](https://github.com/hiero-ledger/hiero-json-rpc-relay/pull/5976)
- Add repository metadata to package.json so npm provenance publishing works [#5975](https://github.com/hiero-ledger/hiero-json-rpc-relay/issues/5975)
- Revisit Codecov setup to improve reporting on PRs [#5897](https://github.com/hiero-ledger/hiero-json-rpc-relay/issues/5897)

## :heart: Contributors

Thank you to all the contributors who worked on this release:

@Nana-EC, @ValentinVPK, @natanasow, @rbarker-dev, @tgntr, and @tinker-michaelj