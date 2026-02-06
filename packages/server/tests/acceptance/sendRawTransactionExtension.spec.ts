// SPDX-License-Identifier: Apache-2.0

// External resources
import { ConfigService } from '@hashgraph/json-rpc-config-service/dist/services';
import { ConfigServiceTestHelper } from '@hashgraph/json-rpc-config-service/tests/configServiceTestHelper';
// Other imports
import { numberTo0x } from '@hashgraph/json-rpc-relay/dist/formatters';
import Constants from '@hashgraph/json-rpc-relay/dist/lib/constants';
// Errors and constants from local resources
import { predefined } from '@hashgraph/json-rpc-relay/dist/lib/errors/JsonRpcError';
import { RequestDetails } from '@hashgraph/json-rpc-relay/dist/lib/types';
import { overrideEnvsInMochaDescribe, withOverriddenEnvsInMochaTest } from '@hashgraph/json-rpc-relay/tests/helpers';
import { expect } from 'chai';

import MirrorClient from '../clients/mirrorClient';
import RelayClient from '../clients/relayClient';
import ServicesClient from '../clients/servicesClient';
// Assertions from local resources
import Assertions from '../helpers/assertions';
import { Utils } from '../helpers/utils';
import { AliasAccount } from '../types/AliasAccount';

describe('@sendRawTransactionExtension Acceptance Tests', function () {
  this.timeout(240 * 1000); // 240 seconds

  const accounts: AliasAccount[] = [];

  // @ts-ignore
  const {
    mirrorNode,
    relay,
    initialBalance,
  }: { servicesNode: ServicesClient; mirrorNode: MirrorClient; relay: RelayClient; initialBalance: string } = global;

  const CHAIN_ID = ConfigService.get('CHAIN_ID');
  const ONE_TINYBAR = Utils.add0xPrefix(Utils.toHex(Constants.TINYBAR_TO_WEIBAR_COEF));
  const defaultLondonTransactionData = {
    value: ONE_TINYBAR,
    chainId: Number(CHAIN_ID),
    maxPriorityFeePerGas: Assertions.defaultGasPrice,
    maxFeePerGas: Assertions.defaultGasPrice,
    gasLimit: numberTo0x(3_000_000),
    type: 2,
  };
  const requestDetails = new RequestDetails({ requestId: 'sendRawTransactionPrecheck', ipAddress: '0.0.0.0' });
  const sendRawTransaction = relay.sendRawTransaction;

  //   describe('@sendRawTransactionPrecheck Acceptance Tests', function () {
  this.timeout(240 * 1000); // 240 seconds
  const defaultGasLimit = numberTo0x(3_000_000);

  this.beforeAll(async () => {
    const initialAccount: AliasAccount = global.accounts[0];
    const neededAccounts: number = 5;
    accounts.push(
      ...(await Utils.createMultipleAliasAccounts(mirrorNode, initialAccount, neededAccounts, initialBalance)),
    );
    global.accounts.push(...accounts);
  });

  describe('Prechecks', function () {
    describe('transactionSize', function () {
      it('@release should execute "eth_sendRawTransaction" with regular transaction size within the SEND_RAW_TRANSACTION_SIZE_LIMIT - 130kb limit', async function () {
        const gasPrice = await relay.gasPrice();
        const transaction = {
          type: 2,
          chainId: Number(CHAIN_ID),
          nonce: await relay.getAccountNonce(accounts[1].address),
          maxPriorityFeePerGas: gasPrice,
          maxFeePerGas: gasPrice,
          gasLimit: defaultGasLimit,
          to: accounts[0].address,
        };

        const signedTx = await accounts[1].wallet.signTransaction(transaction);
        expect(signedTx.length).to.be.lt(Constants.SEND_RAW_TRANSACTION_SIZE_LIMIT);

        const transactionHash = await relay.sendRawTransaction(signedTx);
        await relay.pollForValidTransactionReceipt(transactionHash);

        const info = await mirrorNode.get(`/contracts/results/${transactionHash}`);
        expect(info).to.exist;
        expect(info.result).to.equal('SUCCESS');
      });

      it('@release should fail "eth_sendRawTransaction" when transaction size exceeds the SEND_RAW_TRANSACTION_SIZE_LIMIT - 130kb limit', async function () {
        const gasPrice = await relay.gasPrice();
        const transaction = {
          type: 2,
          chainId: Number(CHAIN_ID),
          nonce: await relay.getAccountNonce(accounts[1].address),
          maxPriorityFeePerGas: gasPrice,
          maxFeePerGas: gasPrice,
          gasLimit: defaultGasLimit,
          to: accounts[0].address,
          data: '0x' + '00'.repeat(Constants.SEND_RAW_TRANSACTION_SIZE_LIMIT + 1024), // exceeds the limit by 1KB
        };

        const signedTx = await accounts[1].wallet.signTransaction(transaction);
        const totalRawTransactionSizeInBytes = signedTx.replace('0x', '').length / 2;
        const error = predefined.TRANSACTION_SIZE_LIMIT_EXCEEDED(
          totalRawTransactionSizeInBytes,
          Constants.SEND_RAW_TRANSACTION_SIZE_LIMIT,
        );

        await Assertions.assertPredefinedRpcError(error, sendRawTransaction, false, relay, [signedTx, requestDetails]);
      });
    });

    describe('accessList', function () {
      it('should fail when calling "eth_sendRawTransaction" with non-empty access list', async function () {
        const gasPrice = await relay.gasPrice();
        const transaction = {
          type: 2,
          chainId: Number(CHAIN_ID),
          nonce: await relay.getAccountNonce(accounts[1].address),
          maxPriorityFeePerGas: gasPrice,
          maxFeePerGas: gasPrice,
          gasLimit: defaultGasLimit,
          accessList: [
            {
              address: '0x67D8d32E9Bf1a9968a5ff53B87d777Aa8EBBEe69',
              storageKeys: [],
            },
          ],
          to: accounts[0].address,
        };

        const signedTx = await accounts[1].wallet.signTransaction(transaction);
        await expect(relay.sendRawTransaction(signedTx)).to.eventually.be.rejected;
      });

      it('should succeed when calling "eth_sendRawTransaction" with an empty access list', async function () {
        const gasPrice = await relay.gasPrice();
        const transaction = {
          type: 2,
          chainId: Number(CHAIN_ID),
          nonce: await relay.getAccountNonce(accounts[1].address),
          maxPriorityFeePerGas: gasPrice,
          maxFeePerGas: gasPrice,
          gasLimit: defaultGasLimit,
          accessList: [],
          to: accounts[0].address,
        };
        const signedTx = await accounts[1].wallet.signTransaction(transaction);
        const transactionHash = await relay.sendRawTransaction(signedTx);
        await relay.pollForValidTransactionReceipt(transactionHash);

        const info = await mirrorNode.get(`/contracts/results/${transactionHash}`);
        expect(info).to.exist;
      });
    });

    describe('callDataSize', function () {
      it('@release should execute "eth_sendRawTransaction" with regular transaction size within the CALL_DATA_SIZE_LIMIT - 128kb limit', async function () {
        const gasPrice = await relay.gasPrice();
        const transaction = {
          type: 2,
          chainId: Number(CHAIN_ID),
          nonce: await relay.getAccountNonce(accounts[1].address),
          maxPriorityFeePerGas: gasPrice,
          maxFeePerGas: gasPrice,
          gasLimit: defaultGasLimit,
          to: accounts[0].address,
        };

        const signedTx = await accounts[1].wallet.signTransaction(transaction);
        expect(signedTx.length).to.be.lt(Constants.CALL_DATA_SIZE_LIMIT);

        const transactionHash = await relay.sendRawTransaction(signedTx);
        await relay.pollForValidTransactionReceipt(transactionHash);

        const info = await mirrorNode.get(`/contracts/results/${transactionHash}`);
        expect(info).to.exist;
        expect(info.result).to.equal('SUCCESS');
      });

      it('@release should fail "eth_sendRawTransaction" when transaction size exceeds the CALL_DATA_SIZE_LIMIT - 128kb limit', async function () {
        const gasPrice = await relay.gasPrice();
        const transaction = {
          type: 2,
          chainId: Number(CHAIN_ID),
          nonce: await relay.getAccountNonce(accounts[1].address),
          maxPriorityFeePerGas: gasPrice,
          maxFeePerGas: gasPrice,
          gasLimit: defaultGasLimit,
          to: accounts[0].address,
          data: '0x' + '00'.repeat(Constants.CALL_DATA_SIZE_LIMIT + 1024), // exceeds the limit by 1KB
        };

        const signedTx = await accounts[1].wallet.signTransaction(transaction);
        const totalRawTransactionSizeInBytes = transaction.data.replace('0x', '').length / 2;
        const error = predefined.CALL_DATA_SIZE_LIMIT_EXCEEDED(
          totalRawTransactionSizeInBytes,
          Constants.CALL_DATA_SIZE_LIMIT,
        );

        await Assertions.assertPredefinedRpcError(error, sendRawTransaction, false, relay, [signedTx, requestDetails]);
      });
    });
  });

  describe('Jumbo Transaction', function () {
    it('@release @xts should execute "eth_sendRawTransaction" with Jumbo Transaction', async function () {
      const isJumboTransaction = ConfigService.get('JUMBO_TX_ENABLED');
      // skip this test if JUMBO_TX_ENABLED is false
      if (!isJumboTransaction) {
        this.skip();
      }

      const gasPrice = await relay.gasPrice();
      const transaction = {
        type: 2,
        chainId: Number(CHAIN_ID),
        nonce: await relay.getAccountNonce(accounts[1].address),
        maxPriorityFeePerGas: gasPrice,
        maxFeePerGas: gasPrice,
        gasLimit: defaultGasLimit,
        to: accounts[0].address,
        data: '0x' + '00'.repeat(6144), // = 6kb just barely above the HFS threshold to trigger the jumbo transaction flow
      };

      const signedTx = await accounts[1].wallet.signTransaction(transaction);
      const transactionHash = await relay.sendRawTransaction(signedTx);
      await relay.pollForValidTransactionReceipt(transactionHash);

      const info = await mirrorNode.get(`/contracts/results/${transactionHash}`);
      expect(info).to.exist;
    });
  });

  describe('Read-Only mode', function () {
    it('should fail to execute "eth_sendRawTransaction" in Read-Only mode', async function () {
      const readOnly = ConfigService.get('READ_ONLY');
      ConfigServiceTestHelper.dynamicOverride('READ_ONLY', true);

      const transaction = {
        type: 2,
        chainId: Number(CHAIN_ID),
        nonce: 1234,
        gasLimit: defaultGasLimit,
        to: accounts[0].address,
        data: '0x00',
      };

      const signedTx = await accounts[1].wallet.signTransaction(transaction);
      const error = predefined.UNSUPPORTED_OPERATION('Relay is in read-only mode');
      await Assertions.assertPredefinedRpcError(error, sendRawTransaction, false, relay, [signedTx, requestDetails]);

      ConfigServiceTestHelper.dynamicOverride('READ_ONLY', readOnly);
    });
  });

  describe('Paymaster', function () {
    const zeroGasPrice = '0x0';
    const GAS_PRICE_REF = '0x123456';
    const MAX_ALLOWANCE = 100;

    let paymasterEnabledBefore, paymasterWhitelistBefore, maxGasAllowanceHbarBefore;
    before(() => {
      paymasterEnabledBefore = ConfigService.get('PAYMASTER_ENABLED');
      paymasterWhitelistBefore = ConfigService.get('PAYMASTER_WHITELIST');
      maxGasAllowanceHbarBefore = ConfigService.get('MAX_GAS_ALLOWANCE_HBAR');
    });

    after(() => {
      ConfigServiceTestHelper.dynamicOverride('PAYMASTER_ENABLED', paymasterEnabledBefore);
      ConfigServiceTestHelper.dynamicOverride('PAYMASTER_WHITELIST', paymasterWhitelistBefore);
      ConfigServiceTestHelper.dynamicOverride('MAX_GAS_ALLOWANCE_HBAR', maxGasAllowanceHbarBefore);
    });

    const configurePaymaster = (enabled: boolean, whitelist: string[], allowance: number) => {
      ConfigServiceTestHelper.dynamicOverride('PAYMASTER_ENABLED', enabled);
      ConfigServiceTestHelper.dynamicOverride('PAYMASTER_WHITELIST', whitelist);
      ConfigServiceTestHelper.dynamicOverride('MAX_GAS_ALLOWANCE_HBAR', allowance);
    };

    const createAndSignTransaction = async (senderAccount: AliasAccount, recipientAddress?: string) => {
      const transaction = {
        type: 2,
        chainId: Number(CHAIN_ID),
        nonce: await relay.getAccountNonce(senderAccount.address),
        maxPriorityFeePerGas: zeroGasPrice,
        maxFeePerGas: zeroGasPrice,
        gasLimit: defaultGasLimit,
        to: recipientAddress, // If undefined, creates a contract deployment transaction
        data: recipientAddress ? undefined : '0x' + '00'.repeat(6144),
      };

      return senderAccount.wallet.signTransaction(transaction);
    };

    const verifySuccessfulTransaction = async (txHash: string, signerAddress: string, initialBalance: bigint) => {
      await relay.pollForValidTransactionReceipt(txHash);

      const info = await mirrorNode.get(`/contracts/results/${txHash}`);
      expect(info).to.exist;
      expect(info.result).to.equal('SUCCESS');

      const finalBalance = await relay.getBalance(signerAddress, 'latest');
      expect(initialBalance).to.be.equal(finalBalance);
    };

    it('should process zero-fee contract deployment transactions when Paymaster is enabled globally', async function () {
      // configure paymaster for all addresses
      configurePaymaster(true, ['*'], MAX_ALLOWANCE);

      const initialBalance = await relay.getBalance(accounts[2].address, 'latest');
      const signedTx = await createAndSignTransaction(accounts[2]);
      const txHash = await relay.sendRawTransaction(signedTx);

      await verifySuccessfulTransaction(txHash, accounts[2].address, initialBalance);
    });

    it('should process zero-fee transactions to existing accounts when Paymaster is enabled globally', async function () {
      configurePaymaster(true, ['*'], MAX_ALLOWANCE);

      const initialBalance = await relay.getBalance(accounts[2].address, 'latest');
      const signedTx = await createAndSignTransaction(accounts[2], accounts[0].address);
      const txHash = await relay.sendRawTransaction(signedTx);

      await verifySuccessfulTransaction(txHash, accounts[2].address, initialBalance);
    });

    it('should process zero-fee transactions when target address is specifically whitelisted', async function () {
      // Configure paymaster for specific address
      configurePaymaster(true, [accounts[0].address], MAX_ALLOWANCE);

      const initialBalance = await relay.getBalance(accounts[2].address, 'latest');
      const signedTx = await createAndSignTransaction(accounts[2], accounts[0].address);
      const txHash = await relay.sendRawTransaction(signedTx);

      await verifySuccessfulTransaction(txHash, accounts[2].address, initialBalance);
    });

    it('should reject zero-fee transactions when Paymaster is disabled', async function () {
      configurePaymaster(false, ['*'], MAX_ALLOWANCE);

      const signedTx = await createAndSignTransaction(accounts[2], accounts[0].address);
      const error = predefined.GAS_PRICE_TOO_LOW(zeroGasPrice, GAS_PRICE_REF);

      await Assertions.assertPredefinedRpcError(error, sendRawTransaction, false, relay, [signedTx, requestDetails]);
    });

    it('should reject zero-fee transactions when whitelist is empty despite Paymaster being enabled', async function () {
      configurePaymaster(true, [], MAX_ALLOWANCE);

      const signedTx = await createAndSignTransaction(accounts[2], accounts[0].address);
      const error = predefined.GAS_PRICE_TOO_LOW(zeroGasPrice, GAS_PRICE_REF);

      await Assertions.assertPredefinedRpcError(error, sendRawTransaction, false, relay, [signedTx, requestDetails]);
    });

    it('should return INSUFFICIENT_TX_FEE when Paymaster is enabled but has zero allowance', async function () {
      // set allowance to zero
      configurePaymaster(true, ['*'], 0);

      const signedTx = await createAndSignTransaction(accounts[2], accounts[0].address);
      const txHash = await relay.sendRawTransaction(signedTx);
      await relay.pollForValidTransactionReceipt(txHash);

      const info = await mirrorNode.get(`/contracts/results/${txHash}`);
      expect(info).to.exist;
      expect(info.result).to.equal('INSUFFICIENT_TX_FEE');
    });
  });

  describe('@nonce-ordering Lock Service Tests', function () {
    this.timeout(240 * 1000); // 240 seconds
    overrideEnvsInMochaDescribe({ ENABLE_NONCE_ORDERING: true, USE_ASYNC_TX_PROCESSING: true });
    const sendTransactionWithoutWaiting = (signer: any, nonce: number, numOfTxs: number, gasPrice: number) => {
      const signedTransactions = Array.from({ length: numOfTxs }, async (_, i) => {
        const tx = {
          ...defaultLondonTransactionData,
          to: accounts[2].address,
          value: ONE_TINYBAR,
          nonce: nonce + i,
          maxPriorityFeePerGas: gasPrice,
          maxFeePerGas: gasPrice,
        };
        return await signer.wallet.signTransaction(tx);
      });

      return signedTransactions.map((signedTx) => relay.sendRawTransaction(signedTx));
    };

    it('should handle rapid burst of 10 transactions from same sender', async function () {
      const sender = accounts[1];
      const startNonce = await relay.getAccountNonce(sender.address);
      const gasPrice = await relay.gasPrice();

      const txPromises = sendTransactionWithoutWaiting(sender, startNonce, 10, gasPrice);
      const txHashes = await Promise.all(txPromises);
      const receipts = await Promise.all(txHashes.map((txHash) => relay.pollForValidTransactionReceipt(txHash)));

      receipts.forEach((receipt, i) => {
        expect(receipt.status).to.equal('0x1', `Transaction ${i} failed`);
      });

      const finalNonce = await relay.getAccountNonce(sender.address);
      expect(finalNonce).to.equal(startNonce + 10);
    });

    it('should process three transactions from different senders concurrently', async function () {
      const senders = [accounts[0], accounts[1], accounts[3]];
      const startNonces = await Promise.all(senders.map((sender) => relay.getAccountNonce(sender.address)));
      const gasPrice = await relay.gasPrice();

      const startTime = Date.now();

      // Send transactions from different senders simultaneously
      const txPromises = senders.flatMap((sender, i) =>
        sendTransactionWithoutWaiting(sender, startNonces[i], 1, gasPrice),
      );

      const txHashes = await Promise.all(txPromises);
      const submitTime = Date.now() - startTime;

      // All should succeed
      const receipts = await Promise.all(txHashes.map((hash) => relay.pollForValidTransactionReceipt(hash)));

      receipts.forEach((receipt) => {
        expect(receipt.status).to.equal('0x1');
      });

      // Verify nonces incremented for each sender independently
      const finalNonces = await Promise.all(senders.map((sender) => relay.getAccountNonce(sender.address)));

      finalNonces.forEach((nonce, i) => {
        expect(nonce).to.equal(startNonces[i] + 1);
      });

      // Submission should be fast (not blocking each other)
      // Even with network latency, parallel submission should be < 5 seconds
      expect(submitTime).to.be.lessThan(5000);
    });

    it('should handle mixed load: 5 txs each from 3 different senders', async function () {
      const senders = [accounts[0], accounts[1], accounts[3]];
      const startNonces = await Promise.all(senders.map((sender) => relay.getAccountNonce(sender.address)));
      const gasPrice = await relay.gasPrice();

      // Each sender sends 5 transactions
      const allTxPromises = senders.flatMap((sender, senderIdx) =>
        sendTransactionWithoutWaiting(sender, startNonces[senderIdx], 5, gasPrice),
      );

      const txHashes = await Promise.all(allTxPromises);

      const receipts = await Promise.all(txHashes.map((txHash) => relay.pollForValidTransactionReceipt(txHash)));
      receipts.forEach((receipt, i) => {
        expect(receipt.status).to.equal('0x1', `Transaction ${i} failed`);
      });

      const finalNonces = await Promise.all(senders.map((sender) => relay.getAccountNonce(sender.address)));

      finalNonces.forEach((nonce, i) => {
        expect(nonce).to.equal(startNonces[i] + 5);
      });
    });

    it('should release lock after consensus submission in async mode', async function () {
      const sender = accounts[0];
      const startNonce = await relay.getAccountNonce(sender.address);
      const gasPrice = await relay.gasPrice();

      // Send first transaction
      const tx1Hash = await (await sendTransactionWithoutWaiting(sender, startNonce, 1, gasPrice))[0];

      // Immediately send second transaction (should queue behind first)
      const tx2Hash = await (await sendTransactionWithoutWaiting(sender, startNonce + 1, 1, gasPrice))[0];

      // In async mode, both should return immediately with tx hashes
      expect(tx1Hash).to.exist;
      expect(tx2Hash).to.exist;

      // Both should eventually succeed
      const receipt1 = await relay.pollForValidTransactionReceipt(tx1Hash);
      const receipt2 = await relay.pollForValidTransactionReceipt(tx2Hash);

      expect(receipt1.status).to.equal('0x1');
      expect(receipt2.status).to.equal('0x1');

      // Verify correct nonces
      const result1 = await mirrorNode.get(`/contracts/results/${tx1Hash}`);
      const result2 = await mirrorNode.get(`/contracts/results/${tx2Hash}`);

      expect(result1.nonce).to.equal(startNonce);
      expect(result2.nonce).to.equal(startNonce + 1);
    });

    withOverriddenEnvsInMochaTest({ USE_ASYNC_TX_PROCESSING: false }, () => {
      it('should release lock after full processing in sync mode', async function () {
        const sender = accounts[0];
        const startNonce = await relay.getAccountNonce(sender.address);
        const gasPrice = await relay.gasPrice();

        // Submit both transactions concurrently (no await until Promise.all)
        const tx1Promise = sendTransactionWithoutWaiting(sender, startNonce, 1, gasPrice);
        const tx2Promise = sendTransactionWithoutWaiting(sender, startNonce + 1, 1, gasPrice);

        // Wait for both to complete (lock service ensures they process sequentially internally)
        const [tx1Hashes, tx2Hashes] = await Promise.all([tx1Promise[0], tx2Promise[0]]);
        const tx1Hash = tx1Hashes;
        const tx2Hash = tx2Hashes;

        // Both should succeed - no WRONG_NONCE errors
        expect(tx1Hash).to.exist;
        expect(tx2Hash).to.exist;

        const receipts = await Promise.all([
          relay.pollForValidTransactionReceipt(tx1Hash),
          relay.pollForValidTransactionReceipt(tx2Hash),
        ]);

        expect(receipts[0].status).to.equal('0x1');
        expect(receipts[0].status).to.equal('0x1');
      });

      it('should release lock and allow next transaction after gas price validation error', async function () {
        const sender = accounts[0];
        const startNonce = await relay.getAccountNonce(sender.address);
        const tooLowGasPrice = '0x0'; // Intentionally too low

        // First tx with invalid gas price (will fail validation and not reach consensus)
        const invalidTx = {
          value: ONE_TINYBAR,
          chainId: Number(CHAIN_ID),
          maxPriorityFeePerGas: tooLowGasPrice,
          maxFeePerGas: tooLowGasPrice,
          gasLimit: numberTo0x(3_000_000),
          type: 2,
          to: accounts[2].address,
          nonce: startNonce,
        };
        const signedInvalidTx = await sender.wallet.signTransaction(invalidTx);

        // Second tx with correct nonce (startNonce + 1), but will fail with WRONG_NONCE
        // because first tx never executed (account's actual nonce is still startNonce)
        const secondTx = {
          ...defaultLondonTransactionData,
          to: accounts[2].address,
          value: ONE_TINYBAR,
          nonce: startNonce + 1, // This nonce is ahead of the account's actual nonce
        };
        const signedSecondTx = await sender.wallet.signTransaction(secondTx);

        // Submit both transactions immediately to test lock release
        const invalidTxPromise = relay.call('eth_sendRawTransaction', [signedInvalidTx]).catch((error: any) => error);
        const secondTxPromise = relay.sendRawTransaction(signedSecondTx).catch((error: any) => error);

        // Wait for both to complete
        const [invalidResult, wrongNonceError] = await Promise.all([invalidTxPromise, secondTxPromise]);
        // Verify first tx failed with validation error
        expect(invalidResult).to.be.instanceOf(Error);
        expect(invalidResult.message).to.include('gas price');
        // Verify lock was released (second tx was allowed to proceed)
        expect(wrongNonceError).to.be.instanceOf(Error);
        expect(wrongNonceError.message).to.include('nonce');
        // Wait for second tx to be processed
        await new Promise((r) => setTimeout(r, 2100));

        // Verify account nonce hasn't changed (neither tx succeeded)
        const finalNonce = await relay.getAccountNonce(sender.address);
        expect(finalNonce).to.equal(startNonce);
      });
    });
    withOverriddenEnvsInMochaTest(
      {
        TXPOOL_API_ENABLED: true,
        ENABLE_TX_POOL: true,
      },
      () => {
        it('should queue multiple transactions and keep more than one pending in the tx pool at the same time', async function () {
          const waitForPendingNoncesCount = async (minCount: number) => {
            const started = Date.now();
            while (Date.now() - started < 30_000) {
              const content = await relay.call('txpool_content', []);
              const pendingForSender = content?.pending?.[sender.address];
              const pendingNonces = pendingForSender ? Object.keys(pendingForSender) : [];
              if (pendingNonces.length >= minCount) return pendingNonces.map(Number);
              await new Promise((r) => setTimeout(r, 100));
            }
            return [];
          };

          const sender = accounts[0];
          const startNonce = await relay.getAccountNonce(sender.address);
          const gasPrice = await relay.gasPrice();
          const minPending = 3;
          const transactionPromises = sendTransactionWithoutWaiting(sender, startNonce, 50, gasPrice);
          const pendingNonces = await waitForPendingNoncesCount(minPending);
          await Promise.allSettled(transactionPromises);

          expect(pendingNonces.length).to.be.gte(
            minPending,
            `At no point there were at least ${minPending} pending nonces assinged to ${sender.address} in the tx pool.`,
          );

          expect(Math.min(...pendingNonces)).to.be.at.least(startNonce);
        });
      },
    );
  });
});
