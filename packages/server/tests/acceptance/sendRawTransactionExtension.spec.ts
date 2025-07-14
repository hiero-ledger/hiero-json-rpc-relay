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
  const requestId = 'sendRawTransactionPrecheck';
  const requestDetails = new RequestDetails({ requestId: 'sendRawTransactionPrecheck', ipAddress: '0.0.0.0' });
  const sendRawTransaction = relay.sendRawTransaction;

  //   describe('@sendRawTransactionPrecheck Acceptance Tests', function () {
  this.timeout(240 * 1000); // 240 seconds
  const defaultGasLimit = numberTo0x(3_000_000);

  this.beforeAll(async () => {
    const initialAccount: AliasAccount = global.accounts[0];
    const neededAccounts: number = 2;
    accounts.push(
      ...(await Utils.createMultipleAliasAccounts(
        mirrorNode,
        initialAccount,
        neededAccounts,
        initialBalance,
        requestDetails,
      )),
    );
    global.accounts.push(...accounts);
  });

  describe('Prechecks', function () {
    describe('transactionSize', function () {
      it('@release should execute "eth_sendRawTransaction" with regular transaction size within the SEND_RAW_TRANSACTION_SIZE_LIMIT - 130kb limit', async function () {
        const gasPrice = await relay.gasPrice(requestId);
        const transaction = {
          type: 2,
          chainId: Number(CHAIN_ID),
          nonce: await relay.getAccountNonce(accounts[1].address, requestId),
          maxPriorityFeePerGas: gasPrice,
          maxFeePerGas: gasPrice,
          gasLimit: defaultGasLimit,
          to: accounts[0].address,
        };

        const signedTx = await accounts[1].wallet.signTransaction(transaction);
        expect(signedTx.length).to.be.lt(Constants.SEND_RAW_TRANSACTION_SIZE_LIMIT);

        const transactionHash = await relay.sendRawTransaction(signedTx, requestId);
        await relay.pollForValidTransactionReceipt(transactionHash);

        const info = await mirrorNode.get(`/contracts/results/${transactionHash}`, requestId);
        expect(info).to.exist;
        expect(info.result).to.equal('SUCCESS');
      });

      it('@release should fail "eth_sendRawTransaction" when transaction size exceeds the SEND_RAW_TRANSACTION_SIZE_LIMIT - 130kb limit', async function () {
        const gasPrice = await relay.gasPrice(requestId);
        const transaction = {
          type: 2,
          chainId: Number(CHAIN_ID),
          nonce: await relay.getAccountNonce(accounts[1].address, requestId),
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

    describe('callDataSize', function () {
      it('@release should execute "eth_sendRawTransaction" with regular transaction size within the CALL_DATA_SIZE_LIMIT - 128kb limit', async function () {
        const gasPrice = await relay.gasPrice(requestId);
        const transaction = {
          type: 2,
          chainId: Number(CHAIN_ID),
          nonce: await relay.getAccountNonce(accounts[1].address, requestId),
          maxPriorityFeePerGas: gasPrice,
          maxFeePerGas: gasPrice,
          gasLimit: defaultGasLimit,
          to: accounts[0].address,
        };

        const signedTx = await accounts[1].wallet.signTransaction(transaction);
        expect(signedTx.length).to.be.lt(Constants.CALL_DATA_SIZE_LIMIT);

        const transactionHash = await relay.sendRawTransaction(signedTx, requestId);
        await relay.pollForValidTransactionReceipt(transactionHash);

        const info = await mirrorNode.get(`/contracts/results/${transactionHash}`, requestId);
        expect(info).to.exist;
        expect(info.result).to.equal('SUCCESS');
      });

      it('@release should fail "eth_sendRawTransaction" when transaction size exceeds the CALL_DATA_SIZE_LIMIT - 128kb limit', async function () {
        const gasPrice = await relay.gasPrice(requestId);
        const transaction = {
          type: 2,
          chainId: Number(CHAIN_ID),
          nonce: await relay.getAccountNonce(accounts[1].address, requestId),
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
    it('@release should execute "eth_sendRawTransaction" with Jumbo Transaction', async function () {
      const isJumboTransaction = ConfigService.get('JUMBO_TX_ENABLED');
      // skip this test if JUMBO_TX_ENABLED is false
      if (!isJumboTransaction) {
        this.skip();
      }

      const gasPrice = await relay.gasPrice(requestId);
      const transaction = {
        type: 2,
        chainId: Number(CHAIN_ID),
        nonce: await relay.getAccountNonce(accounts[1].address, requestId),
        maxPriorityFeePerGas: gasPrice,
        maxFeePerGas: gasPrice,
        gasLimit: defaultGasLimit,
        to: accounts[0].address,
        data: '0x' + '00'.repeat(6144), // = 6kb just barely above the HFS threshold to trigger the jumbo transaction flow
      };

      const signedTx = await accounts[1].wallet.signTransaction(transaction);
      const transactionHash = await relay.sendRawTransaction(signedTx, requestId);
      await relay.pollForValidTransactionReceipt(transactionHash);

      const info = await mirrorNode.get(`/contracts/results/${transactionHash}`, requestId);
      expect(info).to.exist;
    });
  });

  describe('Read-Only mode', function () {
    it('@release should fail to execute "eth_sendRawTransaction" in Read-Only mode', async function () {
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
});
