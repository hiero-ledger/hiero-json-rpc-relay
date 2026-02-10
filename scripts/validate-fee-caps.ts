// SPDX-License-Identifier: Apache-2.0

/**
 * Automated live validation for EIP-1559 fee cap unit fix (#4901).
 *
 * Sends a type-2 transaction on Goliath Testnet and verifies that
 * maxFeePerGas and maxPriorityFeePerGas are returned in weibars
 * (same unit as effectiveGasPrice), not raw tinybars.
 *
 * Usage:
 *   GOLIATH_TEST_PRIVATE_KEY=<hex> npx ts-node scripts/validate-fee-caps.ts
 *
 * Environment variables:
 *   GOLIATH_TEST_PRIVATE_KEY  - Private key (hex, no 0x prefix ok) for a funded Goliath Testnet account
 *   GOLIATH_RPC_URL           - (optional) RPC endpoint, defaults to http://104.238.187.163:30756
 */

import { ethers } from 'ethers';

const TINYBAR_TO_WEIBAR_COEF = 10_000_000_000n;
const RPC_URL = process.env.GOLIATH_RPC_URL || 'http://104.238.187.163:30756';
const BLOCKSCOUT_STATS_URL = process.env.BLOCKSCOUT_STATS_URL || 'https://testnet.explorer.goliath.net/api/v2/stats';
const PRIVATE_KEY = process.env.GOLIATH_TEST_PRIVATE_KEY;

interface ValidationResult {
  passed: boolean;
  txHash: string;
  txType: string;
  maxFeePerGas: string;
  maxPriorityFeePerGas: string;
  effectiveGasPrice: string;
  maxFeePerGasDec: bigint;
  maxPriorityFeePerGasDec: bigint;
  effectiveGasPriceDec: bigint;
  errors: string[];
}

async function main(): Promise<void> {
  if (!PRIVATE_KEY) {
    console.error('ERROR: GOLIATH_TEST_PRIVATE_KEY env var is required');
    process.exit(1);
  }

  console.log(`\n=== EIP-1559 Fee Cap Validation (fix-4901) ===`);
  console.log(`RPC: ${RPC_URL}\n`);

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
  const address = await wallet.getAddress();

  console.log(`Wallet: ${address}`);

  // Check balance
  const balance = await provider.getBalance(address);
  console.log(`Balance: ${ethers.formatEther(balance)} XCN (${balance} wei)\n`);

  if (balance === 0n) {
    console.error('ERROR: Wallet has zero balance — fund it before running validation');
    process.exit(1);
  }

  // Step 1: Send a type-2 (EIP-1559) transaction — simple self-transfer of 0 value
  console.log('Step 1: Sending type-2 transaction...');
  const feeData = await provider.getFeeData();
  console.log(
    `  Network fee data: gasPrice=${feeData.gasPrice}, maxFeePerGas=${feeData.maxFeePerGas}, maxPriorityFeePerGas=${feeData.maxPriorityFeePerGas}`,
  );

  const tx = await wallet.sendTransaction({
    to: address,
    value: 0n,
    type: 2,
    maxFeePerGas: feeData.maxFeePerGas ?? feeData.gasPrice,
    maxPriorityFeePerGas: feeData.maxPriorityFeePerGas ?? 0n,
  });

  console.log(`  Tx hash: ${tx.hash}`);
  console.log('  Waiting for confirmation...');

  const receipt = await tx.wait();
  if (!receipt) {
    console.error('ERROR: Transaction receipt is null');
    process.exit(1);
  }
  console.log(`  Confirmed in block ${receipt.blockNumber}, status=${receipt.status}\n`);

  // Step 2: Query via eth_getTransactionByHash (raw JSON-RPC to see exact hex values)
  console.log('Step 2: Querying eth_getTransactionByHash...');
  const txResult = await provider.send('eth_getTransactionByHash', [tx.hash]);

  if (!txResult) {
    console.error('ERROR: eth_getTransactionByHash returned null');
    process.exit(1);
  }

  // Step 3: Query receipt for effectiveGasPrice
  console.log('Step 3: Querying eth_getTransactionReceipt...');
  const receiptResult = await provider.send('eth_getTransactionReceipt', [tx.hash]);

  // Step 4: Validate
  console.log('\nStep 4: Validating fee field units...\n');

  const result: ValidationResult = {
    passed: true,
    txHash: tx.hash,
    txType: txResult.type,
    maxFeePerGas: txResult.maxFeePerGas,
    maxPriorityFeePerGas: txResult.maxPriorityFeePerGas,
    effectiveGasPrice: receiptResult.effectiveGasPrice,
    maxFeePerGasDec: BigInt(txResult.maxFeePerGas),
    maxPriorityFeePerGasDec: BigInt(txResult.maxPriorityFeePerGas),
    effectiveGasPriceDec: BigInt(receiptResult.effectiveGasPrice),
    errors: [],
  };

  // Print raw values
  console.log(`  tx.type:                 ${result.txType}`);
  console.log(`  tx.maxFeePerGas:         ${result.maxFeePerGas} (${result.maxFeePerGasDec})`);
  console.log(`  tx.maxPriorityFeePerGas: ${result.maxPriorityFeePerGas} (${result.maxPriorityFeePerGasDec})`);
  console.log(`  receipt.effectiveGasPrice: ${result.effectiveGasPrice} (${result.effectiveGasPriceDec})\n`);

  // Assertion 1: Transaction must be type 2
  if (result.txType !== '0x2') {
    result.errors.push(`Expected type 0x2, got ${result.txType}`);
    result.passed = false;
  }

  // Assertion 2: maxFeePerGas must be in weibar range (>= 1 tinybar in weibars = 10^10)
  // A tinybar passthrough would be < 10^6 typically; weibars should be >= 10^10
  if (result.maxFeePerGasDec < TINYBAR_TO_WEIBAR_COEF) {
    result.errors.push(
      `maxFeePerGas ${result.maxFeePerGasDec} appears to be in tinybars (< ${TINYBAR_TO_WEIBAR_COEF}). Expected weibars.`,
    );
    result.passed = false;
  }

  // Assertion 3: maxPriorityFeePerGas must be in weibar range if non-zero
  if (result.maxPriorityFeePerGasDec > 0n && result.maxPriorityFeePerGasDec < TINYBAR_TO_WEIBAR_COEF) {
    result.errors.push(
      `maxPriorityFeePerGas ${result.maxPriorityFeePerGasDec} appears to be in tinybars (< ${TINYBAR_TO_WEIBAR_COEF}). Expected weibars.`,
    );
    result.passed = false;
  }

  // Assertion 4: maxFeePerGas and effectiveGasPrice must be within 100x of each other
  // (same order of magnitude = compatible units)
  if (result.effectiveGasPriceDec > 0n) {
    const ratio =
      result.maxFeePerGasDec > result.effectiveGasPriceDec
        ? result.maxFeePerGasDec / result.effectiveGasPriceDec
        : result.effectiveGasPriceDec / result.maxFeePerGasDec;

    console.log(`  maxFeePerGas / effectiveGasPrice ratio: ${ratio}x`);

    if (ratio > 100n) {
      result.errors.push(
        `maxFeePerGas (${result.maxFeePerGasDec}) and effectiveGasPrice (${result.effectiveGasPriceDec}) differ by ${ratio}x — unit mismatch detected.`,
      );
      result.passed = false;
    }
  }

  // Assertion 5: maxFeePerGas >= effectiveGasPrice (the cap should not be below the effective price)
  if (result.maxFeePerGasDec < result.effectiveGasPriceDec) {
    result.errors.push(
      `maxFeePerGas (${result.maxFeePerGasDec}) < effectiveGasPrice (${result.effectiveGasPriceDec}) — this is invalid for a confirmed transaction.`,
    );
    result.passed = false;
  }

  // Step 5: Validate Blockscout gas_prices consistency
  console.log('\nStep 5: Checking Blockscout stats API...');
  try {
    const statsResponse = await fetch(BLOCKSCOUT_STATS_URL);
    if (!statsResponse.ok) {
      console.log(`  WARNING: Blockscout stats returned ${statsResponse.status} — skipping check`);
    } else {
      const stats = (await statsResponse.json()) as {
        gas_prices?: { slow?: { price: number }; average?: { price: number }; fast?: { price: number } };
      };
      const gasPrices = stats.gas_prices;

      if (!gasPrices) {
        console.log('  WARNING: gas_prices field missing from Blockscout stats — skipping check');
      } else {
        const avgPrice = gasPrices.average?.price ?? gasPrices.slow?.price ?? gasPrices.fast?.price;
        console.log(
          `  Blockscout gas_prices: slow=${gasPrices.slow?.price}, average=${gasPrices.average?.price}, fast=${gasPrices.fast?.price} (Gwei)`,
        );

        if (avgPrice != null && avgPrice > 0) {
          // Compare with eth_gasPrice (convert from wei to Gwei)
          const ethGasPriceResult = await provider.send('eth_gasPrice', []);
          const ethGasPriceWei = BigInt(ethGasPriceResult);
          const ethGasPriceGwei = Number(ethGasPriceWei) / 1e9;

          console.log(`  eth_gasPrice: ${ethGasPriceGwei.toFixed(2)} Gwei`);

          const blockscoutRatio = avgPrice > ethGasPriceGwei ? avgPrice / ethGasPriceGwei : ethGasPriceGwei / avgPrice;
          console.log(`  Blockscout/eth_gasPrice ratio: ${blockscoutRatio.toFixed(2)}x`);

          // Assertion 6: Blockscout gas_prices must be within 2x of eth_gasPrice
          if (blockscoutRatio > 2) {
            result.errors.push(
              `Blockscout gas_prices.average (${avgPrice} Gwei) differs from eth_gasPrice (${ethGasPriceGwei.toFixed(2)} Gwei) by ${blockscoutRatio.toFixed(2)}x — expected within 2x.`,
            );
            result.passed = false;
          }

          // Assertion 7: Blockscout gas_prices must be positive (not negative from unit mismatch)
          if (avgPrice < 0) {
            result.errors.push(`Blockscout gas_prices.average is negative (${avgPrice} Gwei) — unit mismatch issue.`);
            result.passed = false;
          }
        } else {
          console.log('  WARNING: Blockscout gas_prices.average is null/0 — skipping comparison');
        }
      }
    }
  } catch (err) {
    console.log(`  WARNING: Could not reach Blockscout stats API: ${err instanceof Error ? err.message : err}`);
  }

  // Report
  console.log('\n=== RESULT ===\n');
  if (result.passed) {
    console.log('PASS: All fee cap fields are in weibars and consistent with effectiveGasPrice.');
  } else {
    console.log('FAIL: Fee cap validation errors:');
    for (const err of result.errors) {
      console.log(`  - ${err}`);
    }
  }

  console.log(`\nTx hash for manual inspection: ${result.txHash}\n`);

  process.exit(result.passed ? 0 : 1);
}

main().catch((err) => {
  console.error('Unhandled error:', err);
  process.exit(1);
});
