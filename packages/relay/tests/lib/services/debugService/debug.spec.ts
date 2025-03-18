// SPDX-License-Identifier: Apache-2.0

import { ConfigService } from '@hashgraph/json-rpc-config-service/dist/services';
import MockAdapter from 'axios-mock-adapter';
import chai, { expect } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import pino from 'pino';
import { Registry } from 'prom-client';

import { predefined } from '../../../../src';
import { strip0x } from '../../../../src/formatters';
import { MirrorNodeClient } from '../../../../src/lib/clients';
import { IOpcodesResponse } from '../../../../src/lib/clients/models/IOpcodesResponse';
import { TracerType } from '../../../../src/lib/constants';
import { DebugImpl } from '../../../../src/lib/debug';
import { CacheService } from '../../../../src/lib/services/cacheService/cacheService';
import { CommonService } from '../../../../src/lib/services/ethService';
import { RequestDetails } from '../../../../src/lib/types';
import RelayAssertions from '../../../assertions';
import { getQueryParams, withOverriddenEnvsInMochaTest } from '../../../helpers';

chai.use(chaiAsPromised);

const logger = pino({ level: 'silent' });
const registry = new Registry();

let restMock: typeof MockAdapter;
let web3Mock: typeof MockAdapter;
let mirrorNodeInstance: MirrorNodeClient;
let debugService: DebugImpl;
let cacheService: CacheService;

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

    restMock = new MockAdapter(mirrorNodeInstance.getMirrorNodeRestInstance(), { onNoMatch: 'throwException' });
    web3Mock = new MockAdapter(mirrorNodeInstance.getMirrorNodeWeb3Instance(), { onNoMatch: 'throwException' });

    const common = new CommonService(mirrorNodeInstance, logger, cacheService);
    debugService = new DebugImpl(mirrorNodeInstance, logger, common);
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
});
