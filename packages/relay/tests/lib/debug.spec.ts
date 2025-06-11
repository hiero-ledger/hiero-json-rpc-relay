// SPDX-License-Identifier: Apache-2.0

import { ConfigService } from '@hashgraph/json-rpc-config-service/dist/services';
import MockAdapter from 'axios-mock-adapter';
import chai, { expect } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { EventEmitter } from 'events';
import pino from 'pino';
import { register, Registry } from 'prom-client';
import sinon from 'sinon';

import { predefined } from '../../src';
import { strip0x } from '../../src/formatters';
import { MirrorNodeClient } from '../../src/lib/clients';
import { IOpcodesResponse } from '../../src/lib/clients/models/IOpcodesResponse';
import constants, { TracerType } from '../../src/lib/constants';
import { EvmAddressHbarSpendingPlanRepository } from '../../src/lib/db/repositories/hbarLimiter/evmAddressHbarSpendingPlanRepository';
import { HbarSpendingPlanRepository } from '../../src/lib/db/repositories/hbarLimiter/hbarSpendingPlanRepository';
import { IPAddressHbarSpendingPlanRepository } from '../../src/lib/db/repositories/hbarLimiter/ipAddressHbarSpendingPlanRepository';
import { DebugImpl } from '../../src/lib/debug';
import { CommonService } from '../../src/lib/services';
import { CacheService } from '../../src/lib/services/cacheService/cacheService';
import HAPIService from '../../src/lib/services/hapiService/hapiService';
import { HbarLimitService } from '../../src/lib/services/hbarLimitService';
import { RequestDetails } from '../../src/lib/types';
import RelayAssertions from '../assertions';
import { getQueryParams, withOverriddenEnvsInMochaTest } from '../helpers';
chai.use(chaiAsPromised);

const logger = pino({ level: 'silent' });
const registry = new Registry();

let restMock: MockAdapter;
let web3Mock: MockAdapter;
let mirrorNodeInstance: MirrorNodeClient;
let debugService: DebugImpl;
let cacheService: CacheService;
let hapiServiceInstance: HAPIService;
describe('Debug API Test Suite', async function () {
  this.timeout(10000);

  const requestDetails = new RequestDetails({ requestId: 'debugTest', ipAddress: '0.0.0.0' });
  const transactionHash = '0xb7a433b014684558d4154c73de3ed360bd5867725239938c2143acb7a76bca82';
  const nonExistentTransactionHash = '0xb8a433b014684558d4154c73de3ed360bd5867725239938c2143acb7a76bca82';
  const contractAddress = '0x0000000000000000000000000000000000000409';
  const senderAddress = '0x00000000000000000000000000000000000003f8';
  const accountAddress = '0x00000000000000000000000000000000000003f7';
  const contractAddress2 = '0x000000000000000000000000000000000000040a';
  const tracerConfigTrue = { onlyTopCall: true };
  const tracerConfigFalse = { onlyTopCall: false };
  const callTracer: TracerType = TracerType.CallTracer;
  const opcodeLogger: TracerType = TracerType.OpcodeLogger;
  const CONTRACTS_RESULTS_OPCODES = `contracts/results/${transactionHash}/opcodes`;
  const CONTARCTS_RESULTS_ACTIONS = `contracts/results/${transactionHash}/actions`;
  const CONTRACTS_RESULTS_BY_HASH = `contracts/results/${transactionHash}`;
  const CONTRACT_BY_ADDRESS = `contracts/${contractAddress}`;
  const SENDER_BY_ADDRESS = `accounts/${senderAddress}?transactions=false`;
  const ACCOUNT_BY_ADDRESS = `accounts/${accountAddress}?transactions=false`;
  const CONTRACT_BY_ADDRESS2 = `contracts/${contractAddress2}`;
  const CONTRACTS_RESULTS_BY_NON_EXISTENT_HASH = `contracts/results/${nonExistentTransactionHash}`;
  const CONTRACT_RESULTS_BY_ACTIONS_NON_EXISTENT_HASH = `contracts/results/${nonExistentTransactionHash}/actions`;
  const BLOCKS_ENDPOINT = 'blocks';

  const opcodeLoggerConfigs = [
    {
      disableStack: true,
    },
    {
      enableMemory: true,
    },
    {
      disableStorage: true,
    },
    {
      enableMemory: true,
      disableStack: true,
      disableStorage: true,
    },
    {
      enableMemory: false,
      disableStack: false,
      disableStorage: false,
    },
  ];

  const opcodesResponse: IOpcodesResponse = {
    gas: 52139,
    failed: false,
    return_value: '0x0000000000000000000000000000000000000000000000000000000000000001',
    opcodes: [
      {
        pc: 1273,
        op: 'PUSH1',
        gas: 2731,
        gas_cost: 3,
        depth: 2,
        stack: [
          '000000000000000000000000000000000000000000000000000000004700d305',
          '00000000000000000000000000000000000000000000000000000000000000a7',
          '0000000000000000000000000000000000000000000000000000000000000000',
          '000000000000000000000000000000000000000000000000000000000000016c',
          '0000000000000000000000000000000000000000000000000000000000000000',
          '0000000000000000000000000000000000000000000000000000000000000004',
          '0000000000000000000000000000000000000000000000000000000000000000',
          '0000000000000000000000000000000000000000000000000000000000000521',
          '0000000000000000000000000000000000000000000000000000000000000024',
        ],
        memory: [
          '4e487b7100000000000000000000000000000000000000000000000000000000',
          '0000001200000000000000000000000000000000000000000000000000000000',
          '0000000000000000000000000000000000000000000000000000000000000080',
        ],
        storage: {},
        reason: null,
      },
      {
        pc: 1275,
        op: 'REVERT',
        gas: 2728,
        gas_cost: 0,
        depth: 2,
        stack: [
          '000000000000000000000000000000000000000000000000000000004700d305',
          '00000000000000000000000000000000000000000000000000000000000000a7',
          '0000000000000000000000000000000000000000000000000000000000000000',
          '000000000000000000000000000000000000000000000000000000000000016c',
          '0000000000000000000000000000000000000000000000000000000000000000',
          '0000000000000000000000000000000000000000000000000000000000000004',
          '0000000000000000000000000000000000000000000000000000000000000000',
          '0000000000000000000000000000000000000000000000000000000000000521',
          '0000000000000000000000000000000000000000000000000000000000000024',
          '0000000000000000000000000000000000000000000000000000000000000000',
        ],
        memory: [
          '4e487b7100000000000000000000000000000000000000000000000000000000',
          '0000001200000000000000000000000000000000000000000000000000000000',
          '0000000000000000000000000000000000000000000000000000000000000080',
        ],
        storage: {},
        reason: '0x4e487b710000000000000000000000000000000000000000000000000000000000000012',
      },
      {
        pc: 682,
        op: 'SWAP3',
        gas: 2776,
        gas_cost: 3,
        depth: 1,
        stack: [
          '000000000000000000000000000000000000000000000000000000000135b7d0',
          '00000000000000000000000000000000000000000000000000000000000000a0',
          '0000000000000000000000000000000000000000000000000000000000000000',
          '0000000000000000000000000000000000000000000000000000000000000000',
          '00000000000000000000000096769c2405eab9fdc59b25b178041e517ddc0f32',
          '000000000000000000000000000000000000000000000000000000004700d305',
          '0000000000000000000000000000000000000000000000000000000000000084',
          '0000000000000000000000000000000000000000000000000000000000000000',
        ],
        memory: [
          '0000000000000000000000000000000000000000000000000000000000000000',
          '0000000000000000000000000000000000000000000000000000000000000000',
          '0000000000000000000000000000000000000000000000000000000000000080',
          '0000000000000000000000000000000000000000000000000000000000000000',
          '4e487b7100000000000000000000000000000000000000000000000000000000',
        ],
        storage: {},
        reason: null,
      },
    ],
  };

  const contractsResultsByHashResult = {
    address: '0x637a6a8e5a69c087c24983b05261f63f64ed7e9b',
    amount: 0,
    call_result: '0x2',
    error_message: null,
    from: '0x00000000000000000000000000000000000003f8',
    function_parameters: '0x1',
    gas_limit: 300000,
    gas_used: 240000,
    timestamp: '1696438011.462526383',
    to: '0x0000000000000000000000000000000000000409',
    hash: '0xe815a3403c81f277902000d7916606e9571c3a8c0854ef6871595466a43b5b1f',
    block_hash: '0xa4c97b684587a2f1fc42e14ae743c336b97c58f752790482d12e44919f2ccb062807df5c9c0fa9a373b4d9726707f8b5',
    block_number: 668,
    logs: [],
    result: 'SUCCESS',
    transaction_index: 5,
    status: '0x1',
    failed_initcode: null,
    access_list: '0x',
    block_gas_used: 240000,
    chain_id: '0x12a',
    gas_price: '0x',
    max_fee_per_gas: '0x47',
    max_priority_fee_per_gas: '0x47',
    type: 2,
    nonce: 0,
  };

  const contractsResultsActionsResult = {
    actions: [
      {
        call_depth: 0,
        call_operation_type: 'CREATE',
        call_type: 'CREATE',
        caller: '0.0.1016',
        caller_type: 'ACCOUNT',
        from: '0x00000000000000000000000000000000000003f8',
        gas: 247000,
        gas_used: 77324,
        index: 0,
        input: '0x',
        recipient: '0.0.1033',
        recipient_type: 'CONTRACT',
        result_data: '0x',
        result_data_type: 'OUTPUT',
        timestamp: '1696438011.462526383',
        to: '0x0000000000000000000000000000000000000409',
        value: 0,
      },
      {
        call_depth: 1,
        call_operation_type: 'CREATE',
        call_type: 'CREATE',
        caller: '0.0.1033',
        caller_type: 'CONTRACT',
        from: '0x0000000000000000000000000000000000000409',
        gas: 189733,
        gas_used: 75,
        index: 1,
        input: '0x',
        recipient: '0.0.1034',
        recipient_type: 'CONTRACT',
        result_data: '0x',
        result_data_type: 'OUTPUT',
        timestamp: '1696438011.462526383',
        to: '0x000000000000000000000000000000000000040a',
        value: 0,
      },
    ],
  };

  const accountsResult = {
    evm_address: '0xc37f417fa09933335240fca72dd257bfbde9c275',
  };

  const contractResult = {
    evm_address: '0x637a6a8e5a69c087c24983b05261f63f64ed7e9b',
  };

  const contractResultSecond = {
    evm_address: '0x91b1c451777122afc9b83f9b96160d7e59847ad7',
  };

  this.beforeAll(() => {
    cacheService = new CacheService(logger.child({ name: `cache` }), registry);
    // @ts-ignore
    mirrorNodeInstance = new MirrorNodeClient(
      ConfigService.get('MIRROR_NODE_URL')!,
      logger.child({ name: `mirror-node` }),
      registry,
      cacheService,
    );
    const duration = constants.HBAR_RATE_LIMIT_DURATION;
    const eventEmitter = new EventEmitter();

    const hbarSpendingPlanRepository = new HbarSpendingPlanRepository(cacheService, logger);
    const evmAddressHbarSpendingPlanRepository = new EvmAddressHbarSpendingPlanRepository(cacheService, logger);
    const ipAddressHbarSpendingPlanRepository = new IPAddressHbarSpendingPlanRepository(cacheService, logger);
    const hbarLimitService = new HbarLimitService(
      hbarSpendingPlanRepository,
      evmAddressHbarSpendingPlanRepository,
      ipAddressHbarSpendingPlanRepository,
      logger,
      register,
      duration,
    );
    hapiServiceInstance = new HAPIService(logger, registry, eventEmitter, hbarLimitService);

    restMock = new MockAdapter(mirrorNodeInstance.getMirrorNodeRestInstance(), { onNoMatch: 'throwException' });

    web3Mock = new MockAdapter(mirrorNodeInstance.getMirrorNodeWeb3Instance(), { onNoMatch: 'throwException' });

    // Create the debug service
    debugService = new DebugImpl(mirrorNodeInstance, logger, cacheService);
  });

  describe('debug_traceTransaction', async function () {
    beforeEach(() => {
      restMock.onGet(CONTARCTS_RESULTS_ACTIONS).reply(200, JSON.stringify(contractsResultsActionsResult));
      restMock.onGet(CONTRACTS_RESULTS_BY_HASH).reply(200, JSON.stringify(contractsResultsByHashResult));
      restMock.onGet(CONTRACT_BY_ADDRESS).reply(200, JSON.stringify(contractResult));
      restMock.onGet(SENDER_BY_ADDRESS).reply(200, JSON.stringify(accountsResult));
      restMock.onGet(CONTRACT_BY_ADDRESS2).reply(200, JSON.stringify(contractResultSecond));
      restMock.onGet(`contracts/${senderAddress}`).reply(
        404,
        JSON.stringify({
          _status: {
            messages: [
              {
                message: 'Not found',
              },
            ],
          },
        }),
      );
      for (const config of opcodeLoggerConfigs) {
        const opcodeLoggerParams = getQueryParams({
          memory: !!config.enableMemory,
          stack: !config.disableStack,
          storage: !config.disableStorage,
        });

        web3Mock.onGet(`${CONTRACTS_RESULTS_OPCODES}${opcodeLoggerParams}`).reply(
          200,
          JSON.stringify({
            ...opcodesResponse,
            opcodes: opcodesResponse.opcodes?.map((opcode) => ({
              ...opcode,
              stack: config.disableStack ? [] : opcode.stack,
              memory: config.enableMemory ? opcode.memory : [],
              storage: config.disableStorage ? {} : opcode.storage,
            })),
          }),
        );
      }
    });

    afterEach(() => {
      restMock.reset();
      web3Mock.reset();
    });

    withOverriddenEnvsInMochaTest({ DEBUG_API_ENABLED: undefined }, () => {
      it('should throw UNSUPPORTED_METHOD', async function () {
        await RelayAssertions.assertRejection(
          predefined.UNSUPPORTED_METHOD,
          debugService.traceTransaction,
          true,
          debugService,
          [transactionHash, callTracer, tracerConfigFalse, requestDetails],
        );
      });
    });

    withOverriddenEnvsInMochaTest({ DEBUG_API_ENABLED: false }, () => {
      it('should throw UNSUPPORTED_METHOD', async function () {
        await RelayAssertions.assertRejection(
          predefined.UNSUPPORTED_METHOD,
          debugService.traceTransaction,
          true,
          debugService,
          [transactionHash, callTracer, tracerConfigFalse, requestDetails],
        );
      });
    });

    withOverriddenEnvsInMochaTest({ DEBUG_API_ENABLED: true }, () => {
      it('should successfully debug a transaction', async function () {
        const traceTransaction = await debugService.traceTransaction(
          transactionHash,
          callTracer,
          tracerConfigFalse,
          requestDetails,
        );
        expect(traceTransaction).to.exist;
      });

      describe('callTracer', async function () {
        it('Test call tracer with onlyTopCall false', async function () {
          const expectedResult = {
            type: 'CREATE',
            from: '0xc37f417fa09933335240fca72dd257bfbde9c275',
            to: '0x637a6a8e5a69c087c24983b05261f63f64ed7e9b',
            value: '0x0',
            gas: '0x493e0',
            gasUsed: '0x3a980',
            input: '0x1',
            output: '0x2',
            calls: [
              {
                type: 'CREATE',
                from: '0x637a6a8e5a69c087c24983b05261f63f64ed7e9b',
                to: '0x91b1c451777122afc9b83f9b96160d7e59847ad7',
                gas: '0x2e525',
                gasUsed: '0x4b',
                input: '0x',
                output: '0x',
                value: '0x0',
              },
            ],
          };

          const result = await debugService.traceTransaction(
            transactionHash,
            callTracer,
            tracerConfigFalse,
            requestDetails,
          );

          expect(result).to.deep.equal(expectedResult);
        });

        it('Test call tracer with onlyTopCall true', async function () {
          const expectedResult = {
            type: 'CREATE',
            from: '0xc37f417fa09933335240fca72dd257bfbde9c275',
            to: '0x637a6a8e5a69c087c24983b05261f63f64ed7e9b',
            value: '0x0',
            gas: '0x493e0',
            gasUsed: '0x3a980',
            input: '0x1',
            output: '0x2',
            calls: undefined,
          };
          const result = await debugService.traceTransaction(
            transactionHash,
            callTracer,
            tracerConfigTrue,
            requestDetails,
          );

          expect(result).to.deep.equal(expectedResult);
        });

        it('Should return empty array if no actions found', async function () {
          restMock.onGet(CONTARCTS_RESULTS_ACTIONS).reply(200, JSON.stringify({ actions: [] }));

          const result = await debugService.traceTransaction(
            transactionHash,
            callTracer,
            tracerConfigFalse,
            requestDetails,
          );

          expect(result).to.be.null;
        });
      });

      describe('opcodeLogger', async function () {
        for (const config of opcodeLoggerConfigs) {
          const opcodeLoggerParams = Object.keys(config)
            .map((key) => `${key}=${config[key]}`)
            .join(', ');

          describe(`When opcode logger is called with ${opcodeLoggerParams}`, async function () {
            const emptyFields = Object.keys(config)
              .filter((key) => (key.startsWith('disable') && config[key]) || (key.startsWith('enable') && !config[key]))
              .map((key) => (config[key] ? key.replace('disable', '') : key.replace('enable', '')))
              .map((key) => key.toLowerCase());

            it(`Then ${
              emptyFields.length ? `'${emptyFields}' should be empty` : 'all should be returned'
            }`, async function () {
              const expectedResult = {
                gas: opcodesResponse.gas,
                failed: opcodesResponse.failed,
                returnValue: strip0x(opcodesResponse.return_value!),
                structLogs: opcodesResponse.opcodes?.map((opcode) => ({
                  pc: opcode.pc,
                  op: opcode.op,
                  gas: opcode.gas,
                  gasCost: opcode.gas_cost,
                  depth: opcode.depth,
                  stack: config.disableStack ? null : opcode.stack,
                  memory: config.enableMemory ? opcode.memory : null,
                  storage: config.disableStorage ? null : opcode.storage,
                  reason: opcode.reason ? strip0x(opcode.reason) : null,
                })),
              };

              const result = await debugService.traceTransaction(transactionHash, opcodeLogger, config, requestDetails);

              expect(result).to.deep.equal(expectedResult);
            });
          });
        }
      });

      describe('Invalid scenarios', async function () {
        let notFound: { _status: { messages: { message: string }[] } };

        beforeEach(() => {
          notFound = {
            _status: {
              messages: [
                {
                  message: 'Not found',
                },
              ],
            },
          };
          restMock.onGet(CONTRACTS_RESULTS_BY_NON_EXISTENT_HASH).reply(404, JSON.stringify(notFound));
          restMock.onGet(CONTRACT_RESULTS_BY_ACTIONS_NON_EXISTENT_HASH).reply(404, JSON.stringify(notFound));
        });

        afterEach(() => {
          restMock.reset();
        });

        it('test case for non-existing transaction hash', async function () {
          const expectedError = predefined.RESOURCE_NOT_FOUND(
            `Failed to retrieve contract results for transaction ${nonExistentTransactionHash}`,
          );

          await RelayAssertions.assertRejection(expectedError, debugService.traceTransaction, true, debugService, [
            nonExistentTransactionHash,
            callTracer,
            tracerConfigTrue,
            requestDetails,
          ]);
        });

        it('should return empty result with invalid parameters in formatOpcodeResult', async function () {
          const opcodeResult = await debugService.formatOpcodesResult(null, {});
          // @ts-ignore
          expect(opcodeResult.gas).to.eq(0);
          // @ts-ignore
          expect(opcodeResult.failed).to.eq(true);
          // @ts-ignore
          expect(opcodeResult.returnValue).to.eq('');
          // @ts-ignore
          expect(opcodeResult.structLogs).to.be.an('array').that.is.empty;
        });

        describe('resolveAddress', async function () {
          it('should return null address with invalid parameters in resolveAddress', async function () {
            // @ts-ignore
            const address = await debugService.resolveAddress(null, requestDetails);
            expect(address).to.be.null;
          });

          it('should return passed address on notFound entity from the mirror node', async function () {
            restMock.onGet(ACCOUNT_BY_ADDRESS).reply(404, JSON.stringify(notFound));
            const address = await debugService.resolveAddress(accountAddress, requestDetails);
            expect(address).to.eq(accountAddress);
          });
        });
      });
    });
  });

  describe('debug_traceBlockByNumber', async function () {
    const blockNumber = '0x123';
    const blockNumberInDecimal = 291;
    const blockResponse = {
      number: blockNumberInDecimal,
      timestamp: {
        from: '1696438000.000000000',
        to: '1696438020.000000000',
      },
    };
    const contractResult1 = {
      hash: '0xabc123',
      result: 'SUCCESS',
    };
    const contractResult2 = {
      hash: '0xdef456',
      result: 'SUCCESS',
    };
    const contractResultWrongNonce = {
      hash: '0xghi789',
      result: 'WRONG_NONCE',
    };
    const callTracerResult1 = {
      type: 'CREATE',
      from: '0xc37f417fa09933335240fca72dd257bfbde9c275',
      to: '0x637a6a8e5a69c087c24983b05261f63f64ed7e9b',
      value: '0x0',
      gas: '0x493e0',
      gasUsed: '0x3a980',
      input: '0x1',
      output: '0x2',
    };
    const callTracerResult2 = {
      type: 'CALL',
      from: '0xc37f417fa09933335240fca72dd257bfbde9c275',
      to: '0x91b1c451777122afc9b83f9b96160d7e59847ad7',
      value: '0x0',
      gas: '0x493e0',
      gasUsed: '0x3a980',
      input: '0x3',
      output: '0x4',
    };
    const prestateTracerResult1 = {
      '0xc37f417fa09933335240fca72dd257bfbde9c275': {
        balance: '0x100000000',
        nonce: 2,
        code: '0x',
        storage: {},
      },
    };
    const prestateTracerResult2 = {
      '0x91b1c451777122afc9b83f9b96160d7e59847ad7': {
        balance: '0x200000000',
        nonce: 1,
        code: '0x608060405234801561001057600080fd5b50600436106100415760003560e01c8063',
        storage: {
          '0x0': '0x1',
          '0x1': '0x2',
        },
      },
    };

    beforeEach(() => {
      sinon.restore();
      restMock.reset();
      web3Mock.reset();
      cacheService.clear(requestDetails);
    });

    withOverriddenEnvsInMochaTest({ DEBUG_API_ENABLED: undefined }, () => {
      it('should throw UNSUPPORTED_METHOD', async function () {
        await RelayAssertions.assertRejection(
          predefined.UNSUPPORTED_METHOD,
          debugService.traceBlockByNumber,
          true,
          debugService,
          [blockNumber, { tracer: TracerType.CallTracer, tracerConfig: { onlyTopCall: false } }, requestDetails],
        );
      });
    });

    withOverriddenEnvsInMochaTest({ DEBUG_API_ENABLED: false }, () => {
      it('should throw UNSUPPORTED_METHOD', async function () {
        await RelayAssertions.assertRejection(
          predefined.UNSUPPORTED_METHOD,
          debugService.traceBlockByNumber,
          true,
          debugService,
          [blockNumber, { tracer: TracerType.CallTracer, tracerConfig: { onlyTopCall: false } }, requestDetails],
        );
      });
    });

    withOverriddenEnvsInMochaTest({ DEBUG_API_ENABLED: true }, () => {
      it('should throw RESOURCE_NOT_FOUND if block is not found', async function () {
        const getHistoricalBlockResponseStub = sinon.stub().resolves(null);
        sinon.stub(CommonService.prototype, 'getHistoricalBlockResponse').callsFake(getHistoricalBlockResponseStub);

        try {
          await debugService.traceBlockByNumber(
            blockNumber,
            { tracer: TracerType.CallTracer, tracerConfig: { onlyTopCall: false } },
            requestDetails,
          );
          expect.fail('Expected the traceBlockByNumber to throw an error but it did not');
        } catch (error) {
          expect(error.code).to.equal(predefined.RESOURCE_NOT_FOUND().code);
          expect(error.message).to.include(`Block ${blockNumber} not found`);
        }
      });

      it('should return empty array if no contract results are found for the block', async function () {
        const getHistoricalBlockResponseStub = sinon.stub().resolves(blockResponse);
        sinon.stub(CommonService.prototype, 'getHistoricalBlockResponse').callsFake(getHistoricalBlockResponseStub);

        sinon.stub(mirrorNodeInstance, 'getContractResultWithRetry').resolves([]);

        const result = await debugService.traceBlockByNumber(
          blockNumber,
          { tracer: TracerType.CallTracer, tracerConfig: { onlyTopCall: false } },
          requestDetails,
        );

        expect(result).to.be.an('array').that.is.empty;
      });

      it('should return cached result if available', async function () {
        const cachedResult = [{ txHash: '0xabc123', result: callTracerResult1 }];

        const getHistoricalBlockResponseStub = sinon.stub().resolves(blockResponse);
        sinon.stub(CommonService.prototype, 'getHistoricalBlockResponse').callsFake(getHistoricalBlockResponseStub);

        sinon.stub(cacheService, 'getAsync').resolves(cachedResult);

        const result = await debugService.traceBlockByNumber(
          blockNumber,
          { tracer: TracerType.CallTracer, tracerConfig: { onlyTopCall: false } },
          requestDetails,
        );

        expect(result).to.deep.equal(cachedResult);
      });

      describe('with CallTracer', async function () {
        beforeEach(() => {
          const getHistoricalBlockResponseStub = sinon.stub().resolves(blockResponse);
          sinon.stub(CommonService.prototype, 'getHistoricalBlockResponse').callsFake(getHistoricalBlockResponseStub);

          sinon.stub(cacheService, 'getAsync').resolves(null);
          sinon.stub(cacheService, 'set').resolves();
        });

        it('should trace block with CallTracer and filter out WRONG_NONCE results', async function () {
          sinon
            .stub(mirrorNodeInstance, 'getContractResultWithRetry')
            .resolves([contractResult1, contractResult2, contractResultWrongNonce]);

          sinon
            .stub(debugService, 'callTracer')
            .withArgs(contractResult1.hash, sinon.match.any, sinon.match.any)
            .resolves(callTracerResult1)
            .withArgs(contractResult2.hash, sinon.match.any, sinon.match.any)
            .resolves(callTracerResult2);

          const result = await debugService.traceBlockByNumber(
            blockNumber,
            { tracer: TracerType.CallTracer, tracerConfig: { onlyTopCall: false } },
            requestDetails,
          );

          expect(result).to.be.an('array').with.lengthOf(2);
          expect(result[0]).to.deep.equal({ txHash: contractResult1.hash, result: callTracerResult1 });
          expect(result[1]).to.deep.equal({ txHash: contractResult2.hash, result: callTracerResult2 });
        });

        it('should use default CallTracer when no tracer is specified', async function () {
          sinon.stub(mirrorNodeInstance, 'getContractResultWithRetry').resolves([contractResult1]);
          sinon.stub(debugService, 'callTracer').resolves(callTracerResult1);

          // Pass undefined with type assertion for the second parameter
          // In the implementation, undefined tracerObject triggers default behavior (using CallTracer)
          // TypeScript requires type assertion since the parameter is normally required
          const result = await debugService.traceBlockByNumber(blockNumber, undefined as any, requestDetails);

          expect(result).to.be.an('array').with.lengthOf(1);
          expect(result[0]).to.deep.equal({ txHash: contractResult1.hash, result: callTracerResult1 });
        });
      });

      describe('with PrestateTracer', async function () {
        beforeEach(() => {
          const getHistoricalBlockResponseStub = sinon.stub().resolves(blockResponse);
          sinon.stub(CommonService.prototype, 'getHistoricalBlockResponse').callsFake(getHistoricalBlockResponseStub);

          sinon.stub(cacheService, 'getAsync').resolves(null);
          sinon.stub(cacheService, 'set').resolves();
        });

        it('should trace block with PrestateTracer and filter out WRONG_NONCE results', async function () {
          sinon
            .stub(mirrorNodeInstance, 'getContractResultWithRetry')
            .resolves([contractResult1, contractResult2, contractResultWrongNonce]);

          sinon
            .stub(debugService, 'prestateTracer')
            .withArgs(contractResult1.hash, sinon.match.any, sinon.match.any)
            .resolves(prestateTracerResult1)
            .withArgs(contractResult2.hash, sinon.match.any, sinon.match.any)
            .resolves(prestateTracerResult2);

          const result = await debugService.traceBlockByNumber(
            blockNumber,
            { tracer: TracerType.PrestateTracer, tracerConfig: { onlyTopCall: true } },
            requestDetails,
          );

          expect(result).to.be.an('array').with.lengthOf(2);
          expect(result[0]).to.deep.equal({ txHash: contractResult1.hash, result: prestateTracerResult1 });
          expect(result[1]).to.deep.equal({ txHash: contractResult2.hash, result: prestateTracerResult2 });
        });
      });

      it('should handle error scenarios', async function () {
        const jsonRpcError = predefined.INTERNAL_ERROR('Test error');

        const getHistoricalBlockResponseStub = sinon.stub().throws(jsonRpcError);
        sinon.stub(CommonService.prototype, 'getHistoricalBlockResponse').callsFake(getHistoricalBlockResponseStub);

        const genericErrorHandlerStub = sinon.stub().returns(jsonRpcError);
        sinon.stub(CommonService.prototype, 'genericErrorHandler').callsFake(genericErrorHandlerStub);

        await RelayAssertions.assertRejection(jsonRpcError, debugService.traceBlockByNumber, true, debugService, [
          blockNumber,
          { tracer: TracerType.CallTracer },
          requestDetails,
        ]);
      });
    });
  });

  describe('prestateTracer', async function () {
    const mockTimestamp = '1696438011.462526383';
    const contractId = '0.0.1033';
    const accountId = '0.0.1016';
    const contractEvmAddress = '0x637a6a8e5a69c087c24983b05261f63f64ed7e9b';
    const accountEvmAddress = '0xc37f417fa09933335240fca72dd257bfbde9c275';
    const contractAddress = '0x0000000000000000000000000000000000000409';
    const accountAddress = '0x00000000000000000000000000000000000003f8';

    const actionsResponseMock = [
      {
        call_depth: 0,
        call_operation_type: 'CREATE',
        call_type: 'CREATE',
        caller: accountId,
        caller_type: 'ACCOUNT',
        from: accountAddress,
        gas: 247000,
        gas_used: 77324,
        index: 0,
        input: '0x',
        recipient: contractId,
        recipient_type: 'CONTRACT',
        result_data: '0x',
        result_data_type: 'OUTPUT',
        timestamp: mockTimestamp,
        to: contractAddress,
        value: 0,
      },
      {
        call_depth: 1,
        call_operation_type: 'CREATE',
        call_type: 'CREATE',
        caller: contractId,
        caller_type: 'CONTRACT',
        from: contractAddress,
        gas: 189733,
        gas_used: 75,
        index: 1,
        input: '0x',
        recipient: '0.0.1034',
        recipient_type: 'CONTRACT',
        result_data: '0x',
        result_data_type: 'OUTPUT',
        timestamp: mockTimestamp,
        to: '0x000000000000000000000000000000000000040a',
        value: 0,
      },
    ];

    const contractEntityMock = {
      type: constants.TYPE_CONTRACT,
      entity: {
        contract_id: contractId,
        evm_address: contractEvmAddress,
        runtime_bytecode: '0x608060405234801561001057600080fd5b50600436106100415760003560e01c8063',
        nonce: 1,
      },
    };

    const accountEntityMock = {
      type: constants.TYPE_ACCOUNT,
      entity: {
        evm_address: accountEvmAddress,
        ethereum_nonce: 2,
        balance: {
          balance: '100000000',
        },
      },
    };

    const contractBalanceMock = {
      balances: [
        {
          account: contractId,
          balance: '200000000',
        },
      ],
    };

    const contractStateMock = [
      {
        address: contractAddress,
        slot: '0x0',
        value: '0x1',
      },
      {
        address: contractAddress,
        slot: '0x1',
        value: '0x2',
      },
    ];

    const expectedResult = {
      [contractEvmAddress]: {
        balance: '0x200000000',
        nonce: 1,
        code: '0x608060405234801561001057600080fd5b50600436106100415760003560e01c8063',
        storage: {
          '0x0': '0x1',
          '0x1': '0x2',
        },
      },
      [accountEvmAddress]: {
        balance: '0x100000000',
        nonce: 2,
        code: '0x',
        storage: {},
      },
    };

    beforeEach(() => {
      sinon.restore();
      restMock.reset();
      web3Mock.reset();
      cacheService.clear(requestDetails);
    });

    withOverriddenEnvsInMochaTest({ DEBUG_API_ENABLED: true }, () => {
      it('should fetch and format prestate data for a transaction', async function () {
        // Set up stubs
        sinon
          .stub(mirrorNodeInstance, 'getContractsResultsActions')
          .withArgs(transactionHash, sinon.match.any)
          .resolves(actionsResponseMock);

        sinon.stub(mirrorNodeInstance, 'resolveEntityType').callsFake(async (address) => {
          if (address === contractAddress) {
            return contractEntityMock;
          } else if (address === accountAddress) {
            return accountEntityMock;
          }
          return null;
        });

        sinon
          .stub(mirrorNodeInstance, 'getBalanceAtTimestamp')
          .withArgs(contractId, sinon.match.any, sinon.match.any)
          .resolves(contractBalanceMock);

        sinon
          .stub(mirrorNodeInstance, 'getContractState')
          .withArgs(contractId, sinon.match.any, sinon.match.any)
          .resolves(contractStateMock);

        const result = await debugService.prestateTracer(transactionHash, false, requestDetails);
        expect(result).to.deep.equal(expectedResult);
      });

      it('should filter actions based on onlyTopCall=true parameter', async function () {
        // Set up stubs
        sinon
          .stub(mirrorNodeInstance, 'getContractsResultsActions')
          .withArgs(transactionHash, sinon.match.any)
          .resolves(actionsResponseMock);

        sinon.stub(mirrorNodeInstance, 'resolveEntityType').callsFake(async (address) => {
          if (address === contractAddress) {
            return contractEntityMock;
          } else if (address === accountAddress) {
            return accountEntityMock;
          }
          return null;
        });

        sinon
          .stub(mirrorNodeInstance, 'getBalanceAtTimestamp')
          .withArgs(contractId, sinon.match.any, sinon.match.any)
          .resolves(contractBalanceMock);

        sinon
          .stub(mirrorNodeInstance, 'getContractState')
          .withArgs(contractId, sinon.match.any, sinon.match.any)
          .resolves(contractStateMock);

        // With onlyTopCall=true, it should only include top-level actions (call_depth=0)
        const result = await debugService.prestateTracer(transactionHash, true, requestDetails);

        expect(Object.keys(result).length).to.be.at.least(1);
        expect(result).to.have.property(accountEvmAddress);
        expect(result[accountEvmAddress]).to.deep.equal({
          balance: '0x100000000',
          nonce: 2,
          code: '0x',
          storage: {},
        });
      });

      it('should return cached results when available', async function () {
        // Create stubs that return expected data AND track calls
        const getContractsResultsActionsStub = sinon
          .stub(mirrorNodeInstance, 'getContractsResultsActions')
          .withArgs(transactionHash, sinon.match.any)
          .resolves(actionsResponseMock);

        const resolveEntityTypeStub = sinon.stub(mirrorNodeInstance, 'resolveEntityType').callsFake(async (address) => {
          if (address === contractAddress) {
            return contractEntityMock;
          } else if (address === accountAddress) {
            return accountEntityMock;
          }
          return null;
        });

        const getBalanceAtTimestampStub = sinon
          .stub(mirrorNodeInstance, 'getBalanceAtTimestamp')
          .withArgs(contractId, sinon.match.any, sinon.match.any)
          .resolves(contractBalanceMock);

        const getContractStateStub = sinon
          .stub(mirrorNodeInstance, 'getContractState')
          .withArgs(contractId, sinon.match.any, sinon.match.any)
          .resolves(contractStateMock);

        // First call should fetch from API
        const firstResult = await debugService.prestateTracer(transactionHash, false, requestDetails);

        // Verify the first result is correct
        expect(firstResult).to.deep.equal(expectedResult);

        // Verify that the methods were called during the first request
        expect(getContractsResultsActionsStub.called).to.be.true;
        expect(resolveEntityTypeStub.called).to.be.true;

        // Reset call counts for the stubs
        getContractsResultsActionsStub.resetHistory();
        resolveEntityTypeStub.resetHistory();
        getBalanceAtTimestampStub.resetHistory();
        getContractStateStub.resetHistory();

        // Second call should use cache
        const secondResult = await debugService.prestateTracer(transactionHash, false, requestDetails);

        // Results should be identical
        expect(secondResult).to.deep.equal(firstResult);

        // Verify that the methods were NOT called during the second request
        expect(getContractsResultsActionsStub.called).to.be.false;
        expect(resolveEntityTypeStub.called).to.be.false;
        expect(getBalanceAtTimestampStub.called).to.be.false;
        expect(getContractStateStub.called).to.be.false;
      });

      it('should handle empty actions array', async function () {
        // Set up empty actions response
        sinon
          .stub(mirrorNodeInstance, 'getContractsResultsActions')
          .withArgs(transactionHash, sinon.match.any)
          .resolves([]);

        const result = await debugService.prestateTracer(transactionHash, false, requestDetails);
        expect(result).to.deep.equal({});
      });

      it('should return empty array when the transaction hash is not found', async function () {
        // Create a separate DebugImpl instance just for this test
        const isolatedDebugService = new DebugImpl(mirrorNodeInstance, logger, cacheService);

        // Mock the API call to throw the expected error
        restMock.onGet(`contracts/results/${nonExistentTransactionHash}/actions`).reply(
          404,
          JSON.stringify({
            _status: {
              messages: [{ message: 'Not found' }],
            },
          }),
        );

        // Make sure no sinon stubs interfere
        const getContractsResultsActionsStub = sinon.stub(mirrorNodeInstance, 'getContractsResultsActions');
        getContractsResultsActionsStub.callThrough(); // Let it use the original method which will hit the mock

        // The test should now properly throw the expected error
        const result = await isolatedDebugService.prestateTracer(nonExistentTransactionHash, false, requestDetails);
        expect(result).to.deep.equal({});
      });

      it('should handle entity resolution errors', async function () {
        sinon
          .stub(mirrorNodeInstance, 'getContractsResultsActions')
          .withArgs(transactionHash, sinon.match.any)
          .resolves(actionsResponseMock);

        sinon.stub(mirrorNodeInstance, 'resolveEntityType').callsFake(async (address) => {
          if (address === contractAddress) {
            throw new Error('Failed to resolve contract');
          } else if (address === accountAddress) {
            return accountEntityMock;
          }
          return null;
        });

        sinon
          .stub(mirrorNodeInstance, 'getBalanceAtTimestamp')
          .withArgs(sinon.match.any, sinon.match.any, sinon.match.any)
          .resolves(contractBalanceMock);

        const result = await debugService.prestateTracer(transactionHash, false, requestDetails);

        expect(Object.keys(result)).to.have.lengthOf(1);
        expect(result).to.have.property(accountEvmAddress);
        expect(result).to.not.have.property(contractEvmAddress);

        expect(result[accountEvmAddress]).to.have.all.keys(['balance', 'nonce', 'code', 'storage']);
      });

      it('should handle entities without EVM address', async function () {
        sinon
          .stub(mirrorNodeInstance, 'getContractsResultsActions')
          .withArgs(transactionHash, sinon.match.any)
          .resolves(actionsResponseMock);

        sinon.stub(mirrorNodeInstance, 'resolveEntityType').callsFake(async (address) => {
          if (address === contractAddress) {
            return { ...contractEntityMock, entity: { ...contractEntityMock.entity, evm_address: null } };
          } else if (address === accountAddress) {
            return accountEntityMock;
          }
          return null;
        });

        sinon
          .stub(mirrorNodeInstance, 'getBalanceAtTimestamp')
          .withArgs(sinon.match.any, sinon.match.any, sinon.match.any)
          .resolves(contractBalanceMock);

        const result = await debugService.prestateTracer(transactionHash, false, requestDetails);

        expect(Object.keys(result)).to.have.lengthOf(1);
        expect(result).to.have.property(accountEvmAddress);

        expect(result[accountEvmAddress]).to.deep.equal({
          balance: '0x100000000',
          nonce: 2,
          code: '0x',
          storage: {},
        });
      });
    });
  });
});
