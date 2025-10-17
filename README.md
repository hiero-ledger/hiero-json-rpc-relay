<div align="center">

# Hiero JSON-RPC Relay

[![Build](https://github.com/hiero-ledger/hiero-json-rpc-relay/actions/workflows/test.yml/badge.svg)](https://github.com/hiero-ledger/hiero-json-rpc-relay/actions)
[![Release](https://img.shields.io/github/v/release/hiero-ledger/hiero-json-rpc-relay)](https://github.com/hiero-ledger/hiero-json-rpc-relay/releases)
[![RPC API Methods](https://img.shields.io/badge/api-docs-green.svg)](docs/rpc-api.md)
[![RPC API Methods](https://img.shields.io/badge/websocket-docs-green.svg)](docs/live-events-api.md)
[![Discord](https://img.shields.io/badge/discord-join%20chat-blue.svg)](https://hedera.com/discord)
[![Made With](https://img.shields.io/badge/made_with-typescript-blue)](https://github.com/hiero-ledger/hiero-json-rpc-relay/)
[![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/hiero-ledger/hiero-json-rpc-relay/badge)](https://scorecard.dev/viewer/?uri=github.com/hiero-ledger/hiero-json-rpc-relay)
[![CII Best Practices](https://bestpractices.coreinfrastructure.org/projects/10697/badge)](https://bestpractices.coreinfrastructure.org/projects/10697)
[![License](https://img.shields.io/badge/license-apache2-blue.svg)](LICENSE)

</div>

The Hiero JSON-RPC Relay is an open-source implementation of the Ethereum JSON-RPC API that allows developers to interact with the Hedera network using familiar Web3 tools such as MetaMask, Hardhat, and web3.js.

## Table of Contents
- [Overview](#overview)
- [Features](#features)
- [Getting Started](#getting-started)
  - [Prerequisites](#prerequisites)
  - [Installation](#installation)
  - [Docker](#docker)
  - [Configuration](#configuration)
- [Paymaster (Gasless Transactions)](#paymaster-gasless-transactions)
  - [Overview](#overview-1)
  - [Why It Matters](#why-it-matters)
  - [Configuration Overview](#configuration-overview)
  - [Behavior Summary](#behavior-summary)
  - [Example Configuration](#example-configuration)
  - [Example Use Cases](#example-use-cases)
  - [Best Practices](#best-practices)
  - [References](#references)
- [Testing](#testing)
- [Metrics](#metrics)
- [License](#license)

## Overview

The relay serves as a compatibility layer between Ethereum-style JSON-RPC calls and the Hedera Consensus Service, enabling seamless smart contract interactions on Hedera while maintaining compatibility with existing EVM tools and workflows.

## Features

- Full support for `eth_*` JSON-RPC methods
- Mirror Node integration for state queries
- Consensus Node integration for transaction submission
- WebSocket (`eth_subscribe`, `eth_unsubscribe`, `eth_chainId`) and HTTP support
- Docker, Docker Compose, and Helm deployment
- Metrics endpoint for Prometheus/Grafana
- Conformity tests for Ethereum JSON-RPC compliance

## Getting Started

### Prerequisites

- Node.js 20+
- npm or pnpm
- Access to a Hedera network (mainnet, testnet, or previewnet)

### Installation

```bash
git clone https://github.com/hiero-ledger/hiero-json-rpc-relay.git
cd hiero-json-rpc-relay
npm install
npm run build
npm run start
```

### Docker

```bash
docker compose up --build
```

### Configuration

The relay is configured via environment variables. You can copy `.env.example` to `.env` and edit as needed.

| Variable | Description | Default |
|-----------|-------------|----------|
| `HEDERA_NETWORK` | The Hedera network to connect to (`mainnet`, `testnet`, `previewnet`) | `testnet` |
| `MIRROR_NODE_URL` | URL of the mirror node REST API |  |
| `OPERATOR_ID` | Operator account ID used to submit transactions |  |
| `OPERATOR_KEY` | Operator private key (ECDSA or ED25519) |  |
| `PORT_HTTP` | HTTP port for JSON-RPC requests | `7546` |
| `PORT_WS` | WebSocket port | `8546` |
| `LOG_LEVEL` | Logging verbosity | `info` |

## Paymaster (Gasless Transactions)

Starting in v0.71, the relay supports a Paymaster-style mode that allows operators to sponsor gas fees for selected users or contracts — enabling gasless transactions and simpler onboarding.

### Overview

In traditional Web3 environments, every transaction must include a gas payment from the user’s account. This can be a major UX barrier for mainstream or onboarding-focused applications.

Hedera’s Paymaster-style model (via the JSON-RPC Relay) lets a relay or operator sponsor gas fees for certain users or contract calls — safely, predictably, and transparently.

### Why It Matters

- **Better user experience:** Users can perform blockchain actions (e.g., mint, vote, update state) without holding HBAR, lowering entry friction.
- **Flexible monetization models:** Apps and relays can sponsor user activity and handle costs off-chain, via credits, fiat billing, or usage quotas.
- **Expanded enterprise and consumer use cases:** Promotions or onboarding campaigns, sponsored partner apps, delegated submission by a backend, gasless NFT or DeFi interactions.
- **Seamless integration:** Fees can be paid by the relay without changing `msg.sender`, so existing contracts, wallets, and tools continue to work as-is — no special signatures or code changes required.

### Configuration Overview

Starting from v0.71, three parameters govern paymaster behavior:

| Parameter | Description | Type | Default |
| ---------- | ------------ | ---- | -------- |
| `PAYMASTER_ENABLED` | Enables paymaster functionality. Must be true for gas subsidies to apply. | Boolean | false |
| `PAYMASTER_WHITELIST` | Comma-separated list of addresses (EOAs or contracts) eligible for gas sponsorship. Use "*" to allow all. | String | "" |
| `MAX_GAS_ALLOWANCE_HBAR` | Maximum gas subsidy (in HBAR) per write transaction. Only applies if paymaster is enabled and address is whitelisted. | Decimal (HBAR) | 0 |

**Note:** `MAX_GAS_ALLOWANCE_HBAR` is subordinated to the paymaster settings. It has no effect unless both `PAYMASTER_ENABLED=true` and the transaction’s sender is included in the whitelist.

**Technical note:** For the paymaster subsidy to work correctly, the sender must explicitly set the gas price to `0` to indicate they do not intend to pay any fees. This is necessary both on the client side and the network side. On the client side, it prevents errors in tools that check whether the user’s balance is sufficient to cover transaction costs. On the network side, it signals to Hedera that the sender is not paying, allowing the relay to safely attach the gas allowance while preserving transaction integrity.

### Behavior Summary

1. Enable paymaster mode explicitly by setting `PAYMASTER_ENABLED=true`.
2. Define which users or contracts can receive subsidies with `PAYMASTER_WHITELIST`.
   - Use specific addresses for tight control.
   - Use "*" to allow all transactions (not recommended for production).
3. When both are active:
   - The relay attaches a max gas allowance (in HBAR) to qualifying write transactions.
   - The payer account (configured in the relay) covers up to that cap in gas costs.
   - If execution costs exceed the cap or sender is not whitelisted, no subsidy is applied.

### Example Configuration

```bash
# Enable paymaster mode
PAYMASTER_ENABLED=true

# Allow all addresses (demo or testnet only)
PAYMASTER_WHITELIST=*

# Subsidize up to 0.15 HBAR per write transaction
MAX_GAS_ALLOWANCE_HBAR=0.15
```

Example for production:

```bash
# Restrict sponsorship to known contract addresses
PAYMASTER_ENABLED=true
PAYMASTER_WHITELIST=0xabc123...,0xdef456...
MAX_GAS_ALLOWANCE_HBAR=0.10
```

## Testing

You can verify the relay by running:

```bash
npm run test
```

Example query:

```bash
curl -X POST -H 'Content-Type: application/json'   -d '{"jsonrpc":"2.0","id":"2","method":"eth_chainId","params":[null]}'   http://localhost:7546
```

Expected response:

```json
{"jsonrpc":"2.0","id":"2","result":"0x128"}
```


### Example Use Cases

| Scenario | Description | Typical Settings |
| -------- | ------------ | ---------------- |
| App onboarding | Cover gas for first user actions | `PAYMASTER_ENABLED=true`, `PAYMASTER_WHITELIST=*`, `MAX_GAS_ALLOWANCE_HBAR=0.2` |
| Enterprise backend | Relay service submits and sponsors app-level writes | `PAYMASTER_ENABLED=true`, `PAYMASTER_WHITELIST=<app contracts>`, `MAX_GAS_ALLOWANCE_HBAR=0.5` |
| Community relay | Sponsored dApp with capped user updates | `PAYMASTER_ENABLED=true`, `PAYMASTER_WHITELIST=*`, `MAX_GAS_ALLOWANCE_HBAR=0.1` |

### Best Practices

- Always explicitly enable paymaster mode — subsidies are disabled by default.
- Use `PAYMASTER_WHITELIST` to limit risk exposure.
- Start with a small gas cap (e.g., 0.1 HBAR) and monitor usage.
- Track and log relay-side spend for auditing or off-chain billing.
- Avoid `PAYMASTER_WHITELIST=*` in production unless fully sandboxed.

### References

- [PR #3941: Paymaster Use Cases and Rationale](https://github.com/hiero-ledger/hiero-json-rpc-relay/pull/3941)
- [Relay Configuration Docs](https://github.com/hiero-ledger/hiero-json-rpc-relay)


## Metrics

A Prometheus metrics endpoint is available at `/metrics` for operational monitoring.

## License

Apache 2.0
