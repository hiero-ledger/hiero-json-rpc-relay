// SPDX-License-Identifier: Apache-2.0

import { AccountCreateTransaction, FileInfo, FileInfoQuery, PrivateKey } from '@hashgraph/sdk';
import { expect } from 'chai';
import { ethers } from 'ethers';

import { ConfigService } from '../../src/config-service/services';
import { predefined } from '../../src/relay';
import { numberTo0x, prepend0x } from '../../src/relay/formatters';
import Constants from '../../src/relay/lib/constants';
import { ConfigServiceTestHelper } from '../config-service/configServiceTestHelper';
import { ONE_TINYBAR_IN_WEI_HEX } from '../relay/lib/eth/eth-config';
import MirrorClient from '../server/clients/mirrorClient';
import RelayClient from '../server/clients/relayClient';
import ServicesClient from '../server/clients/servicesClient';
import basicContract from '../server/contracts/Basic.json';
import parentContractJson from '../server/contracts/Parent.json';
import Assertions, { computeExpectedCumulativeGasUsed } from '../server/helpers/assertions';
import { Utils } from '../server/helpers/utils';
import { AliasAccount } from '../server/types/AliasAccount';
import { ALL_PROTOCOL_CLIENTS, RpcRawResponse } from './helpers/protocolClient';

describe('@release @protocol-acceptance eth_sendRawTransaction', async function () {
  this.timeout(240 * 1000);

  const METHOD_NAME = 'eth_sendRawTransaction';
  const CHAIN_ID = ConfigService.get('CHAIN_ID');
  const INCORRECT_CHAIN_ID = 999;
  const GAS_PRICE_TOO_LOW = '0x1';
  const GAS_PRICE_REF = '0x123456';
  const FAKE_TX_HASH = `0x${'00'.repeat(20)}`;
  const INVALID_PARAMS: any[][] = [
    [],
    [''],
    [66],
    [39],
    [true],
    [false],
    ['abc'],
    ['0xhbar'],
    ['0xHedera'],
    [FAKE_TX_HASH, 'hbar'],
    [FAKE_TX_HASH, 'rpc', 'invalid'],
  ];

  // @ts-ignore
  const {
    servicesNode,
    mirrorNode,
    relay,
  }: { servicesNode: ServicesClient; mirrorNode: MirrorClient; relay: RelayClient } = global;

  const accounts: AliasAccount[] = [];
  const initialBalance = '5000000000'; // 50 hbar
  const ONE_TINYBAR = Utils.add0xPrefix(Utils.toHex(Constants.TINYBAR_TO_WEIBAR_COEF));
  const defaultGasPrice = numberTo0x(Assertions.defaultGasPrice);
  const defaultGasLimit = numberTo0x(3_000_000);
  const defaultLegacyTransactionData = {
    value: ONE_TINYBAR,
    gasPrice: defaultGasPrice,
    gasLimit: defaultGasLimit,
  };
  const default155TransactionData = {
    ...defaultLegacyTransactionData,
    chainId: Number(CHAIN_ID),
  };
  const defaultLondonTransactionData = {
    value: ONE_TINYBAR,
    chainId: Number(CHAIN_ID),
    maxPriorityFeePerGas: defaultGasPrice,
    maxFeePerGas: defaultGasPrice,
    gasLimit: defaultGasLimit,
    type: 2,
  };
  const defaultLegacy2930TransactionData = {
    value: ONE_TINYBAR,
    chainId: Number(CHAIN_ID),
    gasPrice: defaultGasPrice,
    gasLimit: defaultGasLimit,
    type: 1,
  };
  // https://github.com/hiero-ledger/hiero-consensus-node/blob/main/hedera-node/docs/system-accounts-operations.md
  const hederaReservedAccounts: { address: string; description: string; expectedError: string | null }[] = [
    {
      address: '0x0000000000000000000000000000000000000002',
      description: '0.0.2 treasury',
      expectedError: 'INVALID_CONTRACT_ID',
    },
    {
      address: '0x0000000000000000000000000000000000000003',
      description: '0.0.3',
      expectedError: 'INVALID_CONTRACT_ID',
    },
    {
      address: '0x0000000000000000000000000000000000000032',
      description: '0.0.50 system admin',
      expectedError: 'INVALID_CONTRACT_ID',
    },
    {
      address: '0x0000000000000000000000000000000000000037',
      description: '0.0.55 address book admin',
      expectedError: 'INVALID_CONTRACT_ID',
    },
    {
      address: '0x0000000000000000000000000000000000000039',
      description: '0.0.57 exchange rates admin',
      expectedError: 'INVALID_CONTRACT_ID',
    },
    {
      address: '0x000000000000000000000000000000000000003a',
      description: '0.0.58 freeze admin',
      expectedError: 'INVALID_CONTRACT_ID',
    },
    {
      address: '0x000000000000000000000000000000000000003b',
      description: '0.0.59 system delete admin',
      expectedError: 'INVALID_CONTRACT_ID',
    },
    {
      address: '0x000000000000000000000000000000000000003c',
      description: '0.0.60 system undelete admin',
      expectedError: 'INVALID_CONTRACT_ID',
    },
    {
      address: '0x0000000000000000000000000000000000000167',
      description: '0.0.359 HTS',
      expectedError: 'INVALID_CONTRACT_ID',
    },
    {
      address: '0x0000000000000000000000000000000000000168',
      description: '0.0.360 Exchange Rate',
      expectedError: 'INVALID_CONTRACT_ID',
    },
    {
      address: '0x0000000000000000000000000000000000000169',
      description: '0.0.361 PRNG',
      expectedError: 'INVALID_CONTRACT_ID',
    },
    {
      address: '0x000000000000000000000000000000000000016a',
      description: '0.0.362 HAS',
      expectedError: 'INVALID_CONTRACT_ID',
    },
    {
      address: '0x000000000000000000000000000000000000016b',
      description: '0.0.363 HSS',
      expectedError: 'INVALID_CONTRACT_ID',
    },
    {
      address: '0x00000000000000000000000000000000000001C2',
      description: '0.0.450',
      expectedError: 'INVALID_CONTRACT_ID',
    },
    {
      address: '0x00000000000000000000000000000000000001FE',
      description: '0.0.510',
      expectedError: 'INVALID_CONTRACT_ID',
    },
    {
      address: '0x00000000000000000000000000000000000002EE',
      description: '0.0.750',
      expectedError: 'INVALID_CONTRACT_ID',
    },
    {
      address: '0x00000000000000000000000000000000000002f1',
      description: '0.0.753 (non-existent)',
      expectedError: 'INVALID_ALIAS_KEY',
    },
    {
      address: '0x000000000000000000000000000000000000032A',
      description: '0.0.810 (non-existent)',
      expectedError: 'INVALID_ALIAS_KEY',
    },
    {
      address: '0x0000000000000000000000000000000000000320',
      description: '0.0.800 staking reward account',
      expectedError: null,
    },
    {
      address: '0x0000000000000000000000000000000000000321',
      description: '0.0.801 node reward account',
      expectedError: null,
    },
    { address: '0x00000000000000000000000000000000000003A2', description: '0.0.930 (existent)', expectedError: null },
    { address: '0x00000000000000000000000000000000000003C0', description: '0.0.960 (existent)', expectedError: null },
    { address: '0x00000000000000000000000000000000000003E7', description: '0.0.999 (existent)', expectedError: null },
    {
      address: '0x0000000000000000000000000000000000000001',
      description: '0x1 EC-recover',
      expectedError: 'INVALID_CONTRACT_ID',
    },
    {
      address: '0x0000000000000000000000000000000000000004',
      description: '0x4 identity',
      expectedError: 'INVALID_CONTRACT_ID',
    },
    {
      address: '0x0000000000000000000000000000000000000005',
      description: '0x5 modexp',
      expectedError: 'INVALID_CONTRACT_ID',
    },
    {
      address: '0x0000000000000000000000000000000000000006',
      description: '0x6 ecadd',
      expectedError: 'INVALID_CONTRACT_ID',
    },
    {
      address: '0x0000000000000000000000000000000000000007',
      description: '0x7 ecmul',
      expectedError: 'INVALID_CONTRACT_ID',
    },
    {
      address: '0x0000000000000000000000000000000000000008',
      description: '0x8 ecpairing',
      expectedError: 'INVALID_CONTRACT_ID',
    },
    {
      address: '0x0000000000000000000000000000000000000009',
      description: '0x9 blake2f',
      expectedError: 'INVALID_CONTRACT_ID',
    },
    {
      address: '0x000000000000000000000000000000000000000a',
      description: '0xa point evaluation',
      expectedError: 'INVALID_CONTRACT_ID',
    },
  ];

  let parentContractAddress: string;
  const arbitraryCalldataAccounts: AliasAccount[] = [];

  async function expectRpcError(
    client: (typeof ALL_PROTOCOL_CLIENTS)[number],
    signedTx: string,
    expectedError: { code: number; message: string },
    checkMessage = true,
  ) {
    const response = await client.callRaw(METHOD_NAME, [signedTx]);
    expectJsonRpcEnvelope(response);
    expect(response.error).to.exist;
    expect(response.error!.code).to.eq(expectedError.code);
    if (checkMessage) {
      expect(response.error!.message).to.contain(expectedError.message);
    }
  }

  function expectJsonRpcEnvelope(response: RpcRawResponse) {
    expect(response.id).to.eq(1);
    expect(response.jsonrpc).to.eq('2.0');
    expect(response.method).to.not.exist;
  }

  before(async () => {
    accounts.push(...(await Utils.createMultipleAliasAccounts(mirrorNode, global.accounts[0], 5, initialBalance)));
    arbitraryCalldataAccounts.push(
      ...(await Utils.createMultipleAliasAccounts(
        mirrorNode,
        global.accounts[0],
        ALL_PROTOCOL_CLIENTS.length,
        '30000000000',
      )),
    );
    global.accounts.push(...accounts);
    global.accounts.push(...arbitraryCalldataAccounts);

    const parentContract = await Utils.deployContract(
      parentContractJson.abi,
      parentContractJson.bytecode,
      accounts[0].wallet,
    );
    parentContractAddress = parentContract.target as string;
  });

  after(async () => {
    if (global?.socketServer) {
      expect(global.socketServer._connections).to.eq(0);
    }
  });

  for (const client of ALL_PROTOCOL_CLIENTS) {
    describe(client.label, () => {
      for (const params of INVALID_PARAMS) {
        it(`Should fail eth_sendRawTransaction and throw INVALID_PARAMETERS if params are invalid. params=[${params}]`, async () => {
          const response = await client.callRaw(METHOD_NAME, params);
          expectJsonRpcEnvelope(response);
          expect(response.error).to.exist;
          expect(response.error!.code).to.be.oneOf([-32000, -32602, -32603]);
        });
      }

      it('Should execute eth_sendRawTransaction requests with undefined params and receive MISSING_REQUIRED_PARAMETER error', async () => {
        const response = await client.callRaw(METHOD_NAME, undefined);
        const expectedError = predefined.MISSING_REQUIRED_PARAMETER(0);

        expectJsonRpcEnvelope(response);
        expect(response.error).to.exist;
        expect(response.error!.code).to.eq(expectedError.code);
        expect(response.error!.message).to.contain(expectedError.message);
      });

      it('@release Should execute eth_sendRawTransaction and handle valid requests correctly', async () => {
        const transaction = {
          value: ONE_TINYBAR_IN_WEI_HEX,
          gasLimit: numberTo0x(30000),
          chainId: Number(CHAIN_ID),
          to: accounts[2].address,
          maxFeePerGas: await relay.gasPrice(),
          nonce: await relay.getAccountNonce(accounts[0].address),
        };
        const signedTx = await accounts[0].wallet.signTransaction(transaction);

        const txHash = (await client.call(METHOD_NAME, [signedTx])) as string;
        const txReceipt = await mirrorNode.get(`/contracts/results/${txHash}`);
        const fromAccountInfo = await mirrorNode.get(`/accounts/${txReceipt.from}`);

        expect(txReceipt.to).to.eq(accounts[2].address.toLowerCase());
        expect(fromAccountInfo.evm_address).to.eq(accounts[0].address.toLowerCase());
      });

      it('should fail "eth_sendRawTransaction" when transaction has invalid format', async () => {
        const response = await client.callRaw(METHOD_NAME, [Constants.INVALID_TRANSACTION]);

        expect(response.error).to.exist;
        expect(response.error!.code).to.eq(-32000);
        expect(response.error!.message).to.contain('unexpected junk after rlp payload');
      });

      it('@xts should execute "eth_sendRawTransaction" for deterministic deployment transaction', async () => {
        const sendHbarToProxyContractDeployerTx = {
          value: (10 * 10 ** 18).toString(), // 10 hbar - the gasPrice to deploy deterministic proxy contract
          to: Constants.DETERMINISTIC_DEPLOYMENT_SIGNER,
          gasPrice: await relay.gasPrice(),
          gasLimit: Constants.MIN_TX_HOLLOW_ACCOUNT_CREATION_GAS,
          nonce: await relay.getAccountNonce(accounts[0].address),
        };
        const signedSendHbarTx = await accounts[0].wallet.signTransaction(sendHbarToProxyContractDeployerTx);
        const fundingTxHash = (await client.call(METHOD_NAME, [signedSendHbarTx])) as string;
        await relay.pollForValidTransactionReceipt(fundingTxHash);

        const deployerBalance = await relay.getBalance(Constants.DETERMINISTIC_DEPLOYMENT_SIGNER, 'latest');
        expect(deployerBalance).to.not.eq(0);

        const signerNonce = await relay.getAccountNonce(Constants.DETERMINISTIC_DEPLOYMENT_SIGNER);
        if (signerNonce === 0) {
          const deterministicDeploymentTransactionHash = (await client.call(METHOD_NAME, [
            Constants.DETERMINISTIC_DEPLOYER_TRANSACTION,
          ])) as string;

          const receipt = await mirrorNode.get(`/contracts/results/${deterministicDeploymentTransactionHash}`);
          const fromAccountInfo = await mirrorNode.get(`/accounts/${receipt.from}`);
          const toAccountInfo = await mirrorNode.get(`/accounts/${receipt.to}`);

          expect(receipt).to.exist;
          expect(fromAccountInfo.evm_address).to.eq(Constants.DETERMINISTIC_DEPLOYMENT_SIGNER);
          expect(toAccountInfo.evm_address).to.eq(Constants.DETERMINISTIC_PROXY_CONTRACT);
          expect(receipt.address).to.eq(Constants.DETERMINISTIC_PROXY_CONTRACT);
        } else {
          const response = await client.callRaw(METHOD_NAME, [Constants.DETERMINISTIC_DEPLOYER_TRANSACTION]);
          const expectedNonceTooLowError = predefined.NONCE_TOO_LOW(0, signerNonce);

          expect(response.error).to.exist;
          expect(response.error!.code).to.eq(expectedNonceTooLowError.code);
          expect(response.error!.message).to.contain(expectedNonceTooLowError.message);
        }
      });

      it('should fail "eth_sendRawTransaction" for transaction with incorrect chain_id', async function () {
        const transaction = {
          ...default155TransactionData,
          to: parentContractAddress,
          nonce: await relay.getAccountNonce(accounts[2].address),
          chainId: INCORRECT_CHAIN_ID,
        };
        const signedTx = await accounts[2].wallet.signTransaction(transaction);
        const error = predefined.UNSUPPORTED_CHAIN_ID(ethers.toQuantity(INCORRECT_CHAIN_ID), CHAIN_ID);

        await expectRpcError(client, signedTx, error);
      });

      it('@xts should fail "eth_sendRawTransaction" for HBAR crypto transfer to zero addresses', async function () {
        const sendHbarTx = {
          ...defaultLegacyTransactionData,
          value: ONE_TINYBAR,
          to: ethers.ZeroAddress,
          nonce: await relay.getAccountNonce(accounts[1].address),
          gasPrice: await relay.gasPrice(),
        };
        const signedSendHbarTx = await accounts[1].wallet.signTransaction(sendHbarTx);

        const response = await client.callRaw(METHOD_NAME, [signedSendHbarTx]);
        expect(response.error).to.exist;
        expect(response.error!.code).to.eq(-32003);
        expect(response.error!.message).to.contain('INVALID_SOLIDITY_ADDRESS');
      });

      hederaReservedAccounts.forEach(({ address, description, expectedError }, index) => {
        const testDescription = expectedError
          ? `@xts should reject HBAR transfer to ${description} (${address}) with ${expectedError}`
          : `@xts should successfully execute HBAR transfer to ${description} (${address})`;

        it(testDescription, async function () {
          const accountIndex = index % accounts.length;
          const sendHbarTx = {
            ...defaultLegacyTransactionData,
            value: ONE_TINYBAR,
            to: address,
            nonce: await relay.getAccountNonce(accounts[accountIndex].address),
            gasPrice: await relay.gasPrice(),
          };

          const signedSendHbarTx = await accounts[accountIndex].wallet.signTransaction(sendHbarTx);
          const txHash = (await client.call(METHOD_NAME, [signedSendHbarTx])) as string;
          const txReceipt = await relay.pollForValidTransactionReceipt(txHash);

          if (expectedError) {
            expect(txReceipt.revertReason).to.not.be.empty;
            expect(Buffer.from(txReceipt.revertReason!.slice(2), 'hex').toString('utf8')).to.equal(expectedError);
          } else {
            expect(txReceipt.status).to.equal('0x1');
            expect(txReceipt.revertReason).to.be.undefined;
          }
        });
      });

      it('@release-light @release @xts should execute "eth_sendRawTransaction" for legacy EIP 155 transactions', async function () {
        const receiverInitialBalance = await relay.getBalance(parentContractAddress, 'latest');
        const gasPriceWithDeviation = (await relay.gasPrice()) * (1 + ConfigService.get('TEST_GAS_PRICE_DEVIATION'));
        const transaction = {
          ...default155TransactionData,
          to: parentContractAddress,
          nonce: await relay.getAccountNonce(accounts[2].address),
          gasPrice: gasPriceWithDeviation,
        };
        const signedTx = await accounts[2].wallet.signTransaction(transaction);
        const transactionHash = (await client.call(METHOD_NAME, [signedTx])) as string;
        await relay.pollForValidTransactionReceipt(transactionHash);
        await mirrorNode.get(`/contracts/results/${transactionHash}`);

        const receiverEndBalance = await relay.getBalance(parentContractAddress, 'latest');
        const balanceChange = receiverEndBalance - receiverInitialBalance;
        expect(balanceChange.toString()).to.eq(Number(ONE_TINYBAR).toString());
      });

      it('should fail "eth_sendRawTransaction" for legacy EIP 155 transactions (with insufficient balance)', async function () {
        const balanceInWeiBars = await relay.getBalance(accounts[2].address, 'latest');
        const transaction = {
          ...default155TransactionData,
          to: parentContractAddress,
          value: balanceInWeiBars,
          nonce: await relay.getAccountNonce(accounts[2].address),
          gasPrice: await relay.gasPrice(),
        };
        const signedTx = await accounts[2].wallet.signTransaction(transaction);

        await expectRpcError(client, signedTx, predefined.INSUFFICIENT_ACCOUNT_BALANCE);
      });

      it('@xts should execute "eth_sendRawTransaction" for legacy transactions (with no chainId i.e. chainId=0x0)', async function () {
        const receiverInitialBalance = await relay.getBalance(parentContractAddress, 'latest');
        const transaction = {
          ...defaultLegacyTransactionData,
          to: parentContractAddress,
          nonce: await relay.getAccountNonce(accounts[2].address),
          gasPrice: await relay.gasPrice(),
        };
        const signedTx = await accounts[2].wallet.signTransaction(transaction);
        const transactionHash = (await client.call(METHOD_NAME, [signedTx])) as string;
        await relay.pollForValidTransactionReceipt(transactionHash);
        await mirrorNode.get(`/contracts/results/${transactionHash}`);

        const receiverEndBalance = await relay.getBalance(parentContractAddress, 'latest');
        const balanceChange = receiverEndBalance - receiverInitialBalance;
        expect(balanceChange.toString()).to.eq(Number(ONE_TINYBAR).toString());
      });

      it('@xts should execute "eth_sendRawTransaction" with no chainId field for legacy EIP155 transactions  (with no chainId i.e. chainId=0x0)', async function () {
        const transaction = {
          ...defaultLegacyTransactionData,
          to: parentContractAddress,
          nonce: await relay.getAccountNonce(accounts[1].address),
          gasPrice: await relay.gasPrice(),
        };
        const signedTx = await accounts[1].wallet.signTransaction(transaction);
        const transactionHash = (await client.call(METHOD_NAME, [signedTx])) as string;
        const transactionResult = await relay.pollForValidTransactionReceipt(transactionHash);

        const result = Object.prototype.hasOwnProperty.call(transactionResult, 'chainId');
        expect(result).to.be.false;
      });

      it('should fail "eth_sendRawTransaction" for Legacy transactions (with gas price too low)', async function () {
        const transaction = {
          ...defaultLegacyTransactionData,
          chainId: Number(CHAIN_ID),
          gasPrice: GAS_PRICE_TOO_LOW,
          to: parentContractAddress,
          nonce: await relay.getAccountNonce(accounts[2].address),
        };
        const signedTx = await accounts[2].wallet.signTransaction(transaction);
        const error = predefined.GAS_PRICE_TOO_LOW(GAS_PRICE_TOO_LOW, GAS_PRICE_REF);

        await expectRpcError(client, signedTx, error, false);
      });

      it('should not fail "eth_sendRawTransactxion" for Legacy 2930 transactions', async function () {
        const transaction = {
          ...defaultLegacy2930TransactionData,
          to: parentContractAddress,
          nonce: await relay.getAccountNonce(accounts[2].address),
          gasPrice: await relay.gasPrice(),
        };
        const signedTx = await accounts[2].wallet.signTransaction(transaction);
        const transactionHash = (await client.call(METHOD_NAME, [signedTx])) as string;
        const info = await mirrorNode.get(`/contracts/results/${transactionHash}`);
        expect(info).to.exist;
        expect(info.result).to.equal('SUCCESS');
      });

      it('should fail "eth_sendRawTransaction" for Legacy 2930 transactions (with gas price too low)', async function () {
        const transaction = {
          ...defaultLegacy2930TransactionData,
          gasPrice: GAS_PRICE_TOO_LOW,
          to: parentContractAddress,
          nonce: await relay.getAccountNonce(accounts[2].address),
        };
        const signedTx = await accounts[2].wallet.signTransaction(transaction);
        const error = predefined.GAS_PRICE_TOO_LOW(GAS_PRICE_TOO_LOW, GAS_PRICE_REF);

        await expectRpcError(client, signedTx, error, false);
      });

      it('should fail "eth_sendRawTransaction" for Legacy 2930 transactions (with insufficient balance)', async function () {
        const balanceInWeiBars = await relay.getBalance(accounts[2].address, 'latest');
        const transaction = {
          ...defaultLegacy2930TransactionData,
          value: balanceInWeiBars,
          to: parentContractAddress,
          nonce: await relay.getAccountNonce(accounts[2].address),
          gasPrice: await relay.gasPrice(),
        };
        const signedTx = await accounts[2].wallet.signTransaction(transaction);

        await expectRpcError(client, signedTx, predefined.INSUFFICIENT_ACCOUNT_BALANCE);
      });

      it('should fail "eth_sendRawTransaction" for London transactions (with gas price too low)', async function () {
        const transaction = {
          ...defaultLondonTransactionData,
          maxPriorityFeePerGas: GAS_PRICE_TOO_LOW,
          maxFeePerGas: GAS_PRICE_TOO_LOW,
          to: parentContractAddress,
          nonce: await relay.getAccountNonce(accounts[2].address),
        };
        const signedTx = await accounts[2].wallet.signTransaction(transaction);
        const error = predefined.GAS_PRICE_TOO_LOW(GAS_PRICE_TOO_LOW, GAS_PRICE_REF);

        await expectRpcError(client, signedTx, error, false);
      });

      it('should fail "eth_sendRawTransaction" for London transactions (with insufficient balance)', async function () {
        const balanceInWeiBars = await relay.getBalance(accounts[2].address, 'latest');
        const gasPrice = await relay.gasPrice();
        const transaction = {
          ...defaultLondonTransactionData,
          value: balanceInWeiBars,
          to: parentContractAddress,
          nonce: await relay.getAccountNonce(accounts[2].address),
          maxPriorityFeePerGas: gasPrice,
          maxFeePerGas: gasPrice,
        };
        const signedTx = await accounts[2].wallet.signTransaction(transaction);

        await expectRpcError(client, signedTx, predefined.INSUFFICIENT_ACCOUNT_BALANCE);
      });

      it('@xts should execute "eth_sendRawTransaction" for London transactions', async function () {
        const receiverInitialBalance = await relay.getBalance(parentContractAddress, 'latest');
        const gasPrice = await relay.gasPrice();
        const transaction = {
          ...defaultLondonTransactionData,
          to: parentContractAddress,
          nonce: await relay.getAccountNonce(accounts[2].address),
          maxPriorityFeePerGas: gasPrice,
          maxFeePerGas: gasPrice,
        };
        const signedTx = await accounts[2].wallet.signTransaction(transaction);
        const transactionHash = (await client.call(METHOD_NAME, [signedTx])) as string;
        await relay.pollForValidTransactionReceipt(transactionHash);
        await mirrorNode.get(`/contracts/results/${transactionHash}`);
        const receiverEndBalance = await relay.getBalance(parentContractAddress, 'latest');
        const balanceChange = receiverEndBalance - receiverInitialBalance;
        expect(balanceChange.toString()).to.eq(Number(ONE_TINYBAR).toString());
      });

      it('@xts should execute "eth_sendRawTransaction" and deploy a large contract', async function () {
        const gasPrice = await relay.gasPrice();
        const transaction = {
          type: 2,
          chainId: Number(CHAIN_ID),
          nonce: await relay.getAccountNonce(accounts[2].address),
          maxPriorityFeePerGas: gasPrice,
          maxFeePerGas: gasPrice,
          gasLimit: defaultGasLimit,
          data: '0x' + '00'.repeat(5121),
        };
        const signedTx = await accounts[2].wallet.signTransaction(transaction);
        const transactionHash = (await client.call(METHOD_NAME, [signedTx])) as string;
        await relay.pollForValidTransactionReceipt(transactionHash);
        const info = await mirrorNode.get(`/contracts/results/${transactionHash}`);
        expect(info).to.have.property('contract_id');
        expect(info.contract_id).to.not.be.null;
        expect(info).to.have.property('created_contract_ids');
        expect(info.created_contract_ids.length).to.be.equal(1);
      });

      it('@xts should execute "eth_sendRawTransaction" and deploy a real contract which can be accessible', async function () {
        const deploymentTransaction = {
          ...defaultLondonTransactionData,
          value: 0,
          data: basicContract.bytecode,
          nonce: await relay.getAccountNonce(accounts[2].address),
        };
        const signedTx = await accounts[2].wallet.signTransaction(deploymentTransaction);
        const deploymentTxHash = (await client.call(METHOD_NAME, [signedTx])) as string;
        await relay.pollForValidTransactionReceipt(deploymentTxHash);

        const info = await mirrorNode.get(`/contracts/results/${deploymentTxHash}`);
        expect(info).to.have.property('address');
        expect(info.address).to.not.be.null;
        const contractInfo = await mirrorNode.get(`/contracts/${info.address}`);
        expect(contractInfo).to.have.property('bytecode');
        expect(contractInfo.bytecode).to.not.be.null;

        const deployedContract = new ethers.Contract(info.address, basicContract.abi, accounts[2].wallet);
        expect(await deployedContract.getAddress()).to.eq(contractInfo.evm_address);
        expect(await deployedContract.getDeployedCode()).to.eq(contractInfo.runtime_bytecode);
        const result = await deployedContract.ping();
        expect(result).to.eq(1n);
      });

      it('@xts should execute "eth_sendRawTransaction" of type 1 and deploy a real contract', async function () {
        const transaction = {
          ...defaultLegacy2930TransactionData,
          value: 0,
          data: basicContract.bytecode,
          nonce: await relay.getAccountNonce(accounts[2].address),
        };
        const signedTx = await accounts[2].wallet.signTransaction(transaction);
        const transactionHash = (await client.call(METHOD_NAME, [signedTx])) as string;
        await relay.pollForValidTransactionReceipt(transactionHash);
        const info = await mirrorNode.get(`/contracts/results/${transactionHash}`);
        expect(info).to.have.property('contract_id');
        expect(info.contract_id).to.not.be.null;
        expect(info).to.have.property('created_contract_ids');
        expect(info.created_contract_ids.length).to.be.equal(1);
        expect(info.max_fee_per_gas).to.eq('0x');
        expect(info.max_priority_fee_per_gas).to.eq('0x');
        expect(info).to.have.property('access_list');
      });

      it('@xts should execute "eth_sendRawTransaction" of type 2 and deploy a real contract', async function () {
        const transaction = {
          ...defaultLondonTransactionData,
          value: 0,
          data: basicContract.bytecode,
          nonce: await relay.getAccountNonce(accounts[2].address),
        };
        const signedTx = await accounts[2].wallet.signTransaction(transaction);
        const transactionHash = (await client.call(METHOD_NAME, [signedTx])) as string;
        await relay.pollForValidTransactionReceipt(transactionHash);
        const info = await mirrorNode.get(`/contracts/results/${transactionHash}`);
        expect(info).to.have.property('contract_id');
        expect(info.contract_id).to.not.be.null;
        expect(info).to.have.property('max_fee_per_gas');
        expect(info).to.have.property('max_priority_fee_per_gas');
        expect(info).to.have.property('created_contract_ids');
        expect(info.created_contract_ids.length).to.be.equal(1);
        expect(info).to.have.property('type');
        expect(info.type).to.be.equal(2);
        expect(info).to.have.property('access_list');
      });

      it('@xts should execute "eth_sendRawTransaction" and deploy a contract with any arbitrary calldata size', async () => {
        const gasPrice = await relay.gasPrice();
        const randomBytes = [2566, 2568, 3600, 5217, 7200];
        const sender = arbitraryCalldataAccounts[ALL_PROTOCOL_CLIENTS.indexOf(client)];

        for (const bytes of randomBytes) {
          const transaction = {
            type: 2,
            chainId: Number(CHAIN_ID),
            nonce: await relay.getAccountNonce(sender.address),
            maxPriorityFeePerGas: gasPrice,
            maxFeePerGas: gasPrice,
            gasLimit: defaultGasLimit,
            data: '0x' + '00'.repeat(bytes),
          };
          const signedTx = await sender.wallet.signTransaction(transaction);
          const transactionHash = (await client.call(METHOD_NAME, [signedTx])) as string;
          await relay.pollForValidTransactionReceipt(transactionHash);
          const info = await mirrorNode.get(`/contracts/results/${transactionHash}`);
          expect(info).to.have.property('contract_id');
          expect(info.contract_id).to.not.be.null;
          expect(info).to.have.property('created_contract_ids');
          expect(info.created_contract_ids.length).to.be.equal(1);
          await Utils.wait(3000);
        }
      });

      it('should delete the file created while execute "eth_sendRawTransaction" to deploy a large contract', async function () {
        const jumboTxEnabled = ConfigService.get('JUMBO_TX_ENABLED');
        ConfigServiceTestHelper.dynamicOverride('JUMBO_TX_ENABLED', false);

        try {
          const gasPrice = await relay.gasPrice();
          const transaction = {
            type: 2,
            chainId: Number(CHAIN_ID),
            nonce: await relay.getAccountNonce(accounts[2].address),
            maxPriorityFeePerGas: gasPrice,
            maxFeePerGas: gasPrice,
            gasLimit: defaultGasLimit,
            data: '0x' + '00'.repeat(5121),
          };

          const signedTx = await accounts[2].wallet.signTransaction(transaction);
          const transactionHash = (await client.call(METHOD_NAME, [signedTx])) as string;

          await Utils.wait(1000);
          const txInfo = await mirrorNode.get(`/contracts/results/${transactionHash}`);

          const contractResult = await mirrorNode.get(`/contracts/${txInfo.contract_id}`);
          const fileInfo = await new FileInfoQuery().setFileId(contractResult.file_id).execute(servicesNode.client);
          expect(fileInfo).to.exist;
          expect(fileInfo instanceof FileInfo).to.be.true;
          expect(fileInfo.isDeleted).to.be.true;
          expect(fileInfo.size.toNumber()).to.eq(0);
        } finally {
          ConfigServiceTestHelper.dynamicOverride('JUMBO_TX_ENABLED', jumboTxEnabled);
        }
      });

      it('@xts should execute "eth_sendRawTransaction" and deploy a contract with reasonable transaction fee within expected bounds', async function () {
        const balanceBefore = await relay.getBalance(accounts[2].wallet.address, 'latest');
        const gasPrice = await relay.gasPrice();
        const transaction = {
          type: 2,
          chainId: Number(CHAIN_ID),
          nonce: await relay.getAccountNonce(accounts[2].address),
          maxPriorityFeePerGas: gasPrice,
          maxFeePerGas: gasPrice,
          gasLimit: Constants.MAX_TRANSACTION_FEE_THRESHOLD,
          data: '0x' + '00'.repeat(100),
        };

        const signedTx = await accounts[2].wallet.signTransaction(transaction);
        const transactionHash = (await client.call(METHOD_NAME, [signedTx])) as string;
        await relay.pollForValidTransactionReceipt(transactionHash);
        const info = await mirrorNode.get(`/contracts/results/${transactionHash}`);
        const balanceAfter = await relay.getBalance(accounts[2].wallet.address, 'latest');
        expect(info).to.have.property('contract_id');
        expect(info.contract_id).to.not.be.null;
        expect(info).to.have.property('created_contract_ids');
        expect(info.created_contract_ids.length).to.be.equal(1);

        const diffInTinybars = BigInt(balanceBefore - balanceAfter) / BigInt(Constants.TINYBAR_TO_WEIBAR_COEF);
        const diffInHbars = Number(diffInTinybars) / 100_000_000;
        const maxPossibleFeeInHbars =
          (gasPrice * Constants.MAX_TRANSACTION_FEE_THRESHOLD) / Constants.TINYBAR_TO_WEIBAR_COEF / 100_000_000;

        expect(diffInHbars).to.be.greaterThan(0);
        expect(diffInHbars).to.be.lessThan(maxPossibleFeeInHbars);
      });

      describe('Check subsidizing gas fees', async function () {
        let paymasterEnabledBefore, paymasterWhitelistBefore, maxGasAllowanceHbarBefore;

        before(async () => {
          paymasterEnabledBefore = ConfigService.get('PAYMASTER_ENABLED');
          paymasterWhitelistBefore = ConfigService.get('PAYMASTER_WHITELIST');
          maxGasAllowanceHbarBefore = ConfigService.get('MAX_GAS_ALLOWANCE_HBAR');
        });

        after(() => {
          ConfigServiceTestHelper.dynamicOverride('PAYMASTER_ENABLED', paymasterEnabledBefore);
          ConfigServiceTestHelper.dynamicOverride('PAYMASTER_WHITELIST', paymasterWhitelistBefore);
          ConfigServiceTestHelper.dynamicOverride('MAX_GAS_ALLOWANCE_HBAR', maxGasAllowanceHbarBefore);
          Utils.reloadPaymasterConfigs();
        });

        const configurePaymaster = (enabled: boolean, whitelist: string[], allowance: number) => {
          ConfigServiceTestHelper.dynamicOverride('PAYMASTER_ENABLED', enabled);
          ConfigServiceTestHelper.dynamicOverride('PAYMASTER_WHITELIST', whitelist);
          ConfigServiceTestHelper.dynamicOverride('MAX_GAS_ALLOWANCE_HBAR', allowance);
          Utils.reloadPaymasterConfigs();
        };

        it('should execute a pre EIP-1559 transaction with "eth_sendRawTransaction" and pays the total amount of the fees on behalf of the sender', async function () {
          configurePaymaster(true, ['*'], 100);
          const balanceBefore = await relay.getBalance(accounts[2].wallet.address, 'latest');
          const transaction = {
            type: 1,
            chainId: Number(CHAIN_ID),
            nonce: await relay.getAccountNonce(accounts[2].wallet.address),
            gasPrice: 0,
            gasLimit: Constants.MAX_TRANSACTION_FEE_THRESHOLD,
            data: '0x00',
          };
          const signedTx = await accounts[2].wallet.signTransaction(transaction);
          const transactionHash = (await client.call(METHOD_NAME, [signedTx])) as string;
          const info = await mirrorNode.get(`/contracts/results/${transactionHash}`);
          expect(info).to.have.property('contract_id');
          expect(info.contract_id).to.not.be.null;
          expect(info).to.have.property('created_contract_ids');
          expect(info.created_contract_ids.length).to.be.equal(1);

          const balanceAfter = await relay.getBalance(accounts[2].wallet.address, 'latest');
          expect(balanceAfter).to.be.equal(balanceBefore);
        });

        it('should execute a post EIP-1559 transaction with "eth_sendRawTransaction" and pays the total amount of the fees on behalf of the sender', async function () {
          configurePaymaster(true, ['*'], 100);
          const balanceBefore = await relay.getBalance(accounts[2].wallet.address, 'latest');
          const transaction = {
            type: 2,
            chainId: Number(CHAIN_ID),
            nonce: await relay.getAccountNonce(accounts[2].wallet.address),
            maxPriorityFeePerGas: 0,
            maxFeePerGas: 0,
            gasLimit: Constants.MAX_TRANSACTION_FEE_THRESHOLD,
            data: '0x00',
          };
          const signedTx = await accounts[2].wallet.signTransaction(transaction);
          const transactionHash = (await client.call(METHOD_NAME, [signedTx])) as string;
          const info = await mirrorNode.get(`/contracts/results/${transactionHash}`);
          expect(info).to.have.property('contract_id');
          expect(info.contract_id).to.not.be.null;
          expect(info).to.have.property('created_contract_ids');
          expect(info.created_contract_ids.length).to.be.equal(1);

          const balanceAfter = await relay.getBalance(accounts[2].wallet.address, 'latest');
          expect(balanceAfter).to.be.equal(balanceBefore);
        });
      });

      it('should fail "eth_sendRawTransaction" for EIP155 transaction with not enough gas', async function () {
        const gasLimit = 100;
        const transaction = {
          ...default155TransactionData,
          to: parentContractAddress,
          nonce: await relay.getAccountNonce(accounts[2].address),
          gasLimit,
          gasPrice: await relay.gasPrice(),
        };
        const signedTx = await accounts[2].wallet.signTransaction(transaction);
        const error = predefined.GAS_LIMIT_TOO_LOW(gasLimit, Constants.MAX_TRANSACTION_FEE_THRESHOLD);

        await expectRpcError(client, signedTx, error, false);
      });

      it('should fail "eth_sendRawTransaction" for EIP155 transaction with a too high gasLimit', async function () {
        const gasLimit = 999999999;
        const transaction = {
          ...default155TransactionData,
          to: parentContractAddress,
          nonce: await relay.getAccountNonce(accounts[2].address),
          gasLimit,
          gasPrice: await relay.gasPrice(),
        };
        const signedTx = await accounts[2].wallet.signTransaction(transaction);
        const error = predefined.GAS_LIMIT_TOO_HIGH(gasLimit, Constants.MAX_TRANSACTION_FEE_THRESHOLD);

        await expectRpcError(client, signedTx, error, false);
      });

      it('should fail "eth_sendRawTransaction" for London transaction with not enough gas', async function () {
        const gasLimit = 100;
        const transaction = {
          ...defaultLondonTransactionData,
          to: parentContractAddress,
          nonce: await relay.getAccountNonce(accounts[2].address),
          gasLimit,
        };
        const signedTx = await accounts[2].wallet.signTransaction(transaction);
        const error = predefined.GAS_LIMIT_TOO_LOW(gasLimit, Constants.MAX_TRANSACTION_FEE_THRESHOLD);

        await expectRpcError(client, signedTx, error, false);
      });

      it('should fail "eth_sendRawTransaction" for London transaction with a too high gasLimit', async function () {
        const gasLimit = 999999999;
        const transaction = {
          ...defaultLondonTransactionData,
          to: parentContractAddress,
          nonce: await relay.getAccountNonce(accounts[2].address),
          gasLimit,
        };
        const signedTx = await accounts[2].wallet.signTransaction(transaction);
        const error = predefined.GAS_LIMIT_TOO_HIGH(gasLimit, Constants.MAX_TRANSACTION_FEE_THRESHOLD);

        await expectRpcError(client, signedTx, error, false);
      });

      it('should fail "eth_sendRawTransaction" if receiver\'s account has receiver_sig_required enabled', async function () {
        const newPrivateKey = PrivateKey.generateED25519();
        const newAccount = await new AccountCreateTransaction()
          .setKey(newPrivateKey.publicKey)
          .setInitialBalance(100)
          .setReceiverSignatureRequired(true)
          .freezeWith(servicesNode.client)
          .sign(newPrivateKey);

        const transaction = await newAccount.execute(servicesNode.client);
        const receipt = await transaction.getReceipt(servicesNode.client);

        if (!receipt.accountId) {
          throw new Error('Failed to create new account - accountId is null');
        }

        const toAddress = Utils.idToEvmAddress(receipt.accountId.toString());
        const verifyAccount = await mirrorNode.get(`/accounts/${toAddress}`);
        expect(verifyAccount.receiver_sig_required).to.be.true;

        const tx = {
          ...defaultLegacyTransactionData,
          chainId: Number(CHAIN_ID),
          nonce: await accounts[0].wallet.getNonce(),
          to: toAddress,
          from: accounts[0].address,
        };
        const signedTx = await accounts[0].wallet.signTransaction(tx);

        await expectRpcError(client, signedTx, predefined.RECEIVER_SIGNATURE_ENABLED, false);
      });

      it(`should execute "eth_sendRawTransaction" if receiver's account has receiver_sig_required disabled`, async function () {
        const newPrivateKey = PrivateKey.generateED25519();
        const newAccount = await new AccountCreateTransaction()
          .setKey(newPrivateKey.publicKey)
          .setInitialBalance(100)
          .setReceiverSignatureRequired(false)
          .freezeWith(servicesNode.client)
          .sign(newPrivateKey);

        const transaction = await newAccount.execute(servicesNode.client);
        const receipt = await transaction.getReceipt(servicesNode.client);
        await Utils.wait(3000);

        if (!receipt.accountId) {
          throw new Error('Failed to create new account - accountId is null');
        }

        const toAddress = Utils.idToEvmAddress(receipt.accountId.toString());
        const verifyAccount = await mirrorNode.get(`/accounts/${toAddress}`);
        expect(verifyAccount.receiver_sig_required).to.be.false;

        const tx = {
          ...defaultLegacyTransactionData,
          chainId: Number(CHAIN_ID),
          nonce: await accounts[0].wallet.getNonce(),
          to: toAddress,
          from: accounts[0].address,
        };
        const signedTx = await accounts[0].wallet.signTransaction(tx);
        const transactionHash = (await client.call(METHOD_NAME, [signedTx])) as string;
        await relay.pollForValidTransactionReceipt(transactionHash);

        const info = await mirrorNode.get(`/contracts/results/${transactionHash}`);
        expect(info).to.exist;
        expect(info.result).to.equal('SUCCESS');
      });

      it('should fail "eth_sendRawTransaction" for transaction with null gasPrice, null maxFeePerGas, and null maxPriorityFeePerGas', async function () {
        const transaction = {
          ...defaultLegacyTransactionData,
          chainId: Number(CHAIN_ID),
          gasPrice: null,
          maxFeePerGas: null,
          maxPriorityFeePerGas: null,
          to: parentContractAddress,
          nonce: await relay.getAccountNonce(accounts[2].address),
        };
        const signedTx = await accounts[2].wallet.signTransaction(transaction);
        const error = predefined.GAS_PRICE_TOO_LOW(0, GAS_PRICE_REF);

        await expectRpcError(client, signedTx, error, false);
      });

      it('Type 3 transactions are not supported for eth_sendRawTransaction', async () => {
        const transaction = {
          ...defaultLondonTransactionData,
          type: 3,
          maxFeePerBlobGas: defaultGasPrice,
          blobVersionedHashes: ['0x6265617665726275696c642e6f7267476265617665726275696c642e6f726747'],
        };
        const signedTx = await accounts[0].wallet.signTransaction(transaction);

        await expectRpcError(client, signedTx, predefined.UNSUPPORTED_TRANSACTION_TYPE_3, false);
      });

      describe('Prechecks', function () {
        describe('nonce handling', function () {
          it('@release fail "eth_getTransactionReceipt" on precheck with wrong nonce error when sending a tx with the same nonce twice', async function () {
            const nonce = await relay.getAccountNonce(accounts[2].address);
            const transaction = {
              ...default155TransactionData,
              to: parentContractAddress,
              nonce,
              maxFeePerGas: await relay.gasPrice(),
            };
            const signedTx = await accounts[2].wallet.signTransaction(transaction);
            const txHash = (await client.call(METHOD_NAME, [signedTx])) as string;
            const mirrorResult = await mirrorNode.get(`/contracts/results/${txHash}`);
            mirrorResult.from = accounts[2].wallet.address;
            mirrorResult.to = parentContractAddress;

            const receipt = await client.call('eth_getTransactionReceipt', [txHash]);
            const currentPrice = await relay.gasPrice();
            const expectedCumulativeGasUsed = await computeExpectedCumulativeGasUsed(mirrorNode, mirrorResult);
            Assertions.transactionReceipt(receipt, mirrorResult, currentPrice, expectedCumulativeGasUsed);

            const error = predefined.NONCE_TOO_LOW(nonce, nonce + 1);
            await expectRpcError(client, signedTx, error);
          });

          if (!ConfigService.get('USE_ASYNC_TX_PROCESSING')) {
            it('fail "eth_getTransactionReceipt" on precheck with wrong nonce error when sending a tx with a higher nonce and async tx processing is disabled', async function () {
              const nonce = await relay.getAccountNonce(accounts[2].address);
              const transaction = {
                ...default155TransactionData,
                to: parentContractAddress,
                nonce: nonce + 100,
                gasPrice: await relay.gasPrice(),
              };
              const signedTx = await accounts[2].wallet.signTransaction(transaction);
              const error = predefined.NONCE_TOO_HIGH(nonce + 100, nonce);

              await expectRpcError(client, signedTx, error);
            });
          }

          it('@release fail "eth_getTransactionReceipt" on submitting with wrong nonce error when sending a tx with the same nonce twice', async function () {
            const nonce = await relay.getAccountNonce(accounts[2].address);
            const transaction = {
              ...default155TransactionData,
              to: parentContractAddress,
              nonce,
              maxFeePerGas: await relay.gasPrice(),
            };
            const signedTx = await accounts[2].wallet.signTransaction(transaction);
            const txHash = (await client.call(METHOD_NAME, [signedTx])) as string;
            await relay.pollForValidTransactionReceipt(txHash);

            const error = predefined.NONCE_TOO_LOW(nonce, nonce + 1);
            await expectRpcError(client, signedTx, error);
          });
        });

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

            const transactionHash = (await client.call(METHOD_NAME, [signedTx])) as string;
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
              data: '0x' + '00'.repeat(Constants.SEND_RAW_TRANSACTION_SIZE_LIMIT + 1024),
            };

            const signedTx = await accounts[1].wallet.signTransaction(transaction);
            const totalRawTransactionSizeInBytes = signedTx.replace('0x', '').length / 2;
            const error = predefined.TRANSACTION_SIZE_LIMIT_EXCEEDED(
              totalRawTransactionSizeInBytes,
              Constants.SEND_RAW_TRANSACTION_SIZE_LIMIT,
            );

            await expectRpcError(client, signedTx, error, false);
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
            const response = await client.callRaw(METHOD_NAME, [signedTx]);
            expect(response.error).to.exist;
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
            const transactionHash = (await client.call(METHOD_NAME, [signedTx])) as string;
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

            const transactionHash = (await client.call(METHOD_NAME, [signedTx])) as string;
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
              data: '0x' + '00'.repeat(Constants.CALL_DATA_SIZE_LIMIT + 1024),
            };

            const signedTx = await accounts[1].wallet.signTransaction(transaction);
            const totalRawTransactionSizeInBytes = transaction.data.replace('0x', '').length / 2;
            const error = predefined.CALL_DATA_SIZE_LIMIT_EXCEEDED(
              totalRawTransactionSizeInBytes,
              Constants.CALL_DATA_SIZE_LIMIT,
            );

            await expectRpcError(client, signedTx, error, false);
          });
        });
      });

      it('@release @xts should execute "eth_sendRawTransaction" with Jumbo Transaction', async function () {
        const isJumboTransaction = ConfigService.get('JUMBO_TX_ENABLED');
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
          data: '0x' + '00'.repeat(6144),
        };

        const signedTx = await accounts[1].wallet.signTransaction(transaction);
        const transactionHash = (await client.call(METHOD_NAME, [signedTx])) as string;
        await relay.pollForValidTransactionReceipt(transactionHash);

        const info = await mirrorNode.get(`/contracts/results/${transactionHash}`);
        expect(info).to.exist;
      });

      it('should fail to execute "eth_sendRawTransaction" in Read-Only mode', async function () {
        const readOnly = ConfigService.get('READ_ONLY');
        ConfigServiceTestHelper.dynamicOverride('READ_ONLY', true);

        try {
          const transaction = {
            type: 2,
            chainId: Number(CHAIN_ID),
            nonce: 1234,
            gasLimit: defaultGasLimit,
            to: accounts[0].address,
            data: '0x00',
          };

          const signedTx = await accounts[1].wallet.signTransaction(transaction);
          await expectRpcError(client, signedTx, predefined.UNSUPPORTED_OPERATION('Relay is in read-only mode'), false);
        } finally {
          ConfigServiceTestHelper.dynamicOverride('READ_ONLY', readOnly);
        }
      });

      describe('Paymaster', function () {
        const zeroGasPrice = '0x0';
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
          Utils.reloadPaymasterConfigs();
        });

        const configurePaymaster = (enabled: boolean, whitelist: string[], allowance: number) => {
          ConfigServiceTestHelper.dynamicOverride('PAYMASTER_ENABLED', enabled);
          ConfigServiceTestHelper.dynamicOverride('PAYMASTER_WHITELIST', whitelist);
          ConfigServiceTestHelper.dynamicOverride('MAX_GAS_ALLOWANCE_HBAR', allowance);
          Utils.reloadPaymasterConfigs();
        };

        const createAndSignPaymasterTransaction = async (senderAccount: AliasAccount, recipientAddress?: string) => {
          const transaction = {
            type: 2,
            chainId: Number(CHAIN_ID),
            nonce: await relay.getAccountNonce(senderAccount.address),
            maxPriorityFeePerGas: zeroGasPrice,
            maxFeePerGas: zeroGasPrice,
            gasLimit: defaultGasLimit,
            to: recipientAddress,
            data: recipientAddress ? undefined : '0x' + '00'.repeat(6144),
          };

          return senderAccount.wallet.signTransaction(transaction);
        };

        const verifySuccessfulPaymasterTransaction = async (
          txHash: string,
          signerAddress: string,
          initialBalance: bigint,
        ) => {
          await relay.pollForValidTransactionReceipt(txHash);

          const info = await mirrorNode.get(`/contracts/results/${txHash}`);
          expect(info).to.exist;
          expect(info.result).to.equal('SUCCESS');

          const finalBalance = await relay.getBalance(signerAddress, 'latest');
          expect(initialBalance).to.be.equal(finalBalance);
        };

        it('should process zero-fee contract deployment transactions when Paymaster is enabled globally', async function () {
          configurePaymaster(true, ['*'], MAX_ALLOWANCE);

          const initialBalance = await relay.getBalance(accounts[2].address, 'latest');
          const signedTx = await createAndSignPaymasterTransaction(accounts[2]);
          const txHash = (await client.call(METHOD_NAME, [signedTx])) as string;

          await verifySuccessfulPaymasterTransaction(txHash, accounts[2].address, initialBalance);
        });

        it('should process zero-fee transactions to existing accounts when Paymaster is enabled globally', async function () {
          configurePaymaster(true, ['*'], MAX_ALLOWANCE);

          const initialBalance = await relay.getBalance(accounts[2].address, 'latest');
          const signedTx = await createAndSignPaymasterTransaction(accounts[2], accounts[0].address);
          const txHash = (await client.call(METHOD_NAME, [signedTx])) as string;

          await verifySuccessfulPaymasterTransaction(txHash, accounts[2].address, initialBalance);
        });

        it('should process zero-fee transactions when target address is specifically whitelisted', async function () {
          configurePaymaster(true, [accounts[0].address], MAX_ALLOWANCE);

          const initialBalance = await relay.getBalance(accounts[2].address, 'latest');
          const signedTx = await createAndSignPaymasterTransaction(accounts[2], accounts[0].address);
          const txHash = (await client.call(METHOD_NAME, [signedTx])) as string;

          await verifySuccessfulPaymasterTransaction(txHash, accounts[2].address, initialBalance);
        });

        it('should reject zero-fee transactions when Paymaster is disabled', async function () {
          configurePaymaster(false, ['*'], MAX_ALLOWANCE);

          const signedTx = await createAndSignPaymasterTransaction(accounts[2], accounts[0].address);
          await expectRpcError(client, signedTx, predefined.GAS_PRICE_TOO_LOW(zeroGasPrice, GAS_PRICE_REF), false);
        });

        it('should reject zero-fee transactions when whitelist is empty despite Paymaster being enabled', async function () {
          configurePaymaster(true, [], MAX_ALLOWANCE);

          const signedTx = await createAndSignPaymasterTransaction(accounts[2], accounts[0].address);
          await expectRpcError(client, signedTx, predefined.GAS_PRICE_TOO_LOW(zeroGasPrice, GAS_PRICE_REF), false);
        });

        it('should return INSUFFICIENT_TX_FEE when Paymaster is enabled but has zero allowance', async function () {
          configurePaymaster(true, ['*'], 0);

          const signedTx = await createAndSignPaymasterTransaction(accounts[2], accounts[0].address);
          const txHash = (await client.call(METHOD_NAME, [signedTx])) as string;
          await relay.pollForValidTransactionReceipt(txHash);

          const info = await mirrorNode.get(`/contracts/results/${txHash}`);
          expect(info).to.exist;
          expect(info.result).to.equal('INSUFFICIENT_TX_FEE');
        });
      });

      describe('Multiple paymasters', function () {
        let newPaymasters: AliasAccount[] = [];
        let paymasterAccounts, paymasterAccountsWhitelists;

        const createAndSignPaymasterTransfer = async (
          senderAccount: AliasAccount,
          to: string,
          gasPrice: string | number = '0x0',
        ) => {
          return senderAccount.wallet.signTransaction({
            to,
            maxPriorityFeePerGas: gasPrice,
            maxFeePerGas: gasPrice,
            type: 2,
            chainId: Number(CHAIN_ID),
            nonce: await relay.getAccountNonce(senderAccount.address),
            gasLimit: 30_000,
            value: ONE_TINYBAR,
          });
        };

        before(async () => {
          newPaymasters = await Utils.createMultipleAliasAccounts(mirrorNode, global.accounts[0], 2, '1500000000');
          await Utils.wait(2500);

          paymasterAccounts = ConfigService.get('PAYMASTER_ACCOUNTS');
          paymasterAccountsWhitelists = ConfigService.get('PAYMASTER_ACCOUNTS_WHITELISTS');
        });

        after(() => {
          ConfigServiceTestHelper.dynamicOverride('PAYMASTER_ACCOUNTS', paymasterAccounts);
          ConfigServiceTestHelper.dynamicOverride('PAYMASTER_ACCOUNTS_WHITELISTS', paymasterAccountsWhitelists);
          Utils.reloadPaymasterConfigs();
        });

        const configurePaymasters = (accountsConfig: any, whitelistsConfig: any) => {
          ConfigServiceTestHelper.dynamicOverride('PAYMASTER_ACCOUNTS', accountsConfig);
          ConfigServiceTestHelper.dynamicOverride('PAYMASTER_ACCOUNTS_WHITELISTS', whitelistsConfig);
          Utils.reloadPaymasterConfigs();
        };

        it('should cover the tx fees if PAYMASTER_ACCOUNTS and PAYMASTER_ACCOUNTS_WHITELISTS are set', async () => {
          configurePaymasters(
            [
              [
                newPaymasters[0].accountId.toString(),
                'HEX_ECDSA',
                prepend0x(newPaymasters[0].privateKey.toStringRaw()),
                '14',
              ],
            ],
            [[newPaymasters[0].accountId.toString(), [accounts[2].address.toLowerCase()]]],
          );

          const senderBalanceBefore = await relay.getBalance(accounts[1].address, 'latest');
          const receiverBalanceBefore = await relay.getBalance(accounts[2].address, 'latest');
          const paymasterBalanceBefore = await relay.getBalance(newPaymasters[0].address, 'latest');

          const signedTx = await createAndSignPaymasterTransfer(accounts[1], accounts[2].address);
          const txHash = (await client.call(METHOD_NAME, [signedTx])) as string;
          await relay.pollForValidTransactionReceipt(txHash);
          const senderBalanceAfter = await relay.getBalance(accounts[1].address, 'latest');
          const receiverBalanceAfter = await relay.getBalance(accounts[2].address, 'latest');
          const paymasterBalanceAfter = await relay.getBalance(newPaymasters[0].address, 'latest');

          expect(senderBalanceBefore - BigInt(ONE_TINYBAR)).to.equal(senderBalanceAfter);
          expect(receiverBalanceBefore + BigInt(ONE_TINYBAR)).to.equal(receiverBalanceAfter);
          expect(paymasterBalanceBefore > paymasterBalanceAfter).to.be.true;
        });

        it('should cover tx fees only if they are whitelisted by paymasters', async () => {
          configurePaymasters(
            [
              [
                newPaymasters[0].accountId.toString(),
                'HEX_ECDSA',
                prepend0x(newPaymasters[0].privateKey.toStringRaw()),
                '14',
              ],
              [
                newPaymasters[1].accountId.toString(),
                'HEX_ECDSA',
                prepend0x(newPaymasters[1].privateKey.toStringRaw()),
                '14',
              ],
            ],
            [
              [newPaymasters[0].accountId.toString(), [accounts[1].address.toLowerCase()]],
              [newPaymasters[1].accountId.toString(), [accounts[2].address.toLowerCase()]],
            ],
          );
          let senderBalanceBefore, receiverBalanceBefore, senderBalanceAfter, receiverBalanceAfter;

          const paymaster0BalanceStart = await relay.getBalance(newPaymasters[0].address, 'latest');
          const paymaster1BalanceStart = await relay.getBalance(newPaymasters[1].address, 'latest');

          senderBalanceBefore = await relay.getBalance(accounts[1].address, 'latest');
          receiverBalanceBefore = await relay.getBalance(accounts[2].address, 'latest');
          const signedTx1 = await createAndSignPaymasterTransfer(accounts[1], accounts[2].address);
          const txHash1 = (await client.call(METHOD_NAME, [signedTx1])) as string;
          await relay.pollForValidTransactionReceipt(txHash1);
          senderBalanceAfter = await relay.getBalance(accounts[1].address, 'latest');
          receiverBalanceAfter = await relay.getBalance(accounts[2].address, 'latest');
          expect(senderBalanceBefore - BigInt(ONE_TINYBAR)).to.equal(senderBalanceAfter);
          expect(receiverBalanceBefore + BigInt(ONE_TINYBAR)).to.equal(receiverBalanceAfter);

          const paymaster0BalanceAfter1 = await relay.getBalance(newPaymasters[0].address, 'latest');
          const paymaster1BalanceAfter1 = await relay.getBalance(newPaymasters[1].address, 'latest');

          senderBalanceBefore = await relay.getBalance(accounts[2].address, 'latest');
          receiverBalanceBefore = await relay.getBalance(accounts[1].address, 'latest');
          const signedTx2 = await createAndSignPaymasterTransfer(accounts[2], accounts[1].address);
          const txHash2 = (await client.call(METHOD_NAME, [signedTx2])) as string;
          await relay.pollForValidTransactionReceipt(txHash2);
          senderBalanceAfter = await relay.getBalance(accounts[2].address, 'latest');
          receiverBalanceAfter = await relay.getBalance(accounts[1].address, 'latest');
          expect(senderBalanceBefore - BigInt(ONE_TINYBAR)).to.equal(senderBalanceAfter);
          expect(receiverBalanceBefore + BigInt(ONE_TINYBAR)).to.equal(receiverBalanceAfter);

          const paymaster0BalanceAfter2 = await relay.getBalance(newPaymasters[0].address, 'latest');
          const paymaster1BalanceAfter2 = await relay.getBalance(newPaymasters[1].address, 'latest');

          senderBalanceBefore = await relay.getBalance(accounts[1].address, 'latest');
          receiverBalanceBefore = await relay.getBalance(accounts[0].address, 'latest');
          const signedTx3 = await createAndSignPaymasterTransfer(
            accounts[1],
            accounts[0].address,
            await relay.gasPrice(),
          );
          const txHash3 = (await client.call(METHOD_NAME, [signedTx3])) as string;
          await relay.pollForValidTransactionReceipt(txHash3);
          senderBalanceAfter = await relay.getBalance(accounts[1].address, 'latest');
          receiverBalanceAfter = await relay.getBalance(accounts[0].address, 'latest');
          expect(senderBalanceBefore - BigInt(ONE_TINYBAR)).to.be.greaterThan(senderBalanceAfter);
          expect(receiverBalanceBefore + BigInt(ONE_TINYBAR)).to.equal(receiverBalanceAfter);

          const paymaster0BalanceAfter3 = await relay.getBalance(newPaymasters[0].address, 'latest');
          const paymaster1BalanceAfter3 = await relay.getBalance(newPaymasters[1].address, 'latest');

          expect(paymaster0BalanceStart).to.equal(paymaster0BalanceAfter1);
          expect(paymaster1BalanceStart > paymaster1BalanceAfter1).to.be.true;
          expect(paymaster0BalanceAfter1 > paymaster0BalanceAfter2).to.be.true;
          expect(paymaster1BalanceAfter1).to.equal(paymaster1BalanceAfter2);
          expect(paymaster0BalanceAfter3).to.equal(paymaster0BalanceAfter2);
          expect(paymaster1BalanceAfter3).to.equal(paymaster1BalanceAfter2);
        });

        it('should apply only the last paymaster if there are repeated addresses', async () => {
          configurePaymasters(
            [
              [
                newPaymasters[0].accountId.toString(),
                'HEX_ECDSA',
                prepend0x(newPaymasters[0].privateKey.toStringRaw()),
                '14',
              ],
              [
                newPaymasters[1].accountId.toString(),
                'HEX_ECDSA',
                prepend0x(newPaymasters[1].privateKey.toStringRaw()),
                '14',
              ],
            ],
            [
              [
                newPaymasters[0].accountId.toString(),
                [accounts[1].address.toLowerCase(), accounts[2].address.toLowerCase()],
              ],
              [newPaymasters[1].accountId.toString(), [accounts[2].address.toLowerCase()]],
            ],
          );

          const paymaster0BalanceBefore = await relay.getBalance(newPaymasters[0].address, 'latest');
          const paymaster1BalanceBefore = await relay.getBalance(newPaymasters[1].address, 'latest');
          const senderBalanceBefore = await relay.getBalance(accounts[1].address, 'latest');
          const receiverBalanceBefore = await relay.getBalance(accounts[2].address, 'latest');
          const signedTx = await createAndSignPaymasterTransfer(accounts[1], accounts[2].address);
          const txHash = (await client.call(METHOD_NAME, [signedTx])) as string;
          await relay.pollForValidTransactionReceipt(txHash);
          const senderBalanceAfter = await relay.getBalance(accounts[1].address, 'latest');
          const receiverBalanceAfter = await relay.getBalance(accounts[2].address, 'latest');
          const paymaster0BalanceAfter = await relay.getBalance(newPaymasters[0].address, 'latest');
          const paymaster1BalanceAfter = await relay.getBalance(newPaymasters[1].address, 'latest');

          expect(senderBalanceBefore - BigInt(ONE_TINYBAR)).to.equal(senderBalanceAfter);
          expect(receiverBalanceBefore + BigInt(ONE_TINYBAR)).to.equal(receiverBalanceAfter);
          expect(paymaster0BalanceBefore).to.equal(paymaster0BalanceAfter);
          expect(paymaster1BalanceBefore > paymaster1BalanceAfter).to.be.true;
        });
      });
    });
  }
});
