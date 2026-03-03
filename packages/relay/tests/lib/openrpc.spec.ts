// SPDX-License-Identifier: Apache-2.0

import { inspect } from 'node:util';

import { ConfigService } from '@hashgraph/json-rpc-config-service/dist/services';
import type { ContentDescriptorObject, JSONSchema, MethodObject, OpenrpcDocument } from '@open-rpc/meta-schema';
import { parseOpenRPCDocument, validateOpenRPCDocument } from '@open-rpc/schema-utils-js';
import Ajv from 'ajv';
import axios from 'axios';
import MockAdapter from 'axios-mock-adapter';
import { expect } from 'chai';
import pino from 'pino';
import { register, Registry } from 'prom-client';
import sinon from 'sinon';

import openRpcSchema from '../../../../docs/openrpc.json';
import { LocalPendingTransactionStorage } from '../../dist/lib/services';
import { Eth, JsonRpcError, Net, TxPool, Web3 } from '../../src';
import { numberTo0x, trimPrecedingZeros } from '../../src/formatters';
import { SDKClient } from '../../src/lib/clients';
import { MirrorNodeClient } from '../../src/lib/clients';
import constants from '../../src/lib/constants';
import { EvmAddressHbarSpendingPlanRepository } from '../../src/lib/db/repositories/hbarLimiter/evmAddressHbarSpendingPlanRepository';
import { HbarSpendingPlanRepository } from '../../src/lib/db/repositories/hbarLimiter/hbarSpendingPlanRepository';
import { IPAddressHbarSpendingPlanRepository } from '../../src/lib/db/repositories/hbarLimiter/ipAddressHbarSpendingPlanRepository';
import { EthImpl } from '../../src/lib/eth';
import { CacheClientFactory } from '../../src/lib/factories/cacheClientFactory';
import { NetImpl } from '../../src/lib/net';
import { TransactionPoolService } from '../../src/lib/services';
import ClientService from '../../src/lib/services/hapiService/hapiService';
import { HbarLimitService } from '../../src/lib/services/hbarLimitService';
import { LockService } from '../../src/lib/services/lockService/LockService';
import { TxPoolImpl } from '../../src/lib/txpool';
import { RequestDetails } from '../../src/lib/types';
import { Web3Impl } from '../../src/lib/web3';
import {
  blockHash,
  blockNumber,
  contractAddress1,
  contractAddress2,
  contractAddress3,
  contractId1,
  contractId2,
  contractTimestamp1,
  contractTimestamp2,
  contractTimestamp3,
  defaultBlock,
  defaultCallData,
  defaultContract,
  defaultContractResults,
  defaultDetailedContractResultByHash,
  defaultDetailedContractResults,
  defaultDetailedContractResults2,
  defaultDetailedContractResults3,
  defaultEvmAddress,
  defaultFromLongZeroAddress,
  defaultLogs,
  defaultLogTopics,
  defaultNetworkFees,
  defaultTxHash,
  mockWorkersPool,
  overrideEnvsInMochaDescribe,
  signedTransactionHash,
} from '../helpers';
import { CONTRACT_RESULT_MOCK, NOT_FOUND_RES } from './eth/eth-config';

const logger = pino({ level: 'silent' });
const registry = new Registry();

let mock: MockAdapter;
let mirrorNodeInstance: MirrorNodeClient;
let clientServiceInstance: ClientService;
let sdkClientStub: sinon.SinonStubbedInstance<SDKClient>;

const noTransactions = '?transactions=false';

describe('Open RPC Specification', function () {
  let openRpcDocument: OpenrpcDocument;
  let methodsResponseSchema: { [method: string]: JSONSchema };
  let ethImpl: EthImpl;
  let txpoolImpl: TxPoolImpl;
  let ns: { eth: Eth; net: Net; web3: Web3; txpool: TxPool };

  const requestDetails = new RequestDetails({ requestId: 'openRpcTest', ipAddress: '0.0.0.0' });

  overrideEnvsInMochaDescribe({ npm_package_version: 'relay/0.0.1-SNAPSHOT' });

  before(async () => {
    openRpcDocument = await parseOpenRPCDocument(JSON.stringify(openRpcSchema));
    methodsResponseSchema = openRpcDocument.methods
      .filter((method) => 'name' in method)
      .filter((method) => method.result !== undefined)
      .reduce(
        (res, method) => ({
          ...res,
          [method.name]: (method.result as ContentDescriptorObject)?.schema,
        }),
        {} as { [method: string]: JSONSchema },
      );

    // mock axios
    const instance = axios.create({
      baseURL: 'https://localhost:5551/api/v1',
      responseType: 'json' as const,
      headers: {
        'Content-Type': 'application/json',
      },
      timeout: 10 * 1000,
    });

    mock = new MockAdapter(instance, { onNoMatch: 'throwException' });
    const cacheService = CacheClientFactory.create(logger, registry);
    mirrorNodeInstance = new MirrorNodeClient(
      ConfigService.get('MIRROR_NODE_URL'),
      logger.child({ name: `mirror-node` }),
      registry,
      cacheService,
      instance,
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

    clientServiceInstance = new ClientService(logger, registry, hbarLimitService);
    sdkClientStub = sinon.createStubInstance(SDKClient);
    sinon.stub(clientServiceInstance, 'getSDKClient').returns(sdkClientStub);
    const lockServiceStub = sinon.createStubInstance(LockService);
    lockServiceStub.acquireLock.resolves(undefined);
    ns = { eth: ethImpl, net: new NetImpl(), web3: new Web3Impl() };
    const storageStub = sinon.createStubInstance(LocalPendingTransactionStorage);
    const rlpTx =
      '0x01f871808209b085a54f4c3c00830186a0949b6feaea745fe564158da9a5313eb4dd4dc3a940880de0b6b3a764000080c080a05e2d00db2121fdd3c761388c64fc72d123f17e67fddd85a41c819694196569b5a03dc6b2429ed7694f42cdc46309e08cc78eb96864a0da58537fe938d4d9f334f2';
    storageStub.getTransactionPayloads.resolves(new Set([rlpTx]));
    storageStub.getAllTransactionPayloads.resolves(new Set([rlpTx]));
    const testRegistry = new Registry();
    const transactionPoolService = new TransactionPoolService(storageStub, logger, testRegistry);
    ethImpl = new EthImpl(
      clientServiceInstance,
      mirrorNodeInstance,
      logger,
      '0x12a',
      cacheService,
      transactionPoolService,
      lockServiceStub,
      testRegistry,
    );
    txpoolImpl = new TxPoolImpl(transactionPoolService);
    ns = { eth: ethImpl, net: new NetImpl(), web3: new Web3Impl(), txpool: txpoolImpl };

    // mocked data
    mock.onGet('blocks?limit=1&order=desc').reply(200, JSON.stringify({ blocks: [defaultBlock] }));
    mock.onGet(`blocks/${defaultBlock.number}`).reply(200, JSON.stringify(defaultBlock));
    mock.onGet(`blocks/${blockHash}`).reply(200, JSON.stringify(defaultBlock));
    mock.onGet('network/fees').reply(200, JSON.stringify(defaultNetworkFees));
    mock
      .onGet(`network/fees?timestamp=lte:${defaultBlock.timestamp.to}`)
      .reply(200, JSON.stringify(defaultNetworkFees));
    mock.onGet(`contracts/${contractAddress1}`).reply(200, JSON.stringify(null));
    mock
      .onGet(
        `contracts/results?timestamp=gte:${defaultBlock.timestamp.from}&timestamp=lte:${defaultBlock.timestamp.to}&limit=100&order=asc`,
      )
      .reply(200, JSON.stringify(defaultContractResults));
    mock
      .onGet(
        `contracts/results/logs?timestamp=gte:${defaultBlock.timestamp.from}&timestamp=lte:${defaultBlock.timestamp.to}&limit=100&order=asc`,
      )
      .reply(200, JSON.stringify(defaultLogs));
    mock.onGet(`contracts/results/${defaultTxHash}`).reply(200, JSON.stringify(defaultDetailedContractResultByHash));
    mock
      .onGet(
        `contracts/results?block.hash=${defaultBlock.hash}&transaction.index=${defaultBlock.count}&limit=100&order=asc`,
      )
      .reply(200, JSON.stringify(defaultContractResults));
    mock
      .onGet(
        `contracts/results?block.number=${defaultBlock.number}&transaction.index=${defaultBlock.count}&limit=100&order=asc`,
      )
      .reply(200, JSON.stringify(defaultContractResults));
    mock
      .onGet(`contracts/${contractAddress1}/results/${contractTimestamp1}`)
      .reply(200, JSON.stringify(defaultDetailedContractResults));
    mock
      .onGet(`contracts/${contractAddress2}/results/${contractTimestamp2}`)
      .reply(200, JSON.stringify(defaultDetailedContractResults));
    mock
      .onGet(`contracts/${contractId1}/results/${contractTimestamp1}`)
      .reply(200, JSON.stringify(defaultDetailedContractResults));
    mock
      .onGet(`contracts/${contractId1}/results/${contractTimestamp2}`)
      .reply(200, JSON.stringify(defaultDetailedContractResults2));
    mock
      .onGet(`contracts/${contractId2}/results/${contractTimestamp3}`)
      .reply(200, JSON.stringify(defaultDetailedContractResults3));
    mock.onGet(`tokens/0.0.${parseInt(defaultCallData.to, 16)}`).reply(404, JSON.stringify(null));
    mock.onGet(`accounts/${contractAddress1}?limit=100`).reply(
      200,
      JSON.stringify({
        account: contractAddress1,
        balance: {
          balance: 2000000000000,
        },
      }),
    );
    mock.onGet(`accounts/${contractAddress3}${noTransactions}`).reply(
      200,
      JSON.stringify({
        account: contractAddress3,
        balance: {
          balance: 100000000000,
        },
        ethereum_nonce: 0,
      }),
    );
    mock
      .onGet(`accounts/0xbC989b7b17d18702663F44A6004cB538b9DfcBAc?limit=100`)
      .reply(200, JSON.stringify({ account: '0xbC989b7b17d18702663F44A6004cB538b9DfcBAc' }));

    mock.onGet(`network/exchangerate`).reply(
      200,
      JSON.stringify({
        current_rate: {
          cent_equivalent: 12,
          expiration_time: 4102444800,
          hbar_equivalent: 1,
        },
      }),
    );

    mock.onGet(`accounts/${defaultFromLongZeroAddress}${noTransactions}`).reply(
      200,
      JSON.stringify({
        from: `${defaultEvmAddress}`,
      }),
    );
    for (const log of defaultLogs.logs) {
      mock.onGet(`contracts/${log.address}`).reply(200, JSON.stringify(defaultContract));
    }
    mock
      .onPost(`contracts/call`, { ...defaultCallData, estimate: false })
      .reply(200, JSON.stringify({ result: '0x12' }));
    sdkClientStub.submitEthereumTransaction.resolves();
    mock.onGet(`accounts/${defaultContractResults.results[0].from}?transactions=false`).reply(200);
    mock.onGet(`accounts/${defaultContractResults.results[1].from}?transactions=false`).reply(200);
    mock.onGet(`accounts/${defaultContractResults.results[0].to}?transactions=false`).reply(200);
    mock.onGet(`accounts/${defaultContractResults.results[1].to}?transactions=false`).reply(200);
    mock
      .onGet(`accounts/${CONTRACT_RESULT_MOCK.from}?transactions=false`)
      .reply(200, JSON.stringify(CONTRACT_RESULT_MOCK));
    mock.onGet(`contracts/${defaultContractResults.results[0].from}`).reply(404, JSON.stringify(NOT_FOUND_RES));
    mock.onGet(`contracts/${defaultContractResults.results[1].from}`).reply(404, JSON.stringify(NOT_FOUND_RES));
    mock.onGet(`contracts/${defaultContractResults.results[0].to}`).reply(200);
    mock.onGet(`contracts/${defaultContractResults.results[1].to}`).reply(200);
    mock.onGet(`tokens/${defaultContractResults.results[0].contract_id}`).reply(200);
    mock.onGet(`tokens/${defaultContractResults.results[1].contract_id}`).reply(200);

    await mockWorkersPool(mirrorNodeInstance, ethImpl['common'], cacheService);
  });

  const validateResponseSchema = (schema: JSONSchema, response: unknown) => {
    const ajv = new Ajv();
    ajv.validate(schema, response);

    expect(ajv.errors, `Errors found: ${inspect(ajv.errors)}`).to.be.null;
  };

  it('validates the openrpc document', async () => {
    const isValid = validateOpenRPCDocument(openRpcDocument);
    expect(isValid).to.be.true;
  });

  it('should execute "txpool_content"', async () => {
    const response = await txpoolImpl.content();
    validateResponseSchema(methodsResponseSchema.txpool_content, response);
  });

  it('should execute "txpool_contentFrom"', async () => {
    const response = await txpoolImpl.contentFrom(defaultEvmAddress);
    validateResponseSchema(methodsResponseSchema.txpool_contentFrom, response);
  });

  it('should execute "txpool_status"', async () => {
    const response = await txpoolImpl.status();
    validateResponseSchema(methodsResponseSchema.txpool_status, response);
  });

  it('should execute "eth_accounts"', function () {
    const response = ethImpl.accounts(requestDetails);
    validateResponseSchema(methodsResponseSchema.eth_accounts, response);
  });

  it('should execute "eth_blockNumber"', async function () {
    const response = await ethImpl.blockNumber(requestDetails);
    validateResponseSchema(methodsResponseSchema.eth_blockNumber, response);
  });

  it('should execute "eth_chainId"', function () {
    const response = ethImpl.chainId();
    validateResponseSchema(methodsResponseSchema.eth_chainId, response);
  });

  it('should execute "eth_estimateGas"', async function () {
    mock.onGet(`accounts/undefined${noTransactions}`).reply(404);
    // Mock a successful gas estimation response
    mock.onPost(`contracts/call`).reply(200, JSON.stringify({ result: '0x5208' }));
    const response = await ethImpl.estimateGas({}, null, requestDetails);

    validateResponseSchema(methodsResponseSchema.eth_estimateGas, response);
  });

  it('should execute "eth_feeHistory"', async function () {
    const response = await ethImpl.feeHistory(1, 'latest', [0], requestDetails);
    validateResponseSchema(methodsResponseSchema.eth_feeHistory, response);
  });

  it('should execute "eth_gasPrice"', async function () {
    const response = await ethImpl.gasPrice(requestDetails);
    validateResponseSchema(methodsResponseSchema.eth_gasPrice, response);
  });

  it('should execute "eth_getBalance"', async function () {
    const response = await ethImpl.getBalance(contractAddress1, 'latest', requestDetails);
    validateResponseSchema(methodsResponseSchema.eth_getBalance, response);
  });

  it('should execute "eth_getBlockByHash" with hydrated = true', async function () {
    const response = await ethImpl.getBlockByHash(blockHash, true, requestDetails);
    validateResponseSchema(methodsResponseSchema.eth_getBlockByHash, response);
  });

  it('should execute "eth_getBlockByHash" with hydrated = false', async function () {
    const response = await ethImpl.getBlockByHash(blockHash, true, requestDetails);
    validateResponseSchema(methodsResponseSchema.eth_getBlockByHash, response);
  });

  it('should execute "eth_getBlockByNumber" with hydrated = true', async function () {
    const response = await ethImpl.getBlockByNumber(numberTo0x(blockNumber), true, requestDetails);
    validateResponseSchema(methodsResponseSchema.eth_getBlockByNumber, response);
  });

  it('should execute "eth_getBlockByNumber" with hydrated = false', async function () {
    const response = await ethImpl.getBlockByNumber(numberTo0x(blockNumber), false, requestDetails);
    validateResponseSchema(methodsResponseSchema.eth_getBlockByNumber, response);
  });

  it('should execute "eth_getBlockTransactionCountByHash"', async function () {
    const response = await ethImpl.getBlockTransactionCountByHash(blockHash, requestDetails);
    validateResponseSchema(methodsResponseSchema.eth_getBlockTransactionCountByHash, response);
  });

  it('should execute "eth_getBlockTransactionCountByNumber" with block tag', async function () {
    const response = await ethImpl.getBlockTransactionCountByNumber('latest', requestDetails);
    validateResponseSchema(methodsResponseSchema.eth_getBlockTransactionCountByNumber, response);
  });

  it('should execute "eth_getBlockTransactionCountByNumber" with block number', async function () {
    const response = await ethImpl.getBlockTransactionCountByNumber('0x3', requestDetails);

    validateResponseSchema(methodsResponseSchema.eth_getBlockTransactionCountByNumber, response);
  });

  it('should execute "eth_getCode" with block tag', async function () {
    mock.onGet(`tokens/${defaultContractResults.results[0].contract_id}`).reply(404);
    const response = await ethImpl.getCode(contractAddress1, 'latest', requestDetails);

    validateResponseSchema(methodsResponseSchema.eth_getCode, response);
  });

  it('should execute "eth_getCode" with block number', async function () {
    mock.onGet(`tokens/${defaultContractResults.results[0].contract_id}`).reply(404);
    const response = await ethImpl.getCode(contractAddress1, '0x3', requestDetails);

    validateResponseSchema(methodsResponseSchema.eth_getCode, response);
  });

  it('should execute "eth_getLogs" with no filters', async function () {
    const response = await ethImpl.getLogs(
      { blockHash: null, fromBlock: 'latest', toBlock: 'latest', address: null, topics: null },
      requestDetails,
    );

    validateResponseSchema(methodsResponseSchema.eth_getLogs, response);
  });

  it('should execute "eth_getLogs" with topics filter', async function () {
    const filteredLogs = {
      logs: [defaultLogs.logs[0], defaultLogs.logs[1]],
    };
    mock
      .onGet(
        `contracts/results/logs` +
          `?timestamp=gte:${defaultBlock.timestamp.from}` +
          `&timestamp=lte:${defaultBlock.timestamp.to}` +
          `&topic0=${trimPrecedingZeros(defaultLogTopics[0])}&topic1=${trimPrecedingZeros(defaultLogTopics[1])}` +
          `&topic2=${trimPrecedingZeros(defaultLogTopics[2])}&topic3=${trimPrecedingZeros(defaultLogTopics[3])}&limit=100&order=asc`,
      )
      .reply(200, JSON.stringify(filteredLogs));
    mock.onGet('blocks?block.number=gte:0x5&block.number=lte:0x10').reply(
      200,
      JSON.stringify({
        blocks: [defaultBlock],
      }),
    );
    for (const log of filteredLogs.logs) {
      mock.onGet(`contracts/${log.address}`).reply(200, JSON.stringify(defaultContract));
    }

    const response = await ethImpl.getLogs(
      { blockHash: null, fromBlock: 'latest', toBlock: 'latest', address: null, topics: defaultLogTopics },
      requestDetails,
    );

    validateResponseSchema(methodsResponseSchema.eth_getLogs, response);
  });

  it('should execute "eth_getTransactionByBlockHashAndIndex"', async function () {
    const response = await ethImpl.getTransactionByBlockHashAndIndex(
      defaultBlock.hash,
      numberTo0x(defaultBlock.count),
      requestDetails,
    );

    validateResponseSchema(methodsResponseSchema.eth_getTransactionByBlockHashAndIndex, response);
  });

  it('should execute "eth_getTransactionByBlockNumberAndIndex"', async function () {
    const response = await ethImpl.getTransactionByBlockNumberAndIndex(
      numberTo0x(defaultBlock.number),
      numberTo0x(defaultBlock.count),
      requestDetails,
    );

    validateResponseSchema(methodsResponseSchema.eth_getTransactionByBlockNumberAndIndex, response);
  });

  it('should execute "eth_getTransactionByHash"', async function () {
    const response = await ethImpl.getTransactionByHash(defaultTxHash, requestDetails);
    validateResponseSchema(methodsResponseSchema.eth_getTransactionByHash, response);
  });

  it('should execute "eth_getTransactionCount"', async function () {
    mock
      .onGet(`accounts/${contractAddress1}${noTransactions}`)
      .reply(200, JSON.stringify({ account: contractAddress1, ethereum_nonce: 5 }));
    mock.onGet(`contracts/${contractAddress1}${noTransactions}`).reply(404);
    const response = await ethImpl.getTransactionCount(contractAddress1, 'latest', requestDetails);

    validateResponseSchema(methodsResponseSchema.eth_getTransactionCount, response);
  });

  it('should execute "eth_getTransactionReceipt"', async function () {
    mock.onGet(`contracts/${defaultDetailedContractResultByHash.created_contract_ids[0]}`).reply(404);
    mock
      .onGet(`contracts/results?block.number=${defaultDetailedContractResultByHash.block_number}&limit=100&order=asc`)
      .reply(
        200,
        JSON.stringify({
          results: [defaultDetailedContractResultByHash],
          links: { next: null },
        }),
      );

    // @ts-expect-error: Property 'common' is private and only accessible within class 'EthImpl'.
    const common = ethImpl.common;
    sinon.stub(common, 'getCurrentGasPriceForBlock').resolves('0xad78ebc5ac620000');
    const response = await ethImpl.getTransactionReceipt(defaultTxHash, requestDetails);

    validateResponseSchema(methodsResponseSchema.eth_getTransactionReceipt, response);
  });

  it('should execute "eth_getUncleByBlockHashAndIndex"', async function () {
    const response = ethImpl.getUncleByBlockHashAndIndex(blockHash, '0x0');
    validateResponseSchema(methodsResponseSchema.eth_getUncleByBlockHashAndIndex, response);
  });

  it('should execute "eth_getUncleByBlockNumberAndIndex"', async function () {
    const response = ethImpl.getUncleByBlockNumberAndIndex(numberTo0x(blockNumber), '0x0');
    validateResponseSchema(methodsResponseSchema.eth_getUncleByBlockNumberAndIndex, response);
  });

  it('should execute "eth_getUncleByBlockNumberAndIndex"', async function () {
    const response = ethImpl.getUncleByBlockNumberAndIndex(numberTo0x(blockNumber), '0x0');
    validateResponseSchema(methodsResponseSchema.eth_getUncleByBlockNumberAndIndex, response);
  });

  it('should execute "eth_getUncleCountByBlockHash"', async function () {
    const response = ethImpl.getUncleCountByBlockHash(blockHash);
    validateResponseSchema(methodsResponseSchema.eth_getUncleCountByBlockHash, response);
  });

  it('should execute "eth_getUncleCountByBlockNumber"', async function () {
    const response = ethImpl.getUncleCountByBlockNumber(numberTo0x(blockNumber));
    validateResponseSchema(methodsResponseSchema.eth_getUncleCountByBlockNumber, response);
  });

  it('should execute "eth_hashrate"', async function () {
    const response = await ethImpl.hashrate();
    validateResponseSchema(methodsResponseSchema.eth_hashrate, response);
  });

  it('should execute "eth_mining"', async function () {
    const response = await ethImpl.mining();
    validateResponseSchema(methodsResponseSchema.eth_mining, response);
  });

  it('should execute "eth_sendRawTransaction"', async function () {
    const response = await ethImpl.sendRawTransaction(signedTransactionHash, requestDetails);
    validateResponseSchema(methodsResponseSchema.eth_sendRawTransaction, response);
  });

  it('should execute "eth_submitWork"', async function () {
    const response = await ethImpl.submitWork();
    validateResponseSchema(methodsResponseSchema.eth_submitWork, response);
  });

  it('should execute "eth_syncing"', async function () {
    const response = await ethImpl.syncing();
    validateResponseSchema(methodsResponseSchema.eth_syncing, response);
  });

  it('should execute "net_listening"', function () {
    const response = ns.net.listening();
    validateResponseSchema(methodsResponseSchema.net_listening, response);
  });

  it('should execute "net_version"', function () {
    const response = ns.net.version();
    validateResponseSchema(methodsResponseSchema.net_version, response);
  });

  it('should execute "web3_clientVersion"', function () {
    const response = ns.web3.clientVersion();
    validateResponseSchema(methodsResponseSchema.web3_clientVersion, response);
  });

  it('should execute "web3_sha3"', function () {
    const response = ns.web3.sha3('0x5644');
    validateResponseSchema(methodsResponseSchema.web3_sha3, response);
  });

  describe('Unsupported Methods', function () {
    let methodsSchema: { [method: string]: MethodObject };

    before(function () {
      methodsSchema = openRpcDocument.methods
        .filter((method) => 'name' in method)
        .reduce((res, method) => ({ ...res, [method.name]: method }), {} as { [method: string]: MethodObject });
    });

    type RpcMethodName = { [k in keyof typeof ns]: `${k}_${Exclude<keyof (typeof ns)[k], symbol>}` }[keyof typeof ns];

    const unsupportedMethods = {
      eth_coinbase: () => ns.eth.coinbase(),
      eth_simulateV1: () => ns.eth.simulateV1(),
      eth_blobBaseFee: () => ns.eth.blobBaseFee(),
      eth_getWork: () => ns.eth.getWork(),
      eth_newPendingTransactionFilter: () => ns.eth.newPendingTransactionFilter(),
      eth_protocolVersion: () => ns.eth.protocolVersion(),
      eth_sendTransaction: () => ns.eth.sendTransaction(),
      eth_signTransaction: () => ns.eth.signTransaction(),
      eth_sign: () => ns.eth.sign(),
      eth_submitHashrate: () => ns.eth.submitHashrate(),
      eth_getProof: () => ns.eth.getProof(),
      eth_createAccessList: () => ns.eth.createAccessList(),
      net_peerCount: () => ns.net.peerCount(),
    } satisfies { [rpcMethodName in RpcMethodName]?: () => JsonRpcError };

    Object.entries(unsupportedMethods).forEach(([rpcMethodName, fn]) => {
      it(`should return "Unsupported JSON-RPC method" error when executing '${rpcMethodName}'`, async function () {
        const error = fn();
        expect(error).to.be.an('error');

        const { result, errors } = methodsSchema[rpcMethodName];

        // Methods that always return "Unsupported JSON-RPC method" do not have a result
        expect(result).to.be.undefined;

        expect(errors).to.have.lengthOf(1);
        const [errorSchema] = errors!;
        expect(errorSchema).to.be.deep.equal({ code: -32601, message: 'Unsupported JSON-RPC method' });

        // `JsonRpcError` is an `Error`, so it has additional properties that we want to omit here
        expect({ code: error.code, message: error.message }).to.be.deep.equal(errorSchema);
      });
    });
  });
});
