// SPDX-License-Identifier: Apache-2.0

import { ConfigService } from '@hashgraph/json-rpc-config-service/dist/services';
import { AccountInfo } from '@hashgraph/sdk';
import { parseOpenRPCDocument, validateOpenRPCDocument } from '@open-rpc/schema-utils-js';
import Ajv from 'ajv';
import axios from 'axios';
import MockAdapter from 'axios-mock-adapter';
import { BigNumber } from 'bignumber.js';
import { expect } from 'chai';
import EventEmitter from 'events';
import Long from 'long';
import pino from 'pino';
import { register, Registry } from 'prom-client';
import sinon from 'sinon';

import openRpcSchema from '../../../../docs/openrpc.json';
import { Relay } from '../../src';
import { numberTo0x } from '../../src/formatters';
import { SDKClient } from '../../src/lib/clients';
import { MirrorNodeClient } from '../../src/lib/clients';
import constants from '../../src/lib/constants';
import { EvmAddressHbarSpendingPlanRepository } from '../../src/lib/db/repositories/hbarLimiter/evmAddressHbarSpendingPlanRepository';
import { HbarSpendingPlanRepository } from '../../src/lib/db/repositories/hbarLimiter/hbarSpendingPlanRepository';
import { IPAddressHbarSpendingPlanRepository } from '../../src/lib/db/repositories/hbarLimiter/ipAddressHbarSpendingPlanRepository';
import { EthImpl } from '../../src/lib/eth';
import { CacheService } from '../../src/lib/services/cacheService/cacheService';
import ClientService from '../../src/lib/services/hapiService/hapiService';
import { HbarLimitService } from '../../src/lib/services/hbarLimitService';
import { RequestDetails } from '../../src/lib/types';
import {
  blockHash,
  blockNumber,
  bytecode,
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
  overrideEnvsInMochaDescribe,
  signedTransactionHash,
} from '../helpers';
import { CONTRACT_RESULT_MOCK, NOT_FOUND_RES } from './eth/eth-config';

const logger = pino({ level: 'silent' });
const registry = new Registry();
const relay = new Relay(logger, registry);

let mock: MockAdapter;
let mirrorNodeInstance: MirrorNodeClient;
let clientServiceInstance: ClientService;
let sdkClientStub: sinon.SinonStubbedInstance<SDKClient>;

const noTransactions = '?transactions=false';

describe('Open RPC Specification', function () {
  let rpcDocument: any;
  let methodsResponseSchema: { [method: string]: any };
  let ethImpl: EthImpl;

  const requestDetails = new RequestDetails({ requestId: 'openRpcTest', ipAddress: '0.0.0.0' });

  overrideEnvsInMochaDescribe({ npm_package_version: 'relay/0.0.1-SNAPSHOT' });

  this.beforeAll(async () => {
    rpcDocument = await parseOpenRPCDocument(JSON.stringify(openRpcSchema));
    methodsResponseSchema = rpcDocument.methods.reduce(
      (res: { [method: string]: any }, method: any) => ({
        ...res,
        [method.name]: method.result.schema,
      }),
      {},
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

    // @ts-ignore
    mock = new MockAdapter(instance, { onNoMatch: 'throwException' });
    const cacheService = new CacheService(logger.child({ name: `cache` }), registry);
    // @ts-ignore
    mirrorNodeInstance = new MirrorNodeClient(
      ConfigService.get('MIRROR_NODE_URL'),
      logger.child({ name: `mirror-node` }),
      registry,
      cacheService,
      instance,
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

    clientServiceInstance = new ClientService(logger, registry, cacheService, eventEmitter, hbarLimitService);
    sdkClientStub = sinon.createStubInstance(SDKClient);
    sinon.stub(clientServiceInstance, 'getSDKClient').returns(sdkClientStub);
    // @ts-ignore
    ethImpl = new EthImpl(clientServiceInstance, mirrorNodeInstance, logger, '0x12a', registry, cacheService);

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
    sdkClientStub.getAccountBalanceInWeiBar.resolves(BigNumber(1000));
    sdkClientStub.getAccountBalanceInTinyBar.resolves(BigNumber(100000000000));
    sdkClientStub.getContractByteCode.resolves(Buffer.from(bytecode.replace('0x', ''), 'hex'));
    sdkClientStub.getAccountInfo.resolves({ ethereumNonce: Long.ONE } as unknown as AccountInfo);
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
  });

  const validateResponseSchema = (schema: any, response: any) => {
    const ajv = new Ajv();
    ajv.validate(schema, response);

    if (ajv.errors && ajv.errors.length > 0) {
      console.log({
        errors: ajv.errors,
      });
    }

    expect(ajv.errors).to.be.null;
  };

  it(`validates the openrpc document`, async () => {
    const rpcDocument = await parseOpenRPCDocument(JSON.stringify(openRpcSchema));
    const isValid = validateOpenRPCDocument(rpcDocument);

    expect(isValid).to.be.true;
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
    const response = ethImpl.chainId(requestDetails);

    validateResponseSchema(methodsResponseSchema.eth_chainId, response);
  });

  it('should execute "eth_coinbase"', function () {
    const response = ethImpl.coinbase(requestDetails);

    validateResponseSchema(methodsResponseSchema.eth_coinbase, response);
  });

  it('should execute "eth_estimateGas"', async function () {
    mock.onGet(`accounts/undefined${noTransactions}`).reply(404);
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
          `&topic0=${defaultLogTopics[0]}&topic1=${defaultLogTopics[1]}` +
          `&topic2=${defaultLogTopics[2]}&topic3=${defaultLogTopics[3]}&limit=100&order=asc`,
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

    sinon.stub(ethImpl, <any>'getCurrentGasPriceForBlock').resolves('0xad78ebc5ac620000');
    const response = await ethImpl.getTransactionReceipt(defaultTxHash, requestDetails);

    validateResponseSchema(methodsResponseSchema.eth_getTransactionReceipt, response);
  });

  it('should execute "eth_getUncleByBlockHashAndIndex"', async function () {
    const response = await ethImpl.getUncleByBlockHashAndIndex(requestDetails);

    validateResponseSchema(methodsResponseSchema.eth_getUncleByBlockHashAndIndex, response);
  });

  it('should execute "eth_getUncleByBlockNumberAndIndex"', async function () {
    const response = await ethImpl.getUncleByBlockNumberAndIndex(requestDetails);

    validateResponseSchema(methodsResponseSchema.eth_getUncleByBlockNumberAndIndex, response);
  });

  it('should execute "eth_getUncleByBlockNumberAndIndex"', async function () {
    const response = await ethImpl.getUncleByBlockNumberAndIndex(requestDetails);

    validateResponseSchema(methodsResponseSchema.eth_getUncleByBlockNumberAndIndex, response);
  });

  it('should execute "eth_getUncleCountByBlockHash"', async function () {
    const response = await ethImpl.getUncleCountByBlockHash(requestDetails);

    validateResponseSchema(methodsResponseSchema.eth_getUncleCountByBlockHash, response);
  });

  it('should execute "eth_getUncleCountByBlockNumber"', async function () {
    const response = await ethImpl.getUncleCountByBlockNumber(requestDetails);

    validateResponseSchema(methodsResponseSchema.eth_getUncleCountByBlockNumber, response);
  });

  it('should execute "eth_getWork"', async function () {
    const response = ethImpl.getWork(requestDetails);

    validateResponseSchema(methodsResponseSchema.eth_getWork, response);
  });

  it('should execute "eth_hashrate"', async function () {
    const response = await ethImpl.hashrate(requestDetails);

    validateResponseSchema(methodsResponseSchema.eth_hashrate, response);
  });

  it('should execute "eth_mining"', async function () {
    const response = await ethImpl.mining(requestDetails);

    validateResponseSchema(methodsResponseSchema.eth_mining, response);
  });

  it('should execute "eth_protocolVersion"', async function () {
    const response = ethImpl.protocolVersion(requestDetails);

    validateResponseSchema(methodsResponseSchema.eth_protocolVersion, response);
  });

  it('should execute "eth_sendRawTransaction"', async function () {
    const response = await ethImpl.sendRawTransaction(signedTransactionHash, requestDetails);

    validateResponseSchema(methodsResponseSchema.eth_sendRawTransaction, response);
  });

  it('should execute "eth_sendTransaction"', async function () {
    const response = ethImpl.sendTransaction(requestDetails);

    validateResponseSchema(methodsResponseSchema.eth_sendTransaction, response);
  });

  it('should execute "eth_signTransaction"', async function () {
    const response = ethImpl.signTransaction(requestDetails);

    validateResponseSchema(methodsResponseSchema.eth_signTransaction, response);
  });

  it('should execute "eth_sign"', async function () {
    const response = ethImpl.sign(requestDetails);

    validateResponseSchema(methodsResponseSchema.eth_sign, response);
  });

  it('should execute "eth_submitHashrate"', async function () {
    const response = ethImpl.submitHashrate(requestDetails);

    validateResponseSchema(methodsResponseSchema.eth_submitHashrate, response);
  });

  it('should execute "eth_submitWork"', async function () {
    const response = await ethImpl.submitWork(requestDetails);

    validateResponseSchema(methodsResponseSchema.eth_submitWork, response);
  });

  it('should execute "eth_syncing"', async function () {
    const response = await ethImpl.syncing(requestDetails);

    validateResponseSchema(methodsResponseSchema.eth_syncing, response);
  });

  it('should execute "net_listening"', function () {
    const response = relay.net().listening();

    validateResponseSchema(methodsResponseSchema.net_listening, response);
  });

  it('should execute "net_version"', function () {
    const response = relay.net().version();

    validateResponseSchema(methodsResponseSchema.net_version, response);
  });

  it('should execute "net_peerCount"', function () {
    const response = relay.net().peerCount();

    validateResponseSchema(methodsResponseSchema.net_peerCount, response);
  });

  it('should execute "web3_clientVersion"', function () {
    const response = relay.web3().clientVersion();

    validateResponseSchema(methodsResponseSchema.web3_clientVersion, response);
  });

  it('should execute "web3_sha3"', function () {
    const response = relay.web3().sha3('0x5644');

    validateResponseSchema(methodsResponseSchema.web3_sha3, response);
  });
});
