// SPDX-License-Identifier: Apache-2.0

import { ConfigService } from '@hashgraph/json-rpc-config-service/dist/services';
import { predefined } from '@hashgraph/json-rpc-relay';
import { EvmAddressHbarSpendingPlanRepository } from '@hashgraph/json-rpc-relay/dist/lib/db/repositories/hbarLimiter/evmAddressHbarSpendingPlanRepository';
import { HbarSpendingPlanRepository } from '@hashgraph/json-rpc-relay/dist/lib/db/repositories/hbarLimiter/hbarSpendingPlanRepository';
import { IPAddressHbarSpendingPlanRepository } from '@hashgraph/json-rpc-relay/dist/lib/db/repositories/hbarLimiter/ipAddressHbarSpendingPlanRepository';
import { IDetailedHbarSpendingPlan } from '@hashgraph/json-rpc-relay/dist/lib/db/types/hbarLimiter/hbarSpendingPlan';
import { SubscriptionTier } from '@hashgraph/json-rpc-relay/dist/lib/db/types/hbarLimiter/subscriptionTier';
import { CACHE_LEVEL, CacheService } from '@hashgraph/json-rpc-relay/dist/lib/services/cacheService/cacheService';
import { HbarLimitService } from '@hashgraph/json-rpc-relay/dist/lib/services/hbarLimitService';
import { ITransfer, RequestDetails } from '@hashgraph/json-rpc-relay/dist/lib/types';
import { SpendingPlanConfig } from '@hashgraph/json-rpc-relay/src/lib/types/spendingPlanConfig';
import { estimateFileTransactionsFee, overrideEnvsInMochaDescribe } from '@hashgraph/json-rpc-relay/tests/helpers';
import { expect } from 'chai';
import { config } from 'dotenv';
import { BaseContract, ethers } from 'ethers';
import findConfig from 'find-config';
import fs from 'fs';
import { resolve } from 'path';
import { Logger } from 'pino';

import MetricsClient from '../clients/metricsClient';
import MirrorClient from '../clients/mirrorClient';
import RelayClient from '../clients/relayClient';
import EstimateGasContract from '../contracts/EstimateGasContract.json';
import largeContractJson from '../contracts/hbarLimiterContracts/largeSizeContract.json';
import mediumSizeContract from '../contracts/hbarLimiterContracts/mediumSizeContract.json';
// Contracts used in tests
import parentContractJson from '../contracts/Parent.json';
import Assertions from '../helpers/assertions';
import testConstants from '../helpers/constants';
// Local resources
import { Utils } from '../helpers/utils';
import { AliasAccount } from '../types/AliasAccount';

config({ path: resolve(__dirname, '../localAcceptance.env') });

describe('@hbarlimiter HBAR Limiter Acceptance Tests', function () {
  // @ts-ignore
  const {
    mirrorNode,
    relay,
    logger,
    initialBalance,
    metrics,
    relayIsLocal,
  }: {
    mirrorNode: MirrorClient;
    relay: RelayClient;
    logger: Logger;
    initialBalance: string;
    metrics: MetricsClient;
    relayIsLocal: boolean;
  } = global;
  const mockTTL = ConfigService.get('HBAR_RATE_LIMIT_DURATION');
  const operatorAccount = ConfigService.get('OPERATOR_ID_MAIN');
  const fileAppendChunkSize = Number(ConfigService.get('FILE_APPEND_CHUNK_SIZE'));
  const requestId = 'hbarLimiterTest';
  const requestDetails = new RequestDetails({ requestId: requestId, ipAddress: '0.0.0.0' });
  const cacheService = CacheService.getInstance(CACHE_LEVEL.L1);
  const maxBasicSpendingLimit = HbarLimitService.TIER_LIMITS.BASIC.toTinybars().toNumber();
  const maxExtendedSpendingLimit = HbarLimitService.TIER_LIMITS.EXTENDED.toTinybars().toNumber();
  const maxPrivilegedSpendingLimit = HbarLimitService.TIER_LIMITS.PRIVILEGED.toTinybars().toNumber();

  const evmAddressSpendingPlanRepository = new EvmAddressHbarSpendingPlanRepository(cacheService, logger);
  const ipSpendingPlanRepository = new IPAddressHbarSpendingPlanRepository(cacheService, logger);
  const hbarSpendingPlanRepository = new HbarSpendingPlanRepository(
    cacheService,
    logger.child({ name: 'hbar-spending-plan-repository' }),
  );

  const pollForProperAmountSpent = async (
    hbarSpendingPlan: IDetailedHbarSpendingPlan,
    deploymentCounts: number,
    expectedTxCost: number,
  ) => {
    let amountSpent = (await hbarSpendingPlanRepository.findByIdWithDetails(hbarSpendingPlan.id, requestDetails))
      .amountSpent;

    while (amountSpent < deploymentCounts * expectedTxCost) {
      logger.warn(
        `Fail to retrieve proper amount spent by the spending plan. Polling for the proper amount: deploymentCounts=${deploymentCounts}, expectedTxCost=${expectedTxCost}, amountSpent=${amountSpent}, properAmountSpent=${
          deploymentCounts * expectedTxCost
        }, planId=${hbarSpendingPlan.id}`,
      );
      await Utils.wait(3000);
      amountSpent = (await hbarSpendingPlanRepository.findByIdWithDetails(hbarSpendingPlan.id, requestDetails))
        .amountSpent;
    }

    logger.info(
      `Successfully retrieve proper amount spent by hbarSpendingPlan: deploymentCounts=${deploymentCounts}, expectedTxCost=${expectedTxCost}, amountSpent=${amountSpent}, properAmountSpent=${
        deploymentCounts * expectedTxCost
      }, planId=${hbarSpendingPlan.id}`,
    );
    return amountSpent;
  };

  // The following tests exhaust the hbar limit, so they should only be run against a local relay
  if (relayIsLocal) {
    const deployContract = async (contractJson: any, wallet: ethers.Wallet): Promise<ethers.Contract> => {
      const contract = await Utils.deployContract(contractJson.abi, contractJson.bytecode, wallet);
      expect(contract).to.be.instanceOf(BaseContract);
      await contract.waitForDeployment();
      expect(contract.target).to.not.be.null;

      return contract;
    };
    const transactionReecordCostTolerance = ConfigService.get('TEST_TRANSACTION_RECORD_COST_TOLERANCE');

    const verifyRemainingLimit = (expectedCost: number, remainingHbarsBefore: number, remainingHbarsAfter: number) => {
      const delta = transactionReecordCostTolerance * expectedCost;
      if (global.logger.isLevelEnabled('debug')) {
        global.logger.debug(`Tolerance: ${transactionReecordCostTolerance}`);
        global.logger.debug(`Expected cost: ${expectedCost} ±${delta}`);
        global.logger.debug(`Actual cost: ${remainingHbarsBefore - remainingHbarsAfter}`);
        global.logger.debug(`Actual delta: ${(remainingHbarsBefore - remainingHbarsAfter) / (expectedCost * 100)}`);
      }
      expect(remainingHbarsAfter).to.be.approximately(remainingHbarsBefore - expectedCost, delta);
    };

    const sumAccountTransfers = (transfers: ITransfer[], account?: string) => {
      return Math.abs(
        transfers
          .filter((transfer) => transfer.account === account)
          .reduce((acc, transfer) => acc + transfer.amount, 0),
      );
    };

    const getExpectedCostOfFileCreateTx = async () => {
      const fileCreateTx = (
        await mirrorNode.get(
          `/transactions?transactiontype=FILECREATE&order=desc&account.id=${operatorAccount}&limit=1`,
          requestId,
        )
      ).transactions[0];

      const fileCreateTxFee = sumAccountTransfers(fileCreateTx.transfers, operatorAccount);
      const fileCreateTimestamp = fileCreateTx.consensus_timestamp;
      return { fileCreateTxFee, fileCreateTimestamp };
    };

    const getExpectedCostOfFileAppendTx = async (timeStamp: string, txData: string) => {
      const fileAppendTxs = (
        await mirrorNode.get(
          `/transactions?order=desc&transactiontype=FILEAPPEND&account.id=${operatorAccount}&timestamp=gt:${timeStamp}`,
          requestId,
        )
      ).transactions;
      const fileAppendTxFee = fileAppendTxs.reduce((total: number, data: { transfers: ITransfer[] }) => {
        const sum = sumAccountTransfers(data.transfers, operatorAccount);
        return total + sum;
      }, 0);

      // The first chunk goes in with FileCreateTransaciton, the rest are FileAppendTransactions
      const expectedChunks = Math.ceil(txData.length / fileAppendChunkSize) - 1;
      expect(fileAppendTxs.length).to.eq(expectedChunks);

      return fileAppendTxFee;
    };

    const getExpectedCostOfLastLargeTx = async (txData: string) => {
      const ethereumTransaction = (
        await mirrorNode.get(
          `/transactions?transactiontype=ETHEREUMTRANSACTION&order=desc&account.id=${operatorAccount}&limit=1`,
          requestId,
        )
      ).transactions[0];
      const ethereumTxFee = sumAccountTransfers(ethereumTransaction.transfers, operatorAccount);
      const { fileCreateTxFee, fileCreateTimestamp } = await getExpectedCostOfFileCreateTx();
      const fileAppendTxFee = await getExpectedCostOfFileAppendTx(fileCreateTimestamp, txData);

      const fileDeleteTx = (
        await mirrorNode.get(
          `/transactions?transactiontype=FILEDELETE&order=desc&account.id=${operatorAccount}&limit=1`,
          requestId,
        )
      ).transactions[0];

      const fileDeleteTxFee = fileDeleteTx ? sumAccountTransfers(fileDeleteTx.transfers, operatorAccount) : 0;

      return ethereumTxFee + fileCreateTxFee + fileAppendTxFee + fileDeleteTxFee;
    };

    const getExpectedCostOfLastSmallTx = async (requestId: string) => {
      const ethereumTransaction = (
        await mirrorNode.get(
          `/transactions?transactiontype=ETHEREUMTRANSACTION&order=desc&account.id=${operatorAccount}&limit=1`,
          requestId,
        )
      ).transactions[0];
      return sumAccountTransfers(ethereumTransaction.transfers, operatorAccount);
    };

    describe('HBAR Rate Limit Tests', function () {
      overrideEnvsInMochaDescribe({ GET_RECORD_DEFAULT_TO_CONSENSUS_NODE: true });
      this.timeout(480 * 1000); // 480 seconds

      const accounts: AliasAccount[] = [];
      const defaultLondonTransactionData = {
        value: Utils.add0xPrefix(Utils.toHex(ethers.parseUnits('1', 10))), // 1 tinybar
        chainId: Number(ConfigService.get('CHAIN_ID')),
        maxPriorityFeePerGas: Assertions.defaultGasPrice,
        maxFeePerGas: Assertions.defaultGasPrice,
        gasLimit: 3_000_000,
        type: 2,
      };

      before(async function () {
        logger.info(`${requestDetails.formattedRequestId} Creating accounts`);
        logger.info(
          `${requestDetails.formattedRequestId} HBAR_RATE_LIMIT_TINYBAR: ${ConfigService.get(
            'HBAR_RATE_LIMIT_TINYBAR',
          )}`,
        );

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

      afterEach(async () => {
        const operatorPlans = await hbarSpendingPlanRepository.findAllActiveBySubscriptionTier(
          [SubscriptionTier.OPERATOR],
          requestDetails,
        );
        expect(operatorPlans.length).to.be.eq(1); // sanity check

        await hbarSpendingPlanRepository.resetAmountSpentOfAllPlans(requestDetails);

        // we don't want to reset the operator account's spending, so we have to add the amount spent back
        for (const plan of operatorPlans) {
          await hbarSpendingPlanRepository.addToAmountSpent(plan.id, plan.amountSpent, requestDetails, mockTTL);
        }

        // Note: Since the total HBAR budget is shared across the entire Relay instance by multiple test cases,
        //       and expense updates occur asynchronously, the wait below ensures that the HBAR amount has sufficient time
        //       to update properly after each test.
        await Utils.wait(1500);
      });

      describe('@hbarlimiter-batch1 Total HBAR Limit', () => {
        const pollForProperRemainingHbar = async (initialRemainingHbars: number, expectedTxCost: number) => {
          let updatedRemainingHbars = Number(await metrics.get(testConstants.METRICS.REMAINING_HBAR_LIMIT));

          // Note: expectedTxCost may be retrieved from mirror node which doesn't include the getRecord transaction fee.
          //       calculating delta = expectedTxCost * tolerance to account for this difference in transaction costs.
          const delta = expectedTxCost * transactionReecordCostTolerance;

          while (initialRemainingHbars - updatedRemainingHbars > expectedTxCost + delta) {
            logger.warn(
              `Failed to retrieve proper updated remaining HBARs. Polling for the proper updated remaining HBARs: expectedTxCost=${expectedTxCost}, delta=${delta}, initialRemainingHbars=${initialRemainingHbars}, currentUpdatedRemainingHbars=${updatedRemainingHbars}, properUpdatedRemainingHbar=${
                initialRemainingHbars - expectedTxCost - delta
              }`,
            );
            await Utils.wait(1000);
            updatedRemainingHbars = Number(await metrics.get(testConstants.METRICS.REMAINING_HBAR_LIMIT));
          }

          logger.info(
            `Successfully retrieved proper updated remaining HBARs: expectedTxCost=${expectedTxCost}, delta=${delta}, initialRemainingHbars=${initialRemainingHbars}, currentUpdatedRemainingHbars=${updatedRemainingHbars}, properUpdatedRemainingHbar=${
              initialRemainingHbars - expectedTxCost - delta
            }`,
          );

          return updatedRemainingHbars;
        };

        it('should execute "eth_sendRawTransaction" without triggering HBAR rate limit exceeded', async function () {
          const initialRemainingHbars = Number(await metrics.get(testConstants.METRICS.REMAINING_HBAR_LIMIT));

          const gasPrice = await relay.gasPrice(requestId);
          const transaction = {
            ...defaultLondonTransactionData,
            to: accounts[0].address,
            nonce: await relay.getAccountNonce(accounts[1].address, requestId),
            maxPriorityFeePerGas: gasPrice,
            maxFeePerGas: gasPrice,
          };
          const signedTx = await accounts[1].wallet.signTransaction(transaction);
          const txHash = await relay.call(testConstants.ETH_ENDPOINTS.ETH_SEND_RAW_TRANSACTION, [signedTx], requestId);
          const txReceipt = await relay.pollForValidTransactionReceipt(txHash);

          expect(txReceipt).to.not.be.null;

          const expectedTxCost = await getExpectedCostOfLastSmallTx(requestId);
          const updatedRemainingHbars = await pollForProperRemainingHbar(initialRemainingHbars, expectedTxCost);

          verifyRemainingLimit(expectedTxCost, initialRemainingHbars, updatedRemainingHbars);
        });

        it('should deploy a large contract and decrease remaining HBAR in limiter when transaction data is large', async function () {
          const initialRemainingHbars = Number(await metrics.get(testConstants.METRICS.REMAINING_HBAR_LIMIT));
          expect(initialRemainingHbars).to.be.gt(0);

          const contract = await deployContract(largeContractJson, accounts[0].wallet);
          await contract.waitForDeployment();

          const expectedTxCost = await getExpectedCostOfLastLargeTx(contract.deploymentTransaction()!.data);
          const updatedRemainingHbars = await pollForProperRemainingHbar(initialRemainingHbars, expectedTxCost);

          verifyRemainingLimit(expectedTxCost, initialRemainingHbars, updatedRemainingHbars);
        });

        it('should be able to deploy a contract without creating file', async function () {
          const initialRemainingHbars = Number(await metrics.get(testConstants.METRICS.REMAINING_HBAR_LIMIT));
          expect(initialRemainingHbars).to.be.gt(0);

          // This flow should not spend any major amount of hbars from the operator but only small query fees
          const tx = await deployContract(EstimateGasContract, accounts[0].wallet);
          await tx.waitForDeployment();

          const expectedTxCost = await getExpectedCostOfLastSmallTx(requestId);
          const updatedRemainingHbars = await pollForProperRemainingHbar(initialRemainingHbars, expectedTxCost);

          verifyRemainingLimit(expectedTxCost, initialRemainingHbars, updatedRemainingHbars);
        });

        it('should be able to deploy a medium size contract with fileCreate', async function () {
          const initialRemainingHbars = Number(await metrics.get(testConstants.METRICS.REMAINING_HBAR_LIMIT));
          expect(initialRemainingHbars).to.be.gt(0);

          // This flow should spend hbars from the operator, for fileCreate
          const contract = await deployContract(mediumSizeContract, accounts[0].wallet);
          await contract.waitForDeployment();

          const expectedTxCost = await getExpectedCostOfLastLargeTx(contract.deploymentTransaction()!.data);
          const updatedRemainingHbars = await pollForProperRemainingHbar(initialRemainingHbars, expectedTxCost);

          verifyRemainingLimit(expectedTxCost, initialRemainingHbars, updatedRemainingHbars);
        });

        it('HBAR limiter is updated within acceptable tolerance range in relation to actual spent amount by the relay operator', async function () {
          const initialRemainingHbars = Number(await metrics.get(testConstants.METRICS.REMAINING_HBAR_LIMIT));
          expect(initialRemainingHbars).to.be.gt(0);

          const operatorBalanceBefore = (await mirrorNode.get(`/accounts/${operatorAccount}`, requestId)).balance
            .balance;

          const largeContract = await deployContract(largeContractJson, accounts[0].wallet);
          await largeContract.waitForDeployment();
          const totalOperatorFees = await getExpectedCostOfLastLargeTx(largeContract.deploymentTransaction()!.data);

          const updatedRemainingHbars = await pollForProperRemainingHbar(initialRemainingHbars, totalOperatorFees);

          const operatorBalanceAfter = (await mirrorNode.get(`/accounts/${operatorAccount}`, requestId)).balance
            .balance;

          const amountPaidByOperator = operatorBalanceBefore - operatorBalanceAfter;

          const hbarLimitReducedAmount = initialRemainingHbars - updatedRemainingHbars;

          expect(updatedRemainingHbars).to.be.lt(initialRemainingHbars);
          Assertions.expectWithinTolerance(
            amountPaidByOperator,
            hbarLimitReducedAmount,
            transactionReecordCostTolerance,
          );
          Assertions.expectWithinTolerance(amountPaidByOperator, totalOperatorFees, transactionReecordCostTolerance);
        });

        it('should verify the estimated and actual transaction fees for file transactions are approximately equal', async function () {
          const contract = await deployContract(mediumSizeContract, accounts[0].wallet);
          const exchangeRateResult = (await mirrorNode.get(`/network/exchangerate`, requestId)).current_rate;
          const exchangeRateInCents = exchangeRateResult.cent_equivalent / exchangeRateResult.hbar_equivalent;

          const { fileCreateTxFee, fileCreateTimestamp } = await getExpectedCostOfFileCreateTx();
          const fileAppendTxFee = await getExpectedCostOfFileAppendTx(
            fileCreateTimestamp,
            contract.deploymentTransaction()!.data,
          );

          const estimatedTxFee = estimateFileTransactionsFee(
            contract.deploymentTransaction()!.data.length,
            fileAppendChunkSize,
            exchangeRateInCents,
          );

          const estimatedFileTransactionTotalFee = estimatedTxFee;
          const actualFileTransactionTotalFee = fileCreateTxFee + fileAppendTxFee;

          const tolerance = 0.003 * actualFileTransactionTotalFee; // 0.3% tolerance
          expect(estimatedFileTransactionTotalFee).to.be.approximately(actualFileTransactionTotalFee, tolerance);
        });
      });

      describe('HBAR Rate Limit For Different Spending Plan Tiers', () => {
        const createAliasAndAssociateSpendingPlan = async (
          subscriptionTier: SubscriptionTier,
          accountCounts: number = 1,
        ) => {
          const aliasAccounts: AliasAccount[] = [];
          const hbarSpendingPlan = await hbarSpendingPlanRepository.create(subscriptionTier, requestDetails, mockTTL);

          for (let i = 0; i < accountCounts; i++) {
            const aliasAccount = await Utils.createAliasAccount(
              mirrorNode,
              global.accounts[0],
              requestId,
              initialBalance,
            );
            global.accounts.push(aliasAccount);

            await evmAddressSpendingPlanRepository.save(
              { evmAddress: aliasAccount.address, planId: hbarSpendingPlan.id },
              requestDetails,
              mockTTL,
            );

            const plan = await evmAddressSpendingPlanRepository.findByAddress(aliasAccount.address, requestDetails);
            expect(plan.evmAddress).to.eq(aliasAccount.address);
            expect(plan.planId).to.eq(hbarSpendingPlan.id);
            const spendingPlan = await hbarSpendingPlanRepository.findByIdWithDetails(plan.planId, requestDetails);
            expect(spendingPlan.active).to.be.true;
            expect(spendingPlan.amountSpent).to.eq(0);
            expect(spendingPlan.subscriptionTier).to.eq(subscriptionTier);

            aliasAccounts.push(aliasAccount);
          }

          return { aliasAccounts, hbarSpendingPlan };
        };

        describe('@hbarlimiter-batch2 BASIC Tier', () => {
          beforeEach(async function () {
            const basicPlans = await hbarSpendingPlanRepository.findAllActiveBySubscriptionTier(
              [SubscriptionTier.BASIC],
              requestDetails,
            );
            for (const plan of basicPlans) {
              await hbarSpendingPlanRepository.delete(plan.id, requestDetails);
              await evmAddressSpendingPlanRepository.deleteAllByPlanId(plan.id, 'before', requestDetails);
              await ipSpendingPlanRepository.deleteAllByPlanId(plan.id, 'before', requestDetails);
            }
          });

          it('should create a BASIC spending plan for a new user and use the same plan on second transaction and different plan on third transaction from another user', async function () {
            const parentContract = await deployContract(parentContractJson, accounts[0].wallet);
            // awaiting for HBAR limiter to finish updating expenses in the background
            await Utils.wait(6000);

            const parentContractAddress = parentContract.target as string;
            if (global.logger.isLevelEnabled('trace')) {
              global.logger.trace(
                `${requestDetails.formattedRequestId} Deploy parent contract on address ${parentContractAddress}`,
              );
            }

            expect(evmAddressSpendingPlanRepository.findByAddress(accounts[2].address, requestDetails)).to.be.rejected;
            const gasPrice = await relay.gasPrice(requestId);
            const transaction = {
              ...defaultLondonTransactionData,
              to: parentContractAddress,
              nonce: await relay.getAccountNonce(accounts[2].address, requestId),
              maxPriorityFeePerGas: gasPrice,
              maxFeePerGas: gasPrice,
            };
            const signedTx = await accounts[2].wallet.signTransaction(transaction);
            const txHash = await relay.call(
              testConstants.ETH_ENDPOINTS.ETH_SEND_RAW_TRANSACTION,
              [signedTx],
              requestId,
            );
            const txReceipt = await relay.pollForValidTransactionReceipt(txHash);
            expect(txReceipt).to.not.be.null;

            // awaiting for HBAR limiter to finish updating expenses in the background
            await Utils.wait(6000);

            const ethSpendingPlan = await evmAddressSpendingPlanRepository.findByAddress(
              accounts[2].address,
              requestDetails,
            );
            expect(ethSpendingPlan).to.not.be.undefined;

            const spendingPlanAssociated = await hbarSpendingPlanRepository.findByIdWithDetails(
              ethSpendingPlan.planId,
              requestDetails,
            );
            const amountSpendAfterFirst = spendingPlanAssociated.amountSpent;

            const secondTransaction = {
              ...defaultLondonTransactionData,
              to: parentContractAddress,
              nonce: await relay.getAccountNonce(accounts[2].address, requestId),
              maxPriorityFeePerGas: gasPrice,
              maxFeePerGas: gasPrice,
            };
            const signedTxSecond = await accounts[2].wallet.signTransaction(secondTransaction);

            const txHashSecond = await relay.call(
              testConstants.ETH_ENDPOINTS.ETH_SEND_RAW_TRANSACTION,
              [signedTxSecond],
              requestId,
            );
            const txReceiptSecond = await relay.pollForValidTransactionReceipt(txHashSecond);
            expect(txReceiptSecond).to.not.be.null;

            let spendingPlanAssociatedAfterSecond = await hbarSpendingPlanRepository.findByIdWithDetails(
              ethSpendingPlan.planId,
              requestDetails,
            );

            while (spendingPlanAssociatedAfterSecond.amountSpent === amountSpendAfterFirst) {
              // awaiting for HBAR limiter to finish updating expenses in the background
              await Utils.wait(1000);
              spendingPlanAssociatedAfterSecond = await hbarSpendingPlanRepository.findByIdWithDetails(
                ethSpendingPlan.planId,
                requestDetails,
              );
            }

            expect(amountSpendAfterFirst).to.be.lt(spendingPlanAssociatedAfterSecond.amountSpent);

            // it should use a different BASIC plan for another user
            const thirdTransaction = {
              ...defaultLondonTransactionData,
              to: parentContractAddress,
              nonce: await relay.getAccountNonce(accounts[1].address, requestId),
              maxPriorityFeePerGas: gasPrice,
              maxFeePerGas: gasPrice,
            };
            const signedTxThird = await accounts[1].wallet.signTransaction(thirdTransaction);

            const txHashThird = await relay.call(
              testConstants.ETH_ENDPOINTS.ETH_SEND_RAW_TRANSACTION,
              [signedTxThird],
              requestId,
            );
            const txReceiptThird = await relay.pollForValidTransactionReceipt(txHashThird);
            expect(txReceiptThird).to.not.be.null;

            const ethSpendingPlanThird = await evmAddressSpendingPlanRepository.findByAddress(
              accounts[1].address,
              requestDetails,
            );
            expect(ethSpendingPlanThird).to.not.be.undefined;
            expect(ethSpendingPlanThird.planId).to.not.equal(ethSpendingPlan.planId);
          });

          it('should eventually exhaust the hbar limit for a BASIC user after multiple deployments of large contracts', async function () {
            let expectedTxCost = 0;
            let deploymentCounts = 0;
            let hbarSpendingPlan: IDetailedHbarSpendingPlan | null = null;
            const remainingHbarsBefore = Number(await metrics.get(testConstants.METRICS.REMAINING_HBAR_LIMIT));

            //Unlinking the ipAdress, since ipAddress when running tests in CI and locally is the same
            expect(evmAddressSpendingPlanRepository.findByAddress(accounts[2].address, requestDetails)).to.be.rejected;
            try {
              for (deploymentCounts = 0; deploymentCounts < 50; deploymentCounts++) {
                const tx = await deployContract(largeContractJson, accounts[2].wallet);
                await tx.waitForDeployment();

                expectedTxCost ||= await getExpectedCostOfLastLargeTx(largeContractJson.bytecode);

                if (!hbarSpendingPlan) {
                  const ethSpendingPlan = await evmAddressSpendingPlanRepository.findByAddress(
                    accounts[2].wallet.address,
                    requestDetails,
                  );
                  hbarSpendingPlan = await hbarSpendingPlanRepository.findByIdWithDetails(
                    ethSpendingPlan.planId,
                    requestDetails,
                  );
                }

                const amountSpent = await pollForProperAmountSpent(
                  hbarSpendingPlan,
                  deploymentCounts + 1,
                  expectedTxCost,
                );

                if (amountSpent + expectedTxCost > maxBasicSpendingLimit) {
                  throw predefined.HBAR_RATE_LIMIT_EXCEEDED;
                }
              }
              expect.fail(`Expected an error but nothing was thrown`);
            } catch (e: any) {
              logger.error(e.message);
              expect(e.message).to.contain(predefined.HBAR_RATE_LIMIT_EXCEEDED.message);
              const expectedAmountOfDeployments = Math.floor(maxBasicSpendingLimit / expectedTxCost);
              expect(deploymentCounts + 1).to.eq(expectedAmountOfDeployments);

              if (!hbarSpendingPlan) {
                const ethSpendingPlan = await evmAddressSpendingPlanRepository.findByAddress(
                  accounts[2].wallet.address,
                  requestDetails,
                );
                hbarSpendingPlan = await hbarSpendingPlanRepository.findByIdWithDetails(
                  ethSpendingPlan.planId,
                  requestDetails,
                );
              }
              const amountSpent = await pollForProperAmountSpent(hbarSpendingPlan, deploymentCounts, expectedTxCost);
              const remainingHbarsAfter = Number(await metrics.get(testConstants.METRICS.REMAINING_HBAR_LIMIT));

              // Explanation:
              // An HBAR limit check triggers the HBAR_RATE_LIMIT_EXCEED error in two scenarios:
              //    a. if remainingHbarsBefore > maxBasicSpendingLimit ===> (totalHbarSpentByBasicPlan + expectedTxCost) > maxBasicSpendingLimit
              //    b. if remainingHbarsBefore <= maxBasicSpendingLimit ===> (remainingBudget - expectedTxCost) < 0
              if (remainingHbarsBefore > maxBasicSpendingLimit) {
                expect(amountSpent + expectedTxCost).to.be.gt(maxBasicSpendingLimit);
              } else {
                expect(remainingHbarsAfter).to.be.lt(expectedTxCost);
              }
            }
          });
        });

        describe('@hbarlimiter-batch2 Preconfigured Tiers', () => {
          const reusableTestsForNonBasicTiers = (subscriptionTier: SubscriptionTier, maxSpendingLimit: number) => {
            let aliasAccounts: AliasAccount[];
            let hbarSpendingPlan: IDetailedHbarSpendingPlan;

            beforeEach(async () => {
              const result = await createAliasAndAssociateSpendingPlan(subscriptionTier, 2);
              aliasAccounts = result.aliasAccounts;
              hbarSpendingPlan = result.hbarSpendingPlan;
            });

            it('Should increase the amount spent of the spending plan by the transaction cost', async () => {
              const contract = await deployContract(mediumSizeContract, aliasAccounts[0].wallet);
              await contract.waitForDeployment();
              const expectedTxCost = await getExpectedCostOfLastLargeTx(contract.deploymentTransaction()!.data);

              const amountSpent = await pollForProperAmountSpent(hbarSpendingPlan, 1, expectedTxCost);

              expect(amountSpent).to.be.approximately(expectedTxCost, transactionReecordCostTolerance * expectedTxCost);
            });

            it('Should allow different accounts associated in the same HbarSpendingPlan to contribute to the same budget', async () => {
              let expectedTxCost = 0;

              for (const aliasAccount of aliasAccounts) {
                const contract = await deployContract(mediumSizeContract, aliasAccount.wallet);
                await contract.waitForDeployment();
                expectedTxCost ||= await getExpectedCostOfLastLargeTx(contract.deploymentTransaction()!.data);
              }

              const amountSpent = await pollForProperAmountSpent(
                hbarSpendingPlan,
                aliasAccounts.length,
                expectedTxCost,
              );
              expect(amountSpent).to.be.approximately(
                aliasAccounts.length * expectedTxCost,
                transactionReecordCostTolerance * expectedTxCost,
              );
            });

            it(`Should eventually exhaust the hbar limit for ${subscriptionTier} user and still allow another ${subscriptionTier} user to make calls`, async () => {
              let expectedTxCost = 0;
              let deploymentCounts = 0;
              const remainingHbarsBefore = Number(await metrics.get(testConstants.METRICS.REMAINING_HBAR_LIMIT));

              try {
                for (deploymentCounts = 0; deploymentCounts < 50; deploymentCounts++) {
                  const tx = await deployContract(largeContractJson, aliasAccounts[0].wallet);
                  await tx.waitForDeployment();

                  expectedTxCost ||= await getExpectedCostOfLastLargeTx(largeContractJson.bytecode);
                  const amountSpent = await pollForProperAmountSpent(
                    hbarSpendingPlan,
                    deploymentCounts + 1,
                    expectedTxCost,
                  );

                  if (amountSpent + expectedTxCost > maxSpendingLimit) {
                    throw predefined.HBAR_RATE_LIMIT_EXCEEDED;
                  }
                }
                expect.fail(`Expected an error but nothing was thrown`);
              } catch (e: any) {
                logger.error(e.message);
                expect(e.message).to.contain(predefined.HBAR_RATE_LIMIT_EXCEEDED.message);
                const expectedAmountOfDeployments = Math.floor(maxSpendingLimit / expectedTxCost);
                expect(deploymentCounts + 1).to.eq(expectedAmountOfDeployments);

                const amountSpent = await pollForProperAmountSpent(hbarSpendingPlan, deploymentCounts, expectedTxCost);
                const remainingHbarsAfter = Number(await metrics.get(testConstants.METRICS.REMAINING_HBAR_LIMIT));

                // Explanation:
                // An HBAR limit check triggers the HBAR_RATE_LIMIT_EXCEED error in two scenarios:
                //    a. if remainingHbarsBefore > maxSpendingLimit ===> (totalHbarSpentByPrivilegedPlan + expectedTxCost) > maxSpendingLimit
                //    b. if remainingHbarsBefore <= maxSpendingLimit ===> remainingBudget < expectedTxCost
                if (remainingHbarsBefore > maxSpendingLimit) {
                  expect(amountSpent + expectedTxCost).to.be.gt(maxSpendingLimit);
                } else {
                  expect(remainingHbarsAfter).to.be.lt(expectedTxCost);
                }

                // should make sure accounts in the same plan also share the same amountSpent which should also be hbar rate limited
                const ethSpendingPlan = await evmAddressSpendingPlanRepository.findByAddress(
                  aliasAccounts[1].address,
                  requestDetails,
                );
                const account1SpendingPlanAmountSpent = (
                  await hbarSpendingPlanRepository.findByIdWithDetails(ethSpendingPlan.planId, requestDetails)
                ).amountSpent;
                expect(account1SpendingPlanAmountSpent).to.eq(amountSpent);
                expect(account1SpendingPlanAmountSpent + expectedTxCost).to.gt(maxSpendingLimit);

                // should allow another account, who has the same tier but not in the same HbarSpendingPlan, to make call
                const differentAccount = (await createAliasAndAssociateSpendingPlan(subscriptionTier)).aliasAccounts[0];
                await expect(deployContract(largeContractJson, differentAccount.wallet)).to.be.fulfilled;
              }
            });
          };

          describe('given a valid JSON file with pre-configured spending plans', async () => {
            const SPENDING_PLANS_CONFIG_FILE = ConfigService.get('HBAR_SPENDING_PLANS_CONFIG');
            const configPath = findConfig(SPENDING_PLANS_CONFIG_FILE);

            if (configPath) {
              const rawData = fs.readFileSync(configPath!, 'utf-8');
              const expectedNonBasicPlans2 = JSON.parse(rawData) as SpendingPlanConfig[];

              it('Should successfully populate all pre-configured spending plans', async () => {
                expectedNonBasicPlans2.forEach(async (expectedPlan) => {
                  const hbarSpendingPlan = await hbarSpendingPlanRepository.findByIdWithDetails(
                    expectedPlan.id,
                    requestDetails,
                  );
                  expect(hbarSpendingPlan.active).to.be.true;
                  expect(hbarSpendingPlan.id).to.eq(expectedPlan.id);
                  expect(hbarSpendingPlan.subscriptionTier).to.eq(expectedPlan.subscriptionTier);

                  if (expectedPlan.evmAddresses) {
                    expectedPlan.evmAddresses.forEach(async (evmAddress) => {
                      const associatedPlanByEVMAddress = await evmAddressSpendingPlanRepository.findByAddress(
                        evmAddress,
                        requestDetails,
                      );
                      expect(associatedPlanByEVMAddress.planId).to.eq(expectedPlan.id);
                      expect(associatedPlanByEVMAddress.evmAddress).to.eq(evmAddress);
                    });
                  }

                  if (expectedPlan.ipAddresses) {
                    expectedPlan.ipAddresses.forEach(async (ipAddress) => {
                      const associatedPlanByIpAddress = await ipSpendingPlanRepository.findByAddress(
                        ipAddress,
                        requestDetails,
                      );
                      expect(associatedPlanByIpAddress.planId).to.eq(expectedPlan.id);
                      expect(associatedPlanByIpAddress.ipAddress).to.eq(ipAddress);
                    });
                  }
                });
              });
            }
          });

          describe('EXTENDED Tier', () => {
            reusableTestsForNonBasicTiers(SubscriptionTier.EXTENDED, maxExtendedSpendingLimit);
          });

          describe('PRIVILEGED Tier', () => {
            reusableTestsForNonBasicTiers(SubscriptionTier.PRIVILEGED, maxPrivilegedSpendingLimit);
          });
        });

        describe('@hbarlimiter-batch1 Multiple users with different tiers', () => {
          interface AliasAccountPlan {
            aliasAccounts: AliasAccount[];
            hbarSpendingPlan: IDetailedHbarSpendingPlan;
          }

          let accountPlanObject: Record<SubscriptionTier, AliasAccountPlan[]>;

          const accountPlanRequirements: Record<SubscriptionTier, number> = {
            BASIC: 3,
            EXTENDED: 3,
            PRIVILEGED: 3,
          };

          const createMultipleAliasAccountsWithSpendingPlans = async (
            accountPlanRequirements: Record<SubscriptionTier, number>,
          ) => {
            const accountPlanObject: Record<SubscriptionTier, AliasAccountPlan[]> = {
              BASIC: [],
              EXTENDED: [],
              PRIVILEGED: [],
            };

            for (const [subscriptionTier, numOfAccounts] of Object.entries(accountPlanRequirements)) {
              for (let i = 0; i < numOfAccounts; i++) {
                const accountCreatedResult = await createAliasAndAssociateSpendingPlan(
                  subscriptionTier as SubscriptionTier,
                );
                accountPlanObject[subscriptionTier].push(accountCreatedResult);
              }
            }

            return accountPlanObject;
          };

          before(async () => {
            accountPlanObject = await createMultipleAliasAccountsWithSpendingPlans(accountPlanRequirements);
          });

          it('should individually update amountSpents of different spending plans', async () => {
            const callingAliasAccountPlans: AliasAccountPlan[] = [];
            const aliasAccountPlans = Object.values(accountPlanObject).flat();

            const deployPromises = aliasAccountPlans.map(async (aliasAccountPlan) => {
              if (Math.random() < 0.5) {
                const tx = await deployContract(mediumSizeContract, aliasAccountPlan.aliasAccounts[0].wallet);
                await tx.waitForDeployment();
                return aliasAccountPlan; // Return the aliasAccountPlan for those that made deployments
              }
              return null;
            });

            const results = await Promise.all(deployPromises);

            callingAliasAccountPlans.push(
              ...results.filter((callingAliasAccountPlan) => callingAliasAccountPlan !== null),
            );

            const callingAccountAddresses = callingAliasAccountPlans
              .flat()
              .map((aliasAccountPlan) => aliasAccountPlan.aliasAccounts[0].address);

            // polling for proper updated amountSpent for one of the calling plan
            let amountSpent = (
              await hbarSpendingPlanRepository.findByIdWithDetails(
                callingAliasAccountPlans[0].hbarSpendingPlan.id,
                requestDetails,
              )
            ).amountSpent;

            while (amountSpent === 0) {
              await Utils.wait(1000);
              amountSpent = (
                await hbarSpendingPlanRepository.findByIdWithDetails(
                  callingAliasAccountPlans[0].hbarSpendingPlan.id,
                  requestDetails,
                )
              ).amountSpent;
            }

            // If an account has made a state-changing call, it will have a non-zero `amountSpent` in its associated spending plan.
            // Otherwise, its `amountSpent` in the associated plan should remain 0.
            for (const aliasAccountPlan of Object.values(accountPlanObject).flat()) {
              const associatedSpendingPlan = await hbarSpendingPlanRepository.findByIdWithDetails(
                aliasAccountPlan.hbarSpendingPlan.id,
                requestDetails,
              );

              if (callingAccountAddresses.includes(aliasAccountPlan.aliasAccounts[0].address)) {
                expect(associatedSpendingPlan.amountSpent).to.not.eq(0);
              } else {
                expect(associatedSpendingPlan.amountSpent).to.eq(0);
              }
            }
          });

          it(`Should eventually exhaust the total HBAR limits after many large contract deployments`, async () => {
            let expectedTxCost = 0;
            const exchangeRateResult = (await mirrorNode.get(`/network/exchangerate`, requestId)).current_rate;
            const exchangeRateInCents = exchangeRateResult.cent_equivalent / exchangeRateResult.hbar_equivalent;

            const allAccountAliases = Object.values(accountPlanObject)
              .flat()
              .map((accountAliasPlan) => {
                const aliasAccount = accountAliasPlan.aliasAccounts[0];
                return { ...aliasAccount, hbarSpendingPlan: accountAliasPlan.hbarSpendingPlan };
              });

            const totalHbarBudget = ConfigService.get('HBAR_RATE_LIMIT_TINYBAR');

            let totalHbarSpent =
              totalHbarBudget - Number(await metrics.get(testConstants.METRICS.REMAINING_HBAR_LIMIT));
            const estimatedTxFee = estimateFileTransactionsFee(
              largeContractJson.bytecode.length,
              fileAppendChunkSize,
              exchangeRateInCents,
            );

            while (totalHbarSpent + estimatedTxFee < totalHbarBudget) {
              for (const accountAlias of allAccountAliases) {
                let deploymentCounts = 0;
                const maxSpendingLimit = HbarLimitService.TIER_LIMITS[accountAlias.hbarSpendingPlan.subscriptionTier]
                  .toTinybars()
                  .toNumber();
                try {
                  for (deploymentCounts = 0; deploymentCounts < 50; deploymentCounts++) {
                    if (totalHbarSpent + expectedTxCost > totalHbarBudget) {
                      throw predefined.HBAR_RATE_LIMIT_EXCEEDED;
                    }

                    const tx = await deployContract(largeContractJson, accountAlias.wallet);
                    await tx.waitForDeployment();

                    expectedTxCost ||= await getExpectedCostOfLastLargeTx(largeContractJson.bytecode);
                    const amountSpent = await pollForProperAmountSpent(
                      accountAlias.hbarSpendingPlan,
                      deploymentCounts + 1,
                      expectedTxCost,
                    );

                    const remainingHbars = Number(await metrics.get(testConstants.METRICS.REMAINING_HBAR_LIMIT));
                    totalHbarSpent = totalHbarBudget - remainingHbars;

                    if (amountSpent + expectedTxCost > maxSpendingLimit) {
                      throw predefined.HBAR_RATE_LIMIT_EXCEEDED;
                    }
                  }
                  expect.fail(`Expected an error but nothing was thrown`);
                } catch (e) {
                  logger.error(e.message);
                  expect(e.message).to.contain(predefined.HBAR_RATE_LIMIT_EXCEEDED.message);
                }
              }
            }

            expect(totalHbarSpent + estimatedTxFee).to.gte(totalHbarBudget);
          });
        });
      });
    });

    describe('@hbarlimiter-batch3 Unlimited', () => {
      before(async function () {
        logger.info(
          `${requestDetails.formattedRequestId} HBAR_RATE_LIMIT_TINYBAR: ${ConfigService.get(
            'HBAR_RATE_LIMIT_TINYBAR',
          )}`,
        );
      });

      it('should eventually exhaust the hbar limit for a BASIC user after multiple deployments of large contracts, and not throw an error', async function () {
        // confirm that HBAR_RATE_LIMIT_TINYBAR is set to zero
        expect(ConfigService.get('HBAR_RATE_LIMIT_TINYBAR')).to.eq(0);
        // This should set the remaining HBAR limit to zero
        const remainingHbarsBefore = Number(await metrics.get(testConstants.METRICS.REMAINING_HBAR_LIMIT));
        expect(remainingHbarsBefore).to.eq(0);
        let deploymentCounts = 0;

        const operatorBalanceBefore = (await mirrorNode.get(`/accounts/${operatorAccount}`, requestId)).balance.balance;

        for (deploymentCounts = 0; deploymentCounts < 3; deploymentCounts++) {
          const tx = await deployContract(largeContractJson, global.accounts[0].wallet);
          await tx.waitForDeployment();
        }
        // Verify that the amount spent exceeds the HBAR limit
        const operatorBalanceAfter = (await mirrorNode.get(`/accounts/${operatorAccount}`, requestId)).balance.balance;
        const amountSpent = operatorBalanceBefore - operatorBalanceAfter;
        expect(amountSpent).to.be.gt(maxBasicSpendingLimit);

        // Verify that remaining HBAR limit is zero
        const remainingHbarsAfter = Number(await metrics.get(testConstants.METRICS.REMAINING_HBAR_LIMIT));
        expect(remainingHbarsAfter).to.be.eq(0);

        // Confirm that deployments continued even after the limit was exhausted
        expect(deploymentCounts).to.be.gte(1);
        await expect(deployContract(largeContractJson, global.accounts[0].wallet)).to.be.fulfilled;
      });
    });
  }
});
