// SPDX-License-Identifier: Apache-2.0

import { ConfigService } from '@hashgraph/json-rpc-config-service/dist/services';
import MockAdapter from 'axios-mock-adapter';
import chai, { expect } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { EventEmitter } from 'events';
import pino from 'pino';
import { register, Registry } from 'prom-client';

import { predefined } from '../../src';
import { numberTo0x, strip0x } from '../../src/formatters';
import { MirrorNodeClient } from '../../src/lib/clients';
import { IOpcodesResponse } from '../../src/lib/clients/models/IOpcodesResponse';
import constants, { TracerType } from '../../src/lib/constants';
import { EvmAddressHbarSpendingPlanRepository } from '../../src/lib/db/repositories/hbarLimiter/evmAddressHbarSpendingPlanRepository';
import { HbarSpendingPlanRepository } from '../../src/lib/db/repositories/hbarLimiter/hbarSpendingPlanRepository';
import { IPAddressHbarSpendingPlanRepository } from '../../src/lib/db/repositories/hbarLimiter/ipAddressHbarSpendingPlanRepository';
import { DebugImpl } from '../../src/lib/debug';
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
  const prestateTracer: TracerType = TracerType.PrestateTracer;
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
    const blockNumber = '0x2a'; // Block number in hex format (42)
    const blockTimestamp = { from: '1696438011.462526383', to: '1696438015.462526383' };

    beforeEach(() => {
      const blockResponse = {
        blocks: [
          {
            number: 42,
            timestamp: { from: blockTimestamp.from, to: blockTimestamp.to },
          },
        ],
      };

      // Mock for getting block response - must match what getHistoricalBlockResponse expects
      restMock.onGet(`${BLOCKS_ENDPOINT}/${blockNumber}`).reply(
        200,
        JSON.stringify({
          number: 42,
          timestamp: { from: blockTimestamp.from, to: blockTimestamp.to },
        }),
      );
      restMock.onGet(`${BLOCKS_ENDPOINT}/latest`).reply(200, JSON.stringify(blockResponse));

      // Add mock for latest blocks query
      restMock.onGet(`${BLOCKS_ENDPOINT}?limit=1&order=desc`).reply(200, JSON.stringify(blockResponse));

      // Add mock for decimal block number (42)
      restMock.onGet(`${BLOCKS_ENDPOINT}/42`).reply(
        200,
        JSON.stringify({
          number: 42,
          timestamp: { from: blockTimestamp.from, to: blockTimestamp.to },
        }),
      );

      // Mock contract results based on timestamp range
      const timestampRangeParams = `?timestamp=gte:${blockTimestamp.from}&timestamp=lte:${blockTimestamp.to}&limit=100&order=asc`;

      const contractResultsResponse = {
        results: [
          {
            hash: transactionHash,
            result: 'SUCCESS',
            transaction_index: 0,
            block_number: 42,
            block_hash:
              '0x4a25d11dc95a339bd6d8c4558f9f4c420e68a06f453fe2266e905c5c583f7948a159ee0cb0ec1d031d692d746f93d760',
          },
          {
            hash: '0xc0ffee254a6b68de33dc659a99cb674a3a3e5b3afec22c63b965ded1e91d8285',
            result: 'SUCCESS',
            transaction_index: 0,
            block_number: 42,
            block_hash:
              '0x4a25d11dc95a339bd6d8c4558f9f4c420e68a06f453fe2266e905c5c583f7948a159ee0cb0ec1d031d692d746f93d760',
          },
          {
            hash: '0xddba254a6b68de33dc659a99cb674a3a3e5b3afec22c63b965ded1e91dddddd',
            result: 'WRONG_NONCE',
            transaction_index: 0,
            block_number: 42,
            block_hash:
              '0x4a25d11dc95a339bd6d8c4558f9f4c420e68a06f453fe2266e905c5c583f7948a159ee0cb0ec1d031d692d746f93d760',
          },
        ],
      };

      restMock.onGet(`contracts/results${timestampRangeParams}`).reply(200, JSON.stringify(contractResultsResponse));
      restMock.onGet(`contracts/results/${transactionHash}`).reply(200, JSON.stringify(contractsResultsByHashResult));
      restMock
        .onGet(`contracts/results/0xc0ffee254a6b68de33dc659a99cb674a3a3e5b3afec22c63b965ded1e91d8285`)
        .reply(200, JSON.stringify(contractsResultsByHashResult));

      // Reuse the existing contract results mocks
      restMock.onGet(CONTARCTS_RESULTS_ACTIONS).reply(200, JSON.stringify(contractsResultsActionsResult));

      // Also mock actions for the second transaction hash
      restMock
        .onGet(`contracts/results/0xc0ffee254a6b68de33dc659a99cb674a3a3e5b3afec22c63b965ded1e91d8285/actions`)
        .reply(200, JSON.stringify(contractsResultsActionsResult));

      restMock.onGet(CONTRACTS_RESULTS_BY_HASH).reply(200, JSON.stringify(contractsResultsByHashResult));
      restMock.onGet(CONTRACT_BY_ADDRESS).reply(200, JSON.stringify(contractResult));
      restMock.onGet(SENDER_BY_ADDRESS).reply(200, JSON.stringify(accountsResult));
      restMock.onGet(CONTRACT_BY_ADDRESS2).reply(200, JSON.stringify(contractResultSecond));

      // Mock entity resolution for the addresses
      restMock.onGet(`entity/${contractAddress}`).reply(
        200,
        JSON.stringify({
          type: 'contract',
          entity_id: '0.0.1033',
        }),
      );

      restMock.onGet(`entity/${senderAddress}`).reply(
        200,
        JSON.stringify({
          type: 'account',
          entity_id: '0.0.1016',
        }),
      );

      // Additional mocks for prestateTracer
      const contractEntityResponse = {
        contract_id: '0.0.1033',
        evm_address: '0x637a6a8e5a69c087c24983b05261f63f64ed7e9b',
        timestamp: { from: '1696438000.000000000', to: '1696438011.462526383' },
        nonce: 5,
        runtime_bytecode: '0x60806040',
      };

      const accountEntityResponse = {
        evm_address: '0xc37f417fa09933335240fca72dd257bfbde9c275',
        ethereum_nonce: 1,
        balance: { balance: 1000 },
      };

      const balanceResponse = {
        balances: [{ balance: 500 }],
      };

      const stateResponse = {
        state: [
          { slot: '0x01', value: '0x0a' },
          { slot: '0x02', value: '0x0b' },
        ],
      };

      // Mock contract data for prestateTracer
      restMock.onGet(CONTRACT_BY_ADDRESS).reply(200, JSON.stringify(contractEntityResponse));
      restMock.onGet(SENDER_BY_ADDRESS).reply(200, JSON.stringify(accountEntityResponse));

      // Mock balance and state for prestateTracer
      restMock.onGet(`balances?account.id=0.0.1033`).reply(200, JSON.stringify(balanceResponse));
      restMock.onGet(/contracts\/0\.0\.1033\/state\?timestamp=.*/).reply(200, JSON.stringify(stateResponse));

      // Configure opcode logger mock for any transaction hash
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
      cacheService.clear(requestDetails).then();
    });

    withOverriddenEnvsInMochaTest({ DEBUG_API_ENABLED: undefined }, () => {
      it('should throw UNSUPPORTED_METHOD when debug API is not enabled', async function () {
        await RelayAssertions.assertRejection(
          predefined.UNSUPPORTED_METHOD,
          debugService.traceBlockByNumber,
          true,
          debugService,
          [blockNumber, { tracer: callTracer, tracerConfig: tracerConfigFalse }, requestDetails],
        );
      });
    });

    withOverriddenEnvsInMochaTest({ DEBUG_API_ENABLED: false }, () => {
      it('should throw UNSUPPORTED_METHOD when debug API is explicitly disabled', async function () {
        await RelayAssertions.assertRejection(
          predefined.UNSUPPORTED_METHOD,
          debugService.traceBlockByNumber,
          true,
          debugService,
          [blockNumber, { tracer: callTracer, onlyTopCall: false }, requestDetails],
        );
      });
    });

    withOverriddenEnvsInMochaTest({ DEBUG_API_ENABLED: true }, () => {
      it('should return results for multiple transactions with callTracer', async function () {
        const result = await debugService.traceBlockByNumber(
          blockNumber,
          { tracer: callTracer, onlyTopCall: false },
          requestDetails,
        );

        expect(result).to.be.an('array');
        expect(result).to.have.length(2); // Two successful transactions (SUCCESS), one with WRONG_NONCE is filtered out

        // Verify each result has the expected format
        result.forEach((item) => {
          expect(item).to.have.property('txHash');
          expect(item).to.have.property('result');
        });
      });

      it('should return results with prestateTracer', async function () {
        // Create a special action response for prestateTracer with a simpler format
        const prestateActionsResponse = {
          actions: [
            {
              call_depth: 0,
              call_operation_type: 'CALL',
              call_type: 'CALL',
              from: senderAddress,
              to: contractAddress,
              gas: 247000,
              gas_used: 77324,
              input: '0x',
              result_data: '0x',
            },
          ],
        };

        // Mock the actions for both transaction hashes
        restMock
          .onGet(`contracts/results/${transactionHash}/actions`)
          .reply(200, JSON.stringify(prestateActionsResponse));
        restMock
          .onGet(`contracts/results/0xc0ffee254a6b68de33dc659a99cb674a3a3e5b3afec22c63b965ded1e91d8285/actions`)
          .reply(200, JSON.stringify(prestateActionsResponse));

        const result = await debugService.traceBlockByNumber(blockNumber, { tracer: prestateTracer }, requestDetails);

        expect(result).to.be.an('array');
        expect(result).to.have.length(2); // Two successful transactions

        // Verify each result has the expected format
        result.forEach((item) => {
          expect(item).to.have.property('txHash');
          expect(item).to.have.property('result');

          // Verify the structure of the result matches what prestateTracer should return
          const prestate = item.result;

          // Check for contract address result format
          const contractEvmAddress = '0x637a6a8e5a69c087c24983b05261f63f64ed7e9b';
          expect(prestate).to.have.property(contractEvmAddress);
          expect(prestate[contractEvmAddress]).to.have.property('balance').that.is.a('string').and.match(/^0x/);
          expect(prestate[contractEvmAddress]).to.have.property('nonce').that.is.a('number');
          expect(prestate[contractEvmAddress]).to.have.property('code').that.is.a('string').and.match(/^0x/);
          expect(prestate[contractEvmAddress]).to.have.property('storage').that.is.an('object');

          // Check for account address result format
          const accountEvmAddress = '0xc37f417fa09933335240fca72dd257bfbde9c275';
          expect(prestate).to.have.property(accountEvmAddress);
          expect(prestate[accountEvmAddress]).to.have.property('balance').that.is.a('string').and.match(/^0x/);
          expect(prestate[accountEvmAddress]).to.have.property('nonce').that.is.a('number');
          expect(prestate[accountEvmAddress]).to.have.property('code').that.equals('0x');
          expect(prestate[accountEvmAddress]).to.have.property('storage').that.deep.equals({});
        });
      });

      it('should return empty array when no transactions found in block', async function () {
        // Mock empty contract results
        const emptyTimestampRangeParams = `?timestamp=gte:${blockTimestamp.from}&timestamp=lte:${blockTimestamp.to}&limit=100&order=asc`;
        restMock.onGet(`contracts/results${emptyTimestampRangeParams}`).reply(200, JSON.stringify({ results: [] }));

        const result = await debugService.traceBlockByNumber(
          blockNumber,
          { tracer: callTracer, onlyTopCall: false },
          requestDetails,
        );

        expect(result).to.be.an('array');
        expect(result).to.have.length(0);
      });

      it('should return empty array when block is not found', async function () {
        // Reset mocks and set up a completely fresh environment
        restMock.reset();

        // Need to mock the block not found but also provide the necessary mocks for getHistoricalBlockResponse
        restMock.onGet(`${BLOCKS_ENDPOINT}/${blockNumber}`).reply(404, null);
        restMock.onGet(`${BLOCKS_ENDPOINT}/latest`).reply(
          200,
          JSON.stringify({
            blocks: [
              {
                number: 100, // Different block number
                timestamp: { from: '1696438020.000000000', to: '1696438025.000000000' },
              },
            ],
          }),
        );

        // Also need to mock the block by number using decimal
        restMock.onGet(`${BLOCKS_ENDPOINT}/42`).reply(404, null);

        // And the latest block query that's used as a fallback
        restMock.onGet(`${BLOCKS_ENDPOINT}?limit=1&order=desc`).reply(
          200,
          JSON.stringify({
            blocks: [
              {
                number: 100, // Different block number
                timestamp: { from: '1696438020.000000000', to: '1696438025.000000000' },
              },
            ],
          }),
        );

        const result = await debugService.traceBlockByNumber(
          blockNumber,
          { tracer: callTracer, onlyTopCall: false },
          requestDetails,
        );

        expect(result).to.be.an('array');
        expect(result).to.have.length(0);
      });

      it('should handle "latest" block tag', async function () {
        const result = await debugService.traceBlockByNumber(
          'latest',
          { tracer: callTracer, onlyTopCall: false },
          requestDetails,
        );

        expect(result).to.be.an('array');
        expect(result).to.have.length(2);
      });

      it('should handle errors during trace execution', async function () {
        // Reset all mocks first
        restMock.reset();

        // Set up the minimum mocks required for the test to fail at the right point
        restMock.onGet(`${BLOCKS_ENDPOINT}/${blockNumber}`).reply(
          200,
          JSON.stringify({
            number: 42,
            timestamp: { from: blockTimestamp.from, to: blockTimestamp.to },
          }),
        );

        // This is the error point we want to trigger
        const errorRangeParams = `?timestamp=gte:${blockTimestamp.from}&timestamp=lte:${blockTimestamp.to}&limit=100&order=asc`;
        restMock.onGet(`contracts/results${errorRangeParams}`).reply(500);

        try {
          await debugService.traceBlockByNumber(
            blockNumber,
            { tracer: callTracer, onlyTopCall: false },
            requestDetails,
          );
          // If we get here, the test failed because no error was thrown
          expect.fail('Expected an error to be thrown');
        } catch (error) {
          // Just verify that an error is thrown, specific properties are too implementation-dependent
          expect(error).to.be.an('error');
        }
      });

      it('should filter out transactions with WRONG_NONCE result', async function () {
        const result = await debugService.traceBlockByNumber(
          blockNumber,
          { tracer: callTracer, onlyTopCall: false },
          requestDetails,
        );

        expect(result).to.be.an('array');
        expect(result).to.have.length(2); // Only SUCCESS transactions included

        // Verify all txHashes don't include the one with WRONG_NONCE
        const txHashes = result.map((item) => item.txHash);
        expect(txHashes).to.not.include('0xddba254a6b68de33dc659a99cb674a3a3e5b3afec22c63b965ded1e91dddddd');
      });
    });
  });

  describe('Helper Methods Test Suite', async function () {
    this.timeout(10000);
    beforeEach(async function () {
      restMock.reset();
      web3Mock.reset();
      await cacheService.clear(requestDetails);
    });

    describe('prestateTracer', async function () {
      const requestDetails = new RequestDetails({ requestId: 'debugTest', ipAddress: '0.0.0.0' });
      const transactionHash = '0xb7a433b014684558d4154c73de3ed360bd5867725239938c2143acb7a76bca82';
      const CONTARCTS_RESULTS_ACTIONS = `contracts/results/${transactionHash}/actions`;

      const contractAddress = '0x0000000000000000000000000000000000000409';
      const accountAddress = '0x00000000000000000000000000000000000003f7';
      const CONTRACT_RESOLVE = `contracts/${contractAddress}`;
      const ACCOUNT_RESOLVE = `accounts/${accountAddress}?transactions=false`;

      const actionsResponse = {
        actions: [
          {
            call_depth: 0,
            call_operation_type: 'CALL',
            call_type: 'CALL',
            caller: '0.0.1016',
            caller_type: 'ACCOUNT',
            from: accountAddress,
            gas: 247000,
            gas_used: 77324,
            index: 0,
            input: '0x',
            recipient: '0.0.1033',
            recipient_type: 'CONTRACT',
            result_data: '0x',
            result_data_type: 'OUTPUT',
            timestamp: '1696438011.462526383',
            to: contractAddress,
            value: 100,
          },
        ],
      };

      const contractEntity = {
        type: 'contract',
        entity: {
          evm_address: '0x637a6a8e5a69c087c24983b05261f63f64ed7e9b',
          contract_id: '0.0.1033',
          timestamp: { from: '1696438000.000000000', to: '1696438011.462526383' },
          nonce: 5,
          runtime_bytecode: '0x60806040',
        },
      };

      const accountEntity = {
        type: 'account',
        entity: {
          evm_address: '0xc37f417fa09933335240fca72dd257bfbde9c275',
          ethereum_nonce: 1,
          balance: { balance: 1000 },
        },
      };

      const balanceResponse = {
        balances: [{ balance: 500 }],
      };

      const stateResponse = {
        state: [
          { slot: '0x01', value: '0x0a' },
          { slot: '0x02', value: '0x0b' },
        ],
      };

      describe('when contract actions exist', async function () {
        beforeEach(() => {
          restMock.onGet(CONTARCTS_RESULTS_ACTIONS).reply(200, JSON.stringify(actionsResponse));
        });

        it('should return pre-state information for contracts', async function () {
          // Setup mocks for contract resolving and state retrieval
          // First set up entity type resolution
          restMock
            .onGet(`entity/${contractAddress}`)
            .reply(200, JSON.stringify({ type: 'contract', entity_id: '0.0.1033' }));

          // Then setup contract data retrieval
          restMock.onGet(CONTRACT_RESOLVE).reply(200, JSON.stringify(contractEntity.entity));

          // Setup balance response
          restMock
            .onGet(`balances?account.id=${contractEntity.entity.contract_id}`)
            .reply(200, JSON.stringify(balanceResponse));

          // Setup contract state response
          restMock
            .onGet(
              `contracts/${contractEntity.entity.contract_id}/state?timestamp=${encodeURIComponent(
                contractEntity.entity.timestamp.to,
              )}&limit=100&order=desc`,
            )
            .reply(200, JSON.stringify(stateResponse));

          const result = await debugService.prestateTracer(transactionHash, false, requestDetails);

          expect(result).to.exist;
          expect(result[contractEntity.entity.evm_address]).to.exist;
          expect(result[contractEntity.entity.evm_address].balance).to.equal(
            numberTo0x(balanceResponse.balances[0].balance),
          );
          expect(result[contractEntity.entity.evm_address].nonce).to.equal(contractEntity.entity.nonce);
          expect(result[contractEntity.entity.evm_address].code).to.equal(contractEntity.entity.runtime_bytecode);
          expect(result[contractEntity.entity.evm_address].storage['0x01']).to.equal('0x0a');
          expect(result[contractEntity.entity.evm_address].storage['0x02']).to.equal('0x0b');
        });

        it('should return pre-state information for accounts', async function () {
          // Setup mocks for account resolving
          // First set up entity type resolution
          restMock
            .onGet(`entity/${accountAddress}`)
            .reply(200, JSON.stringify({ type: 'account', entity_id: '0.0.1016' }));

          // Then setup account data retrieval
          restMock.onGet(ACCOUNT_RESOLVE).reply(200, JSON.stringify(accountEntity.entity));

          const result = await debugService.prestateTracer(transactionHash, false, requestDetails);

          expect(result).to.exist;
          expect(result[accountEntity.entity.evm_address]).to.exist;
          expect(result[accountEntity.entity.evm_address].balance).to.equal(
            numberTo0x(accountEntity.entity.balance.balance),
          );
          expect(result[accountEntity.entity.evm_address].nonce).to.equal(accountEntity.entity.ethereum_nonce);
          expect(result[accountEntity.entity.evm_address].code).to.equal('0x');
          expect(result[accountEntity.entity.evm_address].storage).to.deep.equals({});
        });

        it('should return combined pre-state for both contract and account', async function () {
          // Setup mocks for both contract and account
          // Contract entity resolution
          restMock
            .onGet(`entity/${contractAddress}`)
            .reply(200, JSON.stringify({ type: 'contract', entity_id: '0.0.1033' }));

          // Contract data
          restMock.onGet(CONTRACT_RESOLVE).reply(200, JSON.stringify(contractEntity.entity));

          // Setup balance response
          restMock
            .onGet(`balances?account.id=${contractEntity.entity.contract_id}`)
            .reply(200, JSON.stringify(balanceResponse));

          // Contract state
          restMock
            .onGet(
              `contracts/${contractEntity.entity.contract_id}/state?timestamp=${encodeURIComponent(
                contractEntity.entity.timestamp.to,
              )}&limit=100&order=desc`,
            )
            .reply(200, JSON.stringify(stateResponse));

          // Account entity resolution
          restMock
            .onGet(`entity/${accountAddress}`)
            .reply(200, JSON.stringify({ type: 'account', entity_id: '0.0.1016' }));

          // Account data
          restMock.onGet(ACCOUNT_RESOLVE).reply(200, JSON.stringify(accountEntity.entity));

          const result = await debugService.prestateTracer(transactionHash, false, requestDetails);

          expect(result).to.exist;
          expect(result[contractEntity.entity.evm_address]).to.exist;
          expect(result[accountEntity.entity.evm_address]).to.exist;
        });

        it('should handle address with no entity type', async function () {
          // Setup mock for non-existent entity
          restMock.onGet(`entity/${contractAddress}`).reply(404);

          const result = await debugService.prestateTracer(transactionHash, false, requestDetails);
          expect(result).to.deep.equal({});
        });

        it('should handle address with no evm_address', async function () {
          // Setup mock for entity without evm_address
          const entityWithoutEvmAddress = { ...contractEntity };
          entityWithoutEvmAddress.entity = {
            ...contractEntity.entity,
            evm_address: null as unknown as string,
          };

          // Entity type resolution
          restMock
            .onGet(`entity/${contractAddress}`)
            .reply(200, JSON.stringify({ type: 'contract', entity_id: '0.0.1033' }));

          // Contract data without evm_address
          restMock.onGet(CONTRACT_RESOLVE).reply(200, JSON.stringify(entityWithoutEvmAddress.entity));

          const result = await debugService.prestateTracer(transactionHash, false, requestDetails);
          expect(result).to.deep.equal({});
        });

        it('should filter actions by call_depth when onlyTopCall is true', async function () {
          // Create actions with different call depths
          const actionsWithDepth = {
            actions: [
              {
                call_depth: 0,
                call_operation_type: 'CALL',
                call_type: 'CALL',
                caller: '0.0.1016',
                caller_type: 'ACCOUNT',
                from: accountAddress,
                gas: 247000,
                gas_used: 77324,
                index: 0,
                input: '0x',
                recipient: '0.0.1033',
                recipient_type: 'CONTRACT',
                result_data: '0x',
                result_data_type: 'OUTPUT',
                timestamp: '1696438011.462526383',
                to: contractAddress,
                value: 100,
              },
              {
                call_depth: 1, // This should be filtered out when onlyTopCall=true
                call_operation_type: 'CALL',
                call_type: 'CALL',
                caller: '0.0.1033',
                caller_type: 'CONTRACT',
                from: contractAddress,
                gas: 200000,
                gas_used: 50000,
                index: 1,
                input: '0x',
                recipient: '0.0.1016',
                recipient_type: 'ACCOUNT',
                result_data: '0x',
                result_data_type: 'OUTPUT',
                timestamp: '1696438011.462526383',
                to: accountAddress,
                value: 0,
              },
            ],
          };

          // Override the default actions response with our custom one
          restMock.onGet(CONTARCTS_RESULTS_ACTIONS).reply(200, JSON.stringify(actionsWithDepth));

          // Set up entity resolution for both addresses
          restMock
            .onGet(`entity/${contractAddress}`)
            .reply(200, JSON.stringify({ type: 'contract', entity_id: '0.0.1033' }));
          restMock
            .onGet(`entity/${accountAddress}`)
            .reply(200, JSON.stringify({ type: 'account', entity_id: '0.0.1016' }));

          // Set up contract and account data
          restMock.onGet(CONTRACT_RESOLVE).reply(200, JSON.stringify(contractEntity.entity));
          restMock.onGet(ACCOUNT_RESOLVE).reply(200, JSON.stringify(accountEntity.entity));

          // Set up balance response
          restMock
            .onGet(`balances?account.id=${contractEntity.entity.contract_id}`)
            .reply(200, JSON.stringify(balanceResponse));

          // Set up contract state
          restMock
            .onGet(
              `contracts/${contractEntity.entity.contract_id}/state?timestamp=${encodeURIComponent(
                contractEntity.entity.timestamp.to,
              )}&limit=100&order=desc`,
            )
            .reply(200, JSON.stringify(stateResponse));

          // Test with onlyTopCall=true
          const resultWithTopCallOnly = await debugService.prestateTracer(transactionHash, true, requestDetails);

          // When onlyTopCall is true, we should only see addresses from the top-level call
          // The top-level call is from accountAddress to contractAddress
          expect(Object.keys(resultWithTopCallOnly)).to.have.lengthOf(2);
          expect(resultWithTopCallOnly).to.have.property(contractEntity.entity.evm_address);
          expect(resultWithTopCallOnly).to.have.property(accountEntity.entity.evm_address);

          // Create a mock with a nested call that has a different from/to than the top call
          const actionsWithDifferentNestedCall = {
            actions: [
              {
                call_depth: 0,
                call_operation_type: 'CALL',
                call_type: 'CALL',
                from: accountAddress,
                gas: 247000,
                gas_used: 77324,
                to: contractAddress,
                value: 100,
              },
              {
                call_depth: 1,
                call_operation_type: 'CALL',
                call_type: 'CALL',
                from: contractAddress,
                gas: 200000,
                gas_used: 50000,
                to: '0x000000000000000000000000000000000000040a', // Different address
                value: 0,
              },
            ],
          };

          // Override the actions response
          restMock.onGet(CONTARCTS_RESULTS_ACTIONS).reply(200, JSON.stringify(actionsWithDifferentNestedCall));

          // Mock the entity resolution for the new address
          restMock
            .onGet(`entity/0x000000000000000000000000000000000000040a`)
            .reply(200, JSON.stringify({ type: 'contract', entity_id: '0.0.1034' }));

          // Mock the contract data
          restMock.onGet(`contracts/0x000000000000000000000000000000000000040a`).reply(
            200,
            JSON.stringify({
              evm_address: '0x91b1c451777122afc9b83f9b96160d7e59847ad7',
              contract_id: '0.0.1034',
              timestamp: { from: '1696438000.000000000', to: '1696438011.462526383' },
              nonce: 1,
              runtime_bytecode: '0x60806040',
            }),
          );

          // Mock the balance response
          restMock.onGet(`balances?account.id=0.0.1034`).reply(200, JSON.stringify(balanceResponse));

          // Mock the contract state
          restMock
            .onGet(
              `contracts/0.0.1034/state?timestamp=${encodeURIComponent(
                contractEntity.entity.timestamp.to,
              )}&limit=100&order=desc`,
            )
            .reply(200, JSON.stringify(stateResponse));

          // Test with onlyTopCall=true
          const resultWithNestedCall = await debugService.prestateTracer(transactionHash, true, requestDetails);

          // Should not include the nested call address
          expect(resultWithNestedCall).to.not.have.property('0x91b1c451777122afc9b83f9b96160d7e59847ad7');

          // Test with onlyTopCall=false
          const resultWithAllNestedCalls = await debugService.prestateTracer(transactionHash, false, requestDetails);

          // Should include all addresses
          expect(Object.keys(resultWithAllNestedCalls).length).to.be.at.least(3);
        });

        it('should handle onlyTopCall parameter when there are no nested calls', async function () {
          // With only top-level calls, both true and false should yield the same result
          const resultWithTopCallOnly = await debugService.prestateTracer(transactionHash, true, requestDetails);
          const resultWithAllCalls = await debugService.prestateTracer(transactionHash, false, requestDetails);

          // Both should have the same keys since there are no nested calls
          expect(Object.keys(resultWithTopCallOnly)).to.deep.equal(Object.keys(resultWithAllCalls));
        });

        it('should return empty object when no addresses in actions', async function () {
          const emptyActionsResponse = { actions: [] };
          restMock.onGet(CONTARCTS_RESULTS_ACTIONS).reply(200, JSON.stringify(emptyActionsResponse));

          const result = await debugService.prestateTracer(transactionHash, false, requestDetails);
          expect(result).to.deep.equal({});
        });
      });

      describe('when contract actions do not exist', async function () {
        it('should throw RESOURCE_NOT_FOUND when actions response is null', async function () {
          restMock.onGet(CONTARCTS_RESULTS_ACTIONS).reply(404);

          const expectedError = predefined.RESOURCE_NOT_FOUND(
            `Failed to retrieve contract results for transaction ${transactionHash}`,
          );

          await RelayAssertions.assertRejection(expectedError, debugService.prestateTracer, true, debugService, [
            transactionHash,
            false,
            requestDetails,
          ]);
        });

        it('should return empty object when no addresses in actions', async function () {
          const emptyActionsResponse = { actions: [] };
          restMock.onGet(CONTARCTS_RESULTS_ACTIONS).reply(200, JSON.stringify(emptyActionsResponse));

          const result = await debugService.prestateTracer(transactionHash, false, requestDetails);
          expect(result).to.deep.equal({});
        });
      });
    });
  });
});
