// SPDX-License-Identifier: Apache-2.0

import { ContractId } from '@hashgraph/sdk';
import { expect } from 'chai';
import { ethers } from 'ethers';

import { ConfigService } from '../../src/config-service/services';
import { numberTo0x } from '../../src/relay/formatters';
import Constants from '../../src/relay/lib/constants';
import MirrorClient from '../server/clients/mirrorClient';
import RelayClient from '../server/clients/relayClient';
import DeployerContractJson from '../server/contracts/Deployer.json';
import Assertions from '../server/helpers/assertions';
import Address from '../server/helpers/constants';
import RelayCalls from '../server/helpers/constants';
import { Utils } from '../server/helpers/utils';
import { AliasAccount } from '../server/types/AliasAccount';
import { ALL_PROTOCOL_CLIENTS } from './helpers/protocolClient';

describe('@release @protocol-acceptance eth_getTransactionCount', async function () {
  this.timeout(240 * 1000);
  const METHOD_NAME = 'eth_getTransactionCount';
  const CHAIN_ID = ConfigService.get('CHAIN_ID');
  const ONE_TINYBAR = Utils.add0xPrefix(Utils.toHex(ethers.parseUnits('1', 10)));

  // @ts-ignore
  const {
    mirrorNode,
    relay,
    initialBalance,
  }: { mirrorNode: MirrorClient; relay: RelayClient; initialBalance: string } = global;

  const accounts: AliasAccount[] = [];
  let deployerAccount: AliasAccount;
  let deployerContract: ethers.Contract;
  let deployerContractAddress: string;
  let deployerContractTx: ethers.TransactionReceipt;
  let contractId: ContractId;
  let primaryAccountNonce: number | null;
  let secondaryAccountNonce: number | null;

  const defaultGasPrice = numberTo0x(Assertions.defaultGasPrice);
  const defaultGasLimit = numberTo0x(3_000_000);
  const defaultTransaction = {
    value: ONE_TINYBAR,
    chainId: Number(CHAIN_ID),
    maxPriorityFeePerGas: defaultGasPrice,
    maxFeePerGas: defaultGasPrice,
    gasLimit: defaultGasLimit,
    type: 2,
  };

  before(async () => {
    accounts.push(...(await Utils.createMultipleAliasAccounts(mirrorNode, global.accounts[0], 2, initialBalance)));
    global.accounts.push(...accounts);

    [deployerAccount] = await Utils.createMultipleAliasAccounts(mirrorNode, global.accounts[0], 1, initialBalance);

    deployerContract = await Utils.deployContract(
      DeployerContractJson.abi,
      DeployerContractJson.bytecode,
      deployerAccount.wallet,
    );
    deployerContractAddress = deployerContract.target as string;

    const deployerContractTxHash = deployerContract.deploymentTransaction()?.hash;
    expect(deployerContractTxHash).to.not.be.null;

    deployerContractTx = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_GET_TRANSACTION_RECEIPT, [
      deployerContractTxHash,
    ]);

    // get contract details
    const mirrorContract = await mirrorNode.get(`/contracts/${deployerContractAddress}`);
    contractId = ContractId.fromString(mirrorContract.contract_id);

    primaryAccountNonce = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_GET_TRANSACTION_COUNT, [
      accounts[0].address,
      'latest',
    ]);
    secondaryAccountNonce = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_GET_TRANSACTION_COUNT, [
      accounts[1].address,
      'latest',
    ]);
  });

  after(async () => {
    if (global?.socketServer) {
      expect(global.socketServer._connections).to.eq(0);
    }
  });

  for (const client of ALL_PROTOCOL_CLIENTS) {
    describe(client.label, () => {
      it('@release should execute "eth_getTransactionCount" primary', async () => {
        const res = await client.call(METHOD_NAME, [accounts[0].address, deployerContractTx.blockNumber]);
        expect(res).to.be.equal(primaryAccountNonce);
      });

      it('should execute "eth_getTransactionCount" secondary', async () => {
        const res = await client.call(METHOD_NAME, [accounts[1].address, deployerContractTx.blockNumber]);
        expect(res).to.be.equal(secondaryAccountNonce);
      });

      it('@release should execute "eth_getTransactionCount" historic', async () => {
        const res = await client.call(METHOD_NAME, [deployerContractAddress, deployerContractTx.blockNumber]);
        expect(res).to.be.equal('0x2');
      });

      it('@release should execute "eth_getTransactionCount" contract latest', async () => {
        const res = await client.call(METHOD_NAME, [deployerContractAddress, Constants.BLOCK_LATEST]);
        expect(res).to.be.equal('0x2');
      });

      it('@release should execute "eth_getTransactionCount" with block hash', async () => {
        const res = await client.call(METHOD_NAME, [
          deployerContractAddress,
          deployerContractTx.blockHash.slice(0, 66),
        ]);
        expect(res).to.be.equal('0x2');
      });

      it('@release should execute "eth_getTransactionCount" for account with id converted to evm_address', async () => {
        const res = await client.call(METHOD_NAME, [accounts[0].address, deployerContractTx.blockNumber]);
        expect(res).to.be.equal(primaryAccountNonce);
      });

      it('@release should execute "eth_getTransactionCount" contract with id converted to evm_address historic', async () => {
        const res = await client.call(METHOD_NAME, [
          Utils.idToEvmAddress(contractId.toString()),
          deployerContractTx.blockNumber,
        ]);
        expect(res).to.be.equal('0x2');
      });

      it('@release should execute "eth_getTransactionCount" contract with id converted to evm_address latest', async () => {
        const res = await client.call(METHOD_NAME, [
          Utils.idToEvmAddress(contractId.toString()),
          Constants.BLOCK_LATEST,
        ]);
        expect(res).to.be.equal('0x2');
      });

      it('should execute "eth_getTransactionCount" for non-existing address', async () => {
        const res = await client.call(METHOD_NAME, [Address.NON_EXISTING_ADDRESS, deployerContractTx.blockNumber]);
        expect(res).to.be.equal('0x0');
      });

      it('should execute "eth_getTransactionCount" from hollow account', async () => {
        const hollowAccount = ethers.Wallet.createRandom();
        const resBeforeCreation = await client.call(METHOD_NAME, [hollowAccount.address, 'latest']);
        expect(resBeforeCreation).to.be.equal('0x0');

        const gasPrice = await relay.gasPrice();
        const signedTxHollowAccountCreation = await accounts[1].wallet.signTransaction({
          ...defaultTransaction,
          value: '10000000000000000000', // 10 HBARs
          to: hollowAccount.address,
          nonce: await relay.getAccountNonce(accounts[1].address),
          maxPriorityFeePerGas: gasPrice,
          maxFeePerGas: gasPrice,
        });
        const txHashHAC = await relay.sendRawTransaction(signedTxHollowAccountCreation);
        await mirrorNode.get(`/contracts/results/${txHashHAC}`);

        const signTxFromHollowAccount = await hollowAccount.signTransaction({
          ...defaultTransaction,
          to: deployerContractAddress,
          nonce: await relay.getAccountNonce(hollowAccount.address),
          maxPriorityFeePerGas: gasPrice,
          maxFeePerGas: gasPrice,
        });
        const txHashHA = await relay.sendRawTransaction(signTxFromHollowAccount);
        await mirrorNode.get(`/contracts/results/${txHashHA}`);

        const resAfterCreation = await client.call(METHOD_NAME, [hollowAccount.address, 'latest']);
        expect(resAfterCreation).to.be.equal('0x1');
      });

      it('should execute "eth_getTransactionCount" for account with non-zero nonce', async () => {
        const account = await Utils.createAliasAccount(mirrorNode, accounts[0]);

        const gasPrice = await relay.gasPrice();
        const transaction = {
          ...defaultTransaction,
          to: deployerContractAddress,
          nonce: await relay.getAccountNonce(account.address),
          maxPriorityFeePerGas: gasPrice,
          maxFeePerGas: gasPrice,
        };

        const signedTx = await account.wallet.signTransaction(transaction);
        const transactionHash = await relay.sendRawTransaction(signedTx);
        // Since the transactionId is not available in this context
        // Wait for the transaction to be processed and imported in the mirror node with axios-retry
        await mirrorNode.get(`/contracts/results/${transactionHash}`);

        const res = await client.call(METHOD_NAME, [account.address, 'latest']);
        expect(res).to.be.equal('0x1');
      });

      it('should return the transaction count and increment it after a transaction', async () => {
        const beforeCount = Number(await client.call(METHOD_NAME, [accounts[0].address, 'latest']));
        await Utils.sendTransaction(ONE_TINYBAR, CHAIN_ID, accounts, relay, mirrorNode);
        const afterCount = Number(await client.call(METHOD_NAME, [accounts[0].address, 'latest']));
        expect(afterCount).to.equal(beforeCount + 1);
      });

      it('should return the transaction count matching current account nonce', async () => {
        const defaultGasPriceDynamic = await relay.gasPrice();

        const transactionCountBefore = await relay.getAccountNonce(accounts[0].address);
        const resBefore = Number(await client.call(METHOD_NAME, [accounts[0].address, 'latest']));
        expect(resBefore).to.eq(transactionCountBefore);

        const transaction = {
          value: ONE_TINYBAR,
          gasLimit: numberTo0x(30000),
          chainId: Number(CHAIN_ID),
          to: accounts[1].address,
          maxFeePerGas: defaultGasPriceDynamic,
          nonce: await relay.getAccountNonce(accounts[0].address),
        };
        const signedTx = await accounts[0].wallet.signTransaction(transaction);
        // @notice submit a transaction to increase transaction count
        await relay.sendRawTransaction(signedTx);

        const transactionCountAfter = await relay.getAccountNonce(accounts[0].address);
        const resAfter = Number(await client.call(METHOD_NAME, [accounts[0].address, 'latest']));
        expect(resAfter).to.eq(transactionCountAfter);
      });

      it('nonce for contract correctly increments', async () => {
        const freshDeployer = await Utils.deployContract(
          DeployerContractJson.abi,
          DeployerContractJson.bytecode,
          deployerAccount.wallet,
        );

        const nonceBefore = await client.call(METHOD_NAME, [freshDeployer.target, 'latest']);
        expect(nonceBefore).to.be.equal('0x2');

        const newContractReceipt = await freshDeployer.deployViaCreate();
        await newContractReceipt.wait();

        const nonceAfter = await client.call(METHOD_NAME, [freshDeployer.target, 'latest']);
        expect(nonceAfter).to.be.equal('0x3');
      });
    });
  }
});
