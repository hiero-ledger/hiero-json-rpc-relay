##  Hedera JSON-RPC `msg.value` Precision Test

This project demonstrates a precision-related quirk when deploying and interacting with smart contracts on **Hedera via Ethereum-compatible JSON-RPC**.

## Purpose

The goal is to **highlight the difference in how `msg.value` is handled on Hedera versus Ethereum** networks:

- On **Ethereum**, `msg.value` is received and processed exactly as sent (e.g., 10 Gwei = 10,000,000,000 wei).
- On **Hedera**, due to an internal design choice, the **value is automatically divided by 10¹⁰** at the consensus layer before the smart contract receives it.

This can lead to **unexpected behavior**, especially when relying on precise token amounts, event emissions, or logic that compares `msg.value`.

## What It Does

The smart contract:

- Accepts payable calls via a `testEmittedValues()` function.
- Emits an event containing:
    - The original sender
    - The received `msg.value`
    - A transaction count

The test script:

- Sends an exact value (e.g., 10 Gwei)
- Reads the emitted event
- Logs the received `msg.value`
- Compares the expected vs actual value
- **Fails on Hedera** (intentionally) to demonstrate the mismatch

## Why This Matters

When building apps on Hedera using Ethereum-compatible tooling (e.g. MetaMask, Hardhat, Ethers.js), you might assume values are handled in the same way. This test shows why such assumptions can break:

> On Hedera, `msg.value` appears **10000000000x smaller** than on Ethereum.

## Why This Can't Be Easily Fixed on Hedera's Side
Although the precision mismatch might seem like it could be fixed by multiplying or dividing the affected values by 10¹⁰, there is no reliable way for Hedera's JSON-RPC relay to determine which values were originally passed as msg.value and which were normal integers inside the smart contract.

In our example:
```
emit ValueReceived(msg.sender, msg.value, transactionCount);
```
Both `msg.value` and `transactionCount` are emitted as `uint256` values. But only `msg.value` is affected by Hedera's internal conversion (divided by 10¹⁰). From the outside, they look identical in the emitted event.

Hedera cannot safely or automatically distinguish between these cases in the event logs or transaction output.

This means:

1. We cannot simply auto-correct all integers in emitted events or return data.
2. Developers must be aware of this difference and account for it in both contract logic and client applications.

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
2. Run `npx @hashgraph/hedera-local start -d`
3. Run `npx hardhat test`
