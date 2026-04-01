// SPDX-License-Identifier: Apache-2.0

/**
 * Acceptance tests for mirror-node fields (`amount`, `gas_price`,
 * EIP-1559 fee fields) when surfaced through the relay.
 *
 * Mirror node exposes `hbar=true` (tinybars, default) vs `hbar=false` (weibars) on
 * `GET /contracts/results` and related routes. Sub-tinybar `value` and gas prices that are
 * not representable cleanly in tinybars can break RLP reconstruction via
 * `debug_getRawTransaction` until the relay requests weibar-scale fields from the mirror.
 *
 * Baseline cases should pass on healthy networks. Boundary cases document precision limits;
 * they may fail until relay + mirror `hbar` handling is aligned (see project docs / HIP).
 */

// External resources
import { expect } from 'chai';
import { ethers } from 'ethers';

import { ConfigService } from '../../../src/config-service/services';
import constants from '../../../src/relay/lib/constants';
import { withOverriddenEnvsInMochaTest } from '../../relay/helpers';
import RelayClient from '../clients/relayClient';
import { Utils } from '../helpers/utils';
import { AliasAccount } from '../types/AliasAccount';

/** 1 tinybar expressed in weibars (mirror `hbar=false` / EVM native unit scale). */
const ONE_TINYBAR_WEI = BigInt(constants.TINYBAR_TO_WEIBAR_COEF);
const GWEI = BigInt(1_000_000_000);
const ONE_POINT_ONE_TINYBAR_WEI = BigInt(11) * GWEI;
const GAS_PRICE_1500_GWEI = BigInt(1500) * GWEI;
const GAS_PRICE_1501_GWEI = BigInt(1501) * GWEI;

const LEGACY_GAS_LIMIT = 3_000_000;

describe('@sub_tinybar_monetary_precision Acceptance Tests', function () {
  this.timeout(240 * 1000);

  // @ts-ignore
  const { mirrorNode, relay, initialBalance }: { mirrorNode: any; relay: RelayClient; initialBalance: string } = global;

  const CHAIN_ID = Number(ConfigService.get('CHAIN_ID'));

  const accounts: AliasAccount[] = [];
  let sender: ethers.Wallet;
  let recipient: string;

  before(async function () {
    const initialAccount: AliasAccount = global.accounts[0];
    accounts.push(...(await Utils.createMultipleAliasAccounts(mirrorNode, initialAccount, 3, initialBalance)));
    global.accounts.push(...accounts);
    sender = accounts[1].wallet;
    recipient = accounts[2].address;
  });

  async function waitForRelayTransaction(txHash: string, maxAttempts = 40): Promise<any> {
    for (let i = 0; i < maxAttempts; i++) {
      const tx = await relay.call('eth_getTransactionByHash', [txHash]);
      if (tx) {
        return tx;
      }
      await Utils.wait(1000);
    }
    throw new Error(`eth_getTransactionByHash still null after ${maxAttempts}s for ${txHash}`);
  }

  async function sendLegacyTx(params: {
    value: bigint;
    gasPrice: bigint;
  }): Promise<{ hash: string; signedTx: string }> {
    const txRequest = {
      type: 0 as const,
      chainId: CHAIN_ID,
      nonce: await relay.getAccountNonce(sender.address),
      to: recipient,
      value: params.value,
      gasLimit: LEGACY_GAS_LIMIT,
      gasPrice: params.gasPrice,
    };
    const signedTx = await sender.signTransaction(txRequest);
    const hash = await relay.sendRawTransaction(signedTx);
    await relay.pollForValidTransactionReceipt(hash);
    await waitForRelayTransaction(hash);
    return { hash, signedTx };
  }

  async function sendType2Tx(params: {
    value: bigint;
    maxFeePerGas: bigint;
    maxPriorityFeePerGas: bigint;
  }): Promise<{ hash: string; signedTx: string }> {
    const txRequest = {
      type: 2 as const,
      chainId: CHAIN_ID,
      nonce: await relay.getAccountNonce(sender.address),
      to: recipient,
      value: params.value,
      gasLimit: LEGACY_GAS_LIMIT,
      maxFeePerGas: params.maxFeePerGas,
      maxPriorityFeePerGas: params.maxPriorityFeePerGas,
    };
    const signedTx = await sender.signTransaction(txRequest);
    const hash = await relay.sendRawTransaction(signedTx);
    await relay.pollForValidTransactionReceipt(hash);
    await waitForRelayTransaction(hash);
    return { hash, signedTx };
  }

  function assertEthGetTxMatchesSigned(signedSerialized: string, rpcTx: any): void {
    expect(rpcTx, 'eth_getTransactionByHash result').to.not.be.null;
    const fromSigned = ethers.Transaction.from(signedSerialized);
    expect(rpcTx.hash.toLowerCase()).to.equal(fromSigned.hash?.toLowerCase());
    expect(BigInt(rpcTx.value)).to.equal(fromSigned.value);

    if (fromSigned.type === 0) {
      expect(BigInt(rpcTx.gasPrice)).to.equal(fromSigned.gasPrice!);
    } else {
      expect(BigInt(rpcTx.maxFeePerGas)).to.equal(fromSigned.maxFeePerGas!);
      expect(BigInt(rpcTx.maxPriorityFeePerGas)).to.equal(fromSigned.maxPriorityFeePerGas!);
    }
  }

  async function assertDebugRawRoundTrip(signedSerialized: string, txHash: string): Promise<void> {
    const raw = await relay.call('debug_getRawTransaction', [txHash]);
    expect(raw, 'debug_getRawTransaction').to.not.equal('0x');
    const fromSigned = ethers.Transaction.from(signedSerialized);
    const fromRaw = ethers.Transaction.from(raw);
    expect(fromRaw.hash).to.equal(fromSigned.hash);
    expect(fromRaw.from?.toLowerCase()).to.equal(fromSigned.from?.toLowerCase());
    expect(fromRaw.value).to.equal(fromSigned.value);
    if (fromSigned.type === 0) {
      expect(fromRaw.gasPrice).to.equal(fromSigned.gasPrice);
    } else {
      expect(fromRaw.maxFeePerGas).to.equal(fromSigned.maxFeePerGas);
      expect(fromRaw.maxPriorityFeePerGas).to.equal(fromSigned.maxPriorityFeePerGas);
    }
  }

  describe('legacy type-0 — baseline (integer tinybar value, 1500 gwei)', function () {
    it('eth_getTransactionByHash matches signed transaction', async function () {
      const { hash, signedTx } = await sendLegacyTx({
        value: ONE_TINYBAR_WEI,
        gasPrice: GAS_PRICE_1500_GWEI,
      });
      const rpcTx = await relay.call('eth_getTransactionByHash', [hash]);
      assertEthGetTxMatchesSigned(signedTx, rpcTx);
    });

    it('mirror GET /contracts/results/{hash} returns SUCCESS for baseline tx', async function () {
      const { hash } = await sendLegacyTx({
        value: ONE_TINYBAR_WEI,
        gasPrice: GAS_PRICE_1500_GWEI,
      });
      const cr = await mirrorNode.get(`/contracts/results/${hash}`);
      expect(cr.result).to.equal('SUCCESS');
      expect(cr.hash?.toLowerCase()).to.equal(hash.toLowerCase());
    });

    withOverriddenEnvsInMochaTest({ DEBUG_API_ENABLED: true }, () => {
      it('debug_getRawTransaction RLP round-trip matches signer and hash', async function () {
        const { hash, signedTx } = await sendLegacyTx({
          value: ONE_TINYBAR_WEI,
          gasPrice: GAS_PRICE_1500_GWEI,
        });
        await assertDebugRawRoundTrip(signedTx, hash);
      });
    });
  });

  describe('legacy type-0 — value precision (1.1 tinybar in weibars)', function () {
    it('eth_getTransactionByHash matches signed transaction', async function () {
      const { hash, signedTx } = await sendLegacyTx({
        value: ONE_POINT_ONE_TINYBAR_WEI,
        gasPrice: GAS_PRICE_1500_GWEI,
      });
      const rpcTx = await relay.call('eth_getTransactionByHash', [hash]);
      assertEthGetTxMatchesSigned(signedTx, rpcTx);
    });

    withOverriddenEnvsInMochaTest({ DEBUG_API_ENABLED: true }, () => {
      it('debug_getRawTransaction RLP round-trip matches signer and hash', async function () {
        const { hash, signedTx } = await sendLegacyTx({
          value: ONE_POINT_ONE_TINYBAR_WEI,
          gasPrice: GAS_PRICE_1500_GWEI,
        });
        await assertDebugRawRoundTrip(signedTx, hash);
      });
    });
  });

  describe('legacy type-0 — gasPrice precision (1501 gwei)', function () {
    it('eth_getTransactionByHash matches signed transaction', async function () {
      const { hash, signedTx } = await sendLegacyTx({
        value: ONE_TINYBAR_WEI,
        gasPrice: GAS_PRICE_1501_GWEI,
      });
      const rpcTx = await relay.call('eth_getTransactionByHash', [hash]);
      assertEthGetTxMatchesSigned(signedTx, rpcTx);
    });

    withOverriddenEnvsInMochaTest({ DEBUG_API_ENABLED: true }, () => {
      it('debug_getRawTransaction RLP round-trip matches signer and hash', async function () {
        const { hash, signedTx } = await sendLegacyTx({
          value: ONE_TINYBAR_WEI,
          gasPrice: GAS_PRICE_1501_GWEI,
        });
        await assertDebugRawRoundTrip(signedTx, hash);
      });
    });
  });

  describe('type-2 (EIP-1559) — baseline fees', function () {
    it('eth_getTransactionByHash matches signed maxFee and priority fee', async function () {
      const { hash, signedTx } = await sendType2Tx({
        value: ONE_TINYBAR_WEI,
        maxFeePerGas: GAS_PRICE_1500_GWEI,
        maxPriorityFeePerGas: GAS_PRICE_1500_GWEI,
      });
      const rpcTx = await relay.call('eth_getTransactionByHash', [hash]);
      assertEthGetTxMatchesSigned(signedTx, rpcTx);
    });

    withOverriddenEnvsInMochaTest({ DEBUG_API_ENABLED: true }, () => {
      it('debug_getRawTransaction RLP round-trip matches signer and hash', async function () {
        const { hash, signedTx } = await sendType2Tx({
          value: ONE_TINYBAR_WEI,
          maxFeePerGas: GAS_PRICE_1500_GWEI,
          maxPriorityFeePerGas: GAS_PRICE_1500_GWEI,
        });
        await assertDebugRawRoundTrip(signedTx, hash);
      });
    });
  });

  describe('type-2 (EIP-1559) — fee precision (1501 gwei)', function () {
    it('eth_getTransactionByHash matches signed maxFee and priority fee', async function () {
      const { hash, signedTx } = await sendType2Tx({
        value: ONE_TINYBAR_WEI,
        maxFeePerGas: GAS_PRICE_1501_GWEI,
        maxPriorityFeePerGas: GAS_PRICE_1501_GWEI,
      });
      const rpcTx = await relay.call('eth_getTransactionByHash', [hash]);
      assertEthGetTxMatchesSigned(signedTx, rpcTx);
    });

    withOverriddenEnvsInMochaTest({ DEBUG_API_ENABLED: true }, () => {
      it('debug_getRawTransaction RLP round-trip matches signer and hash', async function () {
        const { hash, signedTx } = await sendType2Tx({
          value: ONE_TINYBAR_WEI,
          maxFeePerGas: GAS_PRICE_1501_GWEI,
          maxPriorityFeePerGas: GAS_PRICE_1501_GWEI,
        });
        await assertDebugRawRoundTrip(signedTx, hash);
      });
    });
  });

  describe('GET /contracts/results list path via eth_getTransactionByBlockNumberAndIndex', function () {
    it('returns same fields as eth_getTransactionByHash for baseline legacy tx', async function () {
      const { hash } = await sendLegacyTx({
        value: ONE_TINYBAR_WEI,
        gasPrice: GAS_PRICE_1500_GWEI,
      });
      const receipt = await relay.call('eth_getTransactionReceipt', [hash]);
      expect(receipt).to.not.be.null;
      const blockNumberHex = receipt.blockNumber;
      const txIndex = receipt.transactionIndex;
      const byIndex = await relay.call('eth_getTransactionByBlockNumberAndIndex', [blockNumberHex, txIndex]);
      const byHash = await relay.call('eth_getTransactionByHash', [hash]);
      expect(byIndex.hash.toLowerCase()).to.equal(byHash.hash.toLowerCase());
      expect(byIndex.value).to.equal(byHash.value);
      expect(byIndex.gasPrice).to.equal(byHash.gasPrice);
    });
  });

  describe('GET /contracts/results timestamp range via eth_getBlockByNumber(fullTx=true)', function () {
    it('includes transaction with matching value and gasPrice for baseline legacy tx', async function () {
      const { hash, signedTx } = await sendLegacyTx({
        value: ONE_TINYBAR_WEI,
        gasPrice: GAS_PRICE_1500_GWEI,
      });
      const receipt = await relay.call('eth_getTransactionReceipt', [hash]);
      expect(receipt).to.not.be.null;
      const blockNumberHex = receipt.blockNumber;
      const block = await relay.call('eth_getBlockByNumber', [blockNumberHex, true]);
      expect(block?.transactions, 'full transactions').to.be.an('array');
      const found = block.transactions.find((t: any) => t.hash?.toLowerCase() === hash.toLowerCase());
      expect(found, 'tx in block').to.exist;
      assertEthGetTxMatchesSigned(signedTx, found);
    });
  });
});
