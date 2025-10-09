## Enhancements

- feat: use `amountSentLD` in `.transferToken` on `_debit` function in LayerZero HTSConnector [#4453](https://github.com/hiero-ledger/hiero-json-rpc-relay/pull/4453)
- Use `amountSentLD` in `.transferToken` on `_debit` function in LayerZero HTSConnector [#4448](https://github.com/hiero-ledger/hiero-json-rpc-relay/issues/4448)
- feat: updates sendrawtransaction methods [#4444](https://github.com/hiero-ledger/hiero-json-rpc-relay/pull/4444)
- feat: Implement Redis storage [#4438](https://github.com/hiero-ledger/hiero-json-rpc-relay/pull/4438)
- feat: add optional stateOverride parameter validation to eth\_call [#4420](https://github.com/hiero-ledger/hiero-json-rpc-relay/pull/4420)
- State Override in eth\_call Stopped Working - Breaking Account Abstraction [#4417](https://github.com/hiero-ledger/hiero-json-rpc-relay/issues/4417)
- feat: adds transaction pool service class implementation + tests [#4416](https://github.com/hiero-ledger/hiero-json-rpc-relay/pull/4416)
- refactor: optimize precheckSendRawTransactionCheck for improved efficiency and code cleanliness [#4360](https://github.com/hiero-ledger/hiero-json-rpc-relay/pull/4360)
- fix: extend xts suite with new coverage for HBAR transfers to zero address and reserved system accounts [#4354](https://github.com/hiero-ledger/hiero-json-rpc-relay/pull/4354)
- feat: increase test coverage in ws-server [#4333](https://github.com/hiero-ledger/hiero-json-rpc-relay/pull/4333)
- Add Hedera-specific negative tests for eth\_sendRawTransaction [#4332](https://github.com/hiero-ledger/hiero-json-rpc-relay/issues/4332)
- Refactor precheck.sendRawTransactionCheck for improved efficiency and code cleanliness [#3721](https://github.com/hiero-ledger/hiero-json-rpc-relay/issues/3721)

## Bug Fixes

- fix: debug\_traceTransaction validation for default tracer [#4404](https://github.com/hiero-ledger/hiero-json-rpc-relay/pull/4404)
- fix: skipping calling resolveEntityType if action is CREATE [#4372](https://github.com/hiero-ledger/hiero-json-rpc-relay/pull/4372)
- `debug_traceBlockByNumber` not working if the block contains `CREATE` operation [#4369](https://github.com/hiero-ledger/hiero-json-rpc-relay/issues/4369)
- `debug_traceTransaction` throws error in Remix IDE [#4368](https://github.com/hiero-ledger/hiero-json-rpc-relay/issues/4368)
- fix: `eth_getTransactionByHash` correct response parsing [#4331](https://github.com/hiero-ledger/hiero-json-rpc-relay/pull/4331)
- `eth_getTransactionByHash` - `value` field seems to be off [#4327](https://github.com/hiero-ledger/hiero-json-rpc-relay/issues/4327)
- GasUsed returned instead of GasLimit [#4318](https://github.com/hiero-ledger/hiero-json-rpc-relay/issues/4318)

## Internal Changes

- feat: add optional stateOverride parameter validation to eth\_call [#4422](https://github.com/hiero-ledger/hiero-json-rpc-relay/pull/4422)
- Increase test coverage in ws-server [#4222](https://github.com/hiero-ledger/hiero-json-rpc-relay/issues/4222)
- Update openrpc json updater script [#4200](https://github.com/hiero-ledger/hiero-json-rpc-relay/issues/4200)
- refactor: update logging to use Pino's interpolation values [#4199](https://github.com/hiero-ledger/hiero-json-rpc-relay/pull/4199)
- Update babel-loader package in dapp-example [#4189](https://github.com/hiero-ledger/hiero-json-rpc-relay/issues/4189)
- Update `@typescript-eslint`/parser [#4186](https://github.com/hiero-ledger/hiero-json-rpc-relay/issues/4186)

## :heart: Contributors

Thank you to all the contributors who worked on this release:

@belloibrahv, @konstantinabl, @natanasow, @quiet-node, @simzzz, and @stoyanov-st