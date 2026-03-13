// SPDX-License-Identifier: Apache-2.0

import { ethers, formatEther } from 'ethers';
import * as fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import Greeter from './contracts/Greeter.json' with { type: 'json' };

/**
 * Specialized preparation script for the Consensus Node (CN) Throughput Benchmark.
 *
 * Performs four operations as fast as possible:
 * 1. Deploy one Greeter contract per treasury account (parallel).
 * 2. Create WALLETS_AMOUNT fresh benchmark wallets (local, instant).
 * 3. Submit WALLETS_AMOUNT funding transactions to the treasury accounts (parallel),
 *    while concurrently pre-signing SIGNED_TXS transactions per wallet (pure local CPU).
 * 4. Await all funding confirmations, then persist the parameters file.
 *
 * The critical performance optimization is that transaction signing uses
 * Interface.encodeFunctionData for local calldata construction, eliminating the
 * 24,000+ RPC calls that populateTransaction would otherwise make (one per tx).
 * Signing and funding run concurrently because signing requires only the private
 * key — a funded account is not a prerequisite.
 */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** Absolute output path consumed by k6 bootstrapEnvParameters and verify-cn-tps. */
const OUTPUT_PATH = path.resolve(__dirname, '../prepare/.smartContractParams.json');

/** Pre-instantiated Interface reused across all wallets to avoid repeated ABI parsing. */
const GREETER_INTERFACE = new ethers.Interface(Greeter.abi);

/**
 * Pre-signs a batch of setGreeting transactions for a single wallet entirely
 * in local memory — no network calls are made.
 *
 * All required transaction fields (to, data, gasLimit, gasPrice, chainId, nonce)
 * are explicitly provided, so ethers has nothing to fetch from the provider.
 * A provider-detached signer is used as an additional safeguard against implicit
 * RPC calls that ethers may attempt to fill missing fields.
 *
 * Contracts are selected round-robin to distribute load evenly across deployed
 * instances. Nonces start at 0 because benchmark wallets are created fresh on
 * every prep run.
 *
 * @param {ethers.Wallet} wallet - Wallet whose private key is used for signing.
 * @param {string[]} contracts - Deployed Greeter contract addresses.
 * @param {bigint} gasPrice - Legacy gas price applied to every transaction.
 * @param {bigint} chainId - Target network chain ID.
 * @param {number} count - Number of transactions to pre-sign.
 * @returns {Promise<string[]>} Ordered array of raw signed transaction hex strings.
 */
async function buildSignedTxs(wallet, contracts, gasPrice, chainId, count) {
  // Detached signer (no provider) guarantees ethers cannot issue RPC calls to
  // populate any missing field during signTransaction.
  const signer = new ethers.Wallet(wallet.privateKey);

  return Promise.all(
    Array.from({ length: count }, (_, i) =>
      signer.signTransaction({
        type: 0,
        to: contracts[i % contracts.length],
        // Wallet address + index produces a unique message per tx, preventing
        // duplicate calldata fingerprints without any random number generation.
        data: GREETER_INTERFACE.encodeFunctionData('setGreeting', [`${wallet.address}-${i}`]),
        gasLimit: 1_000_000n,
        gasPrice,
        chainId,
        nonce: i,
      }),
    ),
  );
}

/**
 * Funds a set of benchmark wallets sequentially from a single treasury account.
 *
 * Hedera's relay enforces strict nonce ordering: a transaction with nonce N+1 is
 * rejected if nonce N has not yet been confirmed on-chain. Submissions for the
 * same treasury must therefore be serialized. Callers run multiple treasury chains
 * in parallel via Promise.all to preserve overall throughput.
 *
 * @param {ethers.Wallet} treasury - Connected treasury wallet used to send funds.
 * @param {ethers.Wallet[]} wallets - Benchmark wallets to fund, in order.
 * @param {bigint} amount - Transfer value in tinybar per wallet.
 * @param {number} startNonce - On-chain nonce to use for the first transaction.
 * @returns {Promise<void>} Resolves after all wallets in this chain are confirmed.
 */
async function fundWalletsSequentially(treasury, wallets, amount, startNonce) {
  for (let i = 0; i < wallets.length; i++) {
    const tx = await treasury.sendTransaction({
      to: wallets[i].address,
      value: amount,
      nonce: startNonce + i,
    });
    await tx.wait();
    console.log(
      `   Funded [${wallets[i].address}] via ${treasury.address.slice(0, 10)}... (${i + 1}/${wallets.length})`,
    );
  }
}

(async () => {
  const relayUrl = process.env.RELAY_BASE_URL || 'http://localhost:7546';
  const provider = new ethers.JsonRpcProvider(relayUrl);

  const privateKeysEnv = process.env.PRIVATE_KEYS;
  if (!privateKeysEnv) {
    console.error('ERROR: PRIVATE_KEYS environment variable is missing.');
    process.exit(1);
  }

  let privateKeys;
  try {
    privateKeys = JSON.parse(privateKeysEnv);
    if (!Array.isArray(privateKeys)) throw new Error('not a JSON array');
  } catch (e) {
    console.error(`ERROR: PRIVATE_KEYS must be a JSON array of hex strings: ${e.message}`);
    process.exit(1);
  }

  const treasuryWallets = privateKeys.map((pk) => new ethers.Wallet(pk, provider));
  const { chainId } = await provider.getNetwork();
  const walletCount = parseInt(process.env.WALLETS_AMOUNT || '80', 10);
  const signedTxsPerWallet = parseInt(process.env.SIGNED_TXS || '300', 10);

  console.log('--- CN Benchmark Preparation ---');
  console.log(`Relay URL:           ${relayUrl}`);
  console.log(`Chain ID:            ${chainId}`);
  console.log(`Treasury Accounts:   ${treasuryWallets.length}`);
  console.log(`Wallets:             ${walletCount}`);
  console.log(`Signed TXs / Wallet: ${signedTxsPerWallet}`);

  for (const w of treasuryWallets) {
    const bal = await provider.getBalance(w.address);
    console.log(`Treasury [${w.address}] Balance: ${formatEther(bal)} HBAR`);
  }

  // ── Step 1: Deploy contracts ─────────────────────────────────────────────
  console.log(`\n1. Deploying ${treasuryWallets.length} Greeter contracts (one per treasury)...`);
  const smartContracts = await Promise.all(
    treasuryWallets.map(async (wallet, i) => {
      const factory = new ethers.ContractFactory(Greeter.abi, Greeter.bytecode, wallet);
      const contract = await factory.deploy(`CN Bench Warmup - Treasury ${i}`);
      await contract.waitForDeployment();
      const address = await contract.getAddress();
      console.log(`   Contract [${i}] deployed at: ${address}`);
      return address;
    }),
  );

  // ── Step 2: Gas estimation (once, shared across all wallets) ─────────────
  const { gasPrice } = await provider.getFeeData();
  const gasLimit = await new ethers.Contract(smartContracts[0], Greeter.abi, treasuryWallets[0])[
    'setGreeting'
  ].estimateGas('warmup');
  const perWalletFunding = gasPrice * gasLimit * BigInt(signedTxsPerWallet) * 5n;

  console.log(
    `\n2. Gas: price=${gasPrice}, estimated limit=${gasLimit}, funding per wallet: ${formatEther(perWalletFunding)} HBAR`,
  );

  // ── Step 3: Create wallets, resolve treasury nonces, and assign treasury groups ─
  const newWallets = Array.from({ length: walletCount }, () => ethers.Wallet.createRandom());

  const treasuryNonces = await Promise.all(
    treasuryWallets.map((w) => provider.getTransactionCount(w.address, 'pending')),
  );

  // Partition wallets into per-treasury groups using round-robin assignment.
  // Each group is funded sequentially by its treasury to satisfy Hedera's
  // strict nonce ordering requirement (no pending/queued transactions).
  const treasuryGroups = treasuryWallets.map((_, tidx) =>
    newWallets.filter((_, wi) => wi % treasuryWallets.length === tidx),
  );

  // ── Step 4: Fund wallets + sign transactions (concurrent) ────────────────
  // Signing is pure local secp256k1 computation with no dependency on wallet
  // balance. Both phases start together: signing completes in CPU time while
  // funding awaits on-chain confirmations, eliminating sequential blocking.
  //
  // Funding strategy: treasury chains run in parallel, but each chain submits
  // one transaction at a time and waits for confirmation before the next.
  // Hedera rejects nonce N+1 if nonce N is not yet confirmed on-chain.
  console.log(
    `\n3. Funding ${walletCount} wallets and pre-signing ${walletCount * signedTxsPerWallet} transactions concurrently...`,
  );

  const [, allSignedTxs] = await Promise.all([
    Promise.all(
      treasuryWallets.map((treasury, tidx) =>
        fundWalletsSequentially(treasury, treasuryGroups[tidx], perWalletFunding, treasuryNonces[tidx]),
      ),
    ),
    Promise.all(
      newWallets.map((wallet) => buildSignedTxs(wallet, smartContracts, gasPrice, chainId, signedTxsPerWallet)),
    ),
  ]);

  console.log('   All wallets funded.');

  // ── Step 6: Persist output ───────────────────────────────────────────────
  const output = {
    wallets: newWallets.map((wallet, i) => ({
      address: wallet.address,
      privateKey: wallet.privateKey,
      signedTxs: allSignedTxs[i],
    })),
    smartContracts,
    DEFAULT_ENTITY_FROM: treasuryWallets[0].address,
    DEFAULT_ENTITY_TO: smartContracts[0],
  };

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2));
  console.log(`\n4. Parameters saved to: ${OUTPUT_PATH}`);
  console.log('--- Preparation Complete ---');
})().catch((err) => {
  console.error('\nERROR during preparation:', err);
  process.exit(1);
});
