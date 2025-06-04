# Deployment Scripts

This directory contains scripts for deploying smart contracts and system components to blockchain networks. All deployment scripts follow standardized practices to ensure consistency across different environments and use cases.

## Installation

All project dependencies will be installed via npm.

```bash
# Navigate to the project directory
cd /path/to/hedera-json-rpc-relay/tools/hedera-crosschain-bridge

# Install dependencies
npm install

# Verify environment setup
npm run compile
```

## Environment Setup

### 1. Copy and Configure Environment File

```bash
# Copy the example environment file
cp .env.example .env
```

### 2. Fill Out Environment Variables

Edit the `.env` file with your network configurations:

```bash
# =============================================================================
# HEDERA NETWORK CONFIGURATION
# =============================================================================

# Hedera Chain ID (e.g. 296 for Hedera Testnet)
HEDERA_CHAIN_ID=

# Hedera JSON-RPC endpoint URL (e.g. https://testnet.hashio.io/api for Hedera Testnet)
HEDERA_RPC_URL=

# Hedera account private key
HEDERA_PK=

# Hedera block explorer URL (e.g. https://hashscan.io/testnet for Hedera Testnet)
HEDERA_BLOCK_EXPLORER_URL=

# LayerZero V2 Endpoint for Hedera Network (e.g. 0x6EDCE65403992e310A62460808c4b910D972f10f for Hedera Testnet)
# Find LZ Endpoint V2 at https://docs.layerzero.network/v2/deployments/deployed-contracts
HEDERA_LZ_ENDPOINT_V2=

# LayerZero Endpoint ID (EID) for Hedera Network (e.g. 40267 for Hedera Testnet)
# Find LZ EID V2 at https://docs.layerzero.network/v2/deployments/deployed-contracts
HEDERA_LZ_EID_V2=

# =============================================================================
# SEPOLIA NETWORK CONFIGURATION
# =============================================================================

# Sepolia Testnet Chain ID
SEPOLIA_CHAIN_ID=11155111

# Sepolia JSON-RPC endpoint URL (e.g. https://sepolia.infura.io/v3/YOUR_INFURA_PROJECT_ID)
SEPOLIA_RPC_URL=

# Sepolia account private key
SEPOLIA_PK=

# Sepolia block explorer URL
SEPOLIA_BLOCK_EXPLORER_URL=https://sepolia.etherscan.io

# LayerZero V2 Endpoint for Sepolia Testnet
SEPOLIA_LZ_ENDPOINT_V2=0x6EDCE65403992e310A62460808c4b910D972f10f

# LayerZero Endpoint ID (EID) for Sepolia Testnet
SEPOLIA_LZ_EID_V2=40161
```

**Important**: All configurations are mandatory.

**Useful Links For Configuration**:

- [Hedera Docs](https://docs.hedera.com)
- [Hedera Portal (Account Creation)](https://portal.hedera.com)
- [Hedera Faucet](https://portal.hedera.com/faucet)
- [Sepolia Etherscan](https://sepolia.etherscan.io)
- [Sepolia Faucet](https://sepoliafaucet.com/)
- [LayerZero V2 docs](https://docs.layerzero.network/v2/)
- [LayerZero V2 Endpoints](https://docs.layerzero.network/v2/developers/evm/technical-reference/deployed-contracts)

## Available Deployment Scripts

### 1. ERC20 Token Deployment (`deploy-erc20.ts`)

Deploys a mock ERC20 token contract for testing and development purposes.

**Purpose**: Creates a standard ERC20 token with configurable initial balance and decimals.

**Configuration**:

- `INITIAL_BALANCE` (optional): Initial token balance in ether units (default: 1,000,000)
- `DECIMALS` (optional): Number of decimal places for the token (default: 8)

**Example**:

```bash
INITIAL_BALANCE=3000000 DECIMALS=18 npm run deploy-erc20 -- --network hedera
```

```bash
INITIAL_BALANCE=3000000 DECIMALS=18 npm run deploy-erc20 -- --network sepolia
```

**Since the configs are optional, the scripts can be simply run as:**

```bash
npm run deploy-erc20 -- --network hedera
```

```bash
npm run deploy-erc20 -- --network sepolia
```

**Expected Output**:

1. **Execution Summary Table**: Contains all raw values for easy copying
2. **Block Explorer Links Table**: Contains clickable URLs (when block explorer URL is configured)

**Common Issues**:

- **Insufficient funds**: Ensure your account has enough native tokens for gas fees
- **Network connection**: Verify your RPC URL is accessible and correct
- **Private key format**: Ensure your private key starts with `0x`

### 2. OFT Adapter Deployment (`deploy-oft-adapter.ts`)

Deploys an Omnichain Fungible Token (OFT) Adapter contract that wraps existing ERC20 tokens for cross-chain functionality.

**Purpose**: Creates a LayerZero OFT Adapter to enable cross-chain transfers of existing ERC20 tokens.

**Configuration**:

- `TOKEN_ADDRESS` (required): The address of the existing token to wrap

**Usage**:

```bash
TOKEN_ADDRESS=0x... npm run deploy-oftAdapter -- --network hedera
```

```bash
TOKEN_ADDRESS=0x... npm run deploy-oftAdapter -- --network sepolia
```

**Example**:

```bash
TOKEN_ADDRESS=0x1234567890123456789012345678901234567890 npm run deploy-oftAdapter -- --network hedera
```

**Expected Output**:

1. **Execution Summary Table**: Contains all raw values for easy copying
2. **Block Explorer Links Table**: Contains clickable URLs (when block explorer URL is configured)

**Common Issues**:

- **Invalid token address**: Ensure the token address is a valid 40-character hex string
- **Token not found**: Verify the token exists on the target network
- **LayerZero endpoint not configured**: Check that the network has a LayerZero endpoint configured

### 3. WHBAR Token Deployment (`deploy-whbar.ts`)

Deploys a Wrapped HBAR (WHBAR) contract for testing purposes.

**Purpose**: Creates a test WHBAR token contract that represents wrapped HBAR functionality.

**Configuration**: No additional environment variables required.

**Usage**:

```bash
npm run deploy-whbar -- --network hedera
```

```bash
npm run deploy-whbar -- --network sepolia
```

**Expected Output**:

The deployment script provides two organized tables for easy reference:

1. **Execution Summary Table**: Contains all raw values for easy copying
2. **Block Explorer Links Table**: Contains clickable URLs (when block explorer URL is configured)

**Common Issues**:

- **Insufficient funds**: Ensure your account has enough native tokens for gas fees
- **Network connection**: Verify your RPC URL is accessible and correct
- **Private key format**: Ensure your private key starts with `0x`

## Troubleshooting

### Common Error Messages

**"Network configuration not found"**

- Ensure your network name matches the configured networks (`hedera` or `sepolia`)
- Verify your `.env` file contains the required configuration for the target network

**"LayerZero endpoint not configured"**

- Check that `HEDERA_LZ_ENDPOINT_V2` or `SEPOLIA_LZ_ENDPOINT_V2` is set in your environment
- Verify the endpoint address is correct for your target network

**"Insufficient funds for intrinsic transaction cost"**

- Ensure your deployment account has enough native tokens for gas fees
- Consider using a faucet for testnet tokens if needed

**"Invalid token address format"**

- Token addresses must be exactly 40 hexadecimal characters
- Ensure the address starts with `0x`

### Getting Help

If you encounter issues not covered here:

1. Check the console output for detailed error messages
2. Verify all environment variables are correctly set
3. Ensure network connectivity and RPC endpoint accessibility
4. Review the deployment transaction on the block explorer using the provided links

## Contribution Guidelines

When adding new deployment scripts, ensure to follow the below for consistency:

1. Follow the same naming convention: `deploy-<component>.ts`
2. Add the corresponding npm script to `package.json`
3. If a script requires custom parameters, use environment variables to maintain flexibility:
   - Define parameters as environment variables
   - Use the pattern: `PARAM_NAME=value npm run deploy-script -- --network networkName`
   - Validate if parameters is required in your script and provide clear error messages
4. Update this DEPLOYMENT_GUIDE with a new section following the established format
