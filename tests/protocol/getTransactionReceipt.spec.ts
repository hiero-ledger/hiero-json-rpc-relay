// SPDX-License-Identifier: Apache-2.0

import { expect } from 'chai';

import { ConfigService } from '../../src/config-service/services';
import { predefined } from '../../src/relay';
import { numberTo0x } from '../../src/relay/formatters';
import { ONE_TINYBAR_IN_WEI_HEX } from '../relay/lib/eth/eth-config';
import MirrorClient from '../server/clients/mirrorClient';
import RelayClient from '../server/clients/relayClient';
import basicContractJson from '../server/contracts/Basic.json';
import parentContractJson from '../server/contracts/Parent.json';
import Assertions, { computeExpectedCumulativeGasUsed } from '../server/helpers/assertions';
import Address from '../server/helpers/constants';
import { Utils } from '../server/helpers/utils';
import { AliasAccount } from '../server/types/AliasAccount';
import { ALL_PROTOCOL_CLIENTS } from './helpers/protocolClient';

describe('@release @protocol-acceptance eth_getTransactionReceipt', async function () {
  this.timeout(240 * 1000);
  const METHOD_NAME = 'eth_getTransactionReceipt';
  const CHAIN_ID = ConfigService.get('CHAIN_ID');
  const gasPriceDeviation = ConfigService.get('TEST_GAS_PRICE_DEVIATION');

  const FAKE_TX_HASH = `0x${'00'.repeat(20)}`;
  const INVALID_PARAMS: any[][] = [
    [],
    [''],
    [39],
    [63],
    [true],
    ['abc'],
    [false],
    ['0xhbar'],
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
  let txHash: string;
  let expectedTxReceipt: any;
  let parentContractAddress: string;

  const defaultGasPrice = numberTo0x(Assertions.defaultGasPrice);
  const defaultGasLimit = numberTo0x(3_000_000);

  const default155TransactionData = {
    value: ONE_TINYBAR_IN_WEI_HEX,
    gasPrice: defaultGasPrice,
    gasLimit: defaultGasLimit,
    chainId: Number(CHAIN_ID),
  };

  const defaultLondonTransactionData = {
    value: ONE_TINYBAR_IN_WEI_HEX,
    chainId: Number(CHAIN_ID),
    maxPriorityFeePerGas: defaultGasPrice,
    maxFeePerGas: defaultGasPrice,
    gasLimit: defaultGasLimit,
    type: 2,
  };

  const defaultLegacy2930TransactionData = {
    value: ONE_TINYBAR_IN_WEI_HEX,
    chainId: Number(CHAIN_ID),
    gasPrice: defaultGasPrice,
    gasLimit: defaultGasLimit,
    type: 1,
  };

  async function getGasWithDeviation(): Promise<number> {
    const gasPrice = await relay.gasPrice();
    return gasPrice * (1 + gasPriceDeviation);
  }

  before(async () => {
    accounts.push(...(await Utils.createMultipleAliasAccounts(mirrorNode, global.accounts[0], 3, initialBalance)));
    global.accounts.push(...accounts);

    const parentContract = await Utils.deployContract(
      parentContractJson.abi,
      parentContractJson.bytecode,
      accounts[0].wallet,
    );
    parentContractAddress = parentContract.target as string;

    // Pre-send a simple transfer for the happy-path receipt assertions
    const tx = {
      value: ONE_TINYBAR_IN_WEI_HEX,
      gasLimit: numberTo0x(30000),
      chainId: Number(CHAIN_ID),
      to: accounts[1].address,
      nonce: await relay.getAccountNonce(accounts[0].address),
      maxFeePerGas: await relay.gasPrice(),
    };
    const signedTx = await accounts[0].wallet.signTransaction(tx);
    txHash = await relay.sendRawTransaction(signedTx);
    expectedTxReceipt = await mirrorNode.get(`/contracts/results/${txHash}`);
  });

  after(async () => {
    if (global?.socketServer) {
      expect(global.socketServer._connections).to.eq(0);
    }
  });

  for (const client of ALL_PROTOCOL_CLIENTS) {
    describe(client.label, () => {
      it('@release Should execute eth_getTransactionReceipt and handle valid requests correctly', async () => {
        const txReceipt = (await client.call(METHOD_NAME, [txHash])) as any;
        expect(txReceipt.to).to.be.eq(accounts[1].address.toLowerCase());
        expect(txReceipt.from).to.be.eq(accounts[0].address.toLowerCase());
        expect(txReceipt.transactionHash).to.be.eq(expectedTxReceipt.hash);
        expect(txReceipt.contractAddress).to.be.eq(expectedTxReceipt.address);
        expect(txReceipt.blockHash).to.be.eq(expectedTxReceipt.block_hash.slice(0, 66));
        expect(Number(txReceipt.transactionIndex)).to.be.eq(expectedTxReceipt.transaction_index);
      });

      it('@release-light, @release should execute "eth_getTransactionReceipt" for hash of legacy transaction', async () => {
        const gasPriceWithDeviation = await getGasWithDeviation();
        const transaction = {
          ...default155TransactionData,
          to: parentContractAddress,
          nonce: await relay.getAccountNonce(accounts[2].address),
          gasPrice: gasPriceWithDeviation,
          type: 0,
        };

        const signedTx = await accounts[2].wallet.signTransaction(transaction);
        const legacyTxHash = await relay.sendRawTransaction(signedTx);
        const mirrorResult = await mirrorNode.get(`/contracts/results/${legacyTxHash}`);
        mirrorResult.from = accounts[2].wallet.address;
        mirrorResult.to = parentContractAddress;

        const res = (await client.call(METHOD_NAME, [legacyTxHash])) as any;
        const currentPrice = await relay.gasPrice();
        const expectedCumulativeGasUsed = await computeExpectedCumulativeGasUsed(mirrorNode, mirrorResult);

        Assertions.transactionReceipt(res, mirrorResult, currentPrice, expectedCumulativeGasUsed);
      });

      it('@release-light, @release should execute "eth_getTransactionReceipt" for hash of London transaction', async () => {
        const gasPriceWithDeviation = await getGasWithDeviation();
        const transaction = {
          ...defaultLondonTransactionData,
          to: parentContractAddress,
          nonce: await relay.getAccountNonce(accounts[2].address),
          maxFeePerGas: gasPriceWithDeviation,
          maxPriorityFeePerGas: gasPriceWithDeviation,
        };

        const signedTx = await accounts[2].wallet.signTransaction(transaction);
        const transactionHash = await relay.sendRawTransaction(signedTx);
        const mirrorResult = await mirrorNode.get(`/contracts/results/${transactionHash}`);
        mirrorResult.from = accounts[2].wallet.address;
        mirrorResult.to = parentContractAddress;

        const res = (await client.call(METHOD_NAME, [transactionHash])) as any;
        const currentPrice = await relay.gasPrice();
        const expectedCumulativeGasUsed = await computeExpectedCumulativeGasUsed(mirrorNode, mirrorResult);

        Assertions.transactionReceipt(res, mirrorResult, currentPrice, expectedCumulativeGasUsed);
      });

      it('@release-light, @release should execute "eth_getTransactionReceipt" for hash of 2930 transaction', async () => {
        const gasPriceWithDeviation = await getGasWithDeviation();

        // Use all 3 accounts so companion transactions have independent nonces and can be sent
        // simultaneously without ordering constraints. accounts[2] sends the test transaction.
        const signers = [accounts[0], accounts[1], accounts[2]];
        const nonces = await Promise.all(signers.map((a) => relay.getAccountNonce(a.address)));

        const signedTxs = await Promise.all(
          signers.map((signer, i) =>
            signer.wallet.signTransaction({
              ...defaultLegacy2930TransactionData,
              to: parentContractAddress,
              nonce: nonces[i],
              gasPrice: gasPriceWithDeviation,
            }),
          ),
        );

        const allHashes = await Promise.all(signedTxs.map((signed) => relay.sendRawTransaction(signed)));
        const transactionHash = allHashes[2]; // accounts[2] is the test subject

        await Promise.all(allHashes.map((h) => relay.pollForValidTransactionReceipt(h)));

        const mirrorResult = await mirrorNode.get(`/contracts/results/${transactionHash}`);
        mirrorResult.from = accounts[2].wallet.address;
        mirrorResult.to = parentContractAddress;

        const expectedCumulativeGasUsed = await computeExpectedCumulativeGasUsed(mirrorNode, mirrorResult);

        const res = (await client.call(METHOD_NAME, [transactionHash])) as any;
        const currentPrice = await relay.gasPrice();

        Assertions.transactionReceipt(res, mirrorResult, currentPrice, expectedCumulativeGasUsed);
      });

      it('should execute "eth_getTransactionReceipt" for non-existing hash', async () => {
        const res = await client.call(METHOD_NAME, [Address.NON_EXISTING_TX_HASH]);
        expect(res).to.be.null;
      });

      it('should execute "eth_getTransactionReceipt" and set "to" field to null for direct contract deployment', async () => {
        const basicContract = await Utils.deployContract(
          basicContractJson.abi,
          basicContractJson.bytecode,
          accounts[0].wallet,
        );

        const contractDeploymentTx = basicContract.deploymentTransaction();
        if (!contractDeploymentTx) {
          throw new Error('Deployment transaction is null');
        }
        await relay.pollForValidTransactionReceipt(contractDeploymentTx.hash);

        const contractDeploymentReceipt = (await client.call(METHOD_NAME, [contractDeploymentTx.hash])) as any;
        expect(contractDeploymentReceipt).to.exist;
        expect(contractDeploymentReceipt.contractAddress).to.not.be.null;
        expect(contractDeploymentReceipt.to).to.be.null;
      });

      it('@release should fail to execute "eth_getTransactionReceipt" for hash of London transaction', async () => {
        const gasPrice = await relay.gasPrice();
        const transaction = {
          ...defaultLondonTransactionData,
          to: parentContractAddress,
          nonce: await relay.getAccountNonce(accounts[2].address),
          maxFeePerGas: gasPrice,
          maxPriorityFeePerGas: gasPrice,
        };

        const signedTx = await accounts[2].wallet.signTransaction(transaction);
        const response = await client.callRaw('eth_sendRawTransaction', [signedTx + '11']);
        expect(response.error).to.exist;
        expect(response.error!.code).to.equal(predefined.INVALID_ARGUMENTS('unexpected junk after rlp payload').code);
      });

      for (const params of INVALID_PARAMS) {
        it(`Should fail eth_getTransactionReceipt and throw INVALID_PARAMETERS if the request's params variable is invalid. params=[${params}]`, async () => {
          const response = await client.callRaw(METHOD_NAME, params);
          expect(response.error).to.exist;
          expect(response.error!.code).to.be.oneOf([-32000, -32602, -32603]);
        });
      }
    });
  }
});
