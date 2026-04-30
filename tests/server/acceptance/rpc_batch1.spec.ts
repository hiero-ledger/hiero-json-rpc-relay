// SPDX-License-Identifier: Apache-2.0

// External resources
import { TransferTransaction } from '@hashgraph/sdk';
import { expect } from 'chai';
import { ethers } from 'ethers';

import { ConfigService } from '../../../src/config-service/services';
// Other imports
import { numberTo0x, prepend0x } from '../../../src/relay/formatters';
import Constants from '../../../src/relay/lib/constants';
// Errors and constants from local resources
import { predefined } from '../../../src/relay/lib/errors/JsonRpcError';
import { BLOCK_NUMBER_ERROR, HASH_ERROR } from '../../../src/relay/lib/validators';
import { overrideEnvsInMochaDescribe, withOverriddenEnvsInMochaTest } from '../../relay/helpers';
import MirrorClient from '../clients/mirrorClient';
import RelayClient from '../clients/relayClient';
import ServicesClient from '../clients/servicesClient';
import basicContract from '../contracts/Basic.json';
import basicContractJson from '../contracts/Basic.json';
// Local resources from contracts directory
import parentContractJson from '../contracts/Parent.json';
import reverterContractJson from '../contracts/Reverter.json';
// Assertions from local resources
import Assertions from '../helpers/assertions';
import RelayCalls from '../helpers/constants';
import { Utils } from '../helpers/utils';
import { AliasAccount } from '../types/AliasAccount';
import { MultiLogReceiptFixture } from './fixtures/multiLogReceiptFixture';

const Address = RelayCalls;

describe('@api-batch-1 RPC Server Acceptance Tests', function () {
  this.timeout(240 * 1000); // 240 seconds

  const accounts: AliasAccount[] = [];

  // @ts-ignore
  const {
    servicesNode,
    mirrorNode,
    relay,
    initialBalance,
  }: { servicesNode: ServicesClient; mirrorNode: MirrorClient; relay: RelayClient; initialBalance: string } = global;

  // cached entities
  let parentContractAddress: string;
  let mirrorContractDetails;
  let createChildTx: ethers.ContractTransactionResponse;
  let htsTokenId: any; // Shared HTS token for synthetic transaction tests
  const CHAIN_ID = ConfigService.get('CHAIN_ID');
  const requestId = 'rpc_batch1Test';
  const requestIdPrefix = Utils.formatRequestIdMessage(requestId);
  const ONE_TINYBAR = Utils.add0xPrefix(Utils.toHex(Constants.TINYBAR_TO_WEIBAR_COEF));
  const gasPriceDeviation = ConfigService.get('TEST_GAS_PRICE_DEVIATION');

  describe('RPC Server Acceptance Tests', function () {
    this.timeout(240 * 1000); // 240 seconds

    this.beforeAll(async () => {
      const initialAccount: AliasAccount = global.accounts[0];
      const neededAccounts: number = 4;
      accounts.push(
        ...(await Utils.createMultipleAliasAccounts(mirrorNode, initialAccount, neededAccounts, initialBalance)),
      );
      global.accounts.push(...accounts);

      const parentContract = await Utils.deployContract(
        parentContractJson.abi,
        parentContractJson.bytecode,
        accounts[0].wallet,
      );

      parentContractAddress = parentContract.target as string;
      if (global.logger.isLevelEnabled('trace')) {
        global.logger.trace(`Deploy parent contract on address ${parentContractAddress}`);
      }

      const response = await accounts[0].wallet.sendTransaction({
        to: parentContractAddress,
        value: ethers.parseEther('1'),
      });
      await relay.pollForValidTransactionReceipt(response.hash);

      // @ts-ignore
      createChildTx = await parentContract.createChild(1);
      await relay.pollForValidTransactionReceipt(createChildTx.hash);

      if (global.logger.isLevelEnabled('trace')) {
        global.logger.trace(`Contract call createChild on parentContract results in tx hash: ${createChildTx.hash}`);
      }
      // get contract result details
      mirrorContractDetails = await mirrorNode.get(`/contracts/results/${createChildTx.hash}`);

      mirrorContractDetails.from = accounts[0].address;

      // Create shared HTS token for synthetic transaction tests
      htsTokenId = await servicesNode.createToken(1000);
      await accounts[2].client.associateToken(htsTokenId);
    });

    describe('txpool_* RPC methods', async () => {
      before(async () => {
        await new Promise((r) => setTimeout(r, 2000));
      });
      after(async () => {
        await new Promise((r) => setTimeout(r, 2000));
      });
      overrideEnvsInMochaDescribe({
        ENABLE_TX_POOL: true,
        USE_ASYNC_TX_PROCESSING: true,
      });

      beforeEach(async () => {
        await new Promise((r) => setTimeout(r, 100));
      });

      const defaultGasPrice = numberTo0x(Assertions.defaultGasPrice);
      const defaultGasLimit = numberTo0x(3_000_000);

      const sendTransactions = async (signer = accounts[1], count: number = 2) => {
        const transactionMap = new Map<string, string>();
        for (let i = 0; i < count; i++) {
          const tx = {
            value: ONE_TINYBAR,
            chainId: Number(CHAIN_ID),
            maxPriorityFeePerGas: defaultGasPrice,
            maxFeePerGas: defaultGasPrice,
            gasLimit: defaultGasLimit,
            type: 2,
            to: accounts[2].address,
            nonce: await relay.getAccountNonce(signer.address, 'pending'),
          };
          const signedTx = await signer.wallet.signTransaction(tx);
          const txHash = await relay.sendRawTransaction(signedTx);

          transactionMap.set(txHash, signedTx);
        }

        return transactionMap;
      };

      const sendContractDeploymentTransaction = async (signer = accounts[1]) => {
        const signedTx = await signer.wallet.signTransaction({
          chainId: Number(CHAIN_ID),
          maxPriorityFeePerGas: defaultGasPrice,
          maxFeePerGas: defaultGasPrice,
          gasLimit: defaultGasLimit,
          type: 2,
          value: 0,
          data: basicContract.bytecode,
          nonce: await relay.getAccountNonce(signer.address, 'pending'),
        });
        await relay.sendRawTransaction(signedTx);

        return ethers.Transaction.from(signedTx);
      };

      describe('TXPOOL_API_ENABLED = true', async () => {
        overrideEnvsInMochaDescribe({
          TXPOOL_API_ENABLED: true,
        });

        it('should be able to execute txpool_content without parameter and get all transactions in the transaction pool', async () => {
          const txs = await sendTransactions();
          const res = await relay.call('txpool_content', []);

          expect(res.pending).to.not.be.empty;
          expect(txs).to.not.be.empty;

          txs.forEach((rlpTx) => {
            const parsedTx = ethers.Transaction.from(rlpTx);
            expect(res.pending[parsedTx.from]).to.not.be.empty;

            const txPoolTx = Object.values(res.pending[parsedTx.from]).find((tx) => tx.hash === parsedTx.hash);
            expect(txPoolTx).to.not.be.null;

            expect(txPoolTx.blockHash).to.equal(Constants.ZERO_HEX_32_BYTE);
            expect(txPoolTx.blockNumber).to.be.null;
            expect(txPoolTx.transactionIndex).to.be.null;
            expect(txPoolTx.from).to.equal(parsedTx.from);
            expect(txPoolTx.gas).to.equal(numberTo0x(parsedTx.gasLimit));
            expect(txPoolTx.input).to.equal(parsedTx.data);
            expect(txPoolTx.nonce).to.equal(numberTo0x(parsedTx.nonce));
            expect(txPoolTx.to).to.equal(parsedTx.to);
            expect(txPoolTx.value).to.equal(numberTo0x(parsedTx.value));
          });
        });

        it('should throw an INVALID_PARAMETER error if a parameter is being passed to txpool_content', async () => {
          expect(relay.call('txpool_content', ['0x9303'])).to.eventually.be.rejected.and.satisfy(
            (err: any) => err.response.status === 400,
          );
        });

        it('should be able to execute txpool_contentFrom for a valid address and get all transactions for that signer', async () => {
          await sendTransactions(accounts[1]);
          const res = await relay.call('txpool_contentFrom', [accounts[1].address]);

          expect(res.pending).to.not.be.empty;
          Object.values(res.pending).forEach((tx) => {
            expect(tx.from).to.equal(accounts[1].address);
          });
        });

        it('should be able to execute txpool_contentFrom for a valid address and get an empty object if there are no transactions for that signer', async () => {
          await new Promise((r) => setTimeout(r, 2000)); // wait for at least one block if there are any pending transactions in the pool
          const res = await relay.call('txpool_contentFrom', [accounts[1].address]);

          expect(res.pending).to.be.empty;
        });

        it('should throw an INVALID_PARAMETER error if a parameter is not being passed to txpool_contentFrom', async () => {
          expect(relay.call('txpool_contentFrom', [])).to.eventually.be.rejected.and.satisfy(
            (err: any) => err.response.status === 400,
          );
        });

        it('should be able to execute txpool_status and get the current transactions count in the transaction pool', async () => {
          const count = 1;
          await sendTransactions(accounts[1], count);
          const res = await relay.call('txpool_status', []);
          expect(Number(res.pending)).to.be.greaterThanOrEqual(count);
          expect(res.queued).to.equal('0x0');
        });

        it('should throw an INVALID_PARAMETER error if a parameter is being passed to txpool_status', async () => {
          expect(relay.call('txpool_status', ['0x9303'])).to.eventually.be.rejected.and.satisfy(
            (err: any) => err.response.status === 400,
          );
        });

        it('should be able to execute txpool_content when there is a contract deployment tx', async () => {
          const expectedTx = await sendContractDeploymentTransaction(accounts[2]);
          const res = await relay.call('txpool_content', []);
          expect(res.pending).to.not.be.empty;

          const tx = res.pending[expectedTx.from][Number(expectedTx.nonce)];
          expect(tx).to.not.be.null;
          expect(tx.hash).to.equal(expectedTx.hash);
          expect(tx.to).to.equal(expectedTx.to);
        });

        it('should be able to execute txpool_contentFrom when there is a contract deployment tx', async () => {
          const expectedTx = await sendContractDeploymentTransaction(accounts[2]);
          const res = await relay.call('txpool_contentFrom', [accounts[2].address]);
          expect(res.pending).to.not.be.empty;

          const tx = res.pending[Number(expectedTx.nonce)];
          expect(tx).to.not.be.null;
          expect(tx.hash).to.equal(expectedTx.hash);
          expect(tx.to).to.equal(expectedTx.to);
        });

        it('should be able to execute txpool_status when there is a contract deployment tx', async () => {
          await sendContractDeploymentTransaction(accounts[2]);
          const res = await relay.call('txpool_status', []);
          expect(Number(res.pending)).to.be.greaterThanOrEqual(1);
        });
      });

      describe('TXPOOL_API_ENABLED = false', async () => {
        overrideEnvsInMochaDescribe({
          TXPOOL_API_ENABLED: false,
        });

        it('should throw UNSUPPORTED_METHOD for txpool_content if TXPOOL_API_ENABLED is set to false', async () => {
          await relay.callUnsupported('txpool_content', []);
        });

        it('should throw UNSUPPORTED_METHOD for txpool_contentFrom if TXPOOL_API_ENABLED is set to false', async () => {
          await relay.callUnsupported('txpool_contentFrom', [accounts[1].address]);
        });

        it('should throw UNSUPPORTED_METHOD for txpool_status if TXPOOL_API_ENABLED is set to false', async () => {
          await relay.callUnsupported('txpool_status', []);
        });
      });
    });

    describe('Block related RPC calls', () => {
      let mirrorBlock;

      before(async () => {
        mirrorBlock = (await mirrorNode.get(`/blocks?block.number=${mirrorContractDetails.block_number}`)).blocks[0];
      });

      it('@release should execute "eth_getBlockTransactionCountByNumber"', async function () {
        const res = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_GET_BLOCK_TRANSACTION_COUNT_BY_NUMBER, [
          numberTo0x(mirrorBlock.number),
        ]);
        expect(res).to.be.equal(ethers.toQuantity(mirrorBlock.count));
      });

      it('should execute "eth_getBlockTransactionCountByNumber" for non-existing block number', async function () {
        const res = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_GET_BLOCK_TRANSACTION_COUNT_BY_NUMBER, [
          Address.NON_EXISTING_BLOCK_NUMBER,
        ]);
        expect(res).to.be.null;
      });

      it('@release should execute "eth_getBlockTransactionCountByHash"', async function () {
        const res = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_GET_BLOCK_TRANSACTION_COUNT_BY_HASH, [
          mirrorBlock.hash.substring(0, 66),
        ]);
        expect(res).to.be.equal(ethers.toQuantity(mirrorBlock.count));
      });

      it('should execute "eth_getBlockTransactionCountByHash" for non-existing block hash', async function () {
        const res = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_GET_BLOCK_TRANSACTION_COUNT_BY_HASH, [
          Address.NON_EXISTING_BLOCK_HASH,
        ]);
        expect(res).to.be.null;
      });

      it('should execute "eth_getBlockReceipts" with block hash successfully', async function () {
        const res = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_GET_BLOCK_RECEIPTS, [
          mirrorBlock.hash.substring(0, 66),
        ]);

        expect(res).to.have.length(1);
        expect(res[0]).to.have.property('blockHash');
        expect(res[0].blockHash).to.equal(mirrorBlock.hash.substring(0, 66));
        expect(res[0]).to.have.property('status');
        expect(res[0].status).to.equal('0x1');
        expect(res[0]).to.have.property('transactionHash');
        expect(res[0].transactionHash).to.equal(createChildTx.hash);
        expect(res[0].logs).to.not.be.empty;
        res[0].logs.map((log) =>
          expect(log.blockTimestamp).to.equal(numberTo0x(Number(mirrorBlock.timestamp.to.split('.')[0]))),
        );
      });

      it('should execute "eth_getBlockReceipts" with block number successfully', async function () {
        const res = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_GET_BLOCK_RECEIPTS, [numberTo0x(mirrorBlock.number)]);

        expect(res).to.have.length(1);
        expect(res[0]).to.have.property('blockHash');
        expect(res[0].blockHash).to.equal(mirrorBlock.hash.substring(0, 66));
        expect(res[0]).to.have.property('status');
        expect(res[0].status).to.equal('0x1');
        expect(res[0]).to.have.property('transactionHash');
        expect(res[0].transactionHash).to.equal(createChildTx.hash);
      });

      it('should execute "eth_getBlockReceipts" with tag "earliest" successfully', async function () {
        const res = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_GET_BLOCK_RECEIPTS, ['earliest']);

        expect(res).to.have.length(0);
      });

      it('should execute "eth_getBlockReceipts" with tag "latest" successfully', async function () {
        const res = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_GET_BLOCK_RECEIPTS, ['latest']);

        expect(res).to.have.length(0);
      });

      it('should throw error on "eth_getBlockReceipts" with invalid parameter passed', async function () {
        const error = predefined.INVALID_PARAMETER(
          0,
          `The value passed is not valid: 0x. ${BLOCK_NUMBER_ERROR} OR Expected ${HASH_ERROR} of a block`,
        );
        Assertions.assertPredefinedRpcError(error, relay.call, true, relay, [
          RelayCalls.ETH_ENDPOINTS.ETH_GET_BLOCK_RECEIPTS,
          ['0x', requestIdPrefix],
        ]);
      });

      it('should execute "eth_getBlockReceipts" with contract deployment transaction showing null to field', async function () {
        const contractDeployment = await Utils.deployContract(
          basicContractJson.abi,
          basicContractJson.bytecode,
          accounts[0].wallet,
        );
        const basicContractTx = contractDeployment.deploymentTransaction();
        if (!basicContractTx) {
          throw new Error('Deployment transaction is null');
        }
        const receipt = await relay.pollForValidTransactionReceipt(basicContractTx.hash);

        const deploymentBlock = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_GET_BLOCK_BY_HASH, [
          receipt.blockHash,
          false,
        ]);

        const res = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_GET_BLOCK_RECEIPTS, [deploymentBlock.hash]);

        const deploymentReceiptInBlock = res.find((receipt) => receipt.transactionHash === basicContractTx.hash);

        expect(deploymentReceiptInBlock).to.exist;
        expect(deploymentReceiptInBlock).to.have.property('to');
        expect(deploymentReceiptInBlock.to).to.be.null;
        expect(deploymentReceiptInBlock.contractAddress).to.not.be.null;
        expect(deploymentReceiptInBlock.contractAddress.toLowerCase()).to.equal(
          contractDeployment.target.toString().toLowerCase(),
        );
      });

      it('should return null for "eth_getBlockReceipts" when block is not found', async function () {
        const res = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_GET_BLOCK_RECEIPTS, [
          Address.NON_EXISTING_BLOCK_HASH,
        ]);
        expect(res).to.be.null;
      });

      it('should execute "eth_getBlockReceipts" for a block that contains synthetic transaction', async function () {
        const transaction = new TransferTransaction()
          .addTokenTransfer(htsTokenId, servicesNode._thisAccountId(), -10)
          .addTokenTransfer(htsTokenId, accounts[2].accountId, 10)
          .setTransactionMemo('Relay test token transfer');
        const resp = await transaction.execute(servicesNode.client);
        await resp.getRecord(servicesNode.client);
        await Utils.wait(1000);
        const logsRes = await mirrorNode.get(`/contracts/results/logs?limit=1`);
        const blockNumber = logsRes.logs[0].block_number;
        const formattedBlockNumber = prepend0x(blockNumber.toString(16));
        const contractId = logsRes.logs[0].contract_id;
        const transactionHash = logsRes.logs[0].transaction_hash;
        if (contractId !== htsTokenId.toString()) {
          return;
        }

        const receipts = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_GET_BLOCK_RECEIPTS, [formattedBlockNumber]);
        expect(receipts).to.not.be.empty;
        expect(receipts.filter((receipt) => receipt.transactionHash === transactionHash)).to.not.be.empty;
      });
    });

    describe('Transaction related RPC Calls', () => {
      const defaultGasPrice = numberTo0x(Assertions.defaultGasPrice);
      const defaultGasLimit = numberTo0x(3_000_000);

      const defaultLondonTransactionData = {
        value: ONE_TINYBAR,
        chainId: Number(CHAIN_ID),
        maxPriorityFeePerGas: defaultGasPrice,
        maxFeePerGas: defaultGasPrice,
        gasLimit: defaultGasLimit,
        type: 2,
      };

      describe('Transaction Pool feature', async () => {
        overrideEnvsInMochaDescribe({ USE_ASYNC_TX_PROCESSING: true });
        describe('ENABLE_TX_POOL = true', async () => {
          beforeEach(async () => {
            await new Promise((r) => setTimeout(r, 2000));
          });
          overrideEnvsInMochaDescribe({ ENABLE_TX_POOL: true });
          it('should have equal nonces (pending and latest) after successfully validated transaction', async () => {
            const tx = {
              ...defaultLondonTransactionData,
              to: accounts[2].address,
              nonce: await relay.getAccountNonce(accounts[1].address),
            };
            const signedTx = await accounts[1].wallet.signTransaction(tx);
            const txHash = await relay.sendRawTransaction(signedTx);
            await relay.pollForValidTransactionReceipt(txHash);

            const nonceLatest = await relay.getAccountNonce(accounts[1].address);
            const noncePending = await relay.getAccountNonce(accounts[1].address, 'pending');

            expect(nonceLatest).to.equal(noncePending);
          });

          it('should have equal nonces (pending and latest) after CN reverted transaction', async () => {
            const tx = {
              ...defaultLondonTransactionData,
              to: null,
              data: '0x' + '00'.repeat(5121),
              nonce: (await relay.getAccountNonce(accounts[1].address)) + 2,
            };
            const signedTx = await accounts[1].wallet.signTransaction(tx);
            const txHash = await relay.sendRawTransaction(signedTx);
            await relay.pollForValidTransactionReceipt(txHash);
            const mnResult = await mirrorNode.get(`/contracts/results/${txHash}`);

            const nonceLatest = await relay.getAccountNonce(accounts[1].address);
            const noncePending = await relay.getAccountNonce(accounts[1].address, 'pending');

            expect(mnResult.result).to.equal('WRONG_NONCE');
            expect(nonceLatest).to.equal(noncePending);
          });

          it('should have equal nonces (pending and latest) after multiple CN reverted transactions', async () => {
            const accountNonce = await relay.getAccountNonce(accounts[1].address);
            const tx1 = {
              ...defaultLondonTransactionData,
              to: null,
              data: basicContractJson.bytecode,
              nonce: accountNonce + 2,
            };
            const tx2 = {
              ...defaultLondonTransactionData,
              to: accounts[2].address,
              nonce: accountNonce,
              gasLimit: 21000,
            };
            const tx3 = {
              ...defaultLondonTransactionData,
              to: null,
              data: basicContractJson.bytecode,
              nonce: accountNonce + 3,
            };
            const signedTx1 = await accounts[1].wallet.signTransaction(tx1);
            const signedTx2 = await accounts[1].wallet.signTransaction(tx2);
            const signedTx3 = await accounts[1].wallet.signTransaction(tx3);

            const txHash1 = await relay.sendRawTransaction(signedTx1);
            await new Promise((r) => setTimeout(r, 500));
            const txHash2 = await relay.sendRawTransaction(signedTx2);
            await new Promise((r) => setTimeout(r, 500));
            const txHash3 = await relay.sendRawTransaction(signedTx3);
            await Promise.all([
              relay.pollForValidTransactionReceipt(txHash1),
              relay.pollForValidTransactionReceipt(txHash2),
              relay.pollForValidTransactionReceipt(txHash3),
            ]);

            const [mnResult1, mnResult2, mnResult3] = await Promise.all([
              mirrorNode.get(`/contracts/results/${txHash1}`),
              mirrorNode.get(`/contracts/results/${txHash2}`),
              mirrorNode.get(`/contracts/results/${txHash3}`),
            ]);

            const nonceLatest = await relay.getAccountNonce(accounts[1].address);
            const noncePending = await relay.getAccountNonce(accounts[1].address, 'pending');

            expect(mnResult1.result).to.equal('WRONG_NONCE');
            expect(mnResult2.result).to.equal('SUCCESS');
            expect(mnResult3.result).to.equal('WRONG_NONCE');
            expect(nonceLatest).to.equal(noncePending);
          });

          it('should have equal nonces (pending and latest) for contract reverted transaction', async () => {
            const reverterContract = await Utils.deployContract(
              reverterContractJson.abi,
              reverterContractJson.bytecode,
              accounts[0].wallet,
            );

            const tx = {
              ...defaultLondonTransactionData,
              to: reverterContract.target,
              data: '0xd0efd7ef',
              nonce: await relay.getAccountNonce(accounts[1].address),
              value: ONE_TINYBAR,
            };
            const signedTx = await accounts[1].wallet.signTransaction(tx);
            const txHash = await relay.sendRawTransaction(signedTx);
            await relay.pollForValidTransactionReceipt(txHash);
            const mnResult = await mirrorNode.get(`/contracts/results/${txHash}`);

            const nonceLatest = await relay.getAccountNonce(accounts[1].address);
            const noncePending = await relay.getAccountNonce(accounts[1].address, 'pending');

            expect(mnResult.result).to.equal('CONTRACT_REVERT_EXECUTED');
            expect(nonceLatest).to.equal(noncePending);
          });

          it('should have difference between pending and latest nonce when a single transaction has been sent', async () => {
            const nonceLatest = await relay.getAccountNonce(accounts[1].address);
            const signedTx1 = await accounts[1].wallet.signTransaction({
              ...defaultLondonTransactionData,
              to: accounts[2].address,
              nonce: nonceLatest,
              gasLimit: 21000,
            });
            const txHash1 = await relay.sendRawTransaction(signedTx1);

            const noncePending = await relay.getAccountNonce(accounts[1].address, 'pending');
            const signedTx2 = await accounts[1].wallet.signTransaction({
              ...defaultLondonTransactionData,
              to: accounts[2].address,
              nonce: noncePending,
              gasLimit: 21000,
            });
            const txHash2 = await relay.sendRawTransaction(signedTx2);

            const [receipt1, receipt2] = await Promise.all([
              relay.pollForValidTransactionReceipt(txHash1),
              relay.pollForValidTransactionReceipt(txHash2),
            ]);

            expect(receipt1.status).to.equal('0x1');
            expect(receipt2.status).to.equal('0x1');
            expect(nonceLatest).to.be.lessThan(noncePending);
          });

          it('should have difference between pending and latest nonce when multiple transactions have been sent simultaneously', async () => {
            const nonceLatest = await relay.getAccountNonce(accounts[1].address);
            const signedTx1 = await accounts[1].wallet.signTransaction({
              ...defaultLondonTransactionData,
              to: accounts[2].address,
              nonce: nonceLatest,
              gasLimit: 21000,
            });
            const txHash1 = await relay.sendRawTransaction(signedTx1);

            const noncePendingTx2 = await relay.getAccountNonce(accounts[1].address, 'pending');
            const signedTx2 = await accounts[1].wallet.signTransaction({
              ...defaultLondonTransactionData,
              to: accounts[2].address,
              nonce: noncePendingTx2,
              gasLimit: 21000,
            });
            const txHash2 = await relay.sendRawTransaction(signedTx2);

            const noncePendingTx3 = await relay.getAccountNonce(accounts[1].address, 'pending');
            const signedTx3 = await accounts[1].wallet.signTransaction({
              ...defaultLondonTransactionData,
              to: accounts[2].address,
              nonce: noncePendingTx3,
              gasLimit: 21000,
            });
            const txHash3 = await relay.sendRawTransaction(signedTx3);

            const [receipt1, receipt2, receipt3] = await Promise.all([
              relay.pollForValidTransactionReceipt(txHash1),
              relay.pollForValidTransactionReceipt(txHash2),
              relay.pollForValidTransactionReceipt(txHash3),
            ]);

            expect(receipt1.status).to.equal('0x1');
            expect(receipt2.status).to.equal('0x1');
            expect(receipt3.status).to.equal('0x1');
            expect(nonceLatest).to.be.lessThan(noncePendingTx2);
            expect(noncePendingTx2).to.be.lessThan(noncePendingTx3);
          });
        });

        describe('ENABLE_TX_POOL = false', async () => {
          overrideEnvsInMochaDescribe({ ENABLE_TX_POOL: false });
          it('should return latest nonce after transaction has been sent ', async () => {
            const nonce = await relay.getAccountNonce(accounts[1].address);
            const tx = {
              ...defaultLondonTransactionData,
              to: accounts[2].address,
              nonce,
            };
            const signedTx = await accounts[1].wallet.signTransaction(tx);
            const txHash = await relay.sendRawTransaction(signedTx);
            await relay.pollForValidTransactionReceipt(txHash);

            const nonceLatest = await relay.getAccountNonce(accounts[1].address);

            expect(nonce).to.not.equal(nonceLatest);
            expect(nonce).to.be.lessThan(nonceLatest);
          });

          it('should return equal nonces (pending and latest) when transaction has been sent', async () => {
            const nonce = await relay.getAccountNonce(accounts[1].address);
            const tx = {
              ...defaultLondonTransactionData,
              to: accounts[2].address,
              nonce,
            };
            const signedTx = await accounts[1].wallet.signTransaction(tx);
            await relay.sendRawTransaction(signedTx);

            const nonceLatest = await relay.getAccountNonce(accounts[1].address);
            const noncePending = await relay.getAccountNonce(accounts[1].address, Constants.BLOCK_PENDING);

            expect(nonceLatest).to.equal(noncePending);
          });

          it('should fail with WRONG_NONCE when multiple transactions have been sent simultaneously', async () => {
            const nonceLatest = await relay.getAccountNonce(accounts[1].address);

            const txs = [];
            for (let i = 0; i < 10; i++) {
              txs.push(
                relay.sendRawTransaction(
                  await accounts[1].wallet.signTransaction({
                    ...defaultLondonTransactionData,
                    to: accounts[2].address,
                    nonce: nonceLatest + i,
                  }),
                ),
              );
            }
            const txHashes = await Promise.all(txs);

            // wait for at least one block time
            await new Promise((r) => setTimeout(r, 2100));

            // WRONG_NONCE transactions are recorded in /api/v1/contracts/results/<evm_tx_hash>
            // with result: 'WRONG_NONCE'
            const results = await Promise.all(txHashes.map((hash) => mirrorNode.get(`/contracts/results/${hash}`)));
            const wrongNonceResults = results.filter((result) => result.result === 'WRONG_NONCE');
            expect(wrongNonceResults).to.not.be.empty;
          });
        });

        [true, false].forEach((ENABLE_TX_POOL) => {
          withOverriddenEnvsInMochaTest({ ENABLE_TX_POOL }, () => {
            [
              {
                label: 'a nonce too high (by one only!)',
                value: 1,
              },
              {
                label: 'very high nonce',
                value: 100,
              },
            ].forEach(({ label, value }) => {
              it(`should fail with WRONG_NONCE when a transaction with ${label} has been sent`, async () => {
                const nonceLatest = await relay.getAccountNonce(accounts[1].address);
                const txHash = await relay.sendRawTransaction(
                  await accounts[1].wallet.signTransaction({
                    ...defaultLondonTransactionData,
                    to: accounts[2].address,
                    nonce: nonceLatest + value,
                  }),
                );

                // wait for at least one block time
                await new Promise((r) => setTimeout(r, 2100));

                const mnResult = await mirrorNode.get(`/contracts/results/${txHash}`);
                expect(mnResult.result).to.equal('WRONG_NONCE');
              });
            });
          });
        });
      });

      it('@release should execute "eth_getTransactionByBlockHashAndIndex"', async function () {
        const response = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_GET_TRANSACTION_BY_BLOCK_HASH_AND_INDEX, [
          mirrorContractDetails.block_hash.substring(0, 66),
          numberTo0x(mirrorContractDetails.transaction_index),
        ]);
        Assertions.transaction(response, mirrorContractDetails);
      });

      it('should execute "eth_getTransactionByBlockHashAndIndex" for invalid block hash', async function () {
        const response = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_GET_TRANSACTION_BY_BLOCK_HASH_AND_INDEX, [
          Address.NON_EXISTING_BLOCK_HASH,
          numberTo0x(mirrorContractDetails.transaction_index),
        ]);
        expect(response).to.be.null;
      });

      it('should execute "eth_getTransactionByBlockHashAndIndex" for invalid index', async function () {
        const response = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_GET_TRANSACTION_BY_BLOCK_HASH_AND_INDEX, [
          mirrorContractDetails.block_hash.substring(0, 66),
          Address.NON_EXISTING_INDEX,
        ]);
        expect(response).to.be.null;
      });

      it('@release should execute "eth_getTransactionByBlockNumberAndIndex"', async function () {
        const response = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_GET_TRANSACTION_BY_BLOCK_NUMBER_AND_INDEX, [
          numberTo0x(mirrorContractDetails.block_number),
          numberTo0x(mirrorContractDetails.transaction_index),
        ]);
        Assertions.transaction(response, mirrorContractDetails);
      });

      it('should execute "eth_getTransactionByBlockNumberAndIndex" for invalid index', async function () {
        const response = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_GET_TRANSACTION_BY_BLOCK_NUMBER_AND_INDEX, [
          numberTo0x(mirrorContractDetails.block_number),
          Address.NON_EXISTING_INDEX,
        ]);
        expect(response).to.be.null;
      });

      it('should execute "eth_getTransactionByBlockNumberAndIndex" for non-exising block number', async function () {
        const response = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_GET_TRANSACTION_BY_BLOCK_NUMBER_AND_INDEX, [
          Address.NON_EXISTING_BLOCK_NUMBER,
          numberTo0x(mirrorContractDetails.transaction_index),
        ]);
        expect(response).to.be.null;
      });

      it('@release should execute "eth_getTransactionByBlockHashAndIndex" for synthetic HTS transaction', async function () {
        const transaction = new TransferTransaction()
          .addTokenTransfer(htsTokenId, servicesNode._thisAccountId(), -10)
          .addTokenTransfer(htsTokenId, accounts[2].accountId, 10)
          .setTransactionMemo('Relay test synthetic tx by block hash and index');
        const resp = await transaction.execute(servicesNode.client);

        // Get the exact consensus timestamp from the transaction record
        const { executedTimestamp } = await servicesNode.getRecordResponseDetails(resp);
        await Utils.wait(3000);

        // Query logs with the exact timestamp to get the correct transaction details
        const logsRes = await mirrorNode.get(`/contracts/results/logs?timestamp=${executedTimestamp}`);
        expect(logsRes.logs).to.be.an('array').with.lengthOf.at.least(1);

        const blockHash = logsRes.logs[0].block_hash;
        const transactionIndex = logsRes.logs[0].transaction_index;
        const transactionHash = logsRes.logs[0].transaction_hash;

        const response = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_GET_TRANSACTION_BY_BLOCK_HASH_AND_INDEX, [
          blockHash.substring(0, 66),
          numberTo0x(transactionIndex),
        ]);

        expect(response).to.not.be.null;
        expect(response.hash).to.equal(transactionHash.substring(0, 66));
        expect(response.transactionIndex).to.equal(numberTo0x(transactionIndex));
      });

      it('@release should execute "eth_getTransactionByBlockNumberAndIndex" for synthetic HTS transaction', async function () {
        const transaction = new TransferTransaction()
          .addTokenTransfer(htsTokenId, servicesNode._thisAccountId(), -10)
          .addTokenTransfer(htsTokenId, accounts[2].accountId, 10)
          .setTransactionMemo('Relay test synthetic tx by block number and index');
        const resp = await transaction.execute(servicesNode.client);

        // Get the exact consensus timestamp from the transaction record
        const { executedTimestamp } = await servicesNode.getRecordResponseDetails(resp);
        await Utils.wait(3000);

        // Query logs with the exact timestamp to get the correct transaction details
        const logsRes = await mirrorNode.get(`/contracts/results/logs?timestamp=${executedTimestamp}`);
        expect(logsRes.logs).to.be.an('array').with.lengthOf.at.least(1);

        const blockNumber = logsRes.logs[0].block_number;
        const transactionIndex = logsRes.logs[0].transaction_index;
        const transactionHash = logsRes.logs[0].transaction_hash;

        const response = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_GET_TRANSACTION_BY_BLOCK_NUMBER_AND_INDEX, [
          numberTo0x(blockNumber),
          numberTo0x(transactionIndex),
        ]);

        expect(response).to.not.be.null;
        expect(response.hash).to.equal(transactionHash.substring(0, 66));
        expect(response.transactionIndex).to.equal(numberTo0x(transactionIndex));
      });

      it('@release should return the right "effectiveGasPrice" for SYNTHETIC HTS transaction', async function () {
        const currentPrice = await relay.gasPrice();
        const transaction = new TransferTransaction()
          .addTokenTransfer(htsTokenId, servicesNode._thisAccountId(), -10)
          .addTokenTransfer(htsTokenId, accounts[2].accountId, 10)
          .setTransactionMemo('Relay test token transfer');
        const resp = await transaction.execute(servicesNode.client);
        await resp.getRecord(servicesNode.client);
        await Utils.wait(1000);
        const logsRes = await mirrorNode.get(`/contracts/results/logs?limit=1`);
        const blockNumber = logsRes.logs[0].block_number;
        const formattedBlockNumber = prepend0x(blockNumber.toString(16));
        const contractId = logsRes.logs[0].contract_id;
        const transactionHash = logsRes.logs[0].transaction_hash;
        if (contractId !== htsTokenId.toString()) {
          return;
        }

        // load the block in cache
        await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_GET_BLOCK_BY_NUMBER, [formattedBlockNumber, true]);
        const receiptFromRelay = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_GET_TRANSACTION_RECEIPT, [
          transactionHash,
        ]);

        // handle deviation in gas price
        expect(parseInt(receiptFromRelay.effectiveGasPrice)).to.be.lessThan(currentPrice * (1 + gasPriceDeviation));
        expect(parseInt(receiptFromRelay.effectiveGasPrice)).to.be.greaterThan(currentPrice * (1 - gasPriceDeviation));
      });

      it('@release should return the right "effectiveGasPrice" for SYNTHETIC Contract Call transaction', async function () {
        const currentPrice = await relay.gasPrice();
        const transactionHash = mirrorContractDetails.hash;
        const formattedBlockNumber = prepend0x(mirrorContractDetails.block_number.toString(16));

        // load the block in cache
        await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_GET_BLOCK_BY_NUMBER, [formattedBlockNumber, true]);
        const receiptFromRelay = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_GET_TRANSACTION_RECEIPT, [
          transactionHash,
        ]);

        // handle deviation in gas price
        expect(parseInt(receiptFromRelay.effectiveGasPrice)).to.be.lessThan(currentPrice * (1 + gasPriceDeviation));
        expect(parseInt(receiptFromRelay.effectiveGasPrice)).to.be.greaterThan(currentPrice * (1 - gasPriceDeviation));
      });

      it('@release should return all the synthetic tx logs when querying for its receipt', async function () {
        const fixture = new MultiLogReceiptFixture(servicesNode.client, mirrorNode);
        const blockNumber = await fixture.createBlockWithMultiLogSyntheticTransaction();

        // Block receipt contains a transaction with multiple logs
        const result = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_GET_BLOCK_RECEIPTS, [blockNumber]);
        expect(result).to.be.an('array').with.lengthOf(1);
        expect(result[0]).to.have.property('logs').with.lengthOf.greaterThan(1);

        const { transactionHash } = result[0];

        // Make sure that this transaction is synthetic
        await expect(mirrorNode.get(`/contracts/results/${transactionHash}`)).to.eventually.be.rejectedWith(/404/);

        // When querying for the synthetic transaction receipt directly, logs are also preserved
        const transactionReceipt = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_GET_TRANSACTION_RECEIPT, [
          transactionHash,
        ]);
        expect(transactionReceipt).to.have.property('logs').with.lengthOf.greaterThan(1);
      });
    });
  });
});
