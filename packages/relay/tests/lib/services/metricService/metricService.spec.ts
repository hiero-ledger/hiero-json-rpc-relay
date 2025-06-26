// SPDX-License-Identifier: Apache-2.0

import { ConfigService } from '@hashgraph/json-rpc-config-service/dist/services';
import { AccountId, Client, Hbar, Long, Status, TransactionRecord, TransactionRecordQuery } from '@hashgraph/sdk';
import axios, { AxiosInstance } from 'axios';
import MockAdapter from 'axios-mock-adapter';
import { expect } from 'chai';
import EventEmitter from 'events';
import pino from 'pino';
import { register, Registry } from 'prom-client';
import * as sinon from 'sinon';

import { MirrorNodeClient, SDKClient } from '../../../../src/lib/clients';
import constants from '../../../../src/lib/constants';
import { EvmAddressHbarSpendingPlanRepository } from '../../../../src/lib/db/repositories/hbarLimiter/evmAddressHbarSpendingPlanRepository';
import { HbarSpendingPlanRepository } from '../../../../src/lib/db/repositories/hbarLimiter/hbarSpendingPlanRepository';
import { IPAddressHbarSpendingPlanRepository } from '../../../../src/lib/db/repositories/hbarLimiter/ipAddressHbarSpendingPlanRepository';
import { CACHE_LEVEL, CacheService } from '../../../../src/lib/services/cacheService/cacheService';
import { HbarLimitService } from '../../../../src/lib/services/hbarLimitService';
import MetricService from '../../../../src/lib/services/metricService/metricService';
import { IExecuteQueryEventPayload, IExecuteTransactionEventPayload, RequestDetails } from '../../../../src/lib/types';
import { Utils } from '../../../../src/utils';
import {
  calculateTxRecordChargeAmount,
  overrideEnvsInMochaDescribe,
  withOverriddenEnvsInMochaTest,
} from '../../../helpers';

const registry = new Registry();
const logger = pino({ level: 'silent' });

describe('Metric Service', function () {
  let client: Client;
  let mock: typeof MockAdapter;
  let instance: AxiosInstance;
  let eventEmitter: EventEmitter;
  let metricService: MetricService;
  let hbarLimitService: HbarLimitService;
  let mirrorNodeClient: MirrorNodeClient;

  const requestDetails = new RequestDetails({ requestId: 'metricServiceTest', ipAddress: '0.0.0.0' });
  const mockedTxFee = 36900000;
  const operatorAccountId = `0.0.1022`;
  const mockedCallerName = 'caller_name';
  const mockedConstructorName = 'constructor_name';
  const mockedInteractingEntity = 'interacting_entity';
  const mockedTransactionId = '0.0.1022@1681130064.409933500';
  const mockedTransactionIdFormatted = '0.0.1022-1681130064-409933500';
  const metricHistogramCostSumTitle = 'rpc_relay_consensusnode_response_sum';
  const metricHistogramGasFeeSumTitle = 'rpc_relay_consensusnode_gasfee_sum';
  const mockedOriginalCallerAddress = '0x67d8d32e9bf1a9968a5ff53b87d777aa8ebbee69';
  const mockedMirrorNodeTransactionRecord = {
    transactions: [
      {
        charged_tx_fee: mockedTxFee,
        result: 'SUCCESS',
        transaction_id: '0.0.1022-1681130064-409933500',
        transfers: [
          {
            account: operatorAccountId,
            amount: -1 * mockedTxFee,
            is_approval: false,
          },
        ],
      },
    ],
  };

  const mockedConsensusNodeTransactionRecord = {
    receipt: {
      status: Status.Success,
      exchangeRate: { exchangeRateInCents: 12 },
    },
    transactionFee: new Hbar(mockedTxFee),
    contractFunctionResult: {
      gasUsed: new Long(0, 1000, true),
    },
    transfers: [
      {
        accountId: operatorAccountId,
        amount: Hbar.fromTinybars(-1 * mockedTxFee),
        is_approval: false,
      },
    ],
  } as unknown as TransactionRecord;

  const verifyConsensusNodeClientHistogramGasFee = async () => {
    // @ts-ignore
    const gasMetricObject = (await metricService['consensusNodeClientHistogramGasFee'].get()).values.find(
      (metric) => metric.metricName === metricHistogramGasFeeSumTitle,
    )!;

    expect(gasMetricObject.metricName).to.eq(metricHistogramGasFeeSumTitle);
    expect(gasMetricObject.value).to.eq(
      mockedConsensusNodeTransactionRecord.contractFunctionResult?.gasUsed.toNumber(),
    );
  };

  const verifyConsensusNodeClientHistogramCost = async (executionMode: string, expectedTxRecordFee: number = 0) => {
    const metricObjects = await metricService['consensusNodeClientHistogramCost'].get();

    if (expectedTxRecordFee) {
      const txRecordFeeMetricObject = metricObjects.values.find((metric) => {
        return (
          metric.labels.mode === constants.EXECUTION_MODE.RECORD && metric.metricName === metricHistogramCostSumTitle
        );
      });
      expect(txRecordFeeMetricObject?.metricName).to.eq(metricHistogramCostSumTitle);
      expect(txRecordFeeMetricObject?.value).to.eq(expectedTxRecordFee);
    }

    const transactionFeeMetricObject = metricObjects.values.find((metric) => {
      return metric.labels.mode === executionMode && metric.metricName === metricHistogramCostSumTitle;
    });
    expect(transactionFeeMetricObject?.metricName).to.eq(metricHistogramCostSumTitle);
    expect(transactionFeeMetricObject?.value).to.eq(mockedTxFee);
  };

  overrideEnvsInMochaDescribe({ OPERATOR_KEY_FORMAT: 'DER' });

  before(() => {
    // consensus node client
    const hederaNetwork = ConfigService.get('HEDERA_NETWORK')!;
    if (hederaNetwork in constants.CHAIN_IDS) {
      client = Client.forName(hederaNetwork);
    } else {
      client = Client.forNetwork(JSON.parse(hederaNetwork));
    }
    client = client.setOperator(
      AccountId.fromString(ConfigService.get('OPERATOR_ID_MAIN')!),
      Utils.createPrivateKeyBasedOnFormat(ConfigService.get('OPERATOR_KEY_MAIN')!),
    );

    // mirror node client
    instance = axios.create({
      baseURL: 'https://localhost:5551/api/v1',
      responseType: 'json' as const,
      headers: {
        'Content-Type': 'application/json',
      },
      timeout: 20 * 1000,
    });
    mirrorNodeClient = new MirrorNodeClient(
      ConfigService.get('MIRROR_NODE_URL'),
      logger.child({ name: `mirror-node` }),
      registry,
      CacheService.getInstance(CACHE_LEVEL.L1, registry),
      instance,
    );
  });

  beforeEach(() => {
    mock = new MockAdapter(instance);

    const duration = constants.HBAR_RATE_LIMIT_DURATION;

    eventEmitter = new EventEmitter();

    const cacheService = CacheService.getInstance(CACHE_LEVEL.L1, registry);
    const hbarSpendingPlanRepository = new HbarSpendingPlanRepository(cacheService, logger);
    const evmAddressHbarSpendingPlanRepository = new EvmAddressHbarSpendingPlanRepository(cacheService, logger);
    const ipAddressHbarSpendingPlanRepository = new IPAddressHbarSpendingPlanRepository(cacheService, logger);
    hbarLimitService = new HbarLimitService(
      hbarSpendingPlanRepository,
      evmAddressHbarSpendingPlanRepository,
      ipAddressHbarSpendingPlanRepository,
      logger,
      register,
      duration,
    );

    const sdkClient = new SDKClient(
      client,
      logger.child({ name: `consensus-node` }),
      CacheService.getInstance(CACHE_LEVEL.L1, registry),
      eventEmitter,
      hbarLimitService,
    );
    // Init new MetricService instance
    metricService = new MetricService(logger, sdkClient, mirrorNodeClient, registry, eventEmitter, hbarLimitService);
  });

  afterEach(() => {
    sinon.restore();
    mock.restore();
  });

  describe('captureTransactionMetrics', () => {
    const mockedExecuteTransactionEventPayload: IExecuteTransactionEventPayload = {
      transactionId: mockedTransactionId,
      callerName: mockedCallerName,
      txConstructorName: mockedConstructorName,
      operatorAccountId,
      interactingEntity: mockedInteractingEntity,
      requestDetails,
      originalCallerAddress: mockedOriginalCallerAddress,
    };

    const verifyMetrics = async (originalBudget: Hbar, expectedTxRecordFee: number) => {
      // validate hbarLimitService
      // note: since the query is made to consensus node, the total charged amount = txFee + txRecordFee
      const updatedBudget = await hbarLimitService['getRemainingBudget'](requestDetails);
      expect(originalBudget.toTinybars().toNumber() - updatedBudget.toTinybars().toNumber()).to.eq(
        mockedTxFee + expectedTxRecordFee,
      );

      await verifyConsensusNodeClientHistogramCost(constants.EXECUTION_MODE.TRANSACTION, expectedTxRecordFee);
      await verifyConsensusNodeClientHistogramGasFee();
    };

    withOverriddenEnvsInMochaTest({ GET_RECORD_DEFAULT_TO_CONSENSUS_NODE: false }, () => {
      it('Should execute captureTransactionMetrics() by retrieving transaction record from MIRROR NODE client', async () => {
        mock
          .onGet(`transactions/${mockedTransactionIdFormatted}?nonce=0`)
          .reply(200, JSON.stringify(mockedMirrorNodeTransactionRecord));

        const originalBudget = await hbarLimitService['getRemainingBudget'](requestDetails);

        // capture metrics
        await metricService.captureTransactionMetrics(mockedExecuteTransactionEventPayload);

        // validate hbarLimitService
        const updatedBudget = await hbarLimitService['getRemainingBudget'](requestDetails);
        expect(originalBudget.toTinybars().toNumber() - updatedBudget.toTinybars().toNumber()).to.eq(mockedTxFee);

        // validate cost metrics
        await verifyConsensusNodeClientHistogramCost(constants.EXECUTION_MODE.TRANSACTION);
      });
    });

    withOverriddenEnvsInMochaTest({ GET_RECORD_DEFAULT_TO_CONSENSUS_NODE: true }, () => {
      it('Should execute captureTransactionMetrics() by retrieving transaction record from CONSENSUS NODE client', async () => {
        const mockedExchangeRateInCents = 12;
        const expectedTxRecordFee = calculateTxRecordChargeAmount(mockedExchangeRateInCents);

        const transactionRecordStub = sinon
          .stub(TransactionRecordQuery.prototype, 'execute')
          .resolves(mockedConsensusNodeTransactionRecord);

        const originalBudget = await hbarLimitService['getRemainingBudget'](requestDetails);

        await metricService.captureTransactionMetrics(mockedExecuteTransactionEventPayload);

        expect(transactionRecordStub.called).to.be.true;
        await verifyMetrics(originalBudget, expectedTxRecordFee);
      });
    });

    withOverriddenEnvsInMochaTest({ GET_RECORD_DEFAULT_TO_CONSENSUS_NODE: true }, () => {
      it('Should listen to EXECUTE_TRANSACTION event to kick off captureTransactionMetrics()', async () => {
        const mockedExchangeRateInCents = 12;
        const expectedTxRecordFee = calculateTxRecordChargeAmount(mockedExchangeRateInCents);

        const transactionRecordStub = sinon
          .stub(TransactionRecordQuery.prototype, 'execute')
          .resolves(mockedConsensusNodeTransactionRecord);

        const originalBudget = await hbarLimitService['getRemainingBudget'](requestDetails);

        // emitting an EXECUTE_TRANSACTION event to kick off capturing metrics process asynchronously
        eventEmitter.emit(constants.EVENTS.EXECUTE_TRANSACTION, mockedExecuteTransactionEventPayload);

        // small wait for hbar rate limiter to settle
        await new Promise((r) => setTimeout(r, 100));

        expect(transactionRecordStub.called).to.be.true;
        await verifyMetrics(originalBudget, expectedTxRecordFee);
      });
    });
  });

  describe('addExpenseAndCaptureMetrics', () => {
    const mockedGasUsed = mockedConsensusNodeTransactionRecord.contractFunctionResult!.gasUsed.toNumber();
    const mockedExecuteQueryEventPayload: IExecuteQueryEventPayload = {
      executionMode: constants.EXECUTION_MODE.QUERY,
      transactionId: mockedTransactionId,
      txConstructorName: mockedConstructorName,
      cost: mockedTxFee,
      gasUsed: mockedGasUsed,
      status: 'SUCCESS',
      requestDetails,
      originalCallerAddress: mockedOriginalCallerAddress,
    };

    const verifyMetrics = async (originalBudget: Hbar) => {
      const updatedBudget = await hbarLimitService['getRemainingBudget'](requestDetails);
      expect(originalBudget.toTinybars().toNumber() - updatedBudget.toTinybars().toNumber()).to.eq(mockedTxFee);

      await verifyConsensusNodeClientHistogramCost(constants.EXECUTION_MODE.QUERY);
      await verifyConsensusNodeClientHistogramGasFee();
    };

    it('should execute addExpenseAndCaptureMetrics() to capture metrics in HBAR limiter and metric registry', async () => {
      const originalBudget = await hbarLimitService['getRemainingBudget'](requestDetails);

      // capture metrics
      await metricService.addExpenseAndCaptureMetrics(mockedExecuteQueryEventPayload);

      await verifyMetrics(originalBudget);
    });

    it('should listen to EXECUTE_QUERY event and kick off addExpenseAndCaptureMetrics()', async () => {
      const originalBudget = await hbarLimitService['getRemainingBudget'](requestDetails);

      // emitting an EXECUTE_QUERY event to kick off capturing metrics process
      eventEmitter.emit(constants.EVENTS.EXECUTE_QUERY, mockedExecuteQueryEventPayload);

      // small wait for hbar rate limiter to settle
      await new Promise((r) => setTimeout(r, 100));

      await verifyMetrics(originalBudget);
    });
  });

  describe('ethExecutionsCounter', () => {
    const mockedMethod = 'eth_sendRawTransaction';

    const mockedEthExecutionEventPayload = {
      method: mockedMethod,
      requestDetails,
    };

    it('should increment ethExecutionsCounter when ETH_EXECUTION event is emitted', async () => {
      // Get the counter before emitting the event
      const counterBefore = await metricService['ethExecutionsCounter'].get();

      // Find the initial value for our specific labels, or use 0 if not found
      const initialValue = counterBefore.values.find((metric) => metric.labels.method === mockedMethod)?.value || 0;

      eventEmitter.emit(constants.EVENTS.ETH_EXECUTION, mockedEthExecutionEventPayload);

      // Get the counter after emitting the event
      const counterAfter = await metricService['ethExecutionsCounter'].get();

      // Find the value for our specific labels after the event
      const metricValue = counterAfter.values.find((metric) => metric.labels.method === mockedMethod)?.value;

      expect(metricValue).to.eq(initialValue + 1);
    });
  });
});
