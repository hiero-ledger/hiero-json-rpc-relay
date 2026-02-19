// SPDX-License-Identifier: Apache-2.0

import { ConfigService } from '@hashgraph/json-rpc-config-service/dist/services';
import MockAdapter from 'axios-mock-adapter';
import chai, { expect } from 'chai';
import chaiAsPromised from 'chai-as-promised';
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
import { Block } from '../../src/lib/model';
import { CommonService } from '../../src/lib/services';
import HAPIService from '../../src/lib/services/hapiService/hapiService';
import { HbarLimitService } from '../../src/lib/services/hbarLimitService';
import { RequestDetails } from '../../src/lib/types';
import RelayAssertions from '../assertions';
import { getQueryParams, withOverriddenEnvsInMochaTest } from '../helpers';
import { generateEthTestEnv } from './eth/eth-helpers';

chai.use(chaiAsPromised);

const logger = pino({ level: 'silent' });
const registry = new Registry();

let restMock: MockAdapter;
let web3Mock: MockAdapter;
let mirrorNodeInstance: MirrorNodeClient;
let debugService: DebugImpl;

describe('Debug API Test Suite', async function () {
  this.timeout(10000);
  const { cacheService } = generateEthTestEnv(true);
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
  const tracerObjectCallTracerFalse = { tracer: callTracer, tracerConfig: tracerConfigFalse };
  const tracerObjectCallTracerTrue = { tracer: callTracer, tracerConfig: tracerConfigTrue };
  const CONTRACTS_RESULTS_OPCODES = `contracts/results/${transactionHash}/opcodes`;
  const CONTARCTS_RESULTS_ACTIONS = `contracts/results/${transactionHash}/actions`;
  const CONTRACTS_RESULTS_BY_HASH = `contracts/results/${transactionHash}`;
  const CONTRACT_BY_ADDRESS = `contracts/${contractAddress}`;
  const SENDER_BY_ADDRESS = `accounts/${senderAddress}?transactions=false`;
  const ACCOUNT_BY_ADDRESS = `accounts/${accountAddress}?transactions=false`;
  const CONTRACT_BY_ADDRESS2 = `contracts/${contractAddress2}`;
  const CONTRACTS_RESULTS_BY_NON_EXISTENT_HASH = `contracts/results/${nonExistentTransactionHash}`;
  const CONTRACT_RESULTS_BY_ACTIONS_NON_EXISTENT_HASH = `contracts/results/${nonExistentTransactionHash}/actions`;

  // Synthetic transaction test data
  const syntheticTxHash = '0xb9a433b014684558d4154c73de3ed360bd5867725239938c2143acb7a76bca82';
  const syntheticTxHash2 = '0xb9a433b014684558d4154c73de3ed360bd5867725239938c2143acb7a76bca83';
  const CONTRACT_RESULTS_LOGS_SYNTHETIC = `contracts/results/logs?transaction.hash=${syntheticTxHash}&limit=100&order=asc`;
  const CONTRACTS_RESULTS_ACTIONS_SYNTHETIC = `contracts/results/${syntheticTxHash}/actions`;
  const CONTRACTS_RESULTS_SYNTHETIC = `contracts/results/${syntheticTxHash}`;
  const CONTRACTS_RESULTS_OPCODES_SYNTHETIC = `contracts/results/${syntheticTxHash}/opcodes`;

  // Standard ERC-20/HTS Transfer event signature: keccak256("Transfer(address,address,uint256)")
  const TRANSFER_EVENT_SIGNATURE = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

  const syntheticLog = {
    address: contractAddress,
    block_hash: '0xa4c97b684587a2f1fc42e14ae743c336b97c58f752790482d12e44919f2ccb062807df5c9c0fa9a373b4d9726707f8b5',
    block_number: 668,
    data: '0x0000000000000000000000000000000000000000000000000000000000000064',
    index: 0,
    timestamp: '1696438011.462526383',
    topics: [
      TRANSFER_EVENT_SIGNATURE,
      `0x000000000000000000000000${senderAddress.slice(2)}`,
      `0x000000000000000000000000${accountAddress.slice(2)}`,
    ],
    transaction_hash: syntheticTxHash,
    transaction_index: 1,
  };

  const syntheticLog2 = {
    address: contractAddress2,
    block_hash: '0xa4c97b684587a2f1fc42e14ae743c336b97c58f752790482d12e44919f2ccb062807df5c9c0fa9a373b4d9726707f8b5',
    block_number: 668,
    data: '0x00000000000000000000000000000000000000000000000000000000000000c8',
    index: 1,
    timestamp: '1696438012.462526383',
    topics: [
      TRANSFER_EVENT_SIGNATURE,
      `0x000000000000000000000000${accountAddress.slice(2)}`,
      `0x000000000000000000000000${senderAddress.slice(2)}`,
    ],
    transaction_hash: syntheticTxHash2,
    transaction_index: 2,
  };

  const syntheticCallTracerResult1 = {
    type: 'CALL',
    from: senderAddress,
    to: accountAddress,
    value: '0x64',
    gas: '0x0',
    gasUsed: '0x0',
    input: '0x',
    output: '0x',
  };

  const syntheticCallTracerResult2 = {
    type: 'CALL',
    from: accountAddress,
    to: senderAddress,
    value: '0xc8',
    gas: '0x0',
    gasUsed: '0x0',
    input: '0x',
    output: '0x',
  };

  // Helper to reduce repetition when creating CREATE actions for tests
  const makeCreateAction = (overrides: Partial<any> = {}) => ({
    call_depth: 0,
    call_operation_type: 'CREATE',
    call_type: 'CREATE',
    caller: '0.0.1016',
    caller_type: 'ACCOUNT',
    from: senderAddress,
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
    value: 0,
    ...overrides,
  });

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
      makeCreateAction({ index: 0 }),
      makeCreateAction({
        call_depth: 1,
        caller: '0.0.1033',
        caller_type: 'CONTRACT',
        from: contractAddress,
        gas: 189733,
        gas_used: 75,
        index: 1,
        recipient: '0.0.1034',
        recipient_type: 'CONTRACT',
        to: contractAddress2,
      }),
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
    mirrorNodeInstance = new MirrorNodeClient(
      ConfigService.get('MIRROR_NODE_URL')!,
      logger.child({ name: `mirror-node` }),
      registry,
      cacheService,
    );
    const duration = constants.HBAR_RATE_LIMIT_DURATION;

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
    new HAPIService(logger, registry, hbarLimitService);

    restMock = new MockAdapter(mirrorNodeInstance.getMirrorNodeRestInstance(), { onNoMatch: 'throwException' });

    web3Mock = new MockAdapter(mirrorNodeInstance.getMirrorNodeWeb3Instance(), { onNoMatch: 'throwException' });

    // Create the debug service
    debugService = new DebugImpl(mirrorNodeInstance, logger, cacheService, ConfigService.get('CHAIN_ID'));
  });

  this.beforeEach(() => {
    cacheService.clear();
  });

  describe('debug_getRawBlock', async function () {
    const blockNumber = '0x160c';
    const blockHash = '0xcf55eb0655b5d21c38413afe1919099a83140514cb6c531aebd77e3d2c5506ce';

    beforeEach(() => {
      sinon.restore();
    });

    withOverriddenEnvsInMochaTest({ DEBUG_API_ENABLED: true }, () => {
      it('should return "0x" when block is not found using block number', async function () {
        sinon.stub(debugService['blockService'], 'getBlockByNumber').resolves(null);
        const result = await debugService.getRawBlock(blockNumber, requestDetails);
        expect(result).to.equal('0x');
      });

      it('should return "0x" when block is not found using block hash', async function () {
        sinon.stub(debugService['blockService'], 'getBlockByHash').resolves(null);
        const result = await debugService.getRawBlock(blockHash, requestDetails);
        expect(result).to.equal('0x');
      });

      it('should return a RLP block for existing block', async () => {
        const blockInfo = {
          timestamp: '0x698afa66',
          difficulty: '0x0',
          extraData: '0x',
          gasLimit: '0x1c9c380',
          baseFeePerGas: '0xd63445f000',
          gasUsed: '0xa32c1',
          logsBloom:
            '0x0000000000000000000000000000000000000000400000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000a200000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000040000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000800000000000000',
          miner: '0x0000000000000000000000000000000000000000',
          mixHash: '0x0000000000000000000000000000000000000000000000000000000000000000',
          nonce: '0x0000000000000000',
          receiptsRoot: '0x26c9ecffe4aa9e2e19f814a570bd1e9093ff55e9e6c18f39f4192de6e36153db',
          sha3Uncles: '0x1dcc4de8dec75d7aab85b567b6ccd41ad312451b948a7413f0a142fd40d49347',
          size: '0x1b81',
          stateRoot: '0x56e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421',
          totalDifficulty: '0x0',
          transactions: [
            {
              blockHash: '0xcf55eb0655b5d21c38413afe1919099a83140514cb6c531aebd77e3d2c5506ce',
              blockNumber: '0x1de1f54',
              chainId: '0x128',
              from: '0xbe04a4900b02fe715c75ff307f0b531894184c91',
              gas: '0xc2860',
              gasPrice: '0x0',
              hash: '0x4454bdc6328e6cafb477c76af5e6a72dcb9f97e5aa79d76900f8ca65712a8151',
              input:
                '0xef7615ce00000000000000000000000000000000000000000000000000000000000000c0000000000000000000000000000000000000000000000000000000000000012000000000000000000000000085614ea608c5dd326ba83aeaaacc7eb9d090e0d40000000000000000000000000000000000000000000000000000000000000160000000000000000000000000000000000000000000000000000000000000019800000000000000000000000000000000000000000000000000000000000002e0000000000000000000000000000000000000000000000000000000000000002436623739366561382d303635622d343133322d383266642d38653766613334626338623900000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000672616e616a69000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001586b615258536e5a6f62384c6c5a6c3270327351367134426337385977553175564473746b42756b66724652306556304f6e3750504c4a324a7262655157717443474c5170797579367559686a725138685a6c4f646242485831484741616277544147397a61483068504d4765336c7136682f665a5a5266316b6161626b356c34476d352f4b6a516e4746654a52776a55753565546775305242507338314b416238444735304e6c77524544616f5547635762376c514c504b656e6b354d4f5064662f31504c58546f383461793333307a77446e61786a46584f30783239373761786e4548365879696c5941784b636c7954397963793766477a6b4d724a6a757a376850486767436d4652315a68664a5252334778684c647a366f4336424b497554506154524b52566e63345742585432454577494c2f514d4542422f764d4a695a326733665a576e563572595962446c6e42326338773d3d000000000000000000000000000000000000000000000000000000000000000000000000000000415f0770f2c509e8cb0c3dacceca295e43657f1232c62c9f2d542d8754a6a94720500abc4b95446945a686675fc1e1768506390f5aa2be98ef2e58727d8893b99f1c00000000000000000000000000000000000000000000000000000000000000',
              nonce: '0x168a',
              r: '0xabbfb012c0b774997edcf782a256e55590325962f7a96ffb64467a323c84733f',
              s: '0x60627cc8fc5be8d28dbec3de0835769f1140604eae6bb732dbc60b7aba4274aa',
              to: '0xdd902a9d02d570d92e5d94b095bf6b7a4106773a',
              transactionIndex: '0xf',
              type: '0x2',
              v: '0x0',
              value: '0x0',
              yParity: '0x0',
              accessList: [],
              maxPriorityFeePerGas: '0x62',
              maxFeePerGas: '0x62',
            },
          ],
          transactionsRoot: '0xcf55eb0655b5d21c38413afe1919099a83140514cb6c531aebd77e3d2c5506ce',
          uncles: [],
          withdrawals: [],
          withdrawalsRoot: '0x0000000000000000000000000000000000000000000000000000000000000000',
          number: '0x1de1f54',
          hash: '0xcf55eb0655b5d21c38413afe1919099a83140514cb6c531aebd77e3d2c5506ce',
          parentHash: '0xd7dbe6b1379e3e1d71729a92e167af28d6b79aa9e40b0f6d845fe7b85c500bfa',
        };

        const expectedRlpHex =
          '0xf905fc' +
          'a0' +
          'd7dbe6b1379e3e1d71729a92e167af28d6b79aa9e40b0f6d845fe7b85c500bfa' + // parent hash
          'a0' +
          '1dcc4de8dec75d7aab85b567b6ccd41ad312451b948a7413f0a142fd40d49347' + // ommersHash
          '94' +
          '0000000000000000000000000000000000000321' + // beneficiary
          'a0' +
          '56e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421' + // stateRoot
          'a0' +
          'cf55eb0655b5d21c38413afe1919099a83140514cb6c531aebd77e3d2c5506ce' + // transactionsRoot
          'a0' +
          '26c9ecffe4aa9e2e19f814a570bd1e9093ff55e9e6c18f39f4192de6e36153db' + // receiptsRoot
          'b9' +
          '01000000000000000000000000000000000000000000400000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000a200000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000040000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000800000000000000' + // logsBloom
          '00' + // difficulty
          '84' +
          '01de1f54' + // number
          '84' +
          '01c9c380' + // gasLimit
          '83' +
          '0a32c1' + // gasUsed
          '84' +
          '698afa66' + // timestamp
          '80' + // extraData
          'a0' +
          '0000000000000000000000000000000000000000000000000000000000000000' + // prevrandao
          '88' +
          '0000000000000000' + // nonce
          '85' +
          'd63445f000' + // baseFeePerGas
          'a0' +
          '0000000000000000000000000000000000000000000000000000000000000000' + // withdrawalsRoot
          'f903d4b903d1' + // transactions array
          '02' + // type
          'f903cd' + // length
          '82' +
          '0128' + // chain id
          '82' +
          '168a' + // nonce
          '62' + // max priority fee per gas
          '62' + // max fee per gas
          '83' +
          '0c2860' + // gas limit
          '94' +
          'dd902a9d02d570d92e5d94b095bf6b7a4106773a' + // to
          '80' + // value
          'b90364' +
          'ef7615ce00000000000000000000000000000000000000000000000000000000000000c0000000000000000000000000000000000000000000000000000000000000012000000000000000000000000085614ea608c5dd326ba83aeaaacc7eb9d090e0d40000000000000000000000000000000000000000000000000000000000000160000000000000000000000000000000000000000000000000000000000000019800000000000000000000000000000000000000000000000000000000000002e0000000000000000000000000000000000000000000000000000000000000002436623739366561382d303635622d343133322d383266642d38653766613334626338623900000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000672616e616a69000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001586b615258536e5a6f62384c6c5a6c3270327351367134426337385977553175564473746b42756b66724652306556304f6e3750504c4a324a7262655157717443474c5170797579367559686a725138685a6c4f646242485831484741616277544147397a61483068504d4765336c7136682f665a5a5266316b6161626b356c34476d352f4b6a516e4746654a52776a55753565546775305242507338314b416238444735304e6c77524544616f5547635762376c514c504b656e6b354d4f5064662f31504c58546f383461793333307a77446e61786a46584f30783239373761786e4548365879696c5941784b636c7954397963793766477a6b4d724a6a757a376850486767436d4652315a68664a5252334778684c647a366f4336424b497554506154524b52566e63345742585432454577494c2f514d4542422f764d4a695a326733665a576e563572595962446c6e42326338773d3d000000000000000000000000000000000000000000000000000000000000000000000000000000415f0770f2c509e8cb0c3dacceca295e43657f1232c62c9f2d542d8754a6a94720500abc4b95446945a686675fc1e1768506390f5aa2be98ef2e58727d8893b99f1c00000000000000000000000000000000000000000000000000000000000000' + // input
          'c0' + // access list
          '80' + // v
          'a0' +
          'abbfb012c0b774997edcf782a256e55590325962f7a96ffb64467a323c84733f' + // r
          'a0' +
          '60627cc8fc5be8d28dbec3de0835769f1140604eae6bb732dbc60b7aba4274aa' + // s
          'c0' + // ommers
          'c0'; // withdrawals

        sinon.stub(debugService['blockService'], 'getBlockByHash').resolves(blockInfo as Block);
        const result = await debugService.getRawBlock(blockHash, requestDetails);
        expect(result).to.equal(expectedRlpHex);
      });
    });
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
          tracerObjectCallTracerFalse,
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
            tracerObjectCallTracerFalse,
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
            calls: [],
          };
          const result = await debugService.traceTransaction(
            transactionHash,
            tracerObjectCallTracerTrue,
            requestDetails,
          );

          expect(result).to.deep.equal(expectedResult);
        });
        it('should return empty calls array when using callTracer with single action (no internal calls)', async function () {
          const singleActionResponse = {
            actions: [contractsResultsActionsResult.actions[0]], // Only the root action
          };
          restMock.onGet(CONTARCTS_RESULTS_ACTIONS).reply(200, JSON.stringify(singleActionResponse));

          const result = await debugService.traceTransaction(
            transactionHash,
            tracerObjectCallTracerFalse,
            requestDetails,
          );

          const expectedResult = {
            type: 'CREATE',
            from: accountsResult.evm_address,
            to: contractResult.evm_address,
            value: '0x0',
            gas: '0x493e0',
            gasUsed: '0x3a980',
            input: '0x1',
            output: '0x2',
            calls: [],
          };

          expect(result).to.deep.equal(expectedResult);
        });

        describe('synthetic transaction handling', async function () {
          it('should return minimal trace for synthetic transaction with Transfer event topics', async function () {
            restMock.onGet(CONTRACTS_RESULTS_ACTIONS_SYNTHETIC).reply(404);
            restMock.onGet(CONTRACTS_RESULTS_SYNTHETIC).reply(404);
            restMock.onGet(CONTRACT_RESULTS_LOGS_SYNTHETIC).reply(200, JSON.stringify({ logs: [syntheticLog] }));
            // Mock address resolution for synthetic transaction addresses
            restMock.onGet(SENDER_BY_ADDRESS).reply(200, JSON.stringify(accountsResult));
            restMock.onGet(ACCOUNT_BY_ADDRESS).reply(200, JSON.stringify({ evm_address: accountAddress }));

            const result = await debugService.traceTransaction(
              syntheticTxHash,
              tracerObjectCallTracerFalse,
              requestDetails,
            );

            const expectedResult = {
              type: 'CALL',
              from: accountsResult.evm_address,
              to: accountAddress,
              gas: '0x61a80',
              gasUsed: '0x0',
              value: '0x0',
              input: '0x',
              output: '0x',
              calls: [],
            };

            expect(result).to.deep.equal(expectedResult);
          });

          it('should use log address as from/to when topics are insufficient', async function () {
            const logWithoutTopics = {
              ...syntheticLog,
              topics: [TRANSFER_EVENT_SIGNATURE], // Only event signature
            };

            restMock.onGet(CONTRACTS_RESULTS_ACTIONS_SYNTHETIC).reply(404);
            restMock.onGet(CONTRACTS_RESULTS_SYNTHETIC).reply(404);
            restMock.onGet(CONTRACT_RESULTS_LOGS_SYNTHETIC).reply(200, JSON.stringify({ logs: [logWithoutTopics] }));
            // Mock address resolution for log.address
            restMock.onGet(CONTRACT_BY_ADDRESS).reply(200, JSON.stringify(contractResult));

            const result = await debugService.traceTransaction(
              syntheticTxHash,
              tracerObjectCallTracerFalse,
              requestDetails,
            );

            expect(result.from).to.equal(contractResult.evm_address);
            expect(result.to).to.equal(contractResult.evm_address);
            expect(result.type).to.equal('CALL');
          });

          it('should throw RESOURCE_NOT_FOUND when no contract results and no logs exist', async function () {
            restMock.onGet(CONTRACTS_RESULTS_ACTIONS_SYNTHETIC).reply(404);
            restMock.onGet(CONTRACTS_RESULTS_SYNTHETIC).reply(404);
            restMock.onGet(CONTRACT_RESULTS_LOGS_SYNTHETIC).reply(200, JSON.stringify({ logs: [] }));

            await RelayAssertions.assertRejection(
              predefined.RESOURCE_NOT_FOUND(`Failed to retrieve transaction information for ${syntheticTxHash}`),
              debugService.traceTransaction,
              true,
              debugService,
              [syntheticTxHash, tracerObjectCallTracerFalse, requestDetails],
            );
          });

          [
            { label: 'empty', result: [] },
            { label: 'missing', result: undefined },
            { label: 'malformed', result: [{}] },
          ].forEach(({ label, result }) => {
            it(`should fallback to synthetic transaction handling for ${label} non-synthetic data`, async function () {
              restMock.onGet(CONTRACT_RESULTS_LOGS_SYNTHETIC).reply(200, JSON.stringify({ logs: [syntheticLog] }));
              restMock.onGet(CONTRACTS_RESULTS_ACTIONS_SYNTHETIC).reply(200, JSON.stringify({ actions: result }));
              restMock.onGet(CONTRACTS_RESULTS_SYNTHETIC).reply(200, JSON.stringify(contractsResultsByHashResult));
              restMock.onGet(SENDER_BY_ADDRESS).reply(200, JSON.stringify(accountsResult));
              restMock.onGet(ACCOUNT_BY_ADDRESS).reply(200, JSON.stringify({ evm_address: accountAddress }));
              const { type } = await debugService.traceTransaction(
                syntheticTxHash,
                tracerObjectCallTracerFalse,
                requestDetails,
              );
              expect(type).to.equal('CALL');
            });
          });
        });

        describe('tinybars to weibars conversion', async function () {
          const conversionTestCases = [
            {
              name: 'should convert amount from tinybars to weibars',
              amount: 100,
              expectedValue: '0xe8d4a51000', // 100 tinybars = 100 * 10^10 weibars = 10^12 weibars
            },
            {
              name: 'should return 0x0 for zero amount',
              amount: 0,
              expectedValue: '0x0',
            },
            {
              name: 'should return 0x0 for null amount',
              amount: null,
              expectedValue: '0x0',
            },
            {
              name: 'should convert large amount (1 HBAR) from tinybars to weibars',
              amount: 100_000_000, // 1 HBAR = 100_000_000 tinybars = 10^18 weibars
              expectedValue: '0xde0b6b3a7640000',
            },
          ];

          conversionTestCases.forEach(({ name, amount, expectedValue }) => {
            it(`${name} in callTracer response`, async function () {
              const contractsResultsWithAmount = {
                ...contractsResultsByHashResult,
                amount,
              };

              restMock.onGet(CONTRACTS_RESULTS_BY_HASH).reply(200, JSON.stringify(contractsResultsWithAmount));

              const result = await debugService.traceTransaction(
                transactionHash,
                tracerObjectCallTracerFalse,
                requestDetails,
              );

              expect(result.value).to.equal(expectedValue);
            });
          });
        });
      });

      describe('opcodeLogger', async function () {
        withOverriddenEnvsInMochaTest({ OPCODELOGGER_ENABLED: false }, () => {
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

              const tracerObject = { tracer: opcodeLogger, tracerConfig: config };
              const result = await debugService.traceTransaction(transactionHash, tracerObject, requestDetails);

              expect(result).to.deep.equal(expectedResult);
            });
          });
        }

        describe('synthetic transaction handling', async function () {
          it('should return minimal opcode result for synthetic transaction', async function () {
            const defaultOpcodeParams = getQueryParams({ memory: false, stack: true, storage: true });
            web3Mock.onGet(`${CONTRACTS_RESULTS_OPCODES_SYNTHETIC}${defaultOpcodeParams}`).reply(404);
            // Mock contract result (returns 404 for synthetic tx)
            restMock.onGet(CONTRACTS_RESULTS_SYNTHETIC).reply(404);
            restMock.onGet(CONTRACT_RESULTS_LOGS_SYNTHETIC).reply(200, JSON.stringify({ logs: [syntheticLog] }));

            const tracerObject = { tracer: opcodeLogger, tracerConfig: {} };
            const result = await debugService.traceTransaction(syntheticTxHash, tracerObject, requestDetails);

            const expectedResult = {
              gas: 0,
              failed: false,
              returnValue: '',
              structLogs: [],
            };

            expect(result).to.deep.equal(expectedResult);
          });

          it('should throw RESOURCE_NOT_FOUND when no opcodes and no logs exist', async function () {
            const defaultOpcodeParams = getQueryParams({ memory: false, stack: true, storage: true });
            web3Mock.onGet(`${CONTRACTS_RESULTS_OPCODES_SYNTHETIC}${defaultOpcodeParams}`).reply(404);
            // Mock contract result (returns 404)
            restMock.onGet(CONTRACTS_RESULTS_SYNTHETIC).reply(404);
            restMock.onGet(CONTRACT_RESULTS_LOGS_SYNTHETIC).reply(200, JSON.stringify({ logs: [] }));

            const tracerObject = { tracer: opcodeLogger, tracerConfig: {} };
            await RelayAssertions.assertRejection(
              predefined.RESOURCE_NOT_FOUND(`Failed to retrieve transaction information for ${syntheticTxHash}`),
              debugService.traceTransaction,
              true,
              debugService,
              [syntheticTxHash, tracerObject, requestDetails],
            );
          });
        });
      });

      describe('prestateTracer', async function () {
        const prestateTracer: TracerType = TracerType.PrestateTracer;
        const mockPrestateResult = {
          '0xc37f417fa09933335240fca72dd257bfbde9c275': {
            balance: '0x100000000',
            nonce: 2,
            code: '0x',
            storage: {},
          },
          '0x637a6a8e5a69c087c24983b05261f63f64ed7e9b': {
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
          sinon.stub(debugService, 'prestateTracer').resolves(mockPrestateResult);
        });

        afterEach(() => {
          sinon.restore();
        });

        it('should successfully trace transaction with prestateTracer', async function () {
          const tracerObject = { tracer: prestateTracer };
          const result = await debugService.traceTransaction(transactionHash, tracerObject, requestDetails);

          expect(result).to.deep.equal(mockPrestateResult);
          expect(result).to.be.an('object');
          expect(Object.keys(result)).to.have.lengthOf(2);

          for (const address of Object.keys(result)) {
            expect(result[address]).to.have.all.keys(['balance', 'nonce', 'code', 'storage']);
            expect(result[address].nonce).to.be.a('number');
            expect(result[address].code).to.exist;
            expect(result[address].storage).to.be.an('object');
          }
        });

        it('should trace transaction with prestateTracer and onlyTopCall=true', async function () {
          const tracerObject = { tracer: prestateTracer, tracerConfig: { onlyTopCall: true } };
          const result = await debugService.traceTransaction(transactionHash, tracerObject, requestDetails);

          expect(result).to.deep.equal(mockPrestateResult);

          // Verify that prestateTracer was called with onlyTopCall=true
          const prestateTracerStub = debugService.prestateTracer as sinon.SinonStub;
          expect(prestateTracerStub.calledOnce).to.be.true;
          expect(prestateTracerStub.calledWith(transactionHash, true, requestDetails)).to.be.true;
        });

        it('should trace transaction with prestateTracer and onlyTopCall=false (default)', async function () {
          const tracerObject = { tracer: prestateTracer, tracerConfig: { onlyTopCall: false } };
          const result = await debugService.traceTransaction(transactionHash, tracerObject, requestDetails);

          expect(result).to.deep.equal(mockPrestateResult);

          // Verify that prestateTracer was called with onlyTopCall=false
          const prestateTracerStub = debugService.prestateTracer as sinon.SinonStub;
          expect(prestateTracerStub.calledOnce).to.be.true;
          expect(prestateTracerStub.calledWith(transactionHash, false, requestDetails)).to.be.true;
        });

        it('should handle empty prestate result', async function () {
          const emptyResult = {};
          (debugService.prestateTracer as sinon.SinonStub).resolves(emptyResult);

          const tracerObject = { tracer: prestateTracer };
          const result = await debugService.traceTransaction(transactionHash, tracerObject, requestDetails);

          expect(result).to.deep.equal(emptyResult);
          expect(result).to.be.an('object');
          expect(Object.keys(result)).to.have.lengthOf(0);
        });

        it('should propagate errors from prestateTracer', async function () {
          const expectedError = predefined.RESOURCE_NOT_FOUND('Failed to retrieve contract results');
          (debugService.prestateTracer as sinon.SinonStub).rejects(expectedError);

          const tracerObject = { tracer: prestateTracer };

          await RelayAssertions.assertRejection(expectedError, debugService.traceTransaction, true, debugService, [
            transactionHash,
            tracerObject,
            requestDetails,
          ]);
        });

        describe('synthetic transaction handling', async function () {
          beforeEach(() => {
            sinon.restore();
          });

          it('should return empty prestate for synthetic transaction', async function () {
            restMock.onGet(CONTRACTS_RESULTS_ACTIONS_SYNTHETIC).reply(404);
            // Mock contract result (returns 404 for synthetic tx)
            restMock.onGet(CONTRACTS_RESULTS_SYNTHETIC).reply(404);
            restMock.onGet(CONTRACT_RESULTS_LOGS_SYNTHETIC).reply(200, JSON.stringify({ logs: [syntheticLog] }));

            const result = await debugService.prestateTracer(syntheticTxHash, false, requestDetails);

            expect(result).to.deep.equal({});
            expect(result).to.be.an('object');
          });

          it('should throw RESOURCE_NOT_FOUND when no actions and no logs exist', async function () {
            restMock.onGet(CONTRACTS_RESULTS_ACTIONS_SYNTHETIC).reply(404);
            // Mock contract result (returns 404)
            restMock.onGet(CONTRACTS_RESULTS_SYNTHETIC).reply(404);
            restMock.onGet(CONTRACT_RESULTS_LOGS_SYNTHETIC).reply(200, JSON.stringify({ logs: [] }));

            await expect(debugService.prestateTracer(syntheticTxHash, false, requestDetails)).to.be.rejectedWith(
              'Failed to retrieve transaction information',
            );
          });
        });
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
          restMock
            .onGet(`contracts/results/logs?transaction.hash=${nonExistentTransactionHash}&limit=100&order=asc`)
            .reply(200, JSON.stringify({ logs: [] }));
        });

        afterEach(() => {
          restMock.reset();
        });

        it('test case for non-existing transaction hash', async function () {
          const expectedError = predefined.RESOURCE_NOT_FOUND(
            `Failed to retrieve transaction information for ${nonExistentTransactionHash}`,
          );

          await RelayAssertions.assertRejection(expectedError, debugService.traceTransaction, true, debugService, [
            nonExistentTransactionHash,
            tracerObjectCallTracerTrue,
            requestDetails,
          ]);
        });

        it('should return empty result with invalid parameters in formatOpcodeResult', async function () {
          const opcodeResult = await debugService.formatOpcodesResult(null, {});
          expect(opcodeResult.gas).to.eq(0);
          expect(opcodeResult.failed).to.eq(true);
          expect(opcodeResult.returnValue).to.eq('');
          expect(opcodeResult.structLogs).to.be.an('array').that.is.empty;
        });

        describe('resolveAddress', async function () {
          it('should return null address with invalid parameters in resolveAddress', async function () {
            const address = await debugService.resolveAddress(null, requestDetails);
            expect(address).to.be.null;
          });

          it('should return passed address on notFound entity from the mirror node', async function () {
            restMock.onGet(ACCOUNT_BY_ADDRESS).reply(404, JSON.stringify(notFound));
            const address = await debugService.resolveAddress(accountAddress, requestDetails);
            expect(address).to.eq(accountAddress);
          });
        });

        describe('formatActionsResult with CREATE actions', async function () {
          it('should handle CREATE with to=null and return expected fields', async function () {
            const createActionWithNullTo = {
              actions: [makeCreateAction({ to: null, input: '0x608060405234801561001057600080fd5b50', index: 0 })],
            };

            restMock.onGet(SENDER_BY_ADDRESS).reply(200, JSON.stringify(accountsResult));

            const result = await debugService.formatActionsResult(createActionWithNullTo.actions, requestDetails);

            expect(result).to.be.an('array').with.lengthOf(1);
            expect(result[0]).to.have.property('type', 'CREATE');
            expect(result[0]).to.have.property('from', '0xc37f417fa09933335240fca72dd257bfbde9c275');
            expect(result[0]).to.have.property('to', null);
            expect(result[0]).to.have.property('input', '0x608060405234801561001057600080fd5b50');
          });

          it('should handle CREATE with to=null and skip getContract call', async function () {
            const createActionWithNullTo = {
              actions: [makeCreateAction({ to: null, input: '0x608060405234801561001057600080fd5b50', index: 1 })],
            };

            restMock.onGet(SENDER_BY_ADDRESS).reply(200, JSON.stringify(accountsResult));
            // No mock for getContract call - should not be called
            const getContractSpy = sinon.spy(mirrorNodeInstance, 'getContract');
            const result = await debugService.formatActionsResult(createActionWithNullTo.actions, requestDetails);

            expect(result).to.be.an('array').with.lengthOf(1);
            expect(result[0]).to.have.property('type', 'CREATE');
            expect(result[0]).to.have.property('to', null);
            expect(result[0]).to.have.property('input', '0x608060405234801561001057600080fd5b50');
            expect(result[0]).to.have.property('output', '0x');
            // Ensure getContract was never invoked with a null/undefined id (i.e., for 'to')
            const calledWithNullId = getContractSpy.getCalls().some((c) => c.args[0] == null);
            expect(calledWithNullId).to.be.false;
            getContractSpy.restore();
          });
        });

        describe('formatActionsResult tinybars to weibars conversion', async function () {
          const singleActionTestCases = [
            {
              name: 'should convert action value from tinybars to weibars',
              value: 100,
              expectedValue: '0xe8d4a51000', // 100 tinybars = 100 * 10^10 weibars
            },
            {
              name: 'should return 0x0 for zero value',
              value: 0,
              expectedValue: '0x0',
            },
            {
              name: 'should return 0x0 for null value',
              value: null,
              expectedValue: '0x0',
            },
            {
              name: 'should return 0x0 for undefined value',
              value: undefined,
              expectedValue: '0x0',
            },
            {
              name: 'should convert large value (1 HBAR) from tinybars to weibars',
              value: 100_000_000, // 1 HBAR = 100_000_000 tinybars = 10^18 weibars
              expectedValue: '0xde0b6b3a7640000',
            },
          ];

          singleActionTestCases.forEach(({ name, value, expectedValue }) => {
            it(`${name} in formatActionsResult`, async function () {
              const actionWithValue = {
                actions: [makeCreateAction({ value, index: 0 })],
              };

              restMock.onGet(SENDER_BY_ADDRESS).reply(200, JSON.stringify(accountsResult));

              const result = await debugService.formatActionsResult(actionWithValue.actions, requestDetails);

              expect(result).to.be.an('array').with.lengthOf(1);
              expect(result[0]).to.have.property('value', expectedValue);
            });
          });

          it('should convert multiple action values from tinybars to weibars', async function () {
            const multipleActionsTestCases = [
              { value: 100, expectedValue: '0xe8d4a51000' },
              { value: 200, expectedValue: '0x1d1a94a2000' },
            ];

            const actionsWithValues = {
              actions: [
                makeCreateAction({ value: multipleActionsTestCases[0].value, index: 0 }),
                makeCreateAction({
                  call_depth: 1,
                  value: multipleActionsTestCases[1].value,
                  index: 1,
                  from: contractAddress,
                  to: contractAddress2,
                }),
              ],
            };

            restMock.onGet(SENDER_BY_ADDRESS).reply(200, JSON.stringify(accountsResult));
            restMock.onGet(CONTRACT_BY_ADDRESS).reply(200, JSON.stringify(contractResult));
            restMock.onGet(CONTRACT_BY_ADDRESS2).reply(200, JSON.stringify(contractResultSecond));

            const result = await debugService.formatActionsResult(actionsWithValues.actions, requestDetails);

            expect(result).to.be.an('array').with.lengthOf(2);
            multipleActionsTestCases.forEach((testCase, index) => {
              expect(result[index]).to.have.property('value', testCase.expectedValue);
            });
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
      from: '0x00000000000000000000000000000000005d9d73',
      to: null,
      gas_limit: 100000,
      amount: 0,
      function_parameters: '0x',
      error_message: null,
    };
    const contractResultMaxGasLimitExceeded = {
      hash: '0xjkl012',
      result: 'MAX_GAS_LIMIT_EXCEEDED',
      from: '0x00000000000000000000000000000000005d9d73',
      to: null,
      gas_limit: 100000000,
      amount: 0,
      function_parameters: '0x',
      error_message: '0x4d41585f4741535f4c494d49545f4558434545444544',
    };
    const emptyCallTracerResult = {
      type: 'CALL',
      from: '0x00000000000000000000000000000000005d9d73',
      to: '0x0',
      gas: '0x0',
      gasUsed: '0x0',
      input: '0x',
      output: '0x',
      value: '0x0',
      error: 'WRONG_NONCE',
      revertReason: 'WRONG_NONCE',
      calls: [],
    };
    const emptyCallTracerResultMaxGas = {
      type: 'CALL',
      from: '0x00000000000000000000000000000000005d9d73',
      to: '0x0',
      gas: '0x0',
      gasUsed: '0x0',
      input: '0x',
      output: '0x',
      value: '0x0',
      error: 'MAX_GAS_LIMIT_EXCEEDED',
      revertReason: 'MAX_GAS_LIMIT_EXCEEDED',
      calls: [],
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
      cacheService.clear();
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
        // Mock the logs endpoint for getAllTransactionHashesFromBlock
        sinon.stub(mirrorNodeInstance, 'getContractResultsLogsWithRetry').resolves([]);

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
          // Mock the logs endpoint for getAllTransactionHashesFromBlock
          sinon.stub(mirrorNodeInstance, 'getContractResultsLogsWithRetry').resolves([]);
        });

        it('should trace block with CallTracer and return empty trace for WRONG_NONCE results', async function () {
          sinon
            .stub(mirrorNodeInstance, 'getContractResultWithRetry')
            .resolves([contractResult1, contractResult2, contractResultWrongNonce]);

          sinon
            .stub(debugService, 'callTracer')
            .withArgs(contractResult1.hash, sinon.match.any, sinon.match.any, sinon.match.any, sinon.match.any)
            .resolves(callTracerResult1)
            .withArgs(contractResult2.hash, sinon.match.any, sinon.match.any, sinon.match.any, sinon.match.any)
            .resolves(callTracerResult2)
            .withArgs(contractResultWrongNonce.hash, sinon.match.any, sinon.match.any, sinon.match.any, sinon.match.any)
            .resolves(emptyCallTracerResult);

          const result = await debugService.traceBlockByNumber(
            blockNumber,
            { tracer: TracerType.CallTracer, tracerConfig: { onlyTopCall: false } },
            requestDetails,
          );

          expect(result).to.be.an('array').with.lengthOf(3);
          expect(result[0]).to.deep.equal({ txHash: contractResult1.hash, result: callTracerResult1 });
          expect(result[1]).to.deep.equal({ txHash: contractResult2.hash, result: callTracerResult2 });
          expect(result[2]).to.deep.equal({ txHash: contractResultWrongNonce.hash, result: emptyCallTracerResult });
        });

        it('should trace block with CallTracer and return empty trace for MAX_GAS_LIMIT_EXCEEDED results', async function () {
          sinon
            .stub(mirrorNodeInstance, 'getContractResultWithRetry')
            .resolves([contractResult1, contractResult2, contractResultMaxGasLimitExceeded]);

          sinon
            .stub(debugService, 'callTracer')
            .withArgs(contractResult1.hash, sinon.match.any, sinon.match.any, sinon.match.any, sinon.match.any)
            .resolves(callTracerResult1)
            .withArgs(contractResult2.hash, sinon.match.any, sinon.match.any, sinon.match.any, sinon.match.any)
            .resolves(callTracerResult2)
            .withArgs(
              contractResultMaxGasLimitExceeded.hash,
              sinon.match.any,
              sinon.match.any,
              sinon.match.any,
              sinon.match.any,
            )
            .resolves(emptyCallTracerResultMaxGas);

          const result = await debugService.traceBlockByNumber(
            blockNumber,
            { tracer: TracerType.CallTracer, tracerConfig: { onlyTopCall: false } },
            requestDetails,
          );

          expect(result).to.be.an('array').with.lengthOf(3);
          expect(result[0]).to.deep.equal({ txHash: contractResult1.hash, result: callTracerResult1 });
          expect(result[1]).to.deep.equal({ txHash: contractResult2.hash, result: callTracerResult2 });
          expect(result[2]).to.deep.equal({
            txHash: contractResultMaxGasLimitExceeded.hash,
            result: emptyCallTracerResultMaxGas,
          });
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
          // Mock the logs endpoint for getAllTransactionHashesFromBlock
          sinon.stub(mirrorNodeInstance, 'getContractResultsLogsWithRetry').resolves([]);
        });

        it('should trace block with PrestateTracer and return empty prestate for WRONG_NONCE results', async function () {
          sinon
            .stub(mirrorNodeInstance, 'getContractResultWithRetry')
            .resolves([contractResult1, contractResult2, contractResultWrongNonce]);

          sinon
            .stub(debugService, 'prestateTracer')
            .withArgs(contractResult1.hash, sinon.match.any, sinon.match.any, sinon.match.any, sinon.match.any)
            .resolves(prestateTracerResult1)
            .withArgs(contractResult2.hash, sinon.match.any, sinon.match.any, sinon.match.any, sinon.match.any)
            .resolves(prestateTracerResult2)
            .withArgs(contractResultWrongNonce.hash, sinon.match.any, sinon.match.any, sinon.match.any, sinon.match.any)
            .resolves({});

          const result = await debugService.traceBlockByNumber(
            blockNumber,
            { tracer: TracerType.PrestateTracer, tracerConfig: { onlyTopCall: true } },
            requestDetails,
          );

          expect(result).to.be.an('array').with.lengthOf(3);
          expect(result[0]).to.deep.equal({ txHash: contractResult1.hash, result: prestateTracerResult1 });
          expect(result[1]).to.deep.equal({ txHash: contractResult2.hash, result: prestateTracerResult2 });
          expect(result[2]).to.deep.equal({ txHash: contractResultWrongNonce.hash, result: {} });
        });
      });

      describe('with synthetic transactions', async function () {
        beforeEach(() => {
          const getHistoricalBlockResponseStub = sinon.stub().resolves(blockResponse);
          sinon.stub(CommonService.prototype, 'getHistoricalBlockResponse').callsFake(getHistoricalBlockResponseStub);

          sinon.stub(cacheService, 'getAsync').resolves(null);
          sinon.stub(cacheService, 'set').resolves();
        });

        it('should trace block with both EVM and synthetic transactions using CallTracer', async function () {
          // Mock contract results (EVM transactions)
          sinon.stub(mirrorNodeInstance, 'getContractResultWithRetry').resolves([contractResult1]);

          // Mock logs (includes synthetic transactions)
          sinon.stub(mirrorNodeInstance, 'getContractResultsLogsWithRetry').resolves([syntheticLog, syntheticLog2]);

          // Mock callTracer for both EVM and synthetic transactions
          sinon
            .stub(debugService, 'callTracer')
            .withArgs(contractResult1.hash, sinon.match.any, sinon.match.any)
            .resolves(callTracerResult1)
            .withArgs(syntheticTxHash, sinon.match.any, sinon.match.any)
            .resolves(syntheticCallTracerResult1)
            .withArgs(syntheticTxHash2, sinon.match.any, sinon.match.any)
            .resolves(syntheticCallTracerResult2);

          const result = await debugService.traceBlockByNumber(
            blockNumber,
            { tracer: TracerType.CallTracer, tracerConfig: { onlyTopCall: false } },
            requestDetails,
          );

          expect(result).to.be.an('array').with.lengthOf(3);
          expect(result[0]).to.deep.equal({ txHash: contractResult1.hash, result: callTracerResult1 });
          expect(result[1]).to.deep.equal({ txHash: syntheticTxHash, result: syntheticCallTracerResult1 });
          expect(result[2]).to.deep.equal({ txHash: syntheticTxHash2, result: syntheticCallTracerResult2 });
        });

        it('should trace block with only synthetic transactions using CallTracer', async function () {
          // Mock empty contract results (no EVM transactions)
          sinon.stub(mirrorNodeInstance, 'getContractResultWithRetry').resolves([]);

          // Mock logs (only synthetic transactions)
          sinon.stub(mirrorNodeInstance, 'getContractResultsLogsWithRetry').resolves([syntheticLog]);

          // Mock callTracer for synthetic transaction
          sinon
            .stub(debugService, 'callTracer')
            .withArgs(syntheticTxHash, sinon.match.any, sinon.match.any)
            .resolves(syntheticCallTracerResult1);

          const result = await debugService.traceBlockByNumber(
            blockNumber,
            { tracer: TracerType.CallTracer, tracerConfig: { onlyTopCall: false } },
            requestDetails,
          );

          expect(result).to.be.an('array').with.lengthOf(1);
          expect(result[0]).to.deep.equal({ txHash: syntheticTxHash, result: syntheticCallTracerResult1 });
        });

        it('should trace block with both EVM and synthetic transactions using PrestateTracer', async function () {
          // Mock contract results (EVM transactions)
          sinon.stub(mirrorNodeInstance, 'getContractResultWithRetry').resolves([contractResult1]);

          // Mock logs (includes synthetic transactions)
          sinon.stub(mirrorNodeInstance, 'getContractResultsLogsWithRetry').resolves([syntheticLog]);

          // Mock prestateTracer for both EVM and synthetic transactions
          sinon
            .stub(debugService, 'prestateTracer')
            .withArgs(contractResult1.hash, sinon.match.any, sinon.match.any)
            .resolves(prestateTracerResult1)
            .withArgs(syntheticTxHash, sinon.match.any, sinon.match.any)
            .resolves({});

          const result = await debugService.traceBlockByNumber(
            blockNumber,
            { tracer: TracerType.PrestateTracer, tracerConfig: { onlyTopCall: true } },
            requestDetails,
          );

          expect(result).to.be.an('array').with.lengthOf(2);
          expect(result[0]).to.deep.equal({ txHash: contractResult1.hash, result: prestateTracerResult1 });
          expect(result[1]).to.deep.equal({ txHash: syntheticTxHash, result: {} });
        });

        it('should deduplicate transaction hashes that appear in both contract results and logs', async function () {
          // Mock contract result with a hash
          const sharedTxHash = '0xshared123';
          const sharedContractResult = {
            hash: sharedTxHash,
            result: 'SUCCESS',
          };

          // Mock log with the same transaction hash
          const sharedLog = {
            ...syntheticLog,
            transaction_hash: sharedTxHash,
          };

          sinon.stub(mirrorNodeInstance, 'getContractResultWithRetry').resolves([sharedContractResult]);
          sinon.stub(mirrorNodeInstance, 'getContractResultsLogsWithRetry').resolves([sharedLog]);

          // Mock callTracer - should only be called once for the shared hash
          const callTracerStub = sinon
            .stub(debugService, 'callTracer')
            .withArgs(sharedTxHash, sinon.match.any, sinon.match.any)
            .resolves(callTracerResult1);

          const result = await debugService.traceBlockByNumber(
            blockNumber,
            { tracer: TracerType.CallTracer, tracerConfig: { onlyTopCall: false } },
            requestDetails,
          );

          expect(result).to.be.an('array').with.lengthOf(1);
          expect(result[0]).to.deep.equal({ txHash: sharedTxHash, result: callTracerResult1 });
          expect(callTracerStub.callCount).to.equal(1);
        });

        it('should include WRONG_NONCE transactions with empty traces and skip actions fetch for them', async function () {
          // Mock contract results with WRONG_NONCE transaction
          sinon
            .stub(mirrorNodeInstance, 'getContractResultWithRetry')
            .resolves([contractResult1, contractResultWrongNonce]);

          // Mock logs with synthetic transaction
          sinon.stub(mirrorNodeInstance, 'getContractResultsLogsWithRetry').resolves([syntheticLog]);

          // Mock callTracer - WRONG_NONCE should be called with pre-fetched contract result (returns empty trace)
          sinon
            .stub(debugService, 'callTracer')
            .withArgs(contractResult1.hash, sinon.match.any, sinon.match.any, sinon.match.any, sinon.match.any)
            .resolves(callTracerResult1)
            .withArgs(contractResultWrongNonce.hash, sinon.match.any, sinon.match.any, sinon.match.any, sinon.match.any)
            .resolves(emptyCallTracerResult)
            .withArgs(syntheticTxHash, sinon.match.any, sinon.match.any, sinon.match.any, sinon.match.any)
            .resolves(syntheticCallTracerResult1);

          // Spy on getContractsResultsActions to verify it's not called for WRONG_NONCE
          const getActionsStub = sinon.stub(mirrorNodeInstance, 'getContractsResultsActions').resolves([]);

          const result = await debugService.traceBlockByNumber(
            blockNumber,
            { tracer: TracerType.CallTracer, tracerConfig: { onlyTopCall: false } },
            requestDetails,
          );

          expect(result).to.be.an('array').with.lengthOf(3);
          expect(result[0]).to.deep.equal({ txHash: contractResult1.hash, result: callTracerResult1 });
          expect(result[1]).to.deep.equal({ txHash: contractResultWrongNonce.hash, result: emptyCallTracerResult });
          expect(result[2]).to.deep.equal({ txHash: syntheticTxHash, result: syntheticCallTracerResult1 });

          // Verify actions were NOT fetched for the WRONG_NONCE transaction
          const wrongNonceActionsCalls = getActionsStub
            .getCalls()
            .filter((call) => call.args[0] === contractResultWrongNonce.hash);
          expect(wrongNonceActionsCalls).to.be.empty;
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

  describe('debug_getBadBlocks', async function () {
    withOverriddenEnvsInMochaTest({ DEBUG_API_ENABLED: true }, () => {
      it('should return an empty array', async function () {
        const result = await debugService.getBadBlocks();
        expect(result).to.deep.equal([]);
      });
    });

    [undefined, false].forEach((debugApiEnabled) =>
      withOverriddenEnvsInMochaTest({ DEBUG_API_ENABLED: debugApiEnabled }, () => {
        it('should throw UNSUPPORTED_METHOD', async function () {
          await RelayAssertions.assertRejection(
            predefined.UNSUPPORTED_METHOD,
            debugService.getBadBlocks,
            true,
            debugService,
            [],
          );
        });
      }),
    );
  });

  describe('debug_traceBlockByHash', async function () {
    const blockHash =
      '0x3c08bbbee74d287b1dcd3f0ca6d1d2cb92c90883c4acf9747de9f3f3162ad25b999fc7e86699f60f2a3fb3ed9a646c6b';
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
      cacheService.clear();
    });

    withOverriddenEnvsInMochaTest({ DEBUG_API_ENABLED: undefined }, () => {
      it('should throw UNSUPPORTED_METHOD', async function () {
        await RelayAssertions.assertRejection(
          predefined.UNSUPPORTED_METHOD,
          debugService.traceBlockByHash,
          true,
          debugService,
          [blockHash, { tracer: TracerType.CallTracer, tracerConfig: { onlyTopCall: false } }, requestDetails],
        );
      });
    });

    withOverriddenEnvsInMochaTest({ DEBUG_API_ENABLED: false }, () => {
      it('should throw UNSUPPORTED_METHOD', async function () {
        await RelayAssertions.assertRejection(
          predefined.UNSUPPORTED_METHOD,
          debugService.traceBlockByHash,
          true,
          debugService,
          [blockHash, { tracer: TracerType.CallTracer, tracerConfig: { onlyTopCall: false } }, requestDetails],
        );
      });
    });

    withOverriddenEnvsInMochaTest({ DEBUG_API_ENABLED: true }, () => {
      it('should throw RESOURCE_NOT_FOUND if block is not found', async function () {
        const getHistoricalBlockResponseStub = sinon.stub().resolves(null);
        sinon.stub(CommonService.prototype, 'getHistoricalBlockResponse').callsFake(getHistoricalBlockResponseStub);

        try {
          await debugService.traceBlockByHash(
            blockHash,
            { tracer: TracerType.CallTracer, tracerConfig: { onlyTopCall: false } },
            requestDetails,
          );
          expect.fail('Expected the traceBlockByHash to throw an error but it did not');
        } catch (error) {
          expect(error.code).to.equal(predefined.RESOURCE_NOT_FOUND().code);
          expect(error.message).to.include(`Block ${blockHash} not found`);
        }
      });

      it('should return empty array if no contract results are found for the block', async function () {
        const getHistoricalBlockResponseStub = sinon.stub().resolves(blockResponse);
        sinon.stub(CommonService.prototype, 'getHistoricalBlockResponse').callsFake(getHistoricalBlockResponseStub);

        sinon.stub(mirrorNodeInstance, 'getContractResultWithRetry').resolves([]);
        sinon.stub(mirrorNodeInstance, 'getContractResultsLogsWithRetry').resolves([]);

        const result = await debugService.traceBlockByHash(
          blockHash,
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

        const result = await debugService.traceBlockByHash(
          blockHash,
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
          sinon.stub(mirrorNodeInstance, 'getContractResultsLogsWithRetry').resolves([]);
        });

        it('should trace all transactions in a block using callTracer', async function () {
          sinon.stub(mirrorNodeInstance, 'getContractResultWithRetry').resolves([contractResult1, contractResult2]);

          const callTracerStub = sinon.stub(debugService, 'callTracer');
          callTracerStub.onFirstCall().resolves(callTracerResult1);
          callTracerStub.onSecondCall().resolves(callTracerResult2);

          const result = await debugService.traceBlockByHash(
            blockHash,
            { tracer: TracerType.CallTracer, tracerConfig: { onlyTopCall: false } },
            requestDetails,
          );

          expect(result).to.have.length(2);
          expect(result[0]).to.deep.equal({ txHash: contractResult1.hash, result: callTracerResult1 });
          expect(result[1]).to.deep.equal({ txHash: contractResult2.hash, result: callTracerResult2 });
        });

        it('should filter out WRONG_NONCE transactions', async function () {
          sinon
            .stub(mirrorNodeInstance, 'getContractResultWithRetry')
            .resolves([contractResult1, contractResultWrongNonce]);

          const callTracerStub = sinon.stub(debugService, 'callTracer');
          callTracerStub.resolves(callTracerResult1);

          const result = await debugService.traceBlockByHash(
            blockHash,
            { tracer: TracerType.CallTracer, tracerConfig: { onlyTopCall: false } },
            requestDetails,
          );

          expect(result).to.have.length(1);
          expect(result[0]).to.deep.equal({ txHash: contractResult1.hash, result: callTracerResult1 });

          const wrongNonceCalls = callTracerStub
            .getCalls()
            .filter((call) => call.args[0] === contractResultWrongNonce.hash);
          expect(wrongNonceCalls).to.be.empty;
        });
      });

      describe('with CallTracer - default', async function () {
        beforeEach(() => {
          const getHistoricalBlockResponseStub = sinon.stub().resolves(blockResponse);
          sinon.stub(CommonService.prototype, 'getHistoricalBlockResponse').callsFake(getHistoricalBlockResponseStub);

          sinon.stub(cacheService, 'getAsync').resolves(null);
          sinon.stub(cacheService, 'set').resolves();
          sinon.stub(mirrorNodeInstance, 'getContractResultsLogsWithRetry').resolves([]);
        });

        it('should use default CallTracer when no tracer is specified', async function () {
          sinon.stub(mirrorNodeInstance, 'getContractResultWithRetry').resolves([contractResult1]);
          sinon.stub(debugService, 'callTracer').resolves(callTracerResult1);

          const result = await debugService.traceBlockByHash(blockHash, undefined as any, requestDetails);

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
          sinon.stub(mirrorNodeInstance, 'getContractResultsLogsWithRetry').resolves([]);
        });

        it('should trace all transactions in a block using prestateTracer', async function () {
          sinon.stub(mirrorNodeInstance, 'getContractResultWithRetry').resolves([contractResult1, contractResult2]);

          const prestateTracerStub = sinon.stub(debugService, 'prestateTracer');
          prestateTracerStub.onFirstCall().resolves(prestateTracerResult1);
          prestateTracerStub.onSecondCall().resolves(prestateTracerResult2);

          const result = await debugService.traceBlockByHash(
            blockHash,
            { tracer: TracerType.PrestateTracer, tracerConfig: { onlyTopCall: false } },
            requestDetails,
          );

          expect(result).to.have.length(2);
          expect(result[0]).to.deep.equal({ txHash: contractResult1.hash, result: prestateTracerResult1 });
          expect(result[1]).to.deep.equal({ txHash: contractResult2.hash, result: prestateTracerResult2 });
        });
      });

      describe('with synthetic transactions', async function () {
        beforeEach(() => {
          const getHistoricalBlockResponseStub = sinon.stub().resolves(blockResponse);
          sinon.stub(CommonService.prototype, 'getHistoricalBlockResponse').callsFake(getHistoricalBlockResponseStub);

          sinon.stub(cacheService, 'getAsync').resolves(null);
          sinon.stub(cacheService, 'set').resolves();
        });

        it('should trace block with both EVM and synthetic transactions using CallTracer', async function () {
          sinon.stub(mirrorNodeInstance, 'getContractResultWithRetry').resolves([contractResult1]);
          sinon.stub(mirrorNodeInstance, 'getContractResultsLogsWithRetry').resolves([syntheticLog, syntheticLog2]);

          sinon
            .stub(debugService, 'callTracer')
            .withArgs(contractResult1.hash, sinon.match.any, sinon.match.any)
            .resolves(callTracerResult1)
            .withArgs(syntheticTxHash, sinon.match.any, sinon.match.any)
            .resolves(syntheticCallTracerResult1)
            .withArgs(syntheticTxHash2, sinon.match.any, sinon.match.any)
            .resolves(syntheticCallTracerResult2);

          const result = await debugService.traceBlockByHash(
            blockHash,
            { tracer: TracerType.CallTracer, tracerConfig: { onlyTopCall: false } },
            requestDetails,
          );

          expect(result).to.be.an('array').with.lengthOf(3);
          expect(result[0]).to.deep.equal({ txHash: contractResult1.hash, result: callTracerResult1 });
          expect(result[1]).to.deep.equal({ txHash: syntheticTxHash, result: syntheticCallTracerResult1 });
          expect(result[2]).to.deep.equal({ txHash: syntheticTxHash2, result: syntheticCallTracerResult2 });
        });

        it('should trace block with only synthetic transactions using CallTracer', async function () {
          sinon.stub(mirrorNodeInstance, 'getContractResultWithRetry').resolves([]);
          sinon.stub(mirrorNodeInstance, 'getContractResultsLogsWithRetry').resolves([syntheticLog]);

          sinon
            .stub(debugService, 'callTracer')
            .withArgs(syntheticTxHash, sinon.match.any, sinon.match.any)
            .resolves(syntheticCallTracerResult1);

          const result = await debugService.traceBlockByHash(
            blockHash,
            { tracer: TracerType.CallTracer, tracerConfig: { onlyTopCall: false } },
            requestDetails,
          );

          expect(result).to.be.an('array').with.lengthOf(1);
          expect(result[0]).to.deep.equal({ txHash: syntheticTxHash, result: syntheticCallTracerResult1 });
        });

        it('should trace block with both EVM and synthetic transactions using PrestateTracer', async function () {
          sinon.stub(mirrorNodeInstance, 'getContractResultWithRetry').resolves([contractResult1]);
          sinon.stub(mirrorNodeInstance, 'getContractResultsLogsWithRetry').resolves([syntheticLog]);

          sinon
            .stub(debugService, 'prestateTracer')
            .withArgs(contractResult1.hash, sinon.match.any, sinon.match.any)
            .resolves(prestateTracerResult1)
            .withArgs(syntheticTxHash, sinon.match.any, sinon.match.any)
            .resolves({});

          const result = await debugService.traceBlockByHash(
            blockHash,
            { tracer: TracerType.PrestateTracer, tracerConfig: { onlyTopCall: true } },
            requestDetails,
          );

          expect(result).to.be.an('array').with.lengthOf(2);
          expect(result[0]).to.deep.equal({ txHash: contractResult1.hash, result: prestateTracerResult1 });
          expect(result[1]).to.deep.equal({ txHash: syntheticTxHash, result: {} });
        });

        it('should deduplicate transaction hashes that appear in both contract results and logs', async function () {
          const sharedTxHash = '0xshared123';
          const sharedContractResult = {
            hash: sharedTxHash,
            result: 'SUCCESS',
          };

          const sharedLog = {
            ...syntheticLog,
            transaction_hash: sharedTxHash,
          };

          sinon.stub(mirrorNodeInstance, 'getContractResultWithRetry').resolves([sharedContractResult]);
          sinon.stub(mirrorNodeInstance, 'getContractResultsLogsWithRetry').resolves([sharedLog]);

          const callTracerStub = sinon
            .stub(debugService, 'callTracer')
            .withArgs(sharedTxHash, sinon.match.any, sinon.match.any)
            .resolves(callTracerResult1);

          const result = await debugService.traceBlockByHash(
            blockHash,
            { tracer: TracerType.CallTracer, tracerConfig: { onlyTopCall: false } },
            requestDetails,
          );

          expect(result).to.be.an('array').with.lengthOf(1);
          expect(result[0]).to.deep.equal({ txHash: sharedTxHash, result: callTracerResult1 });
          expect(callTracerStub.callCount).to.equal(1);
        });

        it('should filter out WRONG_NONCE transactions and still trace synthetic transactions', async function () {
          sinon
            .stub(mirrorNodeInstance, 'getContractResultWithRetry')
            .resolves([contractResult1, contractResultWrongNonce]);
          sinon.stub(mirrorNodeInstance, 'getContractResultsLogsWithRetry').resolves([syntheticLog]);

          const callTracerStub = sinon
            .stub(debugService, 'callTracer')
            .withArgs(contractResult1.hash, sinon.match.any, sinon.match.any)
            .resolves(callTracerResult1)
            .withArgs(syntheticTxHash, sinon.match.any, sinon.match.any)
            .resolves(syntheticCallTracerResult1);

          const result = await debugService.traceBlockByHash(
            blockHash,
            { tracer: TracerType.CallTracer, tracerConfig: { onlyTopCall: false } },
            requestDetails,
          );

          expect(result).to.be.an('array').with.lengthOf(2);
          expect(result[0]).to.deep.equal({ txHash: contractResult1.hash, result: callTracerResult1 });
          expect(result[1]).to.deep.equal({ txHash: syntheticTxHash, result: syntheticCallTracerResult1 });

          const wrongNonceCalls = callTracerStub
            .getCalls()
            .filter((call) => call.args[0] === contractResultWrongNonce.hash);
          expect(wrongNonceCalls).to.be.empty;
        });
      });

      it('should handle error scenarios', async function () {
        const jsonRpcError = predefined.INTERNAL_ERROR('Test error');

        const getHistoricalBlockResponseStub = sinon.stub().throws(jsonRpcError);
        sinon.stub(CommonService.prototype, 'getHistoricalBlockResponse').callsFake(getHistoricalBlockResponseStub);

        const genericErrorHandlerStub = sinon.stub().returns(jsonRpcError);
        sinon.stub(CommonService.prototype, 'genericErrorHandler').callsFake(genericErrorHandlerStub);

        await RelayAssertions.assertRejection(jsonRpcError, debugService.traceBlockByHash, true, debugService, [
          blockHash,
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
      makeCreateAction({
        caller: accountId,
        caller_type: 'ACCOUNT',
        from: accountAddress,
        recipient: contractId,
        to: contractAddress,
        timestamp: mockTimestamp,
        index: 0,
      }),
      makeCreateAction({
        call_depth: 1,
        caller: contractId,
        caller_type: 'CONTRACT',
        from: contractAddress,
        recipient: '0.0.1034',
        to: '0x000000000000000000000000000000000000040a',
        timestamp: mockTimestamp,
        index: 1,
      }),
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
      cacheService.clear();
    });

    withOverriddenEnvsInMochaTest({ DEBUG_API_ENABLED: true }, () => {
      it('should fetch and format prestate data for a transaction', async function () {
        // Set up stubs
        sinon
          .stub(mirrorNodeInstance, 'getContractsResultsActions')
          .withArgs(transactionHash, sinon.match.any)
          .resolves(actionsResponseMock);

        // Mock contract result (returns SUCCESS so not a pre-execution failure)
        sinon.stub(mirrorNodeInstance, 'getContractResultWithRetry').resolves({ result: 'SUCCESS' });

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

        // Mock contract result (returns SUCCESS so not a pre-execution failure)
        sinon.stub(mirrorNodeInstance, 'getContractResultWithRetry').resolves({ result: 'SUCCESS' });

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

        // Mock contract result (returns SUCCESS so not a pre-execution failure)
        sinon.stub(mirrorNodeInstance, 'getContractResultWithRetry').resolves({ result: 'SUCCESS' });

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

        // Mock contract result (returns SUCCESS so not a pre-execution failure)
        sinon.stub(mirrorNodeInstance, 'getContractResultWithRetry').resolves({ result: 'SUCCESS' });

        // Mock logs call to return empty array (no synthetic transaction)
        restMock
          .onGet(`contracts/results/logs?transaction.hash=${transactionHash}&limit=100&order=asc`)
          .reply(200, JSON.stringify({ logs: [] }));

        await expect(debugService.prestateTracer(transactionHash, false, requestDetails)).to.be.rejectedWith(
          'Failed to retrieve transaction information',
        );
      });

      it('should return empty array when the transaction hash is not found', async function () {
        // Create a separate DebugImpl instance just for this test
        const isolatedDebugService = new DebugImpl(mirrorNodeInstance, logger, cacheService);

        // Mock the API calls for actions and contract result to return 404
        restMock.onGet(`contracts/results/${nonExistentTransactionHash}/actions`).reply(
          404,
          JSON.stringify({
            _status: {
              messages: [{ message: 'Not found' }],
            },
          }),
        );

        restMock.onGet(`contracts/results/${nonExistentTransactionHash}`).reply(
          404,
          JSON.stringify({
            _status: {
              messages: [{ message: 'Not found' }],
            },
          }),
        );

        // Mock logs call to return empty array (no synthetic transaction)
        restMock
          .onGet(`contracts/results/logs?transaction.hash=${nonExistentTransactionHash}&limit=100&order=asc`)
          .reply(200, JSON.stringify({ logs: [] }));

        // Make sure no sinon stubs interfere
        const getContractsResultsActionsStub = sinon.stub(mirrorNodeInstance, 'getContractsResultsActions');
        getContractsResultsActionsStub.callThrough(); // Let it use the original method which will hit the mock

        // The test should now properly throw the expected error
        await expect(
          isolatedDebugService.prestateTracer(nonExistentTransactionHash, false, requestDetails),
        ).to.be.rejectedWith('Failed to retrieve transaction information');
      });

      it('should handle entity resolution errors', async function () {
        sinon
          .stub(mirrorNodeInstance, 'getContractsResultsActions')
          .withArgs(transactionHash, sinon.match.any)
          .resolves(actionsResponseMock);

        // Mock contract result (returns SUCCESS so not a pre-execution failure)
        sinon.stub(mirrorNodeInstance, 'getContractResultWithRetry').resolves({ result: 'SUCCESS' });

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

        // Mock contract result (returns SUCCESS so not a pre-execution failure)
        sinon.stub(mirrorNodeInstance, 'getContractResultWithRetry').resolves({ result: 'SUCCESS' });

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
