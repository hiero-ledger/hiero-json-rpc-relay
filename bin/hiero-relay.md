# Hiero JSON-RPC Relay CLI

[![Node.js](https://img.shields.io/badge/node-%3E%3D22.13.0-brightgreen)](https://nodejs.org/)
[![NPM](https://img.shields.io/badge/npm-%3E%3D10.9.2-blue)](https://www.npmjs.com/)

The **Hiero JSON-RPC Relay CLI** is a command-line tool to start a local JSON-RPC relay for Hedera networks. It supports multiple networks, read-only mode, logging, and configuration via environment files.

---

## Table of Contents

* [Installation](#installation)
* [Usage](#usage)
* [Options](#options)
* [Examples](#examples)
* [Logging](#logging)
* [Requirements](#requirements)
* [Graceful Shutdown](#graceful-shutdown)
* [Configuration via `.env`](#configuration-via-env)
* [License](#license)

---

## Installation

Download the npm package from npmjs

```bash
npm install @hashgraph/hiero-relay-cli -g
```

---

## Usage

Run the CLI with:

```bash
hiero-relay [options]
```

If no command is specified, the relay starts with default settings. For more information use `--help`.

---

## Options

| Option                   | Alias | Type    | Description                                                   | Required | Choices                                            |
| ------------------------ | ----- | ------- | ------------------------------------------------------------- | -------- | -------------------------------------------------- |
| `--network`              | `-n`  | string  | Select a network to run the relay against                     | ✅        | `mainnet`, `testnet`, `previewnet`                 |
| `--read-only`            | `-r`  | boolean | Run the relay in read-only mode (no operator ID/key required) | ❌        | -                                                  |
| `--operator-id`          | -     | string  | Operator ID in `<realm>.<shard>.<num>` format                 | ❌ (required only when `--read-only false`)       | -                                                  |
| `--operator-key`         | -     | string  | Operator key                                                  | ❌ (required only when `--read-only false`)       | -                                                  |
| `--operator-key-format`  | -     | string  | Operator key format                                           | ❌ (required only when `--read-only false`)       | `HEX_ED25519`, `HEX_ECDSA`                         |
| `--chain-id`             | -     | string  | Select a chain ID                                             | ❌        | `0x127`, `0x128`, `0x129`                          |
| `--mirror-node-rest-url` | -     | string  | Mirror node REST URL                                          | ❌        | -                                                  |
| `--mirror-node-web3-url` | -     | string  | Mirror node WEB3 URL                                          | ❌        | -                                                  |
| `--config-file`          | `-c`  | string  | Path to environment config file                               | ❌        | -                                                  |
| `--logging`              | `-l`  | string  | Logging level                                                 | ❌        | `trace`, `debug`, `info`, `warn`, `error`, `fatal` |
| `--logging-path`         | -     | string  | Path to write logs                                            | ❌        | -                                                  |
| `--json-pretty-print-enabled` | - | boolean | Enabled/disable a basic ndjson formatter                     | ❌        | -                                                  |
| `--rpc-http-enabled`     | -     | boolean  | Enable HTTP server (default: true)                           | ❌        | -                                                  |
| `--rpc-ws-enabled`       | -     | boolean  | Enable WS server (default: false)                            | ❌        | -                                                  |

---

## Examples

**Start relay on testnet in read-only mode:**

```bash
hiero-relay -n testnet -r
```

**Start relay with operator credentials:**

```bash
hiero-relay -n mainnet --operator-id 0.0.1234 --operator-key <YOUR_KEY> --operator-key-format HEX_ED25519
```

**Start relay using a config file:**

```bash
hiero-relay -c ./env/.relay.env
```

**Start relay with custom logging:**

```bash
hiero-relay -n previewnet -r -l debug --logging-path ./logs/relay.log
```

**Start relay with both http and ws servers:**

```bash
hiero-relay -n previewnet -r --rpc-ws-enabled true
```

---

## Logging

* By default, logs are printed to stdout/stderr.
* Use `--logging-path` to redirect logs to a file.
* Logging levels: `trace`, `debug`, `info`, `warn`, `error`, `fatal`.

Example:

```bash
hiero-relay -n testnet -r -l info --logging-path ./logs/relay.log
```

All logs will be appended to `./logs/relay.log`.

---

## Requirements

* **Node.js >= v22.13.0**
* **npm >= v10.9.2**

Check versions:

```bash
node -v
npm -v
```

---

## Graceful Shutdown

The CLI listens to `SIGINT` and `SIGTERM` signals and stops the relay gracefully, ensuring child processes are terminated properly.

---

## Configuration via `.env`

You can configure the relay using a `.env` file by specifying operator IDs, keys, chain IDs, and mirror node URLs. Example `.env` file:

```
OPERATOR_ID=0.0.1234
OPERATOR_KEY=<YOUR_KEY>
CHAIN_ID=0x127
MIRROR_NODE_URL=https://testnet.mirrornode.hedera.com
MIRROR_NODE_URL_WEB3=https://web3.testnet.mirrornode.hedera.com
LOG_LEVEL=info
```

All available configuration envs are listed [here](https://github.com/hiero-ledger/hiero-json-rpc-relay/blob/main/docs/configuration.md).

Start the CLI with the config file:

```bash
hiero-relay -c ./env/.relay.env
```

---

## License

This project is licensed under the [Apache-2.0 License](LICENSE).
