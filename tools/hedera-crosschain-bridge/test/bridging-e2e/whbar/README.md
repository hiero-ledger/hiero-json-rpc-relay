# WHBAR Cross-Chain Bridge End-to-End Test Suite

## Overview

This comprehensive end-to-end test validates the complete WHBAR (Wrapped HBAR) bridging functionality between **Hedera Testnet** and **Sepolia Testnet** using LayerZero's Omnichain Fungible Token (OFT) Adapter pattern. The test demonstrates a full bidirectional cross-chain token transfer flow, ensuring that WHBAR tokens can be seamlessly moved between networks while maintaining 1:1 parity.

### What This Test Validates

- **Infrastructure Deployment**: Automatic deployment of WHBAR contracts, ERC20 tokens, and OFT Adapters on both networks
- **HBAR to WHBAR Conversion**: Converting native HBAR to wrapped WHBAR on Hedera
- **Cross-Chain Transfer Execution**: Bidirectional transfers (Hedera ↔ Sepolia) via LayerZero
- **Balance Verification**: Comprehensive balance tracking and validation throughout the process
- **LayerZero Integration**: Proper peer configuration and message passing between networks
- **Token Economics**: Ensuring 1:1 cross-chain parity and proper token locking/unlocking

### Test Architecture

The test simulates a complete bridge infrastructure from scratch:

```
┌─────────────────┐                    ┌─────────────────┐
│   Hedera        │                    │   Sepolia       │
│   Testnet       │                    │   Testnet       │
├─────────────────┤                    ├─────────────────┤
│ WHBAR Contract  │◄──── LayerZero ────┤ ERC20 Contract  │
│ OFT Adapter     │      V2 Bridge     │ OFT Adapter     │
│ SimpleReceiver  │                    │ SimpleReceiver  │
└─────────────────┘                    └─────────────────┘
```

## Prerequisites

### Required Accounts & Funding

1. **Hedera Testnet Account**:

   - Account with sufficient HBAR for transactions (~10 HBAR recommended)
   - Private key with deployment and transaction permissions

2. **Sepolia Testnet Account**:
   - Account with sufficient SepoliaETH for gas fees (~0.1 ETH recommended)
   - Private key with deployment and transaction permissions

### Dependencies

Ensure you have the following installed:

- **Node.js** (v16 or higher)
- **npm** or **yarn**
- **Git**

All project dependencies will be installed via npm.

## Environment Setup

### 1. Copy and Configure Environment File

```bash
# Navigate to the project root
cd /path/to/hedera-json-rpc-relay/tools/hedera-crosschain-bridge

# Copy the example environment file
cp .env.example .env
```

### 2. Fill Out Required Environment Variables

Edit the `.env` file with your network configurations:

```bash
# =============================================================================
# HEDERA NETWORK CONFIGURATION
# =============================================================================

# Hedera Testnet Chain ID
HEDERA_CHAIN_ID=296

# Hedera JSON-RPC endpoint URL
HEDERA_RPC_URL=https://testnet.hashio.io/api

# Hedera account private key (without 0x prefix)
HEDERA_PK=your_hedera_private_key_here

# Hedera block explorer URL
HEDERA_BLOCK_EXPLORER_URL=https://hashscan.io/testnet

# LayerZero V2 Endpoint for Hedera Testnet
HEDERA_LZ_ENDPOINT_V2=0x6EDCE65403992e310A62460808c4b910D972f10f

# LayerZero Endpoint ID (EID) for Hedera Testnet
HEDERA_LZ_EID_V2=40267

# =============================================================================
# SEPOLIA NETWORK CONFIGURATION
# =============================================================================

# Sepolia Testnet Chain ID
SEPOLIA_CHAIN_ID=11155111

# Sepolia JSON-RPC endpoint URL
SEPOLIA_RPC_URL=https://sepolia.infura.io/v3/YOUR_INFURA_PROJECT_ID

# Sepolia account private key (without 0x prefix)
SEPOLIA_PK=your_sepolia_private_key_here

# Sepolia block explorer URL
SEPOLIA_BLOCK_EXPLORER_URL=https://sepolia.etherscan.io

# LayerZero V2 Endpoint for Sepolia Testnet
SEPOLIA_LZ_ENDPOINT_V2=0x6EDCE65403992e310A62460808c4b910D972f10f

# LayerZero Endpoint ID (EID) for Sepolia Testnet
SEPOLIA_LZ_EID_V2=40161
```

### 3. Where to Find Configuration Values

#### Hedera Configuration:

- **HEDERA_RPC_URL**: Use `https://testnet.hashio.io/api` (public endpoint)
- **HEDERA_PK**: Export from your Hedera wallet (HashPack, Blade, etc.)
- **HEDERA_LZ_ENDPOINT_V2**: LayerZero V2 endpoint address on Hedera Testnet
- **HEDERA_LZ_EID_V2**: LayerZero Endpoint ID for Hedera (40267)

**Useful Links**:

- [HashScan Testnet Explorer](https://hashscan.io/testnet)
- [Hedera Portal (Account Creation)](https://portal.hedera.com)
- [Hedera Faucet](https://portal.hedera.com/faucet)

#### Sepolia Configuration:

- **SEPOLIA_RPC_URL**: Get from [Infura](https://infura.io/), [Alchemy](https://alchemy.com/), or use public endpoints
- **SEPOLIA_PK**: Export from MetaMask or other Ethereum wallet
- **SEPOLIA_LZ_ENDPOINT_V2**: LayerZero V2 endpoint address on Sepolia
- **SEPOLIA_LZ_EID_V2**: LayerZero Endpoint ID for Sepolia (40161)

**Useful Links**:

- [Sepolia Etherscan](https://sepolia.etherscan.io)
- [Sepolia Faucet](https://sepoliafaucet.com/)
- [LayerZero V2 Endpoints](https://docs.layerzero.network/v2/developers/evm/technical-reference/deployed-contracts)

## Installation

```bash
# Navigate to the project directory
cd /path/to/hedera-json-rpc-relay/tools/hedera-crosschain-bridge

# Install dependencies
npm install

# Verify environment setup
npm run compile
```

## How the Test Works

### Cross-Chain Bridge Flow

The test executes a comprehensive 9-phase flow:

#### **Phase 1-2: Infrastructure Setup**

1. **Contract Deployment**: Deploys WHBAR, ERC20, OFT Adapters, and receiver contracts
2. **HBAR Conversion**: Converts native HBAR to WHBAR tokens on Hedera

#### **Phase 3-5: Dual-Mode Configuration**

3. **Source Mode Setup**: Approves tokens for outgoing cross-chain transfers
4. **Destination Mode Setup**: Pre-funds adapters for incoming token unlocking
5. **Balance Validation**: Verifies all contracts have sufficient balances

#### **Phase 6-7: LayerZero Integration**

6. **Peer Configuration**: Establishes bidirectional LayerZero peer connections
7. **Cross-Chain Execution**: Executes transfers in both directions simultaneously

#### **Phase 8-9: Verification**

8. **Transfer Monitoring**: Waits for LayerZero message delivery and balance updates
9. **Final Validation**: Comprehensive balance verification and test summary

### Transfer Mechanics

**Hedera → Sepolia Transfer**:

1. User approves WHBAR to OFT Adapter on Hedera
2. Adapter locks WHBAR tokens on Hedera
3. LayerZero message sent to Sepolia
4. Sepolia adapter receives message and unlocks equivalent ERC20 tokens

**Sepolia → Hedera Transfer**:

1. User approves ERC20 to OFT Adapter on Sepolia
2. Adapter locks ERC20 tokens on Sepolia
3. LayerZero message sent to Hedera
4. Hedera adapter receives message and unlocks equivalent WHBAR tokens

## Running the Test

### Quick Start (Recommended)

```bash
# Run the complete WHBAR bridge test suite
npm run whbar-e2e-test
```

This single command will:

- Compile all contracts
- Execute the complete end-to-end test flow
- Display comprehensive progress logs and results

### Alternative: Direct Hardhat Execution

```bash
# Run with Hardhat directly
npx hardhat test test/bridging-e2e/whbar/whbar-e2e-hedera-sepolia.spec.ts --network hedera
```

### Test Execution Time

⏱️ **Expected Duration**: 10-15 minutes

- Contract deployments: ~2-3 minutes
- Cross-chain transfers: ~5-10 minutes (depends on network congestion)
- Balance verification: ~1-2 minutes

## Expected Test Output

### Successful Test Execution

When the test runs successfully, you'll see detailed phase-by-phase progress:

```
=============== Hedera <-> Sepolia Crosschain E2E Bridge Flow Initiated ===============

=============== PHASE 1: Hedera Infrastructure Setup ===============
Deploying WHBAR on hedera...
✓ WHBAR contract deployed at: 0x1234...

Deploying SimpleReceiver on hedera...
✓ SimpleReceiver deployed at: 0x5678...
Deploying ExampleOFTAdapter on hedera...

✓ OFT Adapter deployed at: 0x9abc...

=============== PHASE 2: HBAR to WHBAR Conversion ===============
Depositing 3 HBAR to mint WHBAR...
✓ HBAR deposit successful: txHash=0xdef0...
✓ WHBAR minted successfully: 300000000 tokens

... [Detailed progress for all 9 phases] ...

🎉 WHBAR BRIDGE E2E TEST SUMMARY

📋 Networks:
  • Hedera Testnet (Chain ID: 296, LayerZero EID: 40267)
  • Sepolia Testnet (Chain ID: 11155111, LayerZero EID: 40161)

🏗️ Deployed Contracts:
  • Hedera WHBAR: 0x1234...
  • Hedera OFT Adapter: 0x9abc...
  • Sepolia ERC20: 0x2345...
  • Sepolia OFT Adapter: 0xcdef...

💸 Cross-Chain Transfers:
  • Hedera → Sepolia: ✅ COMPLETED
    - Amount: 100000000 WHBAR
    - Transaction: https://hashscan.io/testnet/tx/0x...
    - LayerZero: https://testnet.layerzeroscan.com/tx/0x...

  • Sepolia → Hedera: ✅ COMPLETED
    - Amount: 100000000 ERC20
    - Transaction: https://sepolia.etherscan.io/tx/0x...
    - LayerZero: https://testnet.layerzeroscan.com/tx/0x...

📊 Final Balances:
  • Sepolia Receiver: 100000000 (+100000000)
  • Hedera Receiver: 100000000 (+100000000)

✅ ALL TRANSFERS COMPLETED SUCCESSFULLY!
   🔄 Bridge Functionality: FULLY OPERATIONAL
   💰 Token Economics: 1:1 cross-chain parity maintained
   🌐 Interoperability: Hedera ↔ Sepolia bridging confirmed

=============== Hedera <-> Sepolia Crosschain E2E Bridge Flow Completed ===============
```

### Key Success Indicators

✅ **Contract Deployments**: All contracts deploy successfully with valid addresses  
✅ **Balance Tracking**: Pre/post transfer balances are accurately recorded  
✅ **Cross-Chain Completion**: Both transfers complete within 15 minutes  
✅ **1:1 Parity**: Receiver balances match expected transfer amounts  
✅ **Transaction Links**: Valid HashScan and LayerZero scan URLs provided

## Troubleshooting

### Common Issues

#### 1. **Environment Variable Errors**

```
Error: Missing required environment variables for Hedera network
```

**Solution**: Verify all required variables in `.env` are set correctly

#### 2. **Insufficient Balance Errors**

```
Error: insufficient funds for intrinsic transaction cost
```

**Solution**: Fund your accounts:

- **Hedera**: Get HBAR from [Hedera Faucet](https://portal.hedera.com/faucet)
- **Sepolia**: Get ETH from [Sepolia Faucet](https://sepoliafaucet.com/)

#### 3. **Network Connection Issues**

```
Error: could not detect network
```

**Solution**:

- Verify RPC URLs are accessible
- Check if endpoints are rate-limited
- Try alternative RPC providers

#### 4. **LayerZero Transfer Delays**

```
Some transfers still pending completion
```

**Solution**: This is normal! Cross-chain transfers can take 2-15 minutes depending on:

- Network congestion
- LayerZero validator processing time
- Gas price fluctuations

Monitor progress using the provided LayerZero scan links.

### Support Resources

- **LayerZero Documentation**: [docs.layerzero.network](https://docs.layerzero.network)
- **Hedera Documentation**: [docs.hedera.com](https://docs.hedera.com)
- **LayerZero Testnet Scanner**: [testnet.layerzeroscan.com](https://testnet.layerzeroscan.com)
- **Hedera Testnet Explorer**: [hashscan.io/testnet](https://hashscan.io/testnet)
- **Sepolia Explorer**: [sepolia.etherscan.io](https://sepolia.etherscan.io)

## Test Architecture Details

### Smart Contracts Deployed

| Contract              | Network | Purpose                                         |
| --------------------- | ------- | ----------------------------------------------- |
| **WHBAR**             | Hedera  | Wrapped HBAR token (ERC20-compatible)           |
| **ERC20Mock**         | Sepolia | Test ERC20 token (8 decimals, matches WHBAR)    |
| **ExampleOFTAdapter** | Both    | LayerZero OFT Adapter for cross-chain transfers |
| **SimpleReceiver**    | Both    | Test receiver contracts for transfer validation |

### Key Test Parameters

| Parameter           | Value             | Purpose                                    |
| ------------------- | ----------------- | ------------------------------------------ |
| **HBAR Funding**    | 5 HBAR            | Initial HBAR deposit for WHBAR minting     |
| **Transfer Amount** | 1 HBAR equivalent | Amount for each cross-chain transfer       |
| **Gas Limit**       | 3,000,000         | LayerZero message gas limit                |
| **Timeout**         | 15 minutes        | Maximum test execution time                |
| **Tolerance**       | 0.001 tokens      | Acceptable balance variance for validation |

### Security Considerations

- ✅ **Private Key Isolation**: Uses testnet-only accounts
- ✅ **Amount Validation**: Transfers use predefined safe amounts
- ✅ **Balance Verification**: Comprehensive pre/post balance checking
- ✅ **Timeout Protection**: Test automatically fails after 15 minutes
- ✅ **Network Isolation**: Only testnet networks are supported

**Note**: This test suite is designed for testnet environments only. Never use mainnet credentials or attempt to run against production networks.
