// SPDX-License-Identifier: Apache-2.0

import { ConfigService } from '@hashgraph/json-rpc-config-service/dist/services';
import { signTransaction } from '@hashgraph/json-rpc-relay/tests/helpers';
import { parseOpenRPCDocument } from '@open-rpc/schema-utils-js';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import axios from 'axios';
import { expect } from 'chai';
import fs from 'fs';
import path from 'path';
import WebSocket from 'ws';

import openRpcData from '../../../../docs/openrpc.json';
import { bytecode } from '../contracts/Basic.json';
import CallerContract from '../contracts/Caller.json';
import LogsContract from '../contracts/Logs.json';

const directoryPath = path.resolve(__dirname, '../../../../node_modules/execution-apis/tests');
const overwritesDirectoryPath = path.resolve(__dirname, 'data/conformity/overwrites');

let currentBlockHash;
let legacyTransactionAndBlockHash;
let transaction2930AndBlockHash;
let transaction1559AndBlockHash;
let createContractLegacyTransactionAndBlockHash;
const sendAccountAddress = '0xc37f417fA09933335240FCA72DD257BFBdE9C275';
const receiveAccountAddress = '0x67D8d32E9Bf1a9968a5ff53B87d777Aa8EBBEe69';
const relayUrl = 'http://127.0.0.1:7546';
const wsRelayUrl = 'ws://127.0.0.1:8546';
const gasPrice = '0x2C68AF0BB14000';
const gasLimit = '0x3D090';
const value = '0x2E90EDD000';
const localNodeAccountPrivateKey = '0x6e9d61a325be3f6675cf8b7676c70e4a004d2308e3e182370a41f5653d52c6bd';
const ACCESS_LIST_FILE_NAME = 'get-access-list.io';
const DYNAMIC_FEE_FILE_NAME = 'get-dynamic-fee.io';
const EMPTY_TX_FILE_NAME = 'get-empty-tx.io';
const LEGACY_CREATE_FILE_NAME = 'get-legacy-create.io';
const LEGACY_INPUT_FILE_NAME = 'get-legacy-input.io';
const LEGACY_CONTRACT_FILE_NAME = 'get-legacy-contract.io';
const LEGACY_TX_FILE_NAME = 'get-legacy-tx.io';
const LEGACY_RECEIPT_FILE_NAME = 'get-legacy-receipt.io';
const NOT_FOUND_TX_FILE_NAME = 'get-notfound-tx.io';
const ETHEREUM_NETWORK_BLOCK_HASH = '0xac5c61edb087a51279674fe01d5c1f65eac3fd8597f9bea215058e745df8088e';
const ETHEREUM_NETWORK_SIGNED_TRANSACTION =
  '0xf86709843b9aca018261a894aa000000000000000000000000000000000000000a825544820a95a0281582922adf6475f5b2241f0a4f886dafa947ecdc5913703b7840344a566b45a05f685fc099161126637a12308f278a8cd162788a6c6d5aee4d425cde261ba35d';
const ETHEREUM_NETWORK_ACCOUNT_HASH = '0x5C41A21F14cFe9808cBEc1d91b55Ba75ed327Eb6';
const EMPTY_TX_HASH = '0x0000000000000000000000000000000000000000000000000000000000000000';
const NONEXISTENT_TX_HASH = '0x00000000000000000000000000000000000000000000000000000000deadbeef';
const ajv = new Ajv({ strict: false });
addFormats(ajv);
let execApisOpenRpcData;
let relayOpenRpcData: any;

const chainId = Number(ConfigService.get('CHAIN_ID'));

const legacyTransaction = {
  chainId,
  to: receiveAccountAddress,
  from: sendAccountAddress,
  value,
  gasPrice,
  gasLimit: gasLimit,
  type: 0,
};

const transaction2930 = {
  chainId,
  to: receiveAccountAddress,
  from: sendAccountAddress,
  value,
  gasPrice,
  gasLimit: gasLimit,
  type: 1,
};

const transaction1559 = {
  chainId,
  to: receiveAccountAddress,
  from: sendAccountAddress,
  value,
  gasPrice,
  maxPriorityFeePerGas: gasPrice,
  maxFeePerGas: gasPrice,
  gasLimit: gasLimit,
  type: 2,
};

const createContractLegacyTransaction = {
  chainId,
  to: null,
  from: sendAccountAddress,
  gasLimit: gasLimit,
  gasPrice: gasPrice,
  type: 0,
  data: bytecode,
};

async function getTransactionCount() {
  const request = {
    jsonrpc: '2.0',
    id: 1,
    method: 'eth_getTransactionCount',
    params: [sendAccountAddress, 'latest'],
  };

  const response = await sendRequestToRelay(request, false);

  return response.result;
}

async function getLatestBlockHash() {
  const request = {
    jsonrpc: '2.0',
    method: 'eth_getBlockByNumber',
    params: ['latest', false],
    id: 0,
  };

  const response = await sendRequestToRelay(request, false);

  return response.result.hash;
}

function splitReqAndRes(content) {
  /**
   * Splits a given input string into distinct segments representing the request and the response.
   *
   * @param {string} content - The input string to be segmented.
   * @returns {{ request: string, response: string }} - An object containing the separated request and response strings.
   */
  const lines = content.split('\n');
  const filteredLines = lines.filter((line) => line != '' && !line.startsWith('//')).map((line) => line.slice(3));

  return { request: filteredLines[0], response: filteredLines[1] };
}

async function sendRequestToRelay(request, needError) {
  try {
    const response = await axios.post(relayUrl, request);
    if (request.method === 'eth_sendRawTransaction') {
      await global.relay.pollForValidTransactionReceipt(response.data.result);
    }
    return response.data;
  } catch (error) {
    console.error(error);
    if (needError) {
      return error;
    } else {
      throw error;
    }
  }
}

async function signAndSendRawTransaction(transaction) {
  transaction.nonce = parseInt(await getTransactionCount(), 16);
  const signed = await signTransaction(transaction, localNodeAccountPrivateKey);
  const request = {
    jsonrpc: '2.0',
    id: 1,
    method: 'eth_sendRawTransaction',
    params: [signed],
  };

  const response = await sendRequestToRelay(request, false);
  const requestTransactionReceipt = {
    id: 'test_id',
    jsonrpc: '2.0',
    method: 'eth_getTransactionReceipt',
    params: [response.result],
  };
  const transactionReceipt = await sendRequestToRelay(requestTransactionReceipt, false);
  return {
    transactionHash: response.result,
    blockHash: transactionReceipt.result.blockHash,
    transactionIndex: transactionReceipt.result.transactionIndex,
    blockNumber: transactionReceipt.result.blockNumber,
    contractAddress: transactionReceipt.result.contractAddress,
  };
}

async function checkRequestBody(fileName, request) {
  /**
   * Modifies a request object for compatability with our network.
   *
   * @param {string} fileName - The name of the file associated with the request.
   * @param {Object} request - The request object to be modified.
   * @returns {Object} - The modified request object.
   */
  if (
    (request.method === 'eth_getBlockByHash' && request.params[0] === ETHEREUM_NETWORK_BLOCK_HASH) ||
    (request.method === 'eth_sendRawTransaction' && request.params[0] === ETHEREUM_NETWORK_SIGNED_TRANSACTION)
  ) {
    request.params[0] = currentBlockHash;
  }
  if (request.method === 'eth_getTransactionByBlockHashAndIndex') {
    request.params[0] = legacyTransactionAndBlockHash.blockHash;
    request.params[1] = legacyTransactionAndBlockHash.transactionIndex;
  }
  if (request.method === 'eth_getTransactionByBlockNumberAndIndex') {
    request.params[0] = legacyTransactionAndBlockHash.blockNumber;
    request.params[1] = legacyTransactionAndBlockHash.transactionIndex;
  }
  if (request.method === 'eth_sendRawTransaction') {
    if (request.params[0] === ETHEREUM_NETWORK_SIGNED_TRANSACTION) {
      request.params[0] = currentBlockHash;
    } else {
      legacyTransaction.nonce = parseInt(await getTransactionCount(), 16);
      const transactionHash = await signTransaction(legacyTransaction, localNodeAccountPrivateKey);
      request.params[0] = transactionHash;
    }
  }
  if (request.method === 'eth_getBalance') {
    request.params[0] = ETHEREUM_NETWORK_ACCOUNT_HASH;
    request.params[1] = currentBlockHash;
  }
  if (request.method === 'eth_getTransactionByHash' || request.method === 'eth_getTransactionReceipt') {
    request = formatTransactionByHashAndReceiptRequests(fileName, request);
  }
  return request;
}

function checkResponseFormat(actualReponse, expectedResponse) {
  const actualResponseKeys = extractKeys(actualReponse);
  const expectedResponseKeys = extractKeys(expectedResponse);
  const missingKeys = expectedResponseKeys.filter((key) => !actualResponseKeys.includes(key));
  if (missingKeys.length > 0) {
    return true;
  } else {
    return false;
  }
}

const findSchema = function (file) {
  const schema = execApisOpenRpcData.methods.find((method) => method.name === file)?.result?.schema;

  return schema;
};

function isResponseValid(schema, response) {
  const validate = ajv.compile(schema);
  const valid = validate(response.result);

  expect(validate.errors).to.be.null;

  return valid;
}

function extractKeys(obj, prefix = '') {
  let keys = [];
  for (const key in obj) {
    // eslint-disable-next-line no-prototype-builtins
    if (obj.hasOwnProperty(key)) {
      const newKey = prefix ? `${prefix}.${key}` : key;
      keys.push(newKey);

      if (typeof obj[key] === 'object' && !Array.isArray(obj[key])) {
        keys = keys.concat(extractKeys(obj[key], newKey));
      }
    }
  }

  return keys;
}

function formatTransactionByHashAndReceiptRequests(fileName, request) {
  /**
   * Formats a specific request by incorporating actual transaction and block hashes based on the provided file name.
   *
   * @param {string} fileName - The name of the file being processed.
   * @param {Object} request - The specific request to be formatted.
   * @returns {Object} - The formatted request containing updated transaction and block hashes.
   */
  switch (fileName) {
    case ACCESS_LIST_FILE_NAME:
      request.params[0] = transaction2930AndBlockHash.transactionHash;
      break;
    case DYNAMIC_FEE_FILE_NAME:
      request.params[0] = transaction1559AndBlockHash.transactionHash;
      break;
    case EMPTY_TX_FILE_NAME:
      request.params[0] = EMPTY_TX_HASH;
      break;
    case LEGACY_CREATE_FILE_NAME:
      request.params[0] = createContractLegacyTransactionAndBlockHash.transactionHash;
      break;
    case LEGACY_INPUT_FILE_NAME:
      request.params[0] = createContractLegacyTransactionAndBlockHash.transactionHash;
      break;
    case LEGACY_CONTRACT_FILE_NAME:
      request.params[0] = createContractLegacyTransactionAndBlockHash.transactionHash;
      break;
    case LEGACY_TX_FILE_NAME:
      request.params[0] = legacyTransactionAndBlockHash.transactionHash;
      break;
    case LEGACY_RECEIPT_FILE_NAME:
      request.params[0] = legacyTransactionAndBlockHash.transactionHash;
      break;
    case NOT_FOUND_TX_FILE_NAME:
      request.params[0] = NONEXISTENT_TX_HASH;
      break;
  }
  return request;
}

async function processFileContent(directory, file, content) {
  /**
   * Processes a file from the execution apis repo
   * containing test request and response data.
   *
   * @param {string} file - The name of the file being processed.
   * @param {Object} content - The content of the file, consisting of request and response data.
   * @returns {Array<string>} - An array of missing keys in the response data.
   */
  console.log('Executing for ', file);
  const modifiedRequest = await checkRequestBody(file, JSON.parse(content.request));
  const needError = JSON.parse(content.response).error;
  const response = await sendRequestToRelay(modifiedRequest, needError);
  const schema = findSchema(directory);
  const valid = needError
    ? checkResponseFormat(response.response.data, content.response)
    : isResponseValid(schema, response);
  expect(valid).to.be.true;
}

const synthesizeTestCases = function (testCases, updateParamIfNeeded) {
  for (const testName in testCases) {
    it(`${testName}`, async function () {
      const isErrorStatusExpected: boolean = !!(testCases[testName]?.status && testCases[testName].status != 200);
      const schema = relayOpenRpcData.methods.find((method) => method.name === testName)?.result?.schema;
      try {
        const req = updateParamIfNeeded(testName, JSON.parse(testCases[testName].request));
        const res = await sendRequestToRelay(req, false);
        const hasMissingKeys: boolean = checkResponseFormat(res, JSON.parse(testCases[testName].response));

        if (schema && schema.pattern) {
          const check = isResponseValid(schema, res);
          expect(check).to.be.true;
        }

        expect(hasMissingKeys).to.be.false;
        expect(isErrorStatusExpected).to.be.false;
      } catch (e: any) {
        expect(isErrorStatusExpected).to.be.true;
        expect(e?.response?.status).to.equal(testCases[testName].status);
      }
    });
  }
};

/**
 * To run the Ethereum Execution API tests as defined in the repository ethereum/execution-apis, it’s necessary
 * to execute them against a specifically configured node. This node must use:
 *  - Transactions from the blocks in chain.rlp (https://github.com/ethereum/execution-apis/blob/main/tests/chain.rlp),
 *  - Account balances from genesis.json (https://github.com/ethereum/execution-apis/blob/main/tests/genesis.json).
 *
 * We cannot replay all of the chain.rlp transactions directly, as they are already signed with a chain id
 * that exceeds Java’s Integer.MAX_VALUE (which is also the maximum allowed chain ID in Hedera).
 * However, we can replicate the test environment by deploying the required smart contracts manually.
 * While these contracts will receive different addresses than those in the original tests,
 * their behavior will remain consistent with the expectations.
 */
const initGenesisData = async function () {
  for (const data of require('./data/conformity/genesis.json')) {
    const options = { maxPriorityFeePerGas: gasPrice, maxFeePerGas: gasPrice, gasLimit: gasLimit };
    options['to'] = data.account ? data.account : null;
    if (data.balance) options['value'] = `0x${data.balance.toString(16)}`;
    if (data.bytecode) options['data'] = data.bytecode;
    await signAndSendRawTransaction({ chainId, from: sendAccountAddress, type: 2, ...options });
  }
};

describe('@api-conformity', async function () {
  before(async () => {
    relayOpenRpcData = await parseOpenRPCDocument(JSON.stringify(openRpcData));
  });

  describe('@conformity-batch-1 Ethereum execution apis tests', function () {
    this.timeout(240 * 1000);
    execApisOpenRpcData = require('../../../../openrpc_exec_apis.json');
    before(async () => {
      legacyTransactionAndBlockHash = await signAndSendRawTransaction(legacyTransaction);
      transaction2930AndBlockHash = await signAndSendRawTransaction(transaction2930);
      transaction1559AndBlockHash = await signAndSendRawTransaction(transaction1559);
      createContractLegacyTransactionAndBlockHash = await signAndSendRawTransaction(createContractLegacyTransaction);
      await initGenesisData();
      currentBlockHash = await getLatestBlockHash();
    });
    //Reading the directories within the ethereum execution api repo
    //Adds tests for custom Hedera methods from override directory to the list, even if they're not in the OpenRPC spec.
    let directories = [...new Set([...fs.readdirSync(directoryPath), ...fs.readdirSync(overwritesDirectoryPath)])];
    const relaySupportedMethodNames = openRpcData.methods.map((method) => method.name);
    //Filtering in order to use only the tests for methods we support in our relay
    directories = directories.filter((directory) => relaySupportedMethodNames.includes(directory));
    for (const directory of directories) {
      //Lists all files (tests) in a directory (method). Returns an empty array for non-existing directory.
      const ls = (dir: string) => (fs.existsSync(dir) && fs.statSync(dir).isDirectory() ? fs.readdirSync(dir) : []);
      const files = [
        ...new Set([...ls(path.join(directoryPath, directory)), ...ls(path.join(overwritesDirectoryPath, directory))]),
      ];
      for (const file of files) {
        const isCustom = fs.existsSync(path.join(overwritesDirectoryPath, directory, file));
        it(`Executing for ${directory} and ${file}${isCustom ? ' (overwritten)' : ''}`, async () => {
          const dir = isCustom ? overwritesDirectoryPath : directoryPath;
          const data = fs.readFileSync(path.resolve(dir, directory, file));
          const content = splitReqAndRes(data.toString('utf-8'));
          await processFileContent(directory, file, content);
        });
      }
    }
  });

  describe('@conformity-batch-2 Ethereum execution apis tests', async function () {
    this.timeout(240 * 1000);

    let existingBlockFilter: string;
    let existingContractFilter: string;

    before(async () => {
      existingBlockFilter = (
        await sendRequestToRelay(
          {
            jsonrpc: '2.0',
            method: 'eth_newBlockFilter',
            params: [],
            id: 1,
          },
          false,
        )
      ).result;

      const deployLogsContractTx = await signAndSendRawTransaction({
        chainId,
        to: null,
        from: sendAccountAddress,
        maxPriorityFeePerGas: gasPrice,
        maxFeePerGas: gasPrice,
        gasLimit: gasLimit,
        type: 2,
        data: LogsContract.bytecode,
      });

      existingContractFilter = (
        await sendRequestToRelay(
          {
            jsonrpc: '2.0',
            method: 'eth_newFilter',
            params: [
              {
                fromBlock: '0x1',
                toBlock: '0x160c',
                address: deployLogsContractTx.contractAddress,
              },
            ],
            id: 1,
          },
          false,
        )
      ).result;
    });

    const TEST_CASES_BATCH_2 = require('./data/conformity-tests-batch-2.json');

    const updateParamIfNeeded = (testName, request) => {
      switch (testName) {
        case 'eth_getFilterChanges - existing filter':
          request.params = [existingBlockFilter];
          break;
        case 'eth_getFilterLogs - existing filter':
          request.params = [existingContractFilter];
          break;
      }

      return request;
    };

    synthesizeTestCases(TEST_CASES_BATCH_2, updateParamIfNeeded);
  });

  describe('@conformity-batch-3 Ethereum execution apis tests', async function () {
    this.timeout(240 * 1000);

    let txHash;

    before(async () => {
      txHash = (await signAndSendRawTransaction(transaction1559)).transactionHash;
    });

    const TEST_CASES_BATCH_3 = require('./data/conformity-tests-batch-3.json');

    const updateParamIfNeeded = (testName, request) => {
      switch (testName) {
        case 'debug_traceTransaction - existing tx':
          request.params = [
            txHash,
            {
              tracer: 'callTracer',
              tracerConfig: {
                onlyTopCall: true,
              },
            },
          ];
          break;
      }

      return request;
    };

    synthesizeTestCases(TEST_CASES_BATCH_3['server'], updateParamIfNeeded);

    describe('ws related rpc methods', async function () {
      let webSocket: WebSocket;
      let contractAddress: string;
      let existingFilter: string;

      before(async () => {
        contractAddress = (
          await signAndSendRawTransaction({
            chainId,
            to: null,
            from: sendAccountAddress,
            maxPriorityFeePerGas: gasPrice,
            maxFeePerGas: gasPrice,
            gasLimit: gasLimit,
            type: 2,
            data: CallerContract.bytecode,
          })
        ).contractAddress;

        existingFilter = (
          await sendRequestToRelay(
            {
              jsonrpc: '2.0',
              method: 'eth_newFilter',
              params: [
                {
                  fromBlock: '0x3',
                  toBlock: '0x56ac',
                  address: contractAddress,
                },
              ],
              id: 1,
            },
            false,
          )
        ).result;
      });

      beforeEach(() => {
        webSocket = new WebSocket(wsRelayUrl);
      });

      afterEach(() => {
        webSocket.close();
      });

      const updateParamIfNeeded = (testName, request) => {
        switch (testName) {
          case 'eth_subscribe - existing contract':
            request.params = [
              'logs',
              {
                address: contractAddress,
              },
            ];
            break;
          case 'eth_unsubscribe - existing filter':
            request.params = [existingFilter];
            break;
        }

        return request;
      };

      const synthesizeWsTestCases = (testCases, updateParamIfNeeded) => {
        for (const testName in testCases) {
          it(`${testName}`, async () => {
            const req = updateParamIfNeeded(testName, JSON.parse(testCases[testName].request));

            let response: any = {};
            webSocket.on('message', function incoming(data) {
              response = JSON.parse(data);
            });
            webSocket.on('open', function open() {
              webSocket.send(JSON.stringify(req));
            });
            await new Promise((r) => setTimeout(r, 500));

            const hasMissingKeys: boolean = checkResponseFormat(response, JSON.parse(testCases[testName].response));
            expect(hasMissingKeys).to.be.false;
          });
        }
      };

      synthesizeWsTestCases(TEST_CASES_BATCH_3['ws-server'], updateParamIfNeeded);
    });
  });

  describe('@conformity-batch-4 Ethereum execution apis tests', async function () {
    this.timeout(240 * 1000);

    let existingCallerContractAddress: string;
    let existingLogsContractAddress: string;
    let fromBlockForLogs: string;

    before(async () => {
      const deployCallerContractTx = await signAndSendRawTransaction({
        chainId: 0x12a,
        to: null,
        from: sendAccountAddress,
        maxPriorityFeePerGas: gasPrice,
        maxFeePerGas: gasPrice,
        gasLimit: gasLimit,
        type: 2,
        data: CallerContract.bytecode,
      });

      const deployLogsContractTx = await signAndSendRawTransaction({
        chainId: 0x12a,
        to: null,
        from: sendAccountAddress,
        maxPriorityFeePerGas: gasPrice,
        maxFeePerGas: gasPrice,
        gasLimit: gasLimit,
        type: 2,
        data: LogsContract.bytecode,
      });

      existingCallerContractAddress = deployCallerContractTx.contractAddress;
      existingLogsContractAddress = deployLogsContractTx.contractAddress;

      const log0ContractCall = await signAndSendRawTransaction({
        chainId: 0x12a,
        to: existingLogsContractAddress,
        from: sendAccountAddress,
        maxPriorityFeePerGas: gasPrice,
        maxFeePerGas: gasPrice,
        gasLimit: gasLimit,
        type: 2,
        data: '0xd05285d4000000000000000000000000000000000000000000000000000000000000160c',
      });

      fromBlockForLogs = log0ContractCall.blockNumber;
    });

    const TEST_CASES_BATCH_4 = require('./data/conformity-tests-batch-4.json');

    const updateParamIfNeeded = (testName, request) => {
      switch (testName) {
        case 'eth_call - existing contract view function and existing from':
          request.params = [
            {
              from: sendAccountAddress,
              to: existingCallerContractAddress,
              data: '0x0ec1551d',
            },
            'latest',
          ];
          break;
        case 'eth_call - existing contract tx and existing from':
          request.params = [
            {
              from: sendAccountAddress,
              to: existingCallerContractAddress,
              data: '0xddf363d7',
            },
            'latest',
          ];
          break;
        case 'eth_call - existing contract tx, existing from and positive value':
          request.params = [
            {
              from: sendAccountAddress,
              to: existingCallerContractAddress,
              data: '0xddf363d7',
              value: '0x2540be400',
            },
            'latest',
          ];
          break;
        case 'eth_call - existing contract view function and non-existing from':
          request.params = [
            {
              from: '0x6b175474e89094c44da98b954eedeac495271d0f',
              to: existingCallerContractAddress,
              data: '0x0ec1551d',
            },
            'latest',
          ];
          break;
        case 'eth_call - existing contract tx and non-existing from':
          request.params = [
            {
              from: '0x6b175474e89094c44da98b954eedeac495271d0f',
              to: existingCallerContractAddress,
              data: '0xddf363d7',
            },
            'latest',
          ];
          break;
        case 'eth_call - existing contract tx, non-existing from and positive value':
          request.params = [
            {
              from: '0x6b175474e89094c44da98b954eedeac495271d0f',
              to: existingCallerContractAddress,
              data: '0xddf363d7',
              value: '0x2540be400',
            },
            'latest',
          ];
          break;
        case 'eth_estimateGas - existing contract view function and existing from':
          request.params = [
            {
              from: sendAccountAddress,
              to: existingCallerContractAddress,
              data: '0x0ec1551d',
            },
            'latest',
          ];
          break;
        case 'eth_estimateGas - existing contract tx and existing from':
          request.params = [
            {
              from: sendAccountAddress,
              to: existingCallerContractAddress,
              data: '0xddf363d7',
            },
            'latest',
          ];
          break;
        case 'eth_estimateGas - existing contract tx, existing from and positive value':
          request.params = [
            {
              from: sendAccountAddress,
              to: existingCallerContractAddress,
              data: '0xddf363d7',
              value: '0x2540be400',
            },
            'latest',
          ];
          break;
        case 'eth_estimateGas - existing contract view function and non-existing from':
          request.params = [
            {
              from: '0x6b175474e89094c44da98b954eedeac495271d0f',
              to: existingCallerContractAddress,
              data: '0x0ec1551d',
            },
            'latest',
          ];
          break;
        case 'eth_estimateGas - existing contract tx and non-existing from':
          request.params = [
            {
              from: '0x6b175474e89094c44da98b954eedeac495271d0f',
              to: existingCallerContractAddress,
              data: '0xddf363d7',
            },
            'latest',
          ];
          break;
        case 'eth_estimateGas - existing contract tx, non-existing from and positive value':
          request.params = [
            {
              from: '0x6b175474e89094c44da98b954eedeac495271d0f',
              to: existingCallerContractAddress,
              data: '0xddf363d7',
              value: '0x2540be400',
            },
            'latest',
          ];
          break;
        case 'eth_getLogs - existing contract':
          request.params = [
            {
              address: existingLogsContractAddress,
            },
          ];
          break;
        case 'eth_getLogs - existing contract and from/to block':
          request.params = [
            {
              fromBlock: fromBlockForLogs,
              toBlock: 'latest',
              address: existingLogsContractAddress,
            },
          ];
          break;
      }

      return request;
    };

    synthesizeTestCases(TEST_CASES_BATCH_4, updateParamIfNeeded);
  });

  describe('@conformity-batch-5 Ethereum execution apis tests', async function () {
    this.timeout(240 * 1000);
    const TEST_CASES_BATCH_5 = require('./data/conformity-tests-batch-5.json');

    const updateParamIfNeeded = (_testName, request) => request;
    synthesizeTestCases(TEST_CASES_BATCH_5, updateParamIfNeeded);
  });
});
