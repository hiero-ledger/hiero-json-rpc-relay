// SPDX-License-Identifier: Apache-2.0

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
import { processFileContent, splitReqAndRes } from './data/conformity/utils/processors';
import {
  createContractLegacyTransaction,
  legacyTransaction,
  transaction1559,
  transaction1559_2930,
  transaction2930,
} from './data/conformity/utils/transactions';
import { getLatestBlockHash, sendRequestToRelay, signAndSendRawTransaction } from './data/conformity/utils/utils';
import { checkResponseFormat, isResponseValid } from './data/conformity/utils/validations';

const directoryPath = path.resolve(__dirname, '../../../../node_modules/execution-apis/tests');
const overwritesDirectoryPath = path.resolve(__dirname, 'data/conformity/overwrites');

let relayOpenRpcData: any;
(async () => {
  relayOpenRpcData = await parseOpenRPCDocument(JSON.stringify(openRpcData));
})().catch((error) => console.error('Error parsing OpenRPC document:', error));

const synthesizeTestCases = function (testCases: any, updateParamIfNeeded: any) {
  for (const testName in testCases) {
    it(`${testName}`, async function () {
      const isErrorStatusExpected: boolean =
        (testCases[testName]?.status && testCases[testName].status != 200) ||
        !!JSON.parse(testCases[testName].response).error;
      const schema = relayOpenRpcData.methods.find((method: any) => method.name === testName)?.result?.schema;
      try {
        const req = updateParamIfNeeded(testName, JSON.parse(testCases[testName].request));
        const res = await sendRequestToRelay(RELAY_URL, req, false);
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
      let contractAddress: string;
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

      fromBlockForLogs = log0ContractCall.blockNumber;
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
