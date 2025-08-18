// SPDX-License-Identifier: Apache-2.0
import { JSONSchemaObject, MethodObject, MethodOrReference, OpenrpcDocument } from '@open-rpc/meta-schema';
import { parseOpenRPCDocument } from '@open-rpc/schema-utils-js';
import { expect } from 'chai';
import fs from 'fs';
import path from 'path';
import WebSocket from 'ws';

import openRpcData from '../../../../docs/openrpc.json';
import CallerContract from '../contracts/Caller.json';
import LogsContract from '../contracts/Logs.json';
import {
  chainId,
  gasLimit,
  gasPrice,
  RELAY_URL,
  sendAccountAddress,
  setCreateContractLegacyTransactionAndBlockHash,
  setCurrentBlockHash,
  setLegacyTransactionAndBlockHash,
  setTransaction1559_2930AndBlockHash,
  setTransaction1559AndBlockHash,
  setTransaction2930AndBlockHash,
  WS_RELAY_URL,
} from './data/conformity/utils/constants';
import { TestCase, TestCases, UpdateParamFunction } from './data/conformity/utils/interfaces';
import { processFileContent, splitReqAndRes } from './data/conformity/utils/processors';
import {
  createContractLegacyTransaction,
  legacyTransaction,
  transaction1559,
  transaction1559_2930,
  transaction2930,
} from './data/conformity/utils/transactions';
import { getLatestBlockHash, sendRequestToRelay, signAndSendRawTransaction } from './data/conformity/utils/utils';
import { getMissingKeys, isResponseValid } from './data/conformity/utils/validations';

const directoryPath = path.resolve(__dirname, '../../../../node_modules/execution-apis/tests');
const overwritesDirectoryPath = path.resolve(__dirname, 'data/conformity/overwrites');

let relayOpenRpcData: OpenrpcDocument;
(async () => {
  relayOpenRpcData = await parseOpenRPCDocument(JSON.stringify(openRpcData));
})().catch((error) => console.error('Error parsing OpenRPC document:', error));

/**
 * Determines whether a given test case is expected to return an error response.
 *
 * @param testCase - The test case to evaluate.
 * @returns {boolean} `true` if an error response is expected, otherwise `false`.
 *
 * @example
 * ```typescript
 * const tc = { status: 404, response: '{"error": "Not found"}' };
 * console.log(isErrorResponseExpected(tc)); // true
 * ```
 */
const isErrorResponseExpected = function (testCase: TestCase): boolean {
  return (testCase?.status && testCase.status != 200) || !!JSON.parse(testCase.response).error;
};

/**
 * Retrieves the JSON schema object for the result of a given method name from the OpenRPC data.
 *
 * @param name - The name of the method to look up.
 * @returns {JSONSchemaObject | undefined} The method's result schema, or `undefined` if not found or invalid.
 *
 * @example
 * ```typescript
 * const schema = getMethodSchema("eth_getBalance");
 * console.log(schema); // JSON schema object or undefined
 * ```
 */
const getMethodSchema = function (name: string): JSONSchemaObject | undefined {
  const method = relayOpenRpcData.methods.find(
    (m: MethodOrReference): m is MethodObject => 'name' in m && m.name === name,
  );
  return method?.result && 'schema' in method.result && typeof method.result.schema === 'object'
    ? method.result.schema
    : undefined;
};

const synthesizeTestCases = function (testCases: TestCases, updateParamIfNeeded: UpdateParamFunction) {
  for (const testName in testCases) {
    it(`${testName}`, async function () {
      const isErrorStatusExpected = isErrorResponseExpected(testCases[testName]);
      const schema = getMethodSchema(testName.split(' ')[0]);
      try {
        const req = updateParamIfNeeded(testName, JSON.parse(testCases[testName].request));
        const res = await sendRequestToRelay(RELAY_URL, req, false);
        if (schema && schema.pattern) {
          const check = isResponseValid(schema, res);
          expect(check).to.be.true;
        }
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
 * We cannot replay all the chain.rlp transactions directly, as they are already signed with a chain id
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
    await signAndSendRawTransaction(RELAY_URL, { chainId, from: sendAccountAddress, type: 2, ...options });
  }
};

describe('@api-conformity', async function () {
  describe('@conformity-batch-1 Ethereum execution apis tests', function () {
    this.timeout(240 * 1000);
    before(async () => {
      setLegacyTransactionAndBlockHash(await signAndSendRawTransaction(RELAY_URL, legacyTransaction));
      setTransaction2930AndBlockHash(await signAndSendRawTransaction(RELAY_URL, transaction2930));
      setTransaction1559AndBlockHash(await signAndSendRawTransaction(RELAY_URL, transaction1559));
      setTransaction1559_2930AndBlockHash(await signAndSendRawTransaction(RELAY_URL, transaction1559_2930));
      setCreateContractLegacyTransactionAndBlockHash(
        await signAndSendRawTransaction(RELAY_URL, createContractLegacyTransaction),
      );
      await initGenesisData();
      setCurrentBlockHash(await getLatestBlockHash(RELAY_URL));
    });
    //Reading the directories within the ethereum execution api repo
    //Adds tests for custom Hedera methods from the override directory to the list, even if they're not in the OpenRPC spec.
    let directories = [...new Set([...fs.readdirSync(directoryPath), ...fs.readdirSync(overwritesDirectoryPath)])];
    const relaySupportedMethodNames = openRpcData.methods.map((method) => method.name);
    //Filtering to use only the tests for methods we support in our relay
    directories = directories.filter((directory) => relaySupportedMethodNames.includes(directory));
    for (const directory of directories) {
      //Lists all files (tests) in a directory (method). Returns an empty array for a non-existing directory.
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
          await processFileContent(RELAY_URL, directory, file, content);
        });
      }
    }
  });

  // NOTE: Test suites for batches 2-4 have been temporarily skipped.
  // This is a temporary measure to avoid introducing a large-scale refactor at this time,
  // as the original code in these suites violates our quality standards (e.g., high cyclomatic
  // complexity and excessive method length) and triggers Codacy warnings.
  //
  // These test suites must be un-skipped. The code requires refactoring to resolve the
  // static analysis issues before they can be re-enabled.
  describe('@conformity-batch-2 Ethereum execution apis tests', async function () {
    this.timeout(240 * 1000);

    let existingBlockFilter: string;
    let existingContractFilter: string;

    before(async () => {
      existingBlockFilter = (
        await sendRequestToRelay(
          RELAY_URL,
          {
            jsonrpc: '2.0',
            method: 'eth_newBlockFilter',
            params: [],
            id: 1,
          },
          false,
        )
      ).result;

      const deployLogsContractTx = await signAndSendRawTransaction(RELAY_URL, {
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
          RELAY_URL,
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

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const TEST_CASES_BATCH_2 = require('./data/conformity-tests-batch-2.json');

    const updateParamIfNeeded = (testName: any, request: any) => {
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

    let txHash: any;

    before(async () => {
      txHash = (await signAndSendRawTransaction(RELAY_URL, transaction1559)).transactionHash;
    });

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const TEST_CASES_BATCH_3 = require('./data/conformity-tests-batch-3.json');

    const updateParamIfNeeded = (testName: any, request: any) => {
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
      let contractAddress: string | null;
      let existingFilter: string;

      before(async () => {
        contractAddress = (
          await signAndSendRawTransaction(RELAY_URL, {
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
            RELAY_URL,
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
        webSocket = new WebSocket(WS_RELAY_URL);
      });

      afterEach(() => {
        webSocket.close();
      });

      const updateParamIfNeeded = (testName: any, request: any) => {
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

      const synthesizeWsTestCases = (testCases: any, updateParamIfNeeded: any) => {
        for (const testName in testCases) {
          it(`${testName}`, async () => {
            const req = updateParamIfNeeded(testName, JSON.parse(testCases[testName].request));

            let response: any = {};
            webSocket.on('message', function incoming(data: any) {
              response = JSON.parse(data);
            });
            webSocket.on('open', function open() {
              webSocket.send(JSON.stringify(req));
            });
            await new Promise((r) => setTimeout(r, 500));

            const hasMissingKeys =
              getMissingKeys({
                actual: response,
                expected: JSON.parse(testCases[testName].response),
                wildcards: [],
              }).length > 0;
            expect(hasMissingKeys).to.be.false;
          });
        }
      };

      synthesizeWsTestCases(TEST_CASES_BATCH_3['ws-server'], updateParamIfNeeded);
    });
  });

  describe('@conformity-batch-4 Ethereum execution apis tests', async function () {
    this.timeout(240 * 1000);

    let existingCallerContractAddress: string | null;
    let existingLogsContractAddress: string | null;
    let fromBlockForLogs: string;

    before(async () => {
      const deployCallerContractTx = await signAndSendRawTransaction(RELAY_URL, {
        chainId: 0x12a,
        to: null,
        from: sendAccountAddress,
        maxPriorityFeePerGas: gasPrice,
        maxFeePerGas: gasPrice,
        gasLimit: gasLimit,
        type: 2,
        data: CallerContract.bytecode,
      });

      const deployLogsContractTx = await signAndSendRawTransaction(RELAY_URL, {
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

      const log0ContractCall = await signAndSendRawTransaction(RELAY_URL, {
        chainId: 0x12a,
        to: existingLogsContractAddress,
        from: sendAccountAddress,
        maxPriorityFeePerGas: gasPrice,
        maxFeePerGas: gasPrice,
        gasLimit: gasLimit,
        type: 2,
        data: '0xd05285d4000000000000000000000000000000000000000000000000000000000000160c',
      });

      fromBlockForLogs = String(log0ContractCall.blockNumber);
    });

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const TEST_CASES_BATCH_4 = require('./data/conformity-tests-batch-4.json');

    const updateParamIfNeeded = (testName: any, request: any) => {
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
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const TEST_CASES_BATCH_5 = require('./data/conformity-tests-batch-5.json');

    const updateParamIfNeeded = (_testName: any, request: any) => request;
    synthesizeTestCases(TEST_CASES_BATCH_5, updateParamIfNeeded);
  });
});
