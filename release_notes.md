## Enhancements

- feat: adds debug\_traceBlockByHash support (#4867) [#5008](https://github.com/hiero-ledger/hiero-json-rpc-relay/pull/5008)
- feat: allow mutliple paymaster accounts, and smart contracts per paymaster [#4998](https://github.com/hiero-ledger/hiero-json-rpc-relay/pull/4998)
- feat: fix `debug_getRawBlock` acceptance test [#4981](https://github.com/hiero-ledger/hiero-json-rpc-relay/pull/4981)
- [FEATURE] Extended Paymaster: Allow mutliple paymaster accounts, and smart contracts per paymaster [#4977](https://github.com/hiero-ledger/hiero-json-rpc-relay/issues/4977)
- feat: add support for authrozation list when returning tx data (#4863) [PECTRA] [#4907](https://github.com/hiero-ledger/hiero-json-rpc-relay/pull/4907)
- Remove pnpm dependency [#4906](https://github.com/hiero-ledger/hiero-json-rpc-relay/issues/4906)
- build: remove pnpm dependency and standardize on npm (#4868) [#4888](https://github.com/hiero-ledger/hiero-json-rpc-relay/pull/4888)
- feat: reduce unnecessary redis calls [#4883](https://github.com/hiero-ledger/hiero-json-rpc-relay/pull/4883)
- Unnecessary Redis calls and missing error handling cause `eth_sendRawTransaction` failures [#4882](https://github.com/hiero-ledger/hiero-json-rpc-relay/issues/4882)
- test: reduce flakiness in ethGetBlockBy perf test [#4881](https://github.com/hiero-ledger/hiero-json-rpc-relay/pull/4881)
- feat: split tx validation process in two steps [#4874](https://github.com/hiero-ledger/hiero-json-rpc-relay/pull/4874)
- fix: reduced Mirror Node load for WRONG\_NONCE handling [#4872](https://github.com/hiero-ledger/hiero-json-rpc-relay/pull/4872)
- Refactor WRONG\_NONCE error handling in TransactionService to reduce Mirror Node load [#4864](https://github.com/hiero-ledger/hiero-json-rpc-relay/issues/4864)
- Pectra: AuthorizationList on eth\_getTransactionByBlockHashAndIndex eth\_getTransactionByBlockNumberAndIndex eth\_getTransactionByHash [#4863](https://github.com/hiero-ledger/hiero-json-rpc-relay/issues/4863)
- eth\_call is not returing the revert details [#4862](https://github.com/hiero-ledger/hiero-json-rpc-relay/issues/4862)
- fix: ensure SDK consensus errors are properly surfaced to clients for eth\_sendRawTransaction [#4856](https://github.com/hiero-ledger/hiero-json-rpc-relay/pull/4856)
- feat: fix outdated version of the SDK [#4855](https://github.com/hiero-ledger/hiero-json-rpc-relay/pull/4855)
- fix: filter all pre-execution validation failures in debug trace APIs [#4849](https://github.com/hiero-ledger/hiero-json-rpc-relay/pull/4849)
- Fix Error Masking in sendRawTransactionProcessor: SDK Errors with TransactionIDs Incorrectly Treated as Successful [#4848](https://github.com/hiero-ledger/hiero-json-rpc-relay/issues/4848)
- feat: creates metrics service for lock service [#4847](https://github.com/hiero-ledger/hiero-json-rpc-relay/pull/4847)
- Comply to the functional definition of pending transactions [#4845](https://github.com/hiero-ledger/hiero-json-rpc-relay/issues/4845)
- Outdated version of the SDK installed on `npm ci` [#4841](https://github.com/hiero-ledger/hiero-json-rpc-relay/issues/4841)
- feat: optimize block retrieval with parallel timestamp slicing for mirror node api calls [#4828](https://github.com/hiero-ledger/hiero-json-rpc-relay/pull/4828)
- refactor: replace Lodash with native Set/Map in populateSyntheticTransactions [#4819](https://github.com/hiero-ledger/hiero-json-rpc-relay/pull/4819)
- feat: add worker threads related metrics [#4809](https://github.com/hiero-ledger/hiero-json-rpc-relay/pull/4809)
- Replace Lodash with native Node.js functions in BlockService [#4807](https://github.com/hiero-ledger/hiero-json-rpc-relay/issues/4807)
- Optimize block retrieval with parallel timestamp slicing for Mirror Node API calls [#4806](https://github.com/hiero-ledger/hiero-json-rpc-relay/issues/4806)
- feat: optimize `debug_traceBlockByNumber` to eliminate redundant Mirror Node API calls  [#4803](https://github.com/hiero-ledger/hiero-json-rpc-relay/pull/4803)
- feat: update list of hedera based errors (#4785) [#4796](https://github.com/hiero-ledger/hiero-json-rpc-relay/pull/4796)
- Redefine the default Relay configuration to improve Developer Experience [#4785](https://github.com/hiero-ledger/hiero-json-rpc-relay/issues/4785)
- feat: propagate all errors from mn to the user (#4677) [#4781](https://github.com/hiero-ledger/hiero-json-rpc-relay/pull/4781)
- feat: add k6 tests for block with many HTS transfers [#4770](https://github.com/hiero-ledger/hiero-json-rpc-relay/pull/4770)
- Ddeskov task [#4753](https://github.com/hiero-ledger/hiero-json-rpc-relay/pull/4753)
- Add relevant metrics for lock service [#4712](https://github.com/hiero-ledger/hiero-json-rpc-relay/issues/4712)
- feat: add worker threads [#4702](https://github.com/hiero-ledger/hiero-json-rpc-relay/pull/4702)
- Optimize debug\_traceBlockByNumber to eliminate redundant Mirror Node API calls [#4699](https://github.com/hiero-ledger/hiero-json-rpc-relay/issues/4699)
- Move cache measurement logic into separate service [#4690](https://github.com/hiero-ledger/hiero-json-rpc-relay/issues/4690)
- feat: move cache measurements to decorator [#4688](https://github.com/hiero-ledger/hiero-json-rpc-relay/pull/4688)
- chore: update gas validation for pectra upgrade [#4686](https://github.com/hiero-ledger/hiero-json-rpc-relay/pull/4686)
- Add worker threads related metrics [#4685](https://github.com/hiero-ledger/hiero-json-rpc-relay/issues/4685)
- Add k6 testing for CPU-intensive methods [#4684](https://github.com/hiero-ledger/hiero-json-rpc-relay/issues/4684)
- Add worker threads for CPU-intensive operations using piscina [#4683](https://github.com/hiero-ledger/hiero-json-rpc-relay/issues/4683)
- [FEATURE] Add worker threads for CPU-intensive operations [#4682](https://github.com/hiero-ledger/hiero-json-rpc-relay/issues/4682)
- Improve `eth_call` and `eth_estimateGas` error responses for HTS tokens by leveraging Mirror Node's secondary error messages [discussion] [#4677](https://github.com/hiero-ledger/hiero-json-rpc-relay/issues/4677)
- Reevaluate unused or low-value cache client methods [#4676](https://github.com/hiero-ledger/hiero-json-rpc-relay/issues/4676)
- [EPIC] Nonce Ordering with Locks [#4591](https://github.com/hiero-ledger/hiero-json-rpc-relay/issues/4591)
- Address `npm install` warnings and recommnedations [#2068](https://github.com/hiero-ledger/hiero-json-rpc-relay/issues/2068)

## Bug Fixes

- fix: add 'INVALID\_FILE\_ID' to HEDERA\_SPECIFIC\_REVERT\_STATUSES [#4944](https://github.com/hiero-ledger/hiero-json-rpc-relay/pull/4944)
- `INVALID_FILE_ID` is missing from the list of Hedera errors [#4943](https://github.com/hiero-ledger/hiero-json-rpc-relay/issues/4943)
- Flaky test: handles large transaction arrays with O(n) performance uses hard 10ms threshold [#4880](https://github.com/hiero-ledger/hiero-json-rpc-relay/issues/4880)
- debug\_traceBlockByNumber returns 400 error for blocks containing pre-execution validation failures [#4850](https://github.com/hiero-ledger/hiero-json-rpc-relay/issues/4850)
- fix: convert trace value from tinybars to weibars in debug APIs [#4764](https://github.com/hiero-ledger/hiero-json-rpc-relay/pull/4764)
- `debug_traceTransaction` returns `value` in tinybars (8 decimals) instead of weibars (18 decimals) [#4763](https://github.com/hiero-ledger/hiero-json-rpc-relay/issues/4763)
- fix: Handle synthetic HTS transactions in debug trace methods [#4760](https://github.com/hiero-ledger/hiero-json-rpc-relay/pull/4760)
- feat: stop silently swallowing errors (#4697) [#4758](https://github.com/hiero-ledger/hiero-json-rpc-relay/pull/4758)
- test: ensure trace works without non-synth data (#4752) [#4757](https://github.com/hiero-ledger/hiero-json-rpc-relay/pull/4757)
- fix: stop sending gas price to mn when not submitted (#4755) [#4756](https://github.com/hiero-ledger/hiero-json-rpc-relay/pull/4756)
- feat: use type 0x0 for synthetic transactions (#4711) [#4714](https://github.com/hiero-ledger/hiero-json-rpc-relay/pull/4714)
- Standardize Native/Synthetic Transaction Types to Legacy (0x0) in JSON-RPC Relay [#4711](https://github.com/hiero-ledger/hiero-json-rpc-relay/issues/4711)
- fix: improve unit tests by preventing test pollution [#4708](https://github.com/hiero-ledger/hiero-json-rpc-relay/pull/4708)
- getBlockByHash unit tests fail when ran with only [#4696](https://github.com/hiero-ledger/hiero-json-rpc-relay/issues/4696)
- Missing Synthetic Logs for CRYPTOTRANSFER initiated by another smart contract [#3616](https://github.com/hiero-ledger/hiero-json-rpc-relay/issues/3616)

## Documentation

- docs: update Node.js version requirement from v20 to v22 in README (#4868) [#4887](https://github.com/hiero-ledger/hiero-json-rpc-relay/pull/4887)
- Update the README to recommend Node.js v22 [#4868](https://github.com/hiero-ledger/hiero-json-rpc-relay/issues/4868)
- Update the Maintainers file to point to the right guidelines [#4839](https://github.com/hiero-ledger/hiero-json-rpc-relay/issues/4839)
- chore: update link to maintainer guidelines [#4836](https://github.com/hiero-ledger/hiero-json-rpc-relay/pull/4836)
- add quickstart to enable devs to spin up json rpc relay [#4771](https://github.com/hiero-ledger/hiero-json-rpc-relay/issues/4771)
- docs: add quickstart to enable devs to spin up json rpc relay [#4640](https://github.com/hiero-ledger/hiero-json-rpc-relay/pull/4640)

## Dependency Upgrades

- chore: updates SDK version to 2.80.0 [#4831](https://github.com/hiero-ledger/hiero-json-rpc-relay/pull/4831)
- Update SDK version to v2.80.0 [#4826](https://github.com/hiero-ledger/hiero-json-rpc-relay/issues/4826)
- Sprint 0.70.0 B: Dependency Maintenance and Updates [#4706](https://github.com/hiero-ledger/hiero-json-rpc-relay/issues/4706)
- build(deps): bump `@hashgraph`/sdk from 2.75.0 to 2.78.0 in /tools/whbar-hardhat-example [#4669](https://github.com/hiero-ledger/hiero-json-rpc-relay/pull/4669)

## Internal Changes

- document Paymaster for gasless transactions [#4477](https://github.com/hiero-ledger/hiero-json-rpc-relay/issues/4477)

## :heart: Contributors

Thank you to all the contributors who worked on this release:

@BartoszSolkaBD, @Neurone, @ddeskov-limechain, @jasuwienas, @jaycoolslm, @jwagantall, @konstantinabl, @kpachhai, @mgarbs, @natanasow, @quiet-node, and @simzzz