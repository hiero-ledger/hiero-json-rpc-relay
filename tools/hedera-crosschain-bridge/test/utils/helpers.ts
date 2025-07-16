// SPDX-License-Identifier: Apache-2.0

import { addressToBytes32, Options } from '@layerzerolabs/lz-v2-utilities';
import { expect } from 'chai';
import { spawn } from 'child_process';
import { BigNumber } from 'ethers';

// Import hre to access ethers via hardhat runtime environment
const hre = require('hardhat');

// Type definitions for better code organization
interface NetworkConfig {
  lzEID: string;
  lzEndpointV2: string;
  networkProvider: any;
  networkSigner: any;
}

interface BalanceSnapshot {
  [key: string]: BigNumber;
}

interface TransferParams {
  dstEid: string;
  to: string;
  amountLD: BigNumber;
  minAmountLD: BigNumber;
  extraOptions: Uint8Array;
  composeMsg: Uint8Array;
  oftCmd: Uint8Array;
}

interface TransferResult {
  hash: string;
  receipt: any;
  completed: boolean;
}

interface CrossChainTransferConfig {
  sourceNetwork: string;
  destinationNetwork: string;
  IOFTContract: any;
  transferAmount: BigNumber;
  receiverAddress: string;
  gasLimit: number;
  txGasLimit: number;
  tinybarToWeibar?: bigint;
}

/**
 * Runs a Hardhat deployment script on a specified network.
 *
 * @param network - The target network to deploy to
 * @param pathToScript - The file path to the deployment script
 * @param env - Optional environment variables to pass to the process
 * @returns Promise that resolves to the output string from the deployment process
 * @throws Error if the deployment process fails (non-zero exit code)
 */
export async function runHardhatScript(network: string, pathToScript: string, env?: Record<string, string>) {
  const deploymentProcess = spawn('npx', ['hardhat', 'run', pathToScript, '--network', network], {
    stdio: ['pipe', 'pipe', 'pipe'],
    cwd: process.cwd(),
    env: { ...process.env, ...env },
  });

  let output = '';
  let error = '';

  deploymentProcess.stdout.on('data', (data: Buffer) => {
    output += data.toString();
  });

  deploymentProcess.stderr.on('data', (data: Buffer) => {
    error += data.toString();
  });

  await new Promise((resolve, reject) => {
    deploymentProcess.on('close', (code: number) => {
      if (code === 0) {
        resolve(code);
      } else {
        reject(new Error(`Deployment failed with code ${code}: ${error}`));
      }
    });
  });

  return output;
}

export function getNetworkConfigs(network: string) {
  if (network === 'hedera') {
    if (
      !process.env.HEDERA_RPC_URL ||
      !process.env.HEDERA_PK ||
      !process.env.HEDERA_LZ_EID_V2 ||
      !process.env.HEDERA_LZ_ENDPOINT_V2
    ) {
      throw new Error('Missing required environment variables for Hedera network');
    }

    const networkProvider = new hre.ethers.providers.JsonRpcProvider(process.env.HEDERA_RPC_URL);
    const networkSigner = new hre.ethers.Wallet(process.env.HEDERA_PK, networkProvider);

    return {
      lzEID: process.env.HEDERA_LZ_EID_V2,
      lzEndpointV2: process.env.HEDERA_LZ_ENDPOINT_V2,
      networkProvider,
      networkSigner,
    };
  } else if (network === 'sepolia') {
    if (
      !process.env.SEPOLIA_RPC_URL ||
      !process.env.SEPOLIA_PK ||
      !process.env.SEPOLIA_LZ_EID_V2 ||
      !process.env.SEPOLIA_LZ_ENDPOINT_V2
    ) {
      throw new Error('Missing required environment variables for Sepolia network');
    }
    const networkProvider = new hre.ethers.providers.JsonRpcProvider(process.env.SEPOLIA_RPC_URL);
    const networkSigner = new hre.ethers.Wallet(process.env.SEPOLIA_PK, networkProvider);

    return {
      lzEID: process.env.SEPOLIA_LZ_EID_V2,
      lzEndpointV2: process.env.SEPOLIA_LZ_ENDPOINT_V2,
      networkProvider,
      networkSigner,
    };
  } else {
    throw new Error(`Unsupported network: ${network}`);
  }
}

/**
 * Deploys a smart contract on the specified network.
 *
 * @param network - The target network for deployment ('hedera' or 'sepolia')
 * @param contractName - The name of the contract to deploy
 * @param params - Optional array of constructor parameters for the contract
 * @returns Promise that resolves to the deployed contract address
 * @throws Error if required environment variables are missing or network is unsupported
 */
export async function deployContractOnNetwork(network: string, contractName: string, params: any[] = []) {
  const { networkSigner } = getNetworkConfigs(network);

  console.log(`\nDeploying ${contractName} on ${network}...`);
  const ContractFactory = await hre.ethers.getContractFactory(contractName, networkSigner);
  const contract = await ContractFactory.deploy(...params);
  await contract.deployed();

  console.log(`✓ ${contractName} deployed on ${network} at address: ${contract.address}`);
  return contract;
}

export async function setLZPeer(
  network: string,
  lzOappContractName: string,
  sourceAddress: string,
  targetAddress: string,
) {
  const { networkSigner } = getNetworkConfigs(network);
  const targetNetwork = network === 'hedera' ? 'sepolia' : 'hedera';
  const { lzEID } = getNetworkConfigs(targetNetwork);

  console.log(`\nSetting LZ peers on ${network} network...`);
  console.log(`  • Source OFTAdapter Address: ${sourceAddress}`);
  console.log(`  • Target OFTAdapter Address: ${targetAddress}`);
  console.log(`  • Target LayerZero EID: ${lzEID}`);
  const contract = await hre.ethers.getContractAt(lzOappContractName, sourceAddress, networkSigner);
  const tx = await contract.setPeer(lzEID, '0x' + targetAddress.substring(2, 42).padStart(64, '0'));
  const receipt = await tx.wait();

  if (!receipt.status) {
    process.exit('Execution of setPeer failed. Tx hash: ' + tx.hash);
  }

  console.log(`✓ Peer for ${network} network with EID ${lzEID} was successfully set: txHash=${tx.hash}`);
  return receipt;
}

/**
 * Validates contract deployment and configuration.
 * Checks that token reference, endpoint, and owner are correctly set.
 *
 * @param contract - The OFT Adapter contract instance
 * @param expectedTokenAddress - Expected token contract address
 * @param expectedEndpoint - Expected LayerZero endpoint address
 * @param expectedOwner - Expected contract owner address
 * @param networkName - Network name for logging
 */
export async function validateContractConfiguration(
  contract: any,
  expectedTokenAddress: string,
  expectedEndpoint: string,
  expectedOwner: string,
  networkName: string,
): Promise<void> {
  console.log(`\nValidating ${networkName} OFTAdapter contract configurations...`);

  const tokenRef = await contract.token();
  const endpoint = await contract.endpoint();
  const owner = await contract.owner();

  expect(tokenRef).to.equal(expectedTokenAddress, `${networkName} token reference mismatch`);
  expect(endpoint).to.equal(expectedEndpoint, `${networkName} endpoint mismatch`);
  expect(owner).to.equal(expectedOwner, `${networkName} owner mismatch`);

  console.log(`✓ ${networkName} OFTAdapter contract configurations validated:`);
  console.log(`  • Token: ${tokenRef}`);
  console.log(`  • Endpoint: ${endpoint}`);
  console.log(`  • Owner: ${owner}`);
}

/**
 * Records balance snapshots for validation purposes.
 *
 * @param snapshots - Object to store balance snapshots
 * @param key - Unique key for the snapshot
 * @param contract - Contract instance to check balance from
 * @param address - Address to check balance for
 * @param description - Description for logging
 */
export async function recordBalanceSnapshot(
  snapshots: BalanceSnapshot,
  key: string,
  contract: any,
  address: string,
  description: string,
): Promise<void> {
  snapshots[key] = await contract.balanceOf(address);
  console.log(`\n${description}: ${snapshots[key].toString()}`);
}

/**
 * Validates balance changes with tolerance for cross-chain transfers.
 *
 * @param actualBalance - Current balance
 * @param expectedBalance - Expected balance change
 * @param tolerance - Tolerance for balance differences (default: 0.001 tokens for 8 decimals)
 * @param description - Description for logging and error messages
 */
export function validateBalanceChange(
  actualBalance: BigNumber,
  expectedBalance: BigNumber,
  tolerance: BigNumber = BigNumber.from(10).pow(5),
  description: string,
): void {
  const expectedMinimum = expectedBalance.sub(tolerance);
  const expectedMaximum = expectedBalance.add(tolerance);

  expect(actualBalance.gte(expectedMinimum)).to.be.true;
  expect(actualBalance.lte(expectedMaximum)).to.be.true;

  console.log(`\n✓ ${description}: Balance validation PASSED (${actualBalance.toString()})`);
}

/**
 * Handles token approval for cross-chain transfers.
 *
 * @param tokenContract - Token contract instance
 * @param spenderAddress - Address to approve (usually OFT Adapter)
 * @param amount - Amount to approve
 * @param networkName - Network name for logging
 * @param tokenName - Token name for logging
 */
export async function approveTokenForTransfer(
  tokenContract: any,
  spenderAddress: string,
  amount: BigNumber,
  networkName: string,
  tokenName: string,
): Promise<void> {
  console.log(`Approving ${amount.toString()} ${tokenName} tokens on ${networkName} for cross-chain transfers...`);

  const approveTx = await tokenContract.approve(spenderAddress, amount);
  const approveReceipt = await approveTx.wait();

  expect(approveReceipt.status).to.equal(1, `${tokenName} approval failed on ${networkName}`);
  console.log(`✓ ${tokenName} approval successful on ${networkName}: txHash=${approveTx.hash}`);

  // Verify allowance
  const allowance = await tokenContract.allowance(await tokenContract.signer.getAddress(), spenderAddress);
  expect(allowance).to.equal(amount, `${tokenName} allowance verification failed on ${networkName}`);
  console.log(`${tokenName} allowance verified on ${networkName}: ${allowance.toString()} tokens`);
}

/**
 * Pre-funds an OFT Adapter with tokens for destination mode operations.
 *
 * @param tokenContract - Token contract instance
 * @param adapterAddress - OFT Adapter address
 * @param amount - Amount to transfer to adapter
 * @param networkName - Network name for logging
 * @param tokenName - Token name for logging
 */
export async function preFundAdapter(
  tokenContract: any,
  adapterAddress: string,
  amount: BigNumber,
  networkName: string,
  tokenName: string,
): Promise<void> {
  console.log(`\nPre-funding ${amount.toString()} ${tokenName} tokens to ${networkName} OFT Adapter...`);

  const transferTx = await tokenContract.transfer(adapterAddress, amount);
  const transferReceipt = await transferTx.wait();

  expect(transferReceipt.status).to.equal(1, `${tokenName} pre-funding failed on ${networkName}`);
  console.log(`✓ ${tokenName} pre-funding successful on ${networkName}: txHash=${transferTx.hash}`);

  // Verify adapter balance
  const adapterBalance = await tokenContract.balanceOf(adapterAddress);
  expect(adapterBalance.gte(amount)).to.be.true;
  console.log(`${networkName} OFT Adapter ${tokenName} balance: ${adapterBalance.toString()} tokens`);
}

/**
 * Prepares LayerZero cross-chain transfer parameters.
 *
 * @param config - Transfer configuration object
 * @returns Prepared transfer parameters
 */
export function prepareCrossChainTransferParams(config: CrossChainTransferConfig): TransferParams {
  const { destinationNetwork, transferAmount, receiverAddress, gasLimit } = config;
  const destinationNetworkConfig = getNetworkConfigs(destinationNetwork);

  return {
    dstEid: destinationNetworkConfig.lzEID,
    to: addressToBytes32(receiverAddress) as any,
    amountLD: transferAmount,
    minAmountLD: transferAmount,
    extraOptions: Options.newOptions().addExecutorLzReceiveOption(gasLimit, 0).toBytes(),
    composeMsg: hre.ethers.utils.arrayify('0x'),
    oftCmd: hre.ethers.utils.arrayify('0x'),
  };
}

/**
 * Gets LayerZero fee quote for cross-chain transfers.
 *
 * @param IOFTContract - OFT Adapter contract instance
 * @param transferParams - Transfer parameters
 * @param networkName - Network name for logging
 * @returns Fee quote object with native and LZ token fees
 */
export async function getLayerZeroFeeQuote(
  IOFTContract: any,
  transferParams: TransferParams,
  networkName: string,
): Promise<{ nativeFee: BigNumber; lzTokenFee: BigNumber }> {
  console.log(`\nGetting LayerZero fee quote for ${networkName} cross-chain transfer...`);

  const feeQuote = await IOFTContract.quoteSend(transferParams, false);
  const { nativeFee, lzTokenFee } = feeQuote;

  console.log(`LayerZero fee quote for ${networkName}:`);
  console.log(`  • Native Fee: ${nativeFee.toString()} wei`);
  console.log(`  • LZ Token Fee: ${lzTokenFee.toString()}`);

  return { nativeFee, lzTokenFee };
}

/**
 * Executes a cross-chain transfer using LayerZero.
 *
 * @param config - Transfer configuration object
 * @returns Transfer result with transaction hash and receipt
 */
export async function executeCrossChainTransfer(config: CrossChainTransferConfig): Promise<TransferResult> {
  const {
    sourceNetwork,
    destinationNetwork,
    IOFTContract,
    transferAmount,
    receiverAddress,
    gasLimit,
    txGasLimit,
    tinybarToWeibar,
  } = config;

  console.log(`\nInitiating ${sourceNetwork} → ${destinationNetwork} cross-chain transfer:`);
  console.log(`  • Amount: ${transferAmount.toString()} tokens`);
  console.log(`  • Receiver: ${receiverAddress}`);
  console.log(`  • Gas Limit: ${gasLimit}`);

  // Prepare transfer parameters
  const transferParams = prepareCrossChainTransferParams(config);

  // Get fee quote
  const { nativeFee, lzTokenFee } = await getLayerZeroFeeQuote(IOFTContract, transferParams, sourceNetwork);

  // Calculate transaction value (different for Hedera vs other networks)
  const txValue =
    sourceNetwork === 'hedera' && tinybarToWeibar
      ? nativeFee.mul(BigNumber.from(tinybarToWeibar.toString()))
      : nativeFee;

  console.log(`  • Transaction Value: ${txValue.toString()} ${sourceNetwork === 'hedera' ? 'tinybars' : 'wei'}`);

  // Execute transfer
  const transferTx = await IOFTContract.send(
    transferParams,
    { nativeFee, lzTokenFee },
    await IOFTContract.signer.getAddress(),
    { gasLimit: txGasLimit, value: txValue },
  );

  const transferReceipt = await transferTx.wait();

  expect(transferReceipt.status).to.equal(1, `Cross-chain transfer failed on ${sourceNetwork}`);
  expect(transferReceipt.events?.length).to.be.greaterThan(0, 'Should emit transfer events');

  console.log(`\n✓ Cross-chain transfer initiated successfully!`);

  return {
    hash: transferTx.hash,
    receipt: transferReceipt,
    completed: false,
  };
}

/**
 * Waits for cross-chain transfer completion by polling receiver balance.
 *
 * @param receiverContract - Contract instance to check receiver balance
 * @param receiverAddress - Address of the receiver
 * @param initialBalance - Initial balance before transfer
 * @param expectedAmount - Expected transfer amount
 * @param networkName - Network name for logging
 * @param maxRetries - Maximum number of polling attempts
 * @param retryInterval - Interval between polling attempts in milliseconds
 * @returns True if transfer completed within timeout, false otherwise
 */
export async function waitForTransferCompletion(
  receiverContract: any,
  receiverAddress: string,
  initialBalance: BigNumber,
  expectedAmount: BigNumber,
  networkName: string,
  maxRetries: number = 30,
  retryInterval: number = 30000,
): Promise<boolean> {
  console.log(`Waiting for ${networkName} transfer completion...`);

  const tolerance = BigNumber.from(10).pow(5); // 0.001 tokens tolerance for 8 decimals
  const expectedMinimum = expectedAmount.sub(tolerance);
  const expectedMaximum = expectedAmount.add(tolerance);

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const currentBalance = await receiverContract.balanceOf(receiverAddress);
      const balanceIncrease = currentBalance.sub(initialBalance);

      console.log(
        `  Attempt ${attempt}/${maxRetries}: Current balance ${currentBalance.toString()}, Increase: ${balanceIncrease.toString()}`,
      );

      if (balanceIncrease.gte(expectedMinimum) && balanceIncrease.lte(expectedMaximum)) {
        console.log(`✓ ${networkName} transfer completed! Receiver received ${balanceIncrease.toString()} tokens`);
        return true;
      }

      if (attempt < maxRetries) {
        console.log(`  Retrying in ${retryInterval / 1000} seconds...`);
        await new Promise((resolve) => setTimeout(resolve, retryInterval));
      }
    } catch (error: any) {
      console.log(`  Error checking balance (attempt ${attempt}): ${error.message}`);
      if (attempt < maxRetries) {
        await new Promise((resolve) => setTimeout(resolve, retryInterval));
      }
    }
  }

  console.log(`❌ ${networkName} transfer did not complete within ${(maxRetries * retryInterval) / 60000} minutes`);
  return false;
}

/**
 * Waits for multiple cross-chain transfers to complete by polling receiver balances.
 *
 * @param transfers - Array of transfer configurations to monitor
 * @param maxRetries - Maximum number of polling attempts
 * @param retryInterval - Interval between polling attempts in milliseconds
 * @param tolerance - A permissible tolerance in tokens
 * @returns Object with completion status for each transfer
 */
export async function waitForMultipleTransfers(
  transfers: Array<{
    name: string;
    receiverContract: any;
    receiverAddress: string;
    initialBalance: BigNumber;
    expectedAmount: BigNumber;
  }>,
  maxRetries: number = 30,
  retryInterval: number = 30000,
  tolerance: BigNumber = BigNumber.from(10).pow(5), // 0.001 tokens tolerance for 8 decimals
): Promise<{ [transferName: string]: boolean }> {
  console.log('Waiting for multiple cross-chain transfers to complete...');

  const completionStatus: { [transferName: string]: boolean } = {};
  transfers.forEach((transfer) => {
    completionStatus[transfer.name] = false;
  });

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(` • Attempt ${attempt}/${maxRetries}: Checking all receiver balances...`);

      // Check each transfer
      for (const transfer of transfers) {
        if (!completionStatus[transfer.name]) {
          const currentBalance = await transfer.receiverContract.balanceOf(transfer.receiverAddress);
          const balanceIncrease = currentBalance.sub(transfer.initialBalance);

          console.log(
            `   • ${transfer.name} - Current: ${currentBalance.toString()}, Increase: ${balanceIncrease.toString()}`,
          );

          const expectedMinimum = transfer.expectedAmount.sub(tolerance);
          const expectedMaximum = transfer.expectedAmount.add(tolerance);

          if (balanceIncrease.gte(expectedMinimum) && balanceIncrease.lte(expectedMaximum)) {
            completionStatus[transfer.name] = true;
            console.log(`    ✅ ${transfer.name} completed! Receiver received ${balanceIncrease.toString()} tokens`);
          }
        }
      }

      // Check if all transfers are complete
      const allCompleted = Object.values(completionStatus).every((status) => status);
      if (allCompleted) {
        console.log(`\n🎉 All cross-chain transfers completed successfully!`);
        break;
      }

      if (attempt < maxRetries) {
        const pendingTransfers = Object.entries(completionStatus)
          .filter(([, completed]) => !completed)
          .map(([name]) => name);
        console.log(
          `   ⌛ Pending transfers: ${pendingTransfers.join(', ')}... retrying in ${retryInterval / 1000} seconds`,
        );
        await new Promise((resolve) => setTimeout(resolve, retryInterval));
      }
    } catch (error: any) {
      console.log(`    ❌ Error checking balances (attempt ${attempt}): ${error.message}`);
      if (attempt < maxRetries) {
        await new Promise((resolve) => setTimeout(resolve, retryInterval));
      }
    }
  }

  // Log completion status for any incomplete transfers
  Object.entries(completionStatus).forEach(([transferName, completed]) => {
    if (!completed) {
      console.log(`  ⚠️ ${transferName} did not complete within ${(maxRetries * retryInterval) / 60000} minutes`);
      console.log(
        `  This may be due to network congestion or LayerZero processing delays. Please check the transaction status on the respective block explorer and LayerZero Scan.`,
      );
    }
  });

  return completionStatus;
}

/**
 * Validates bidirectional LayerZero peer configuration.
 *
 * @param hederaAdapter - Hedera OFT Adapter contract
 * @param sepoliaAdapter - Sepolia OFT Adapter contract
 * @param hederaNetworkConfig - Hedera network configuration
 * @param sepoliaNetworkConfig - Sepolia network configuration
 */
export async function validatePeerConfiguration(
  hederaAdapter: any,
  sepoliaAdapter: any,
  hederaNetworkConfig: NetworkConfig,
  sepoliaNetworkConfig: NetworkConfig,
): Promise<void> {
  console.log('\nValidating bidirectional peer configuration...');

  const hederaPeer = await hederaAdapter.peers(sepoliaNetworkConfig.lzEID);
  const sepoliaPeer = await sepoliaAdapter.peers(hederaNetworkConfig.lzEID);

  const expectedSepoliaPeerBytes = '0x' + sepoliaAdapter.address.substring(2).padStart(64, '0');
  const expectedHederaPeerBytes = '0x' + hederaAdapter.address.substring(2).padStart(64, '0');

  expect(hederaPeer.toLowerCase()).to.equal(
    expectedSepoliaPeerBytes.toLowerCase(),
    'Hedera peer configuration mismatch',
  );
  expect(sepoliaPeer.toLowerCase()).to.equal(
    expectedHederaPeerBytes.toLowerCase(),
    'Sepolia peer configuration mismatch',
  );

  console.log('✓ Bidirectional peer configuration validated: Hedera ↔ Sepolia');
}

/**
 * Displays comprehensive test summary with network info, contracts, and results.
 *
 * @param config - Summary configuration object
 */
export function displayTestSummary(config: {
  hederaNetworkConfig: NetworkConfig;
  sepoliaNetworkConfig: NetworkConfig;
  contracts: {
    hederaWHBAR: string;
    hederaOftAdapter: string;
    sepoliaERC20: string;
    sepoliaOftAdapter: string;
  };
  transfers: {
    hederaToSepolia: { completed: boolean; amount: string; hash: string };
    sepoliaToHedera: { completed: boolean; amount: string; hash: string };
  };
  finalBalances: {
    sepoliaReceiver: { balance: string; increase: string };
    hederaReceiver: { balance: string; increase: string };
  };
}): void {
  const { hederaNetworkConfig, sepoliaNetworkConfig, contracts, transfers, finalBalances } = config;

  console.log(`\nWHBAR BRIDGE E2E TEST SUMMARY`);

  // Network information
  console.log(`\n📋 Networks:`);
  console.log(`  • Hedera Testnet (Chain ID: 296, LayerZero EID: ${hederaNetworkConfig.lzEID})`);
  console.log(`  • Sepolia Testnet (Chain ID: 11155111, LayerZero EID: ${sepoliaNetworkConfig.lzEID})`);

  // Contract addresses
  console.log(`\n🏗️ Deployed Contracts:`);
  console.log(`  • Hedera WHBAR: ${contracts.hederaWHBAR}`);
  console.log(`  • Hedera OFT Adapter: ${contracts.hederaOftAdapter}`);
  console.log(`  • Sepolia ERC20: ${contracts.sepoliaERC20}`);
  console.log(`  • Sepolia OFT Adapter: ${contracts.sepoliaOftAdapter}`);

  // Transfer results
  console.log(`\n💸 Cross-Chain Transfers:`);
  console.log(`  • Hedera → Sepolia: ${transfers.hederaToSepolia.completed ? '✅ COMPLETED' : 'PENDING'}`);
  console.log(`    • Amount: ${transfers.hederaToSepolia.amount} WHBAR`);
  console.log(`    • Transaction: https://hashscan.io/testnet/tx/${transfers.hederaToSepolia.hash}`);
  console.log(`    • LayerZero: https://testnet.layerzeroscan.com/tx/${transfers.hederaToSepolia.hash}`);

  console.log(`  • Sepolia → Hedera: ${transfers.sepoliaToHedera.completed ? '✅ COMPLETED' : 'PENDING'}`);
  console.log(`    • Amount: ${transfers.sepoliaToHedera.amount} ERC20`);
  console.log(`    • Transaction: https://sepolia.etherscan.io/tx/${transfers.sepoliaToHedera.hash}`);
  console.log(`    • LayerZero: https://testnet.layerzeroscan.com/tx/${transfers.sepoliaToHedera.hash}`);

  // Balance verification
  console.log(`\n📊 Final Balances:`);
  console.log(
    `  • Sepolia Receiver: ${finalBalances.sepoliaReceiver.balance} (+${finalBalances.sepoliaReceiver.increase})`,
  );
  console.log(
    `  • Hedera Receiver: ${finalBalances.hederaReceiver.balance} (+${finalBalances.hederaReceiver.increase})`,
  );

  // Overall status
  if (transfers.hederaToSepolia.completed && transfers.sepoliaToHedera.completed) {
    console.log(`\n✅ ALL TRANSFERS COMPLETED SUCCESSFULLY!`);
    console.log(`   🔄 Bridge Functionality: FULLY OPERATIONAL`);
    console.log(`   💰 Token Economics: 1:1 cross-chain parity maintained`);
    console.log(`   🌐 Interoperability: Hedera ↔ Sepolia bridging confirmed`);
  } else {
    console.log(`\n⏳ Some transfers still pending completion`);
    console.log(`   Note: Cross-chain transfers typically take 2-10 minutes`);
    console.log(`   Monitor progress using the LayerZero scan links above`);
  }
}

/**
 * Executes a smart contract function against specified network.
 *
 * @param network - The target network ('hedera' or 'sepolia')
 * @param contractName - The name of the contract
 * @param contractAddress - The address of the contract
 * @param contractFunction - The function we're calling
 * @param params - Optional array of constructor parameters for the contract
 * @returns Promise that resolves to contract call response
 * @throws Error if required environment variables are missing or network is unsupported
 */
export async function executeContractCallOnNetwork(
  network: string,
  contractName: string,
  contractAddress: string,
  contractFunction: string,
  params: any[] = [],
): Promise<string> {
  let wallet;

  if (network === 'hedera') {
    if (!process.env.HEDERA_RPC_URL || !process.env.HEDERA_PK) {
      throw new Error('HEDERA_RPC_URL and HEDERA_PK environment variables are required for Hedera deployment');
    }
    wallet = new hre.ethers.Wallet(
      process.env.HEDERA_PK,
      new hre.ethers.providers.JsonRpcProvider(process.env.HEDERA_RPC_URL),
    );
  } else if (network === 'sepolia') {
    if (!process.env.SEPOLIA_RPC_URL || !process.env.SEPOLIA_PK) {
      throw new Error('SEPOLIA_RPC_URL and SEPOLIA_PK environment variables are required for Sepolia deployment');
    }
    wallet = new hre.ethers.Wallet(
      process.env.SEPOLIA_PK,
      new hre.ethers.providers.JsonRpcProvider(process.env.SEPOLIA_RPC_URL),
    );
  } else {
    throw new Error(`Unsupported network: ${network}`);
  }

  console.log(`Executing ${contractFunction} via ${contractName} on ${network}...`);
  const contract = await hre.ethers.getContractAt(contractName, contractAddress, wallet);
  return await contract[contractFunction](...params);
}

/**
 * Get random integer in a range
 * @param min
 * @param max
 */
export function getRandomInt(min: number = 1, max: number = 999_999): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Test Configuration and Constants
 */
export const TEST_CONFIG = {
  // HBAR/WHBAR configuration
  HBAR_FUNDING_AMOUNT: hre.ethers.utils.parseEther('3'),
  WHBAR_TRANSFER_AMOUNT: hre.ethers.utils.parseEther('1'),
  TINYBAR_TO_WEIBAR: BigInt(10 ** 10),
  WEIBAR_TO_HBAR: BigInt(10 ** 18),

  // ERC20 configuration (8 decimals matching WHBAR)
  ERC20_DECIMALS: 8,
  ERC20_INITIAL_SUPPLY: 5 * 10 ** 8,
  ERC20_TRANSFER_AMOUNT: 1 * 10 ** 8,

  // Test receiver contracts will be deployed dynamically
  RECEIVER_ADDRESS_HEDERA: '', // Will be set after deploying SimpleReceiver on Hedera
  RECEIVER_ADDRESS_SEPOLIA: '', // Will be set after deploying SimpleReceiver on Sepolia

  // LayerZero configuration (optimized for testing)
  LZ_GAS_LIMIT: 3000000,
  TX_GAS_LIMIT: 10_000_000,

  // Validation thresholds
  MINIMUM_TRANSFER_AMOUNT: BigNumber.from(10).pow(6), // 0.01 tokens for 8 decimals
};
