# Interaction Scripts

This directory contains scripts for executing contract operations, transactions, and business logic workflows. All interaction scripts follow standardized practices to ensure consistency across different environments and use cases.

## Prerequisites

Before running any interaction script, ensure you have:

1. **Environment Configuration**: Set up your `.env` file based on `.env.example`
2. **Network Access**: Ensure you have access to the target network's RPC endpoint
3. **Account Funding**: Verify your account has sufficient funds for gas fees
4. **Dependencies**: Run `npm install` to install all required dependencies
5. **Deployed Contracts**: Ensure the contracts you want to interact with are already deployed

## Available Interaction Scripts

### 1. OFT Adapter Peer Configuration (`set-oft-adapter-peer.ts`)

Configures peer connections between OFT (Omnichain Fungible Token) Adapter contracts across different blockchain networks using LayerZero protocol.

**Purpose**: Establishes bidirectional communication channels between OFT Adapter contracts on different chains to enable cross-chain token transfers.

**Usage**:

```bash
SOURCE_OFTADAPTER_ADDRESS=0x... TARGET_OFTADAPTER_ADDRESS=0x... npm run set-oft-adapter-peer -- --network hedera
```

```bash
SOURCE_OFTADAPTER_ADDRESS=0x... TARGET_OFTADAPTER_ADDRESS=0x... npm run set-oft-adapter-peer -- --network sepolia
```

**Required Parameters**:

- `SOURCE_OFTADAPTER_ADDRESS`: The address of the source OFT Adapter contract (required)
- `TARGET_OFTADAPTER_ADDRESS`: The address of the target OFT Adapter contract (required)

**Examples**:

Setting up Hedera to Sepolia peer connection:

```bash
SOURCE_OFTADAPTER_ADDRESS=0x1234567890123456789012345678901234567890 TARGET_OFTADAPTER_ADDRESS=0x0987654321098765432109876543210987654321 npm run set-oft-adapter-peer -- --network hedera
```

Setting up Sepolia to Hedera peer connection:

```bash
SOURCE_OFTADAPTER_ADDRESS=0x0987654321098765432109876543210987654321 TARGET_OFTADAPTER_ADDRESS=0x1234567890123456789012345678901234567890 npm run set-oft-adapter-peer -- --network sepolia
```

**Expected Output**:

1. **Parameter Overview Table**: Displays all input parameters for verification
2. **Execution Summary Table**: Contains transaction details and raw values
3. **Block Explorer Links Table**: Contains clickable URLs (when block explorer URL is configured)

**What it does**:

1. Validates input parameters and network configuration
2. Connects to the source OFT Adapter contract
3. Calls the `setPeer` function with the target chain's LayerZero Endpoint ID and target adapter address
4. Formats the target address to bytes32 format as required by LayerZero protocol
5. Waits for transaction confirmation and reports results

**Common Issues**:

- **Invalid address format**: Ensure both addresses are valid 40-character hex strings starting with `0x`
- **LayerZero configuration missing**: Check that `HEDERA_LZ_EID_V2` or `SEPOLIA_LZ_EID_V2` is set in environment
- **Insufficient funds**: Ensure your account has enough native tokens for gas fees
- **Contract not found**: Verify the source OFT Adapter address exists and is deployed
- **Permission denied**: Ensure you're using the contract owner's private key

## Contribution Guidelines

When adding new interaction scripts, ensure to follow the below for consistency:

1. Follow the same naming convention: `<action>-<component>.ts`
2. Add the corresponding npm script to `package.json` using camelCase naming
3. Use environment variables for dynamic parameters to maintain flexibility:
   - Define parameters as environment variables
   - Use the pattern: `PARAM_NAME=value npm run scriptName -- --network networkName`
   - Validate required parameters and provide clear error messages
4. Update this INTERACTION_GUIDE.md with a new section following the established format
