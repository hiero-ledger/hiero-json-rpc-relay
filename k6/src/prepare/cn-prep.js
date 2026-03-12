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
 * 3. Funding benchmark wallets from a main treasury account.
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
  const amount = parseInt(process.env.SIGNED_TXS || '300', 10);
  console.log(`Generating (${amount}) Txs for Wallet ${wallet.address}...`);

  // Benchmark wallets are typically fresh, so we start nonce at 0
  let nonce = 0;
  const signedTxCollection = [];

  for (let i = 0; i < amount; i++) {
    const contractIndex = randomIntFromInterval(0, greeterContracts.length);
    const contractAddress = greeterContracts[contractIndex];
    const contract = new ethers.Contract(contractAddress, Greeter.abi, wallet);

    const msg = `CN Benchmark Iteration ${i} - ${Date.now()}`;
    const txRequest = await contract['setGreeting'].populateTransaction(msg);

    txRequest.gasLimit = gasLimit;
    txRequest.chainId = chainId;
    txRequest.gasPrice = gasPrice;
    txRequest.nonce = nonce + i;

    const signedTx = await wallet.signTransaction(txRequest);
    signedTxCollection.push(signedTx);

    if ((i + 1) % 50 === 0) {
      console.log(`Signed ${i + 1}/${amount} transactions...`);
    }
  }

  return signedTxCollection;
}

(async () => {
  const relayUrl = process.env.RELAY_BASE_URL || 'http://localhost:7546';
  const provider = new LoggingProvider(relayUrl);

  const mainPrivateKey = process.env.PRIVATE_KEY;
  if (!mainPrivateKey) {
    console.error('ERROR: PRIVATE_KEY environment variable is missing.');
    process.exit(1);
  }

  const mainWallet = new ethers.Wallet(mainPrivateKey, provider);
  const network = await provider.getNetwork();
  const chainId = network.chainId;

  console.log('--- CN Benchmark Preparation ---');
  console.log('Relay URL:           ' + relayUrl);
  console.log('Chain ID:            ' + chainId);
  console.log('Treasury Address:    ' + mainWallet.address);

  const treasuryBalance = await provider.getBalance(mainWallet.address);
  console.log('Treasury Balance:    ' + formatEther(treasuryBalance) + ' HBAR');

  // 1. Deploy Greeter Contracts
  const contractsCount = parseInt(process.env.SMART_CONTRACTS_AMOUNT || '10', 10);
  const smartContracts = [];

  console.log(`\n1. Deploying ${contractsCount} Greeter contracts...`);
  const contractFactory = new ethers.ContractFactory(Greeter.abi, Greeter.bytecode, mainWallet);

  for (let i = 0; i < contractsCount; i++) {
    const contract = await contractFactory.deploy('CN Bench Warmup');
    await contract.waitForDeployment();
    const address = await contract.getAddress();
    console.log(`   Contract [${i}] at: ${address}`);
    smartContracts.push(address);
  }

  // 2. Setup Benchmark Wallets
  const walletCount = parseInt(process.env.WALLETS_AMOUNT || '80', 10);
  const wallets = [];

  // Pre-calculate gas requirements for estimation
  const mockMsg = `CN Benchmark Warmup Message`;
  const contractForEstimate = new ethers.Contract(smartContracts[0], Greeter.abi, mainWallet);
  const estimatedGasLimit = await contractForEstimate['setGreeting'].estimateGas(mockMsg);
  const feeData = await provider.getFeeData();
  const gasPrice = feeData.gasPrice;

  console.log(`\n2. Creating and funding ${walletCount} benchmark wallets...`);

  // Calculate funding amount per wallet:
  // (GasPrice * GasLimit * SIGNED_TXS) + Buffer for deployments/transfers
  const signedTxsPerWallet = parseInt(process.env.SIGNED_TXS || '300', 10);
  const fundingPerWallet = gasPrice * estimatedGasLimit * BigInt(signedTxsPerWallet) * 2n;

  for (let i = 0; i < walletCount; i++) {
    const tempWallet = ethers.Wallet.createRandom().connect(provider);

    // Fund the wallet from treasury
    const fundTx = await mainWallet.sendTransaction({
      to: tempWallet.address,
      value: fundingPerWallet,
    });
    await fundTx.wait();

    console.log(`   Wallet [${i}] ${tempWallet.address} funded with ${formatEther(fundingPerWallet)} HBAR`);

    // 3. Pre-sign transactions for this wallet
    const signedTxs = await getSignedTxs(tempWallet, smartContracts, gasPrice, estimatedGasLimit, chainId);

    wallets.push({
      address: tempWallet.address,
      privateKey: tempWallet.privateKey,
      signedTxs: signedTxs,
    });
  }

  // 4. Persistence
  const outputPath = path.resolve(__dirname, '../prepare/.smartContractParams.json');
  const outputData = {
    wallets: wallets,
    // Provide generic values for fields k6 might expect from setupTestParameters
    smartContracts: smartContracts,
    DEFAULT_ENTITY_FROM: mainWallet.address,
    DEFAULT_ENTITY_TO: smartContracts[0],
  };

  fs.writeFileSync(outputPath, JSON.stringify(outputData, null, 2));
  console.log(`\n3. Benchmark parameters saved to: ${outputPath}`);
  console.log('--- Preparation Complete ---');
})().catch((err) => {
  console.error('\nERROR during preparation:', err);
  process.exit(1);
});
