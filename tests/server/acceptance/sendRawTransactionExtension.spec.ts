// SPDX-License-Identifier: Apache-2.0

import { expect } from 'chai';

import { ConfigService } from '../../../src/config-service/services';
import { numberTo0x } from '../../../src/relay/formatters';
import Constants from '../../../src/relay/lib/constants';
import { overrideEnvsInMochaDescribe, withOverriddenEnvsInMochaTest } from '../../relay/helpers';
import MirrorClient from '../clients/mirrorClient';
import RelayClient from '../clients/relayClient';
import Assertions from '../helpers/assertions';
import { Utils } from '../helpers/utils';
import { AliasAccount } from '../types/AliasAccount';

describe('@sendRawTransactionExtension Acceptance Tests', function () {
  overrideEnvsInMochaDescribe({ ENABLE_TX_POOL: false });

  this.timeout(240 * 1000);

  const accounts: AliasAccount[] = [];

  // @ts-ignore
  const {
    mirrorNode,
    relay,
    initialBalance,
  }: { mirrorNode: MirrorClient; relay: RelayClient; initialBalance: string } = global;

  const CHAIN_ID = ConfigService.get('CHAIN_ID');
  const ONE_TINYBAR = Utils.add0xPrefix(Utils.toHex(Constants.TINYBAR_TO_WEIBAR_COEF));
  const defaultGasLimit = numberTo0x(3_000_000);
  const defaultLondonTransactionData = {
    value: ONE_TINYBAR,
    chainId: Number(CHAIN_ID),
    maxPriorityFeePerGas: Assertions.defaultGasPrice,
    maxFeePerGas: Assertions.defaultGasPrice,
    gasLimit: defaultGasLimit,
    type: 2,
  };

  this.beforeAll(async () => {
    accounts.push(...(await Utils.createMultipleAliasAccounts(mirrorNode, global.accounts[0], 5, initialBalance)));
    global.accounts.push(...accounts);
  });

  describe('@nonce-ordering Lock Service Tests', function () {
    this.timeout(240 * 1000);
    overrideEnvsInMochaDescribe({ ENABLE_NONCE_ORDERING: true, USE_ASYNC_TX_PROCESSING: true });

    const sendTransactionWithoutWaiting = (signer: AliasAccount, nonce: number, numOfTxs: number, gasPrice: number) => {
      return Array.from({ length: numOfTxs }, async (_, i) => {
        const tx = {
          ...defaultLondonTransactionData,
          to: accounts[2].address,
          value: ONE_TINYBAR,
          nonce: nonce + i,
          maxPriorityFeePerGas: gasPrice,
          maxFeePerGas: gasPrice,
        };
        const signedTx = await signer.wallet.signTransaction(tx);
        return relay.sendRawTransaction(signedTx);
      });
    };

    it('should handle rapid burst of 10 transactions from same sender', async function () {
      const sender = accounts[1];
      const startNonce = await relay.getAccountNonce(sender.address);
      const gasPrice = await relay.gasPrice();

      const txHashes = await Promise.all(sendTransactionWithoutWaiting(sender, startNonce, 10, gasPrice));
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
      const txPromises = senders.flatMap((sender, i) =>
        sendTransactionWithoutWaiting(sender, startNonces[i], 1, gasPrice),
      );

      const txHashes = await Promise.all(txPromises);
      const submitTime = Date.now() - startTime;
      const receipts = await Promise.all(txHashes.map((hash) => relay.pollForValidTransactionReceipt(hash)));

      receipts.forEach((receipt) => {
        expect(receipt.status).to.equal('0x1');
      });

      const finalNonces = await Promise.all(senders.map((sender) => relay.getAccountNonce(sender.address)));
      finalNonces.forEach((nonce, i) => {
        expect(nonce).to.equal(startNonces[i] + 1);
      });

      expect(submitTime).to.be.lessThan(5000);
    });

    it('should handle mixed load: 5 txs each from 3 different senders', async function () {
      const senders = [accounts[0], accounts[1], accounts[3]];
      const startNonces = await Promise.all(senders.map((sender) => relay.getAccountNonce(sender.address)));
      const gasPrice = await relay.gasPrice();

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

      const tx1Hash = await sendTransactionWithoutWaiting(sender, startNonce, 1, gasPrice)[0];
      const tx2Hash = await sendTransactionWithoutWaiting(sender, startNonce + 1, 1, gasPrice)[0];

      expect(tx1Hash).to.exist;
      expect(tx2Hash).to.exist;

      const receipt1 = await relay.pollForValidTransactionReceipt(tx1Hash);
      const receipt2 = await relay.pollForValidTransactionReceipt(tx2Hash);

      expect(receipt1.status).to.equal('0x1');
      expect(receipt2.status).to.equal('0x1');

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

        const tx1Promise = sendTransactionWithoutWaiting(sender, startNonce, 1, gasPrice);
        const tx2Promise = sendTransactionWithoutWaiting(sender, startNonce + 1, 1, gasPrice);
        const [tx1Hash, tx2Hash] = await Promise.all([tx1Promise[0], tx2Promise[0]]);

        expect(tx1Hash).to.exist;
        expect(tx2Hash).to.exist;

        const receipts = await Promise.all([
          relay.pollForValidTransactionReceipt(tx1Hash),
          relay.pollForValidTransactionReceipt(tx2Hash),
        ]);

        expect(receipts[0].status).to.equal('0x1');
        expect(receipts[1].status).to.equal('0x1');
      });

      it('should release lock and allow next transaction after gas price validation error', async function () {
        const sender = accounts[0];
        const startNonce = await relay.getAccountNonce(sender.address);
        const tooLowGasPrice = '0x0';

        const invalidTx = {
          value: ONE_TINYBAR,
          chainId: Number(CHAIN_ID),
          maxPriorityFeePerGas: tooLowGasPrice,
          maxFeePerGas: tooLowGasPrice,
          gasLimit: defaultGasLimit,
          type: 2,
          to: accounts[2].address,
          nonce: startNonce,
        };
        const signedInvalidTx = await sender.wallet.signTransaction(invalidTx);

        const secondTx = {
          ...defaultLondonTransactionData,
          to: accounts[2].address,
          value: ONE_TINYBAR,
          nonce: startNonce + 1,
        };
        const signedSecondTx = await sender.wallet.signTransaction(secondTx);

        const invalidTxPromise = relay.call('eth_sendRawTransaction', [signedInvalidTx]).catch((error: any) => error);
        const secondTxPromise = relay.sendRawTransaction(signedSecondTx).catch((error: any) => error);

        const [invalidResult, wrongNonceError] = await Promise.all([invalidTxPromise, secondTxPromise]);
        expect(invalidResult).to.be.instanceOf(Error);
        expect(invalidResult.message).to.include('gas price');
        expect(wrongNonceError).to.be.instanceOf(Error);
        expect(wrongNonceError.message).to.include('nonce');

        await Utils.wait(2100);

        const finalNonce = await relay.getAccountNonce(sender.address);
        expect(finalNonce).to.equal(startNonce);
      });
    });
  });

  /**
   * We'll need to skip these tests for now, until the Authorization List is fully implemented in the Mirror Node:
   * https://github.com/hiero-ledger/hiero-mirror-node/issues/12379.
   */
  describe.skip('EIP-7702 (authorizationList)', function () {
    const DELEGATION_TARGET = '0x0000000000000000000000000000000000000167';

    it('should install delegation via type-4 tx and verify the created transaction has correct authorization list', async function () {
      const signer = accounts[1];
      const gasPrice = await relay.gasPrice();
      const currentNonce = await relay.getAccountNonce(signer.address);

      const authorizationList = [
        await signer.wallet.authorize({
          address: DELEGATION_TARGET,
          nonce: currentNonce + 1,
        }),
      ];

      const unsignedTx = {
        type: 4,
        chainId: Number(CHAIN_ID),
        nonce: currentNonce,
        maxPriorityFeePerGas: gasPrice,
        maxFeePerGas: gasPrice,
        gasLimit: defaultGasLimit,
        to: accounts[0].address,
        value: ONE_TINYBAR,
        authorizationList,
      };

      const signedTx = await signer.wallet.signTransaction(unsignedTx);
      const txHash = await relay.sendRawTransaction(signedTx);
      await relay.pollForValidTransactionReceipt(txHash);

      const tx = (await relay.call('eth_getTransactionByHash', [txHash])) as any;

      expect(tx).to.exist;
      expect(tx.type).to.equal('0x4');
      expect(tx.authorizationList).to.exist;
      expect(tx.authorizationList).to.be.an('array').that.is.not.empty;
      expect(tx.authorizationList).to.deep.equal(authorizationList);
    });
  });
});
