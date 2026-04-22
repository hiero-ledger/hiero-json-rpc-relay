// SPDX-License-Identifier: Apache-2.0

import { expect } from 'chai';
import { ethers } from 'ethers';

import { ConfigService } from '../../src/config-service/services';
import MirrorClient from '../server/clients/mirrorClient';
import RelayClient from '../server/clients/relayClient';
import storageContractJson from '../server/contracts/Storage.json';
import { Utils } from '../server/helpers/utils';
import { AliasAccount } from '../server/types/AliasAccount';
import { ALL_PROTOCOL_CLIENTS } from './helpers/protocolClient';

describe('@release @protocol-acceptance eth_getStorageAt', async function () {
  this.timeout(240 * 1000);
  const METHOD_NAME = 'eth_getStorageAt';
  const STORAGE_CONTRACT_UPDATE = '0x2de4e884';
  const CHAIN_ID = ConfigService.get('CHAIN_ID');

  const FAKE_TX_HASH = `0x${'00'.repeat(20)}`;
  const INVALID_PARAMS: any[][] = [
    [],
    ['', ''],
    ['', '0x0'],
    [FAKE_TX_HASH],
    [FAKE_TX_HASH, ''],
    [FAKE_TX_HASH, 36, 'latest'],
    [FAKE_TX_HASH, '0xhbar', 'latest'],
  ];

  // @notice: The simple contract artifacts (ABI & bytecode) below simply has one state at position 0, which will be assigned to the number `7` within the consutrctor after deployment
  const SIMPLE_CONTRACT_ABI = [
    {
      inputs: [],
      stateMutability: 'nonpayable',
      type: 'constructor',
    },
  ];
  const SIMPLE_CONTRACT_BYTECODE =
    '0x6080604052348015600f57600080fd5b506007600081905550603f8060256000396000f3fe6080604052600080fdfea2646970667358221220416347bd1607cf1f0e7ec93afab3d5fe283173dd5e6ce3928dce940edd5c1fb564736f6c63430008180033';
  const SIMPLE_CONTRACT_EXPECTED_VALUE = 7;

  // @ts-ignore
  const {
    mirrorNode,
    relay,
    initialBalance,
  }: { mirrorNode: MirrorClient; relay: RelayClient; initialBalance: string } = global;

  const accounts: AliasAccount[] = [];
  let simpleContractParams: any[];
  let storageContract: ethers.Contract;
  let storageContractAddress: string;

  before(async () => {
    accounts.push(...(await Utils.createMultipleAliasAccounts(mirrorNode, global.accounts[0], 2, initialBalance)));
    global.accounts.push(...accounts);

    const simpleContractFactory = new ethers.ContractFactory(
      SIMPLE_CONTRACT_ABI,
      SIMPLE_CONTRACT_BYTECODE,
      accounts[0].wallet,
    );
    const simpleContract = await simpleContractFactory.deploy();
    await simpleContract.waitForDeployment();
    simpleContractParams = [simpleContract.target, '0x0', 'latest'];
  });

  beforeEach(async () => {
    storageContract = await Utils.deployContract(
      storageContractJson.abi,
      storageContractJson.bytecode,
      accounts[0].wallet,
    );
    storageContractAddress = storageContract.target as string;
  });

  after(async () => {
    if (global?.socketServer) {
      expect(global.socketServer._connections).to.eq(0);
    }
  });

  for (const client of ALL_PROTOCOL_CLIENTS) {
    describe(client.label, () => {
      it('@release Should execute eth_getStorageAt and handle valid requests correctly', async () => {
        const result = (await client.call(METHOD_NAME, simpleContractParams)) as string;
        expect(parseInt(result)).to.eq(SIMPLE_CONTRACT_EXPECTED_VALUE);
      });

      it('should execute "eth_getStorageAt" request to get current state changes', async () => {
        const BEGIN_EXPECTED_STORAGE_VAL = '0x000000000000000000000000000000000000000000000000000000000000000f';
        const END_EXPECTED_STORAGE_VAL = '0x0000000000000000000000000000000000000000000000000000000000000008';

        const beginStorageVal = (await client.call(METHOD_NAME, [
          storageContractAddress,
          '0x0000000000000000000000000000000000000000000000000000000000000000',
          'latest',
        ])) as string;
        expect(beginStorageVal).to.eq(BEGIN_EXPECTED_STORAGE_VAL);

        const gasPrice = await relay.gasPrice();
        const transaction = {
          value: 0,
          gasLimit: 50000,
          chainId: Number(CHAIN_ID),
          to: storageContractAddress,
          nonce: await relay.getAccountNonce(accounts[1].address),
          gasPrice: gasPrice,
          data: STORAGE_CONTRACT_UPDATE,
          maxPriorityFeePerGas: gasPrice,
          maxFeePerGas: gasPrice,
          type: 2,
        };

        const signedTx = await accounts[1].wallet.signTransaction(transaction);
        const transactionHash = await relay.sendRawTransaction(signedTx);
        await relay.pollForValidTransactionReceipt(transactionHash);

        const storageVal = (await client.call(METHOD_NAME, [
          storageContractAddress,
          '0x0000000000000000000000000000000000000000000000000000000000000000',
          'latest',
        ])) as string;
        expect(storageVal).to.eq(END_EXPECTED_STORAGE_VAL);
      });

      it('should execute "eth_getStorageAt" request to get old state with passing specific block', async () => {
        const END_EXPECTED_STORAGE_VAL = '0x0000000000000000000000000000000000000000000000000000000000000008';

        const beginStorageVal = (await client.call(METHOD_NAME, [
          storageContractAddress,
          '0x0000000000000000000000000000000000000000000000000000000000000000',
          'latest',
        ])) as string;

        const gasPrice = await relay.gasPrice();
        const transaction = {
          value: 0,
          gasLimit: 50000,
          chainId: Number(CHAIN_ID),
          to: storageContractAddress,
          nonce: await relay.getAccountNonce(accounts[1].address),
          gasPrice: gasPrice,
          data: STORAGE_CONTRACT_UPDATE,
          maxPriorityFeePerGas: gasPrice,
          maxFeePerGas: gasPrice,
          type: 2,
        };

        const signedTx = await accounts[1].wallet.signTransaction(transaction);
        const transactionHash = await relay.sendRawTransaction(signedTx);
        const txReceipt = await relay.pollForValidTransactionReceipt(transactionHash);
        const blockNumber = txReceipt.blockNumber;

        // wait for the transaction to propogate to mirror node
        await new Promise((r) => setTimeout(r, 4000));

        const latestStorageVal = (await client.call(METHOD_NAME, [
          storageContractAddress,
          '0x0000000000000000000000000000000000000000000000000000000000000000',
          'latest',
        ])) as string;
        const blockNumberBeforeChange = `0x${(blockNumber - 1).toString(16)}`;
        const storageValBeforeChange = (await client.call(METHOD_NAME, [
          storageContractAddress,
          '0x0000000000000000000000000000000000000000000000000000000000000000',
          blockNumberBeforeChange,
        ])) as string;

        expect(latestStorageVal).to.eq(END_EXPECTED_STORAGE_VAL);
        expect(storageValBeforeChange).to.eq(beginStorageVal);
      });

      it('should execute "eth_getStorageAt" request to get current state changes with passing specific block', async () => {
        const EXPECTED_STORAGE_VAL = '0x0000000000000000000000000000000000000000000000000000000000000008';

        const gasPrice = await relay.gasPrice();
        const transaction = {
          value: 0,
          gasLimit: 50000,
          chainId: Number(CHAIN_ID),
          to: storageContractAddress,
          nonce: await relay.getAccountNonce(accounts[1].address),
          gasPrice: gasPrice,
          data: STORAGE_CONTRACT_UPDATE,
          maxPriorityFeePerGas: gasPrice,
          maxFeePerGas: gasPrice,
          type: 2,
        };

        const signedTx = await accounts[1].wallet.signTransaction(transaction);
        const transactionHash = await relay.sendRawTransaction(signedTx);
        const txReceipt = await relay.pollForValidTransactionReceipt(transactionHash);

        const blockNumber = txReceipt.blockNumber;
        const transaction1 = {
          ...transaction,
          nonce: await relay.getAccountNonce(accounts[1].address),
          data: STORAGE_CONTRACT_UPDATE,
        };

        const signedTx1 = await accounts[1].wallet.signTransaction(transaction1);
        const transactionHash1 = await relay.sendRawTransaction(signedTx1);
        await relay.pollForValidTransactionReceipt(transactionHash1);

        // Get previous state change with specific block number
        const storageVal = (await client.call(METHOD_NAME, [
          storageContractAddress,
          '0x0000000000000000000000000000000000000000000000000000000000000000',
          blockNumber,
        ])) as string;
        expect(storageVal).to.eq(EXPECTED_STORAGE_VAL);
      });

      it('should execute "eth_getStorageAt" request to get current state changes with passing specific block hash', async () => {
        const EXPECTED_STORAGE_VAL = '0x0000000000000000000000000000000000000000000000000000000000000008';

        const gasPrice = await relay.gasPrice();
        const transaction = {
          value: 0,
          gasLimit: 50000,
          chainId: Number(CHAIN_ID),
          to: storageContractAddress,
          nonce: await relay.getAccountNonce(accounts[1].address),
          gasPrice: gasPrice,
          data: STORAGE_CONTRACT_UPDATE,
          maxPriorityFeePerGas: gasPrice,
          maxFeePerGas: gasPrice,
          type: 2,
        };

        const signedTx = await accounts[1].wallet.signTransaction(transaction);
        const transactionHash = await relay.sendRawTransaction(signedTx);
        const txReceipt = await relay.pollForValidTransactionReceipt(transactionHash);

        const blockHash = txReceipt.blockHash;

        const transaction1 = {
          ...transaction,
          nonce: await relay.getAccountNonce(accounts[1].address),
          data: STORAGE_CONTRACT_UPDATE,
        };

        const signedTx1 = await accounts[1].wallet.signTransaction(transaction1);
        const transactionHash1 = await relay.sendRawTransaction(signedTx1);
        await relay.pollForValidTransactionReceipt(transactionHash1);

        // Get previous state change with specific block number
        const storageVal = (await client.call(METHOD_NAME, [
          storageContractAddress,
          '0x0000000000000000000000000000000000000000000000000000000000000000',
          blockHash,
        ])) as string;
        expect(storageVal).to.eq(EXPECTED_STORAGE_VAL);
      });

      it('should execute "eth_getStorageAt" request against an inactive address (contains no data) and receive a 32-byte-zero-hex string ', async () => {
        const hexString = ethers.ZeroHash;
        const inactiveAddress = ethers.Wallet.createRandom();

        const storageVal = (await client.call(METHOD_NAME, [inactiveAddress.address, '0x0', 'latest'])) as string;

        expect(storageVal).to.eq(hexString);
      });

      for (const params of INVALID_PARAMS) {
        it(`Should fail eth_getStorageAt and throw INVALID_PARAMETERS if the request's params variable is invalid. params=[${params}]`, async () => {
          const response = await client.callRaw(METHOD_NAME, params);
          expect(response.error).to.exist;
          expect(response.error!.code).to.be.oneOf([-32000, -32602, -32603]);
        });
      }
    });
  }
});
