# Hedera Crosschain Bridge (WIP)

A LayerZero-based bridging solution that enables seamless bidirectional token transfers between Hedera and Sepolia networks. This implementation supports both WHBAR and HTS (Hedera Token Service) tokens, providing a robust foundation for cross-chain interoperability.

## Overview

The Hedera Crosschain Bridge project leverages LayerZero's proven cross-chain messaging infrastructure to facilitate secure token transfers between Hedera and Ethereum ecosystems. The solution is designed with production readiness in mind, featuring comprehensive testing frameworks, DevOps-friendly deployment scripts, and modular architecture for easy maintenance and scaling.

## Supported Use Cases

### Case A: WHBAR Bridging

- **Purpose**: Enable WHBAR (Wrapped HBAR) transfers between Hedera and Sepolia
- **Architecture**: OFTAdapter on both networks with 1:1 token peg
- **Flow**: Hedera WHBAR ↔ Sepolia ERC20

### Case B: Custom HTS Token Bridging

- **Purpose**: Bridge custom HTS tokens created on Hedera to ERC20 tokens on Sepolia
- **Architecture**: HTSConnector on Hedera with mint/burn mechanism, standard ERC20 on Sepolia
- **Flow**: Custom HTS Token ↔ ERC20 token

## Architecture

The bridge system consists of four key components:

1. **OFTAdapter (Sepolia)** - Lockbox contract for ERC20 tokens
2. **OFTAdapter (Hedera)** - Lockbox contract for WHBAR tokens
3. **HTSConnector (Hedera)** - Manages HTS token minting/burning for custom tokens
4. **LayerZero Protocol** - Provides secure cross-chain messaging infrastructure

```
┌─────────────────┐    LayerZero Protocol     ┌─────────────────┐
│     Hedera      │◄─────────────────────────►│     Sepolia     │
│                 │                           │                 │
│ ┌─────────────┐ │                           │ ┌─────────────┐ │
│ │ OFTAdapter  │ │     Case A: WHBAR         │ │ OFTAdapter  │ │
│ │   (WHBAR)   │ │                           │ │  (ERC20)    │ │
│ └─────────────┘ │                           │ └─────────────┘ │
│                 │                           │                 │
│ ┌─────────────┐ │                           │ ┌─────────────┐ │
│ │HTSConnector │ │   Case B: Custom Token    │ │   ERC20     │ │
│ │ (HTS Token) │ │                           │ │  Contract   │ │
│ └─────────────┘ │                           │ └─────────────┘ │
└─────────────────┘                           └─────────────────┘
```

## Key Features

- **Bidirectional Transfers**: Seamless token movement in both directions
- **Token Economics**: Maintains 1:1 peg for WHBAR and supply consistency for HTS tokens
- **Security**: Built on LayerZero's battle-tested infrastructure
- **DevOps Ready**: Deployment scripts support managed private keys and environment-specific configurations
- **Self-Contained Testing**: Autonomous test suites with programmatic contract deployment
- **Modular Design**: Clean separation between WHBAR and HTS token handling

## Token Economics

- **WHBAR**: Maintains 1:1 peg with HBAR through deposit/withdrawal mechanism
- **HTS Tokens**: Use mint/burn model to maintain total supply consistency across networks
- **ERC20 Tokens**: Utilize standard lock/unlock mechanism for secure bridging

## Testing Strategy

The project includes comprehensive test suites for both supported use cases:

### WHBAR Bridge Testing (`whbar-bridge-test.js`)

1. Deposit HBAR → mint WHBAR tokens
2. Approve OFTAdapter to spend WHBAR
3. Send WHBAR from Hedera → Sepolia
4. Verify wrapped WHBAR balance on Sepolia
5. Send wrapped WHBAR from Sepolia → Hedera
6. Verify WHBAR balance restoration on Hedera

### HTS Bridge Testing (`hts-bridge-test.js`)

1. Deploy ERC20 token on Sepolia
2. Deploy HTSConnector on Hedera (creates HTS token)
3. Approve HTSConnector to manage HTS tokens
4. Send HTS tokens from Hedera → Sepolia
5. Verify ERC20 token minting on Sepolia
6. Send ERC20 tokens from Sepolia → Hedera
7. Verify HTS token restoration on Hedera

## Getting Started

### Prerequisites

- Node.js and npm
- Hardhat development environment
- Access to Hedera Testnet and Sepolia networks
- Private keys for deployment accounts

### Environment Configuration

Create a .env file based on the .env.example file and fill out the configurations:

```bash
# Hedera Network Configuration
HEDERA_CHAIN_ID=
HEDERA_RPC=
HEDERA_PK=
HEDERA_LZ_ENDPOINT_V2=
HEDERA_LZ_EID_V2=

# Sepolia Network Configuration
SEPOLIA_CHAIN_ID=
SEPOLIA_RPC=
SEPOLIA_PK=
SEPOLIA_LZ_ENDPOINT_V2=
SEPOLIA_LZ_EID_V2=
```

### Installation

```bash
npm install
```

### Deployment

TBD

### Running Tests

TBD
