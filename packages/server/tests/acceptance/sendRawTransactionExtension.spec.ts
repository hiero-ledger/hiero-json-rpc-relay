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
    const neededAccounts: number = 3;
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

    describe('contractCodeSize', function () {
      it('@release should execute "eth_sendRawTransaction" and deploy a contract with code size within the CONTRACT_CODE_SIZE_LIMIT - 24kb limit', async function () {
        const gasPrice = await relay.gasPrice(requestId);

        // create a regular deployment transaction with contract code size within the CONTRACT_CODE_SIZE_LIMIT - 24kb limit
        const transaction = {
          type: 2,
          chainId: Number(CHAIN_ID),
          nonce: await relay.getAccountNonce(accounts[1].address, requestId),
          maxPriorityFeePerGas: gasPrice,
          maxFeePerGas: gasPrice,
          gasLimit: defaultGasLimit,
          data: '0x' + '00'.repeat(5120),
        };

        const signedTx = await accounts[1].wallet.signTransaction(transaction);
        const transactionHash = await relay.sendRawTransaction(signedTx, requestId);
        await relay.pollForValidTransactionReceipt(transactionHash);

        const info = await mirrorNode.get(`/contracts/results/${transactionHash}`, requestId);
        expect(info).to.have.property('contract_id');
        expect(info.contract_id).to.not.be.null;
        expect(info).to.have.property('created_contract_ids');
        expect(info.created_contract_ids.length).to.be.equal(1);
      });

      it('@release should fail "eth_sendRawTransaction" for contract with code size exceeding the CONTRACT_CODE_SIZE_LIMIT - 24kb limit', async function () {
        const gasPrice = await relay.gasPrice(requestId);
        // Create a deployment transaction with contract code size exceeding CONTRACT_CODE_SIZE_LIMIT
        const transaction = {
          type: 2,
          chainId: Number(CHAIN_ID),
          nonce: await relay.getAccountNonce(accounts[1].address, requestId),
          maxPriorityFeePerGas: gasPrice,
          maxFeePerGas: gasPrice,
          gasLimit: defaultGasLimit,
          data: '0x' + '00'.repeat(Constants.CONTRACT_CODE_SIZE_LIMIT + 1024), // exceeds the limit by 1KB
        };

        const signedTx = await accounts[1].wallet.signTransaction(transaction);
        const contractCodeSize = (transaction.data.length - 2) / 2;
        const error = predefined.CONTRACT_CODE_SIZE_LIMIT_EXCEEDED(
          contractCodeSize,
          Constants.CONTRACT_CODE_SIZE_LIMIT,
        );

        await Assertions.assertPredefinedRpcError(error, sendRawTransaction, false, relay, [signedTx, requestDetails]);
      });

      it('@release should pass precheck and execute "eth_sendRawTransaction" for a regular transaction i.e. non contract deployment transaction with data exceeding the CONTRACT_CODE_SIZE_LIMIT - 24kb limit', async function () {
        const gasPrice = await relay.gasPrice(requestId);
        // Create a transaction with large data but sent to an existing address (not contract creation)
        const transaction = {
          type: 2,
          chainId: Number(CHAIN_ID),
          nonce: await relay.getAccountNonce(accounts[1].address, requestId),
          maxPriorityFeePerGas: gasPrice,
          maxFeePerGas: gasPrice,
          gasLimit: defaultGasLimit,
          to: accounts[0].address, // Sending to existing address, so code size check doesn't apply
          data: '0x' + '00'.repeat(Constants.CONTRACT_CODE_SIZE_LIMIT + 1024), // exceeds the limit by 1KB
        };

        const signedTx = await accounts[1].wallet.signTransaction(transaction);
        const transactionHash = await relay.sendRawTransaction(signedTx, requestId);
        const info = await mirrorNode.get(`/contracts/results/${transactionHash}`, requestId);
        expect(info).to.exist;
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

  describe('Paymaster', function () {
    // Common test variables
    const zeroGasPrice = '0x0';
    const GAS_PRICE_REF = '0x123456';
    const MAX_ALLOWANCE = 10000000000; // 100 hbars

    // Helper function to setup paymaster configuration
    const configurePaymaster = (enabled: boolean, whitelist: string[], allowance: number) => {
      ConfigServiceTestHelper.dynamicOverride('PAYMASTER_ENABLED', enabled);
      ConfigServiceTestHelper.dynamicOverride('PAYMASTER_WHITELIST', whitelist);
      ConfigServiceTestHelper.dynamicOverride('PAYMASTER_MAX_ALLOWANCE', allowance);
    };

    // Helper function to create and sign a transaction
    const createAndSignTransaction = async (senderAccount: AliasAccount, recipientAddress?: string) => {
      const transaction = {
        type: 2,
        chainId: Number(CHAIN_ID),
        nonce: await relay.getAccountNonce(senderAccount.address, requestId),
        maxPriorityFeePerGas: zeroGasPrice,
        maxFeePerGas: zeroGasPrice,
        gasLimit: defaultGasLimit,
        to: recipientAddress, // If undefined, creates a contract deployment transaction
        data: recipientAddress ? undefined : '0x' + '00'.repeat(6144),
      };

      return senderAccount.wallet.signTransaction(transaction);
    };

    // Helper function to verify successful transaction execution without balance change
    const verifySuccessfulTransaction = async (txHash: string, signerAddress: string, initialBalance: bigint) => {
      await relay.pollForValidTransactionReceipt(txHash);

      const info = await mirrorNode.get(`/contracts/results/${txHash}`, requestId);
      expect(info).to.exist;
      expect(info.result).to.equal('SUCCESS');

      const finalBalance = await relay.getBalance(signerAddress, 'latest', requestId);
      expect(initialBalance).to.be.equal(finalBalance);
    };

    it('should process zero-fee contract deployment transactions when Paymaster is enabled globally', async function () {
      // Configure paymaster for all addresses
      configurePaymaster(true, ['*'], MAX_ALLOWANCE);

      // Record initial balance
      const initialBalance = await relay.getBalance(accounts[2].address, 'latest', requestId);

      // Create and execute transaction
      const signedTx = await createAndSignTransaction(accounts[2]);
      const txHash = await relay.sendRawTransaction(signedTx, requestId);

      await verifySuccessfulTransaction(txHash, accounts[2].address, initialBalance);
    });

    it('should process zero-fee transactions to existing accounts when Paymaster is enabled globally', async function () {
      configurePaymaster(true, ['*'], MAX_ALLOWANCE);

      const initialBalance = await relay.getBalance(accounts[2].address, 'latest', requestId);

      const signedTx = await createAndSignTransaction(accounts[2], accounts[0].address);
      const txHash = await relay.sendRawTransaction(signedTx, requestId);

      await verifySuccessfulTransaction(txHash, accounts[2].address, initialBalance);
    });

    it('should process zero-fee transactions when target address is specifically whitelisted', async function () {
      // Configure paymaster for specific address
      configurePaymaster(true, [accounts[0].address], MAX_ALLOWANCE);

      const initialBalance = await relay.getBalance(accounts[2].address, 'latest', requestId);

      const signedTx = await createAndSignTransaction(accounts[2], accounts[0].address);
      const txHash = await relay.sendRawTransaction(signedTx, requestId);

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
      configurePaymaster(true, ['*'], 0); // Set allowance to zero

      const signedTx = await createAndSignTransaction(accounts[2], accounts[0].address);
      const txHash = await relay.sendRawTransaction(signedTx, requestId);
      await relay.pollForValidTransactionReceipt(txHash);

      const info = await mirrorNode.get(`/contracts/results/${txHash}`, requestId);
      expect(info).to.exist;
      expect(info.result).to.equal('INSUFFICIENT_TX_FEE');
    });
  });
});
