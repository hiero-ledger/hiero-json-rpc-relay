# Hardhat example

Simple scripts for basic operations like hbars transfer, balance fetching, and contract interactions (deployment and calls).

## Prerequisite

You must have running:

- JSON-RPC Relay

## Configuration

Create `.env` file based on `.env.example`

```
# Alias accounts keys
OPERATOR_PRIVATE_KEY=
RECEIVER_PRIVATE_KEY=
```

## Setup & Install

In the project directory:

1. Run `npm install`
2. Run `npx @hashgraph/solo one-shot single deploy --dev`
3. Run `npx hardhat test`
