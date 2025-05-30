# Deployment Scripts

This directory contains scripts for deploying smart contracts and system components to blockchain networks. All deployment scripts follow standardized practices to ensure consistency across different environments and use cases.

## Prerequisites

Before running any deployment script, ensure you have:

1. **Environment Configuration**: Set up your `.env` file based on `.env.example`
2. **Network Access**: Ensure you have access to the target network's RPC endpoint
3. **Account Funding**: Verify your deployment account has sufficient funds for gas fees
4. **Dependencies**: Run `npm install` to install all required dependencies

## Available Deployment Scripts

### 1. ERC20 Token Deployment (`deploy-erc20.ts`)

Deploys a mock ERC20 token contract for testing and development purposes.

**Purpose**: Creates a standard ERC20 token with configurable initial balance and decimals.

**Usage**:

```bash
npm run deploy-erc20 -- --network hedera
```

```bash
npm run deploy-erc20 -- --network sepolia
```

**Configuration**:

- `INITIAL_BALANCE` (optional): Initial token balance in ether units (default: 1,000,000)
- `DECIMALS` (optional): Number of decimal places for the token (default: 8)

**Example**:

```bash
INITIAL_BALANCE=5000000 DECIMALS=18 npm run deploy-erc20 -- --network hedera
```

```bash
INITIAL_BALANCE=5000000 DECIMALS=18 npm run deploy-erc20 -- --network sepolia
```

**Expected Output**:

1. **Deployment Summary Table**: Contains all raw values for easy copying
2. **Block Explorer Links Table**: Contains clickable URLs (when block explorer URL is configured)

**Common Issues**:

- **Insufficient funds**: Ensure your account has enough native tokens for gas fees
- **Network connection**: Verify your RPC URL is accessible and correct
- **Private key format**: Ensure your private key starts with `0x`

### 2. OFT Adapter Deployment (`deploy-oft-adapter.ts`)

Deploys an Omnichain Fungible Token (OFT) Adapter contract that wraps existing ERC20 tokens for cross-chain functionality.

**Purpose**: Creates a LayerZero OFT Adapter to enable cross-chain transfers of existing ERC20 tokens.

**Usage**:

```bash
TOKEN_ADDRESS=0x... npm run deploy-oftAdapter -- --network hedera
```

```bash
TOKEN_ADDRESS=0x... npm run deploy-oftAdapter -- --network sepolia
```

**Required Parameters**:

- `TOKEN_ADDRESS`: The address of the existing ERC20 token to wrap (required)

**Example**:

```bash
TOKEN_ADDRESS=0x1234567890123456789012345678901234567890 npm run deploy-oftAdapter -- --network hedera
```

**Expected Output**:

1. **Deployment Summary Table**: Contains all raw values for easy copying
2. **Block Explorer Links Table**: Contains clickable URLs (when block explorer URL is configured)

**Common Issues**:

- **Invalid token address**: Ensure the token address is a valid 40-character hex string
- **Token not found**: Verify the token exists on the target network
- **LayerZero endpoint not configured**: Check that the network has a LayerZero endpoint configured

### 3. WHBAR Token Deployment (`deploy-whbar.ts`)

Deploys a Wrapped HBAR (WHBAR) contract for testing purposes.

**Purpose**: Creates a test WHBAR token contract that represents wrapped HBAR functionality.

**Usage**:

```bash
npm run deploy-whbar -- --network hedera
```

```bash
npm run deploy-whbar -- --network sepolia
```

**Configuration**: No additional environment variables required.

**Expected Output**:

The deployment script provides two organized tables for easy reference:

1. **Deployment Summary Table**: Contains all raw values for easy copying
2. **Block Explorer Links Table**: Contains clickable URLs (when block explorer URL is configured)

**Common Issues**:

- **Gas estimation failure**: WHBAR deployment may require higher gas limits on some networks
- **Contract verification**: Manual verification may be needed on block explorers

### 4. OFT Deployment (`deploy-oft.ts`)

Deploys an OFT contract for testing purposes.

**Purpose**: Creates an omnichain fungible token that can be transferred across multiple chains.

**Usage**:

```bash
npm run deploy-oft -- --network hedera
```

```bash
npm run deploy-oft -- --network sepolia
```

**Configuration**: No additional environment variables required.

**Expected Output**:

The deployment script provides two organized tables for easy reference:

1. **Deployment Summary Table**: Contains all raw values for easy copying
2. **Block Explorer Links Table**: Contains clickable URLs (when block explorer URL is configured)

**Common Issues**:

- **Contract verification**: Manual verification may be needed on block explorers

### 5. HTS Connector Deployment (`deploy-hts-connector.ts`)

Deploys a HTS Connector contract for testing purposes.

**Purpose**: Creates a test HTS token which is wrapped in a solidity contract.

**Usage**:

```bash
npm run deploy-hts-connector -- --network hedera
```

**Configuration**: No additional environment variables required.

**Expected Output**:

The deployment script provides two organized tables for easy reference:

1. **Deployment Summary Table**: Contains all raw values for easy copying
2. **Block Explorer Links Table**: Contains clickable URLs (when block explorer URL is configured)

**Common Issues**:

- **Gas estimation failure**: HTS deployment may require a hardcoded gas limit due to an inaccurate gas estimation
- **Contract verification**: Manual verification may be needed on block explorers

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
