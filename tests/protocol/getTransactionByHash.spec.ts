// SPDX-License-Identifier: Apache-2.0

import { expect } from 'chai';
import { ethers } from 'ethers';

import { ConfigService } from '../../src/config-service/services';
import { numberTo0x } from '../../src/relay/formatters';
import { GAS_LIMIT, ONE_TINYBAR_IN_WEI_HEX } from '../relay/lib/eth/eth-config';
import MirrorClient from '../server/clients/mirrorClient';
import RelayClient from '../server/clients/relayClient';
import DeployerContractJson from '../server/contracts/Deployer.json';
import parentContractJson from '../server/contracts/Parent.json';
import Assertions from '../server/helpers/assertions';
import Address from '../server/helpers/constants';
import { Utils } from '../server/helpers/utils';
import { AliasAccount } from '../server/types/AliasAccount';
import { ALL_PROTOCOL_CLIENTS } from './helpers/protocolClient';

describe('@release @protocol-acceptance eth_getTransactionByHash', async function () {
  this.timeout(240 * 1000);
  const METHOD_NAME = 'eth_getTransactionByHash';
  const CHAIN_ID = ConfigService.get('CHAIN_ID');

  const FAKE_TX_HASH = `0x${'00'.repeat(20)}`;
  const INVALID_PARAMS: any[][] = [
    [],
    [''],
    [66],
    [39],
    [true],
    ['abc'],
    ['0xhbar'],
    ['txHash'],
    ['0xHedera'],
    [FAKE_TX_HASH, 'hbar'],
    [FAKE_TX_HASH, 'rpc', 'invalid'],
  ];

  // @ts-ignore
  const {
    mirrorNode,
    relay,
    initialBalance,
  }: { mirrorNode: MirrorClient; relay: RelayClient; initialBalance: string } = global;

  const accounts: AliasAccount[] = [];
  let parentContractAddress: string;
  let simpleTxHash: string;
  let simpleTxMirror: any;
  let deployerContract: ethers.Contract;
  let deployerContractAddress: string;
  let deployerDefaultTxFields: any;

  before(async () => {
    accounts.push(...(await Utils.createMultipleAliasAccounts(mirrorNode, global.accounts[0], 2, initialBalance)));
    global.accounts.push(...accounts);

    const parentContract = await Utils.deployContract(
      parentContractJson.abi,
      parentContractJson.bytecode,
      accounts[0].wallet,
    );
    parentContractAddress = parentContract.target as string;

    const simpleTx = {
      value: ONE_TINYBAR_IN_WEI_HEX,
      gasLimit: numberTo0x(30000),
      chainId: Number(CHAIN_ID),
      to: accounts[1].address,
      nonce: await relay.getAccountNonce(accounts[0].address),
      maxFeePerGas: await relay.gasPrice(),
    };
    const signedSimpleTx = await accounts[0].wallet.signTransaction(simpleTx);
    simpleTxHash = await relay.sendRawTransaction(signedSimpleTx);
    simpleTxMirror = await mirrorNode.get(`/contracts/results/${simpleTxHash}`);

    deployerContract = await Utils.deployContract(
      DeployerContractJson.abi,
      DeployerContractJson.bytecode,
      accounts[0].wallet,
    );
    deployerContractAddress = (deployerContract.target as string).toLowerCase();

    const defaultGasPrice = await relay.gasPrice();
    deployerDefaultTxFields = {
      to: null,
      from: accounts[0].address,
      gasPrice: defaultGasPrice,
      chainId: Number(CHAIN_ID),
      gasLimit: GAS_LIMIT,
      type: 2,
      maxFeePerGas: defaultGasPrice,
      maxPriorityFeePerGas: defaultGasPrice,
    };
  });

  after(async () => {
    if (global?.socketServer) {
      expect(global.socketServer._connections).to.eq(0);
    }
  });

  for (const client of ALL_PROTOCOL_CLIENTS) {
    describe(client.label, () => {
      it('@release Should execute eth_getTransactionByHash and handle valid requests correctly', async () => {
        const txReceipt = (await client.call(METHOD_NAME, [simpleTxHash])) as any;
        expect(txReceipt.from).to.be.eq(accounts[0].address.toLowerCase());
        expect(txReceipt.to).to.be.eq(accounts[1].address.toLowerCase());
        expect(txReceipt.blockHash).to.be.eq(simpleTxMirror.block_hash.slice(0, 66));
        expect(txReceipt.hash).to.be.eq(simpleTxMirror.hash);
        // Must convert to quantity to compare and remove leading zeros
        expect(txReceipt.r).to.be.eq(ethers.toQuantity(simpleTxMirror.r));
        expect(txReceipt.s).to.be.eq(ethers.toQuantity(simpleTxMirror.s));
        expect(Number(txReceipt.v)).to.be.eq(simpleTxMirror.v);
      });

      it('@release should execute "eth_getTransactionByHash" for existing transaction', async () => {
        const gasPrice = await relay.gasPrice();
        const transaction = {
          value: Number(ONE_TINYBAR_IN_WEI_HEX),
          chainId: Number(CHAIN_ID),
          maxPriorityFeePerGas: gasPrice,
          maxFeePerGas: gasPrice,
          gasLimit: 3_000_000,
          type: 2,
          to: parentContractAddress,
          nonce: await relay.getAccountNonce(accounts[1].address),
        };
        const signedTx = await accounts[1].wallet.signTransaction(transaction);
        const transactionHash = await relay.sendRawTransaction(signedTx);
        const mirrorTransaction = await mirrorNode.get(`/contracts/results/${transactionHash}`);

        const res = (await client.call(METHOD_NAME, [transactionHash])) as any;
        const addressResult = await mirrorNode.get(`/accounts/${res.from}`);
        mirrorTransaction.from = addressResult.evm_address;

        Assertions.transaction(res, mirrorTransaction);
      });

      it('should execute "eth_getTransactionByHash" for non-existing transaction and return null', async () => {
        const res = await client.call(METHOD_NAME, [Address.NON_EXISTING_TX_HASH]);
        expect(res).to.be.null;
      });

      it('@release getTransactionByHash should return null for to for reverted contract creation', async () => {
        // the data below is actually disassembled opcodes
        // containing revert as well
        const dataToRevert = '0x600160015560006000fd';
        const gasPrice = await relay.gasPrice();
        const transaction = {
          value: Number(ONE_TINYBAR_IN_WEI_HEX),
          chainId: Number(CHAIN_ID),
          maxPriorityFeePerGas: gasPrice,
          maxFeePerGas: gasPrice,
          gasLimit: 3_000_000,
          type: 2,
          to: null,
          data: dataToRevert,
          nonce: await relay.getAccountNonce(accounts[1].address),
        };
        const signedTx = await accounts[1].wallet.signTransaction(transaction);
        const transactionHash = await relay.sendRawTransaction(signedTx);

        // wait for tx receipt
        await relay.pollForValidTransactionReceipt(transactionHash);
        const res = (await client.call(METHOD_NAME, [transactionHash])) as any;

        expect(res.to).to.be.null;
      });

      it('should return to = null for contract deployment tx', async () => {
        const { hash } = deployerContract.deploymentTransaction()!;

        const res = (await client.call(METHOD_NAME, [hash])) as any;
        expect(res.to).to.be.null;
      });

      it('should return to = target contract for a transaction that executes CREATE', async () => {
        const transactionHash = await relay.sendRawTransaction(
          await accounts[0].wallet.signTransaction({
            ...deployerDefaultTxFields,
            to: deployerContractAddress,
            nonce: await relay.getAccountNonce(accounts[0].address),
            data: '0x6e6662b9', // deployViaCreate() selector
          }),
        );
        await relay.pollForValidTransactionReceipt(transactionHash);

        const res = (await client.call(METHOD_NAME, [transactionHash])) as any;
        expect(res.to).to.equal(deployerContractAddress);
      });

      it('should return to = target contract for a transaction that executes CREATE2', async () => {
        const transactionHash = await relay.sendRawTransaction(
          await accounts[0].wallet.signTransaction({
            ...deployerDefaultTxFields,
            to: deployerContractAddress,
            nonce: await relay.getAccountNonce(accounts[0].address),
            data: '0xdbb6f04a', // deployViaCreate2()
          }),
        );
        await relay.pollForValidTransactionReceipt(transactionHash);

        const res = (await client.call(METHOD_NAME, [transactionHash])) as any;
        expect(res.to).to.equal(deployerContractAddress);
      });

      for (const params of INVALID_PARAMS) {
        it(`Should fail eth_getTransactionByHash and throw INVALID_PARAMETERS if the request's params variable is invalid. params=[${params}]`, async () => {
          const response = await client.callRaw(METHOD_NAME, params);
          expect(response.error).to.exist;
          expect(response.error!.code).to.be.oneOf([-32000, -32602, -32603]);
        });
      }
    });
  }
});
