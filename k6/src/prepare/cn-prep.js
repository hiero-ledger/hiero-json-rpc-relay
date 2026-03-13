// SPDX-License-Identifier: Apache-2.0

import Greeter from './contracts/Greeter.json' with { type: 'json' };
import { ethers, formatEther } from 'ethers';
import * as fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

/**
 * @file cn-prep.js
 * @description Specialized preparation script for the Consensus Node (CN) Throughput Benchmark.
 *
 * This script is a streamlined version of the general prep.js, focused exclusively on:
 * 1. Deploying a minimal set of smart contracts.
 * 2. Creating a specific number of benchmark wallets (WALLETS_AMOUNT).
 * 3. Funding benchmark wallets from multiple treasury accounts (PRIVATE_KEYS).
 * 4. Pre-signing a high volume of transactions (SIGNED_TXS) per wallet to be replayed by k6.
 *
 * Unlike the general prep script, this avoids:
 * - HTS token creation and transfers.
 * - Complex log/filter/block state generation.
 * - Expensive synthetic transaction generation across blocks.
 */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const logPayloads = process.env.DEBUG_MODE === 'true';

/**
 * Custom JsonRpcProvider with optional payload logging for debugging.
 */
class LoggingProvider extends ethers.JsonRpcProvider {
  constructor(url) {
    super(url);
    this._nextId = 1;
  }

  async send(method, params) {
    if (logPayloads) {
      const request = {
        method: method,
        params: params,
        id: this._nextId++,
        jsonrpc: '2.0',
      };
      console.log('>>>', method, '-->', JSON.stringify(request));
    }

    try {
      const result = await super.send(method, params);
      if (logPayloads) {
        console.log('<<<', method, '-->', JSON.stringify(result));
      }
      return result;
    } catch (error) {
      if (logPayloads) {
        console.error('<<< ERROR', method, '-->', error.message);
      }
      throw error;
    }
  }
}

/**
 * Returns a random integer between min and max inclusive.
 *
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
function randomIntFromInterval(min, max) {
  return Math.floor(Math.random() * (max - min) + min);
}

/**
 * Generates an array of pre-signed setGreeting transactions for a given wallet.
 *
 * @param {ethers.Wallet} wallet - Funded wallet to sign transactions.
 * @param {string[]} greeterContracts - Array of deployed contract addresses.
 * @param {bigint} gasPrice - Current gas price for the network.
 * @param {bigint} gasLimit - Estimated gas limit for the operation.
 * @param {bigint} chainId - Chain ID of the target network.
 * @returns {Promise<string[]>} - Array of raw signed transaction hex strings.
 */
async function getSignedTxs(wallet, greeterContracts, gasPrice, gasLimit, chainId) {
  // Use a high default for benchmarking if not specified
  const n = parseInt(process.env.SIGNED_TXS || '300', 10);
  console.log(`Generating (${n}) Txs for Wallet ${wallet.address}...`);

  // Gas calculation logic follows strict reliability safety margins (20% overhead)
  const safeGasLimit = 1_000_000n; // Set a high fixed gas limit for benchmarking to avoid out-of-gas errors, as CN may have different gas requirements than EVM.
  console.log(`   Using safe gasLimit: ${safeGasLimit} (Original: ${gasLimit})`);

  let nonce = 0;
  const signedTxCollection = [];

  for (let i = 0; i < n; i++) {
    const contractIndex = randomIntFromInterval(0, greeterContracts.length);
    const contractAddress = greeterContracts[contractIndex];
    const contract = new ethers.Contract(contractAddress, Greeter.abi, wallet);

    // UNIQUE MESSAGE PER TX: Prevents identical data fingerprints.
    // Included extra space padding to avoid bitwise collision.
    const msg = `CN Benchmark TX-${Date.now()}-${Math.random().toString(36).substring(7)}`;
    const txRequest = await contract['setGreeting'].populateTransaction(msg);

    txRequest.gasLimit = safeGasLimit;
    txRequest.chainId = chainId;
    txRequest.gasPrice = gasPrice;
    txRequest.nonce = nonce + i;

    const signedTx = await wallet.signTransaction(txRequest);
    signedTxCollection.push(signedTx);

    if ((i + 1) % 100 === 0) {
      console.log(`   ...Progress: ${i + 1}/${n} transactions signed.`);
    }
  }

  return signedTxCollection;
}

(async () => {
  const relayUrl = process.env.RELAY_BASE_URL || 'http://localhost:7546';
  const provider = new LoggingProvider(relayUrl);

  const privateKeysEnv = process.env.PRIVATE_KEYS;
  console.log('PRIVATE_KEYS env variable:', privateKeysEnv);
  if (!privateKeysEnv) {
    console.error('ERROR: PRIVATE_KEYS environment variable is missing.');
    process.exit(1);
  }

  let privateKeys;
  try {
    privateKeys = JSON.parse(privateKeysEnv);
    if (!Array.isArray(privateKeys)) {
      throw new Error('PRIVATE_KEYS is not an array');
    }
  } catch (e) {
    console.error('ERROR: PRIVATE_KEYS must be a JSON array of strings.');
    process.exit(1);
  }

  const treasuryWallets = privateKeys.map((pk) => new ethers.Wallet(pk, provider));
  const network = await provider.getNetwork();
  const chainId = network.chainId;

  console.log('--- CN Benchmark Preparation ---');
  console.log('Relay URL:           ' + relayUrl);
  console.log('Chain ID:            ' + chainId);
  console.log(`Treasury Accounts:   ${treasuryWallets.length}`);

  for (const wallet of treasuryWallets) {
    const balance = await provider.getBalance(wallet.address);
    console.log(`Treasury [${wallet.address}] Balance: ${formatEther(balance)} HBAR`);
  }

  // 1. Deploy Greeter Contracts
  // Each treasury accounts deploys ONE contract concurrently
  console.log(`\n1. Deploying ${treasuryWallets.length} Greeter contracts (one per treasury)...`);

  const deployPromises = treasuryWallets.map(async (wallet, index) => {
    const contractFactory = new ethers.ContractFactory(Greeter.abi, Greeter.bytecode, wallet);
    const contract = await contractFactory.deploy(`CN Bench Warmup - Treasury ${index}`);
    await contract.waitForDeployment();
    const address = await contract.getAddress();
    console.log(`   Contract [${index}] deployed by ${wallet.address} at: ${address}`);
    return address;
  });

  const smartContracts = await Promise.all(deployPromises);

  // 2. Setup Benchmark Wallets
  const walletCount = parseInt(process.env.WALLETS_AMOUNT || '80', 10);
  const wallets = [];

  // Pre-calculate gas requirements for estimation using the first contract and treasury
  const mockMsg = 'CN Benchmark Warmup Message';
  const contractForEstimate = new ethers.Contract(smartContracts[0], Greeter.abi, treasuryWallets[0]);
  const estimatedGasLimit = await contractForEstimate['setGreeting'].estimateGas(mockMsg);
  const feeData = await provider.getFeeData();
  const gasPrice = feeData.gasPrice;

  console.log(`\n2. Creating and funding ${walletCount} benchmark wallets in batches...`);

  const signedTxsPerWallet = parseInt(process.env.SIGNED_TXS || '300', 10);
  const fundingPerWallet = gasPrice * estimatedGasLimit * BigInt(signedTxsPerWallet) * 5n;

  // Track the current nonce for each treasury to ensure ordered execution within a batch
  const treasuryNonces = await Promise.all(
    treasuryWallets.map((wallet) => provider.getTransactionCount(wallet.address, 'pending')),
  );

  let counter = 0;

  // Process benchmark wallets in batches of treasuryWallets.length
  for (let i = 0; i < walletCount; i += treasuryWallets.length) {
    const batchSize = Math.min(treasuryWallets.length, walletCount - i);
    console.log(`\n   Processing batch: wallets ${i} to ${i + batchSize - 1}...`);

    const batchPromises = [];

    for (let j = 0; j < batchSize; j++) {
      const walletIndex = i + j;
      const treasuryIndex = j;
      const treasury = treasuryWallets[treasuryIndex];

      const task = (async () => {
        const tempWallet = ethers.Wallet.createRandom().connect(provider);

        // Fund the wallet from assigned treasury using explicit nonce for safety
        const fundTx = await treasury.sendTransaction({
          to: tempWallet.address,
          value: fundingPerWallet,
          nonce: treasuryNonces[treasuryIndex]++,
        });

        // We wait for the fund transaction to be mined before finishing this task
        // but since they use different treasuries, we can submit them concurrently
        await fundTx.wait();

        console.log(
          `   Wallet [${walletIndex}] ${tempWallet.address} funded by Treasury [${treasuryIndex}] with ${formatEther(
            fundingPerWallet,
          )} HBAR`,
        );

        // 3. Pre-sign transactions for this wallet
        const signedTxs = await getSignedTxs(tempWallet, smartContracts, gasPrice, estimatedGasLimit, chainId);

        return {
          address: tempWallet.address,
          privateKey: tempWallet.privateKey,
          signedTxs: signedTxs,
        };
      })();

      batchPromises.push(task);
    }

    // Wait for the entire batch to complete before moving to the next one
    // This ensures no treasury has more than one pending transaction at a time if the batch size matches treasury count
    const batchResults = await Promise.all(batchPromises);
    wallets.push(...batchResults);

    // Increment counter and pause every 10 batches to allow the network to process transactions and avoid overwhelming it
    // with too many pending transactions at once. This is especially important if the batch size is large or if the network
    //  has limited capacity.
    counter += 1;
    if (counter >= 5 && counter % 5 === 0 && counter * treasuryWallets.length < walletCount) {
      console.log(`--- Counter Reached Batch ${counter}th, pausing for 3 seconds to allow network processing ---`);
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
  }

  // 4. Persistence
  const outputPath = path.resolve(__dirname, '../prepare/.smartContractParams.json');
  const outputData = {
    wallets: wallets,
    // Provide generic values for fields k6 might expect from setupTestParameters
    smartContracts: smartContracts,
    DEFAULT_ENTITY_FROM: treasuryWallets[0].address,
    DEFAULT_ENTITY_TO: smartContracts[0],
  };

  fs.writeFileSync(outputPath, JSON.stringify(outputData, null, 2));
  console.log(`\n3. Benchmark parameters saved to: ${outputPath}`);
  console.log('--- Preparation Complete ---');
})().catch((err) => {
  console.error('\nERROR during preparation:', err);
  process.exit(1);
});
