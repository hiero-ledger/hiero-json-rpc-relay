// SPDX-License-Identifier: Apache-2.0

import { ContractId, Hbar, HbarUnit } from '@hashgraph/sdk';
import { expect } from 'chai';
import { ethers } from 'ethers';

import { ConfigService } from '../../src/config-service/services';
import { numberTo0x } from '../../src/relay/formatters';
import { overrideEnvsInMochaDescribe } from '../relay/helpers';
import MirrorClient from '../server/clients/mirrorClient';
import RelayClient from '../server/clients/relayClient';
import parentContractJson from '../server/contracts/Parent.json';
import constants from '../server/helpers/constants';
import Address from '../server/helpers/constants';
import RelayCalls from '../server/helpers/constants';
import { Utils } from '../server/helpers/utils';
import { AliasAccount } from '../server/types/AliasAccount';
import { ALL_PROTOCOL_CLIENTS } from './helpers/protocolClient';

describe('@release @protocol-acceptance eth_getBalance', async function () {
  this.timeout(240 * 1000);
  const METHOD_NAME = 'eth_getBalance';

  // FAKE_TX_HASH is 20 bytes of zeros (address-shaped) — preserved from the former
  // tests/ws-server/acceptance/getBalance.spec.ts INVALID_PARAMS block.
  const FAKE_TX_HASH = `0x${'00'.repeat(20)}`;
  const INVALID_PARAMS: any[][] = [
    [],
    [false],
    [FAKE_TX_HASH],
    ['0xhbar', 'latest'],
    ['0xhedera', 'latest'],
    [FAKE_TX_HASH, true, 39],
    [FAKE_TX_HASH, '0xhedera'],
    [FAKE_TX_HASH, '0xhbar', 36],
  ];

  const CHAIN_ID = ConfigService.get('CHAIN_ID');
  const ONE_TINYBAR = Utils.add0xPrefix(Utils.toHex(ethers.parseUnits('1', 10)));
  const ONE_WEIBAR = Utils.add0xPrefix(Utils.toHex(ethers.parseUnits('1', 18)));

  // @ts-ignore
  const { mirrorNode, relay }: { mirrorNode: MirrorClient; relay: RelayClient } = global;

  const accounts: AliasAccount[] = [];
  let getBalanceContractAddress: string;
  let blockNumAfterCreateChildTx = 0;
  let accounts0StartBalance: bigint;

  const signSendAndConfirmTransaction = async (transaction: any, account: AliasAccount) => {
    const signedTx = await account.wallet.signTransaction(transaction);
    const txHash = await relay.sendRawTransaction(signedTx);
    await mirrorNode.get(`/contracts/results/${txHash}`);
    await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_GET_TRANSACTION_BY_HASH, [txHash]);
    await new Promise((r) => setTimeout(r, 2000));
  };

  before(async () => {
    accounts.push(...(await Utils.createMultipleAliasAccounts(mirrorNode, global.accounts[0], 4, '2500000000')));
    global.accounts.push(...accounts);

    const activityContract = await Utils.deployContract(
      parentContractJson.abi,
      parentContractJson.bytecode,
      accounts[0].wallet,
    );

    const activityFundsTx = await accounts[0].wallet.sendTransaction({
      to: activityContract.target as string,
      value: ethers.parseEther('1'),
    });
    await relay.pollForValidTransactionReceipt(activityFundsTx.hash);

    const createChildTx = await (activityContract as any).createChild(1);
    const createChildTxReceipt = await relay.pollForValidTransactionReceipt(createChildTx.hash);

    const blockNumBeforeCreateChildTx = parseInt(createChildTxReceipt.blockNumber, 16);
    blockNumAfterCreateChildTx = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_BLOCK_NUMBER, []);

    // Note: There is currently a caching solution for eth_blockNumber that stores the block number.
    // This loop is designed to poll for the latest block number until it is correctly updated.
    for (let i = 0; i < 5; i++) {
      blockNumAfterCreateChildTx = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_BLOCK_NUMBER, []);
      if (blockNumAfterCreateChildTx > blockNumBeforeCreateChildTx) break;
      await Utils.wait(1500);
    }

    accounts0StartBalance = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_GET_BALANCE, [accounts[0].address, 'latest']);

    const balanceContract = await Utils.deployContract(
      parentContractJson.abi,
      parentContractJson.bytecode,
      accounts[0].wallet,
    );
    getBalanceContractAddress = balanceContract.target as string;

    const balanceFundsTx = await accounts[0].wallet.sendTransaction({
      to: getBalanceContractAddress,
      value: ethers.parseEther('1'),
    });
    await relay.pollForValidTransactionReceipt(balanceFundsTx.hash);
  });

  after(async () => {
    if (global?.socketServer) {
      expect(global.socketServer._connections).to.eq(0);
    }
  });

  overrideEnvsInMochaDescribe({
    MIRROR_NODE_LIMIT_PARAM: 100,
  });

  for (const client of ALL_PROTOCOL_CLIENTS) {
    describe(client.label, () => {
      it('@release should execute "eth_getBalance" for newly created account with 1 HBAR', async () => {
        let balance = Hbar.from(1, HbarUnit.Hbar).toTinybars().toString();
        const newAccount = await Utils.createAliasAccount(mirrorNode, accounts[0], balance);
        const res = (await client.call(METHOD_NAME, [newAccount.address, 'latest'])) as string;
        balance = `0x${(BigInt(balance) * BigInt(constants.TINYBAR_TO_WEIBAR_COEF)).toString(16)}`;
        expect(res).to.be.eq(balance);
      });

      it('should execute "eth_getBalance" for non-existing address', async () => {
        const res = (await client.call(METHOD_NAME, [Address.NON_EXISTING_ADDRESS, 'latest'])) as string;
        expect(res).to.eq('0x0');
      });

      it('@release-light, @release should execute "eth_getBalance" for contract', async () => {
        const res = (await client.call(METHOD_NAME, [getBalanceContractAddress, 'latest'])) as string;
        expect(res).to.eq(ethers.toQuantity(ONE_WEIBAR));
      });

      it('@release should execute "eth_getBalance" for contract with id converted to evm_address', async () => {
        const mirrorNodeContractRes = await mirrorNode.get(`/contracts/${getBalanceContractAddress}`);
        const contractId = ContractId.fromString(mirrorNodeContractRes.contract_id);
        const res = (await client.call(METHOD_NAME, [`0x${contractId.toEvmAddress()}`, 'latest'])) as string;
        expect(res).to.eq(ethers.toQuantity(ONE_WEIBAR));
      });

      it('@release should execute "eth_getBalance" with latest block number', async () => {
        const latestBlock = (await mirrorNode.get(`/blocks?limit=1&order=desc`)).blocks[0];
        const res = (await client.call(METHOD_NAME, [
          getBalanceContractAddress,
          numberTo0x(latestBlock.number),
        ])) as string;
        expect(res).to.eq(ethers.toQuantity(ONE_WEIBAR));
      });

      it('@release should execute "eth_getBalance" with one block behind latest block number', async () => {
        const latestBlock = (await mirrorNode.get(`/blocks?limit=1&order=desc`)).blocks[0];
        const res = (await client.call(METHOD_NAME, [
          getBalanceContractAddress,
          numberTo0x(latestBlock.number - 1),
        ])) as string;
        expect(res).to.eq(ethers.toQuantity(ONE_WEIBAR));
      });

      it('@release should execute "eth_getBalance" with latest block hash', async () => {
        const latestBlock = (await mirrorNode.get(`/blocks?limit=1&order=desc`)).blocks[0];
        const res = (await client.call(METHOD_NAME, [
          getBalanceContractAddress,
          numberTo0x(latestBlock.number),
        ])) as string;
        expect(res).to.eq(ethers.toQuantity(ONE_WEIBAR));
      });

      it('@release should execute "eth_getBalance" with pending', async () => {
        const res = (await client.call(METHOD_NAME, [getBalanceContractAddress, 'pending'])) as string;
        expect(res).to.eq(ethers.toQuantity(ONE_WEIBAR));
      });

      it('@release should execute "eth_getBalance" with block number in the last 15 minutes', async () => {
        const latestBlock = (await mirrorNode.get(`/blocks?limit=1&order=desc`)).blocks[0];
        const earlierBlockNumber = latestBlock.number - 2;
        const res = (await client.call(METHOD_NAME, [
          getBalanceContractAddress,
          numberTo0x(earlierBlockNumber),
        ])) as string;
        expect(res).to.eq(ethers.toQuantity(ONE_WEIBAR));
      });

      it('@release should execute "eth_getBalance" with block number in the last 15 minutes for account that has performed contract deploys/calls', async () => {
        const res = (await client.call(METHOD_NAME, [accounts[0].address, blockNumAfterCreateChildTx])) as string;
        expect(res).to.eq(accounts0StartBalance);
      });

      it('@release should correctly execute "eth_getBalance" with block number in the last 15 minutes with several txs around that time', async () => {
        const initialBalance = (await client.call(METHOD_NAME, [accounts[0].address, 'latest'])) as string;
        const acc3Nonce = await relay.getAccountNonce(accounts[3].address);
        const gasPrice = await relay.gasPrice();

        const transaction = {
          value: ONE_TINYBAR,
          gasLimit: 50000,
          chainId: Number(CHAIN_ID),
          to: accounts[0].wallet.address,
          nonce: acc3Nonce,
          maxPriorityFeePerGas: gasPrice,
          maxFeePerGas: gasPrice,
        };

        await signSendAndConfirmTransaction(transaction, accounts[3]);

        const blockNumber = (await client.call(RelayCalls.ETH_ENDPOINTS.ETH_BLOCK_NUMBER, [])) as string;

        await signSendAndConfirmTransaction({ ...transaction, nonce: acc3Nonce + 1 }, accounts[3]);

        const endBalance = (await client.call(METHOD_NAME, [accounts[0].address, 'latest'])) as string;

        // initialBalance + sum of value of all transactions
        const manuallyCalculatedBalance = BigInt(initialBalance) + BigInt(ONE_TINYBAR) * BigInt(2);
        expect(BigInt(endBalance).toString()).to.eq(manuallyCalculatedBalance.toString());

        // Balance at the block number of tx1 should be initialBalance + the value of tx1
        const balanceAtTx1Block = (await client.call(METHOD_NAME, [accounts[0].address, blockNumber])) as string;
        const manuallyCalculatedBalanceAtTx1Block = BigInt(initialBalance) + BigInt(ONE_TINYBAR);
        expect(BigInt(balanceAtTx1Block).toString()).to.eq(manuallyCalculatedBalanceAtTx1Block.toString());
      });

      it('should return an error when the second parameter is missing in eth_getBalance', async () => {
        const response = await client.callRaw(METHOD_NAME, [Address.NON_EXISTING_ADDRESS]);
        expect(response.error).to.exist;
        expect(response.error!.message).to.include('Missing value for required parameter');
      });

      it('should return an error when null is provided as the second parameter in eth_getBalance', async () => {
        const response = await client.callRaw(METHOD_NAME, [Address.NON_EXISTING_ADDRESS, null]);
        expect(response.error).to.exist;
        expect(response.error!.message).to.include('Invalid parameter 1: The value passed is not valid: null.');
      });

      for (const params of INVALID_PARAMS) {
        it(`Should fail eth_getBalance and throw INVALID_PARAMETERS if the request's params variable is invalid. params=[${params}]`, async () => {
          const response = await client.callRaw(METHOD_NAME, params);
          expect(response.error).to.exist;
          expect(response.error!.code).to.be.oneOf([-32000, -32602, -32603]);
        });
      }
    });
  }
});
