# HTS-ERC20 Cross-Chain Bridge End-to-End Test Suite

## Overview

This comprehensive end-to-end test validates the complete HTS - ERC20 bridging functionality between **Hedera Testnet** and **Sepolia Testnet**
using LayerZero's Omnichain Fungible Token (OFT) Adapter pattern and Hedera's HTS Connector. The test demonstrates a full bidirectional cross-chain token transfer
flow, ensuring that HTS and ERC20 tokens can be seamlessly moved between networks while maintaining 1:1 parity.

### What This Test Validates

- **Infrastructure Deployment**: Automatic deployment of OFT and HTS Connector contracts on both networks
- **Cross-Chain Transfer Execution**: Bidirectional transfers (Hedera ↔ Sepolia) via LayerZero
- **Balance Verification**: Comprehensive balance tracking and validation throughout the process
- **LayerZero Integration**: Proper peer configuration and message passing between networks
- **Token Economics**: Ensuring 1:1 cross-chain parity and proper token locking/unlocking

### Test Architecture

The test simulates a complete bridge infrastructure from scratch:

```
┌───────────────┐                              ┌──────────────┐
│   Hedera      │                              │   Sepolia    │
│   Testnet     │                              │   Testnet    │
├───────────────┤                              ├──────────────┤
│ HTS Connector │◄──── LayerZero V2 Bridge ────┤ OFT Contract │
│               │                              │              │
└───────────────┘                              └──────────────┘
```

## Prerequisites

### Required Accounts & Funding

1. **Hedera Testnet Account**:

   - Account with sufficient HBAR for transactions (~50 HBAR recommended)
   - Private key with deployment and transaction permissions
   - Account must have "Auto. Associations" enabled or must execute `npx hardhat run scripts/utils/update-account-associations.ts --network hedera` beforehand

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

1. **Hedera Contract Deployment**: Deploys OFT contract
2. **Sepolia Contract Deployment**: Deploys HTS Connector contract

#### **Phase 3: LayerZero Integration**

3. **Peer Configuration**: Establishes bidirectional LayerZero peer connections

#### **Phase 4: LayerZero Integration**

4. **Cross-Chain Execution**: Executes transfers in both directions simultaneously

#### **Phase 5: Verification**

5. **Transfer Monitoring**: Waits for LayerZero message delivery and balance updates
6. **Final Validation**: Comprehensive balance verification and test summary

### Transfer Mechanics

**Hedera → Sepolia Transfer**:

1. User approves HTS Connector to spend HTS tokens
2. LayerZero message sent to Sepolia
3. Sepolia adapter receives message and mints equivalent ERC20 tokens

**Sepolia → Hedera Transfer**:

1. User sends OFT tokens
2. LayerZero message sent to Hedera
4. HTS Connector receives message and mints equivalent HTS tokens

## Running the Test

### Quick Start (Recommended)

```bash
# Run the complete HTS-ERC20 bridge test suite
npm run erc20-hts-e2e-test
```

This single command will:

- Compile all contracts
- Execute the complete end-to-end test flow
- Display comprehensive progress logs and results

### Alternative: Direct Hardhat Execution

```bash
# Run with Hardhat directly
npx hardhat test test/bridging-e2e/erc20-hts/erc20-hts-e2e-hedera-sepolia.spec.ts --network hedera
```

### Test Execution Time

⏱️ **Expected Duration**: 10-15 minutes

- Contract deployments: ~1-2 minutes
- Cross-chain transfers: ~5-10 minutes (depends on network congestion)
- Balance verification: ~1-2 minutes

## Expected Test Output

### Successful Test Execution

When the test runs successfully, you'll see detailed phase-by-phase progress:

```
=============== Hedera <-> Sepolia Cross-Chain E2E Bridge Flow Initiated ===============

Token Information:
  • Name: T_NAME_363876
  • Symbol: T_SYMBOL_80510

=============== PHASE 1: Hedera Infrastructure Setup ===============

Deploying ExampleHTSConnector on hedera...
✓ ExampleHTSConnector deployed on hedera at address: 0x1226E114E50001515e2E02B85485F3C12A6757F1
HTS token address: 0x00000000000000000000000000000000005DC99E
Hedera Signer's initial HTS balance: 1000 tokens

=============== PHASE 2: Sepolia Infrastructure Setup ===============

Deploying ExampleOFT on sepolia...
✓ ExampleOFT deployed on sepolia at address: 0x28202263F563Eada1A5278E72cbEF2df93beDde4
Sepolia Signer's initial ERC20 balance: 500000000 tokens

=============== PHASE 3: LayerZero Peer Configuration ===============

--- Phase 3A: Setting up Hedera → Sepolia LZ peer connection ---

Setting LZ peers on hedera network...
  • Source OFTAdapter Address: 0x1226E114E50001515e2E02B85485F3C12A6757F1
  • Target OFTAdapter Address: 0x28202263F563Eada1A5278E72cbEF2df93beDde4
  • Target LayerZero EID: 40161
✓ Peer for hedera network with EID 40161 was successfully set: txHash=0x93c3ee1f26f789d8db94b9c6611597e16b177a2beade55c048114e5398a4c31f
Hedera → Sepolia LZ peer configured

--- Phase 3B: Setting up Sepolia → Hedera LZ peer connection ---

Setting LZ peers on sepolia network...
  • Source OFTAdapter Address: 0x28202263F563Eada1A5278E72cbEF2df93beDde4
  • Target OFTAdapter Address: 0x1226E114E50001515e2E02B85485F3C12A6757F1
  • Target LayerZero EID: 40285
✓ Peer for sepolia network with EID 40285 was successfully set: txHash=0x6e39c9d3e47a59e8f26679d1d93932784896f1de699044a24a9a07892cad94be
Sepolia → Hedera LZ peer configured

=============== PHASE 4: HTS Connector Approval Setup ===============
Approving 100 T_NAME_363876 tokens on Hedera for cross-chain transfers...
✓ T_NAME_363876 approval successful on Hedera: txHash=0x8129067b8054dc46e7a9942e3d3c70c3992736ef4a58062427d0feea4ce2e5d4
T_NAME_363876 allowance verified on Hedera: 100 tokens

=============== PHASE 4: Cross-Chain Transfer Execution ===============

=============== PHASE 4.1: Hedera HTS to Sepolia ERC20 ===============

Initiating hedera → sepolia cross-chain transfer:
  • Amount: 100 tokens
  • Receiver: 0xF51c7a9407217911d74e91642dbC58F18E51Deac
  • Gas Limit: 3000000

Getting LayerZero fee quote for hedera cross-chain transfer...
LayerZero fee quote for hedera:
  • Native Fee: 78381612 wei
  • LZ Token Fee: 0
  • Transaction Value: 783816120000000000 tinybars

✓ Cross-chain transfer initiated successfully!

🎉 Phase 4.1 Hedera → Sepolia transfer initiated successfully!
  - Transaction Hash: 0x7c7f5c41348613ff10b453dc50d207c0d8791ae70820a7f945b61e946c80225e
  - Find transaction on Hashscan: https://hashscan.io/testnet/tx/0x7c7f5c41348613ff10b453dc50d207c0d8791ae70820a7f945b61e946c80225e
  - Find transaction on LayerZero Scan: https://testnet.layerzeroscan.com/tx/0x7c7f5c41348613ff10b453dc50d207c0d8791ae70820a7f945b61e946c80225e

=============== PHASE 4.2: Sepolia ERC20 to Hedera HTS ===============

Initiating sepolia → hedera cross-chain transfer:
  • Amount: 100 tokens
  • Receiver: 0xF51c7a9407217911d74e91642dbC58F18E51Deac
  • Gas Limit: 3000000

Getting LayerZero fee quote for sepolia cross-chain transfer...
LayerZero fee quote for sepolia:
  • Native Fee: 158619898816678 wei
  • LZ Token Fee: 0
  • Transaction Value: 158619898816678 wei

✓ Cross-chain transfer initiated successfully!

🎉 Phase 4.2 Sepolia → Hedera transfer initiated successfully!
  - Transaction Hash: 0x5ad44a9e497e042241ca636c0b18515850599294354096214c3df87abaeed2e4
  - Find transaction on Sepolia: https://sepolia.etherscan.io/tx/0x5ad44a9e497e042241ca636c0b18515850599294354096214c3df87abaeed2e4
  - Find transaction on LayerZero Scan: https://testnet.layerzeroscan.com/tx/0x5ad44a9e497e042241ca636c0b18515850599294354096214c3df87abaeed2e4

=============== PHASE 5: Receiver Balance Verification After Cross-Chain Transfers ===============
Waiting for multiple cross-chain transfers to complete...
 • Attempt 1/30: Checking all receiver balances...
   • Hedera → Sepolia - Current: 0, Increase: 0
   • Sepolia → Hedera - Current: 0, Increase: 0
   ⌛ Pending transfers: Hedera → Sepolia, Sepolia → Hedera... retrying in 30 seconds
 • Attempt 2/30: Checking all receiver balances...
   • Hedera → Sepolia - Current: 0, Increase: 0
   • Sepolia → Hedera - Current: 100, Increase: 100
    ✅ Sepolia → Hedera completed! Receiver received 100 tokens
   ⌛ Pending transfers: Hedera → Sepolia... retrying in 30 seconds
 • Attempt 3/30: Checking all receiver balances...
   • Hedera → Sepolia - Current: 100, Increase: 100
    ✅ Hedera → Sepolia completed! Receiver received 100 tokens

🎉 All cross-chain transfers completed successfully!
This test validates the complete ERC20 - HTS bridging infrastructure using LayerZero V2.

=============== Hedera <-> Sepolia Cross-Chain E2E Bridge Flow Completed ===============

```

### Key Success Indicators

✅ **Contract Deployments**: All contracts deploy successfully with valid addresses  
✅ **Balance Tracking**: Pre/post transfer balances are accurately recorded  
✅ **Cross-Chain Completion**: Both transfers complete within 15 minutes  
✅ **1:1 Parity**: Receiver balances match expected transfer amounts  
✅ **Transaction Links**: Valid HashScan and LayerZero scan URLs provided

## Troubleshooting

### Common Issues

#### 1. **Automatic Associations error (revert on HTS Connector deployment)**

```
Error: transaction failed [ See: https://links.ethers.org/v5-errors-CALL_EXCEPTION ]
```

**Solution**: Execute `npx hardhat run scripts/utils/update-account-associations.ts --network hedera` to update the account

#### 2. **Environment Variable Errors**

```
Error: Missing required environment variables for Hedera network
```

**Solution**: Verify all required variables in `.env` are set correctly

#### 3. **Insufficient Balance Errors**

```
Error: insufficient funds for intrinsic transaction cost
```

**Solution**: Fund your accounts:

- **Hedera**: Get HBAR from [Hedera Faucet](https://portal.hedera.com/faucet)
- **Sepolia**: Get ETH from [Sepolia Faucet](https://sepoliafaucet.com/)

#### 4. **Network Connection Issues**

```
Error: could not detect network
```

**Solution**:

- Verify RPC URLs are accessible
- Check if endpoints are rate-limited
- Try alternative RPC providers

#### 5. **LayerZero Transfer Delays**

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
| **OFT**               | Hedera  | OFT (ERC20-compatible)                          |
| **HTS Connector**     | Sepolia | HTS token wrapped in HTS Connector              |

### Security Considerations

- ✅ **Private Key Isolation**: Uses testnet-only accounts
- ✅ **Amount Validation**: Transfers use predefined safe amounts
- ✅ **Balance Verification**: Comprehensive pre/post balance checking
- ✅ **Timeout Protection**: Test automatically fails after 15 minutes
- ✅ **Network Isolation**: Only testnet networks are supported

**Note**: This test suite is designed for testnet environments only. Never use mainnet credentials or attempt to run against production networks.
