// SPDX-License-Identifier: Apache-2.0

import { expect } from 'chai';
import { ethers } from 'ethers';
import sinon from 'sinon';

import { ConfigService } from '../../src/config-service/services';
import { numberTo0x } from '../../src/relay/formatters';
import * as methodConfigModule from '../../src/relay/lib/config/methodConfiguration';
import { TracerType } from '../../src/relay/lib/constants';
import basicContractJson from '../server/contracts/Basic.json';
import logsContractJson from '../server/contracts/Logs.json';
import storageContractJson from '../server/contracts/Storage.json';
import Address from '../server/helpers/constants';
import { Utils } from '../server/helpers/utils';
import { type AliasAccount } from '../server/types/AliasAccount';
import { assertSameJsonRpcResultAcrossTransports } from './helpers/protocolClient';

interface ParityCase {
  method: string;
  description: string;
  // A function that returns the params array, so rows can use values that `before()` sets up after the table is built.
  params: () => unknown[];
}

const PING_CALL_DATA = new ethers.Interface(basicContractJson.abi).encodeFunctionData('ping');
const LOG1_CALL_DATA = new ethers.Interface(logsContractJson.abi).encodeFunctionData('log1', [1]);
const METHODS_WITHOUT_RATE_LIMIT_ENTRY = [
  'debug_getBadBlocks',
  'debug_getRawBlock',
  'debug_getRawHeader',
  'debug_getRawReceipts',
  'debug_getRawTransaction',
  'txpool_content',
  'txpool_contentFrom',
  'txpool_status',
];

describe('@protocol-acceptance @protocol-acceptance-common-service HTTP/WebSocket parity', async function () {
  this.timeout(240 * 1000);

  let account: AliasAccount;
  let contractAddress: string;
  let blockBeforeDeploy: string;
  let txHash: string;
  let txBlockNumber: string;
  let txBlockHash: string;
  let txIndex: string | null;
  let storageContractAddress: string;
  let logsFilter: { fromBlock: string; toBlock: string; address: string };
  let logsBlockHash: string;
  let logsFilterId: string;
  let wrongChainIdTx: string;
  const sandbox = sinon.createSandbox();

  before(async () => {
    // WebSocket's rate limiter throws and never replies for methods missing from methodConfiguration, so add the default limit.
    if (global.relayIsLocal) {
      sandbox.replace(methodConfigModule, 'methodConfiguration', {
        ...methodConfigModule.getMethodConfiguration(),
        ...Object.fromEntries(
          METHODS_WITHOUT_RATE_LIMIT_ENTRY.map((method) => [
            method,
            { total: ConfigService.get('DEFAULT_RATE_LIMIT') },
          ]),
        ),
      });
    }

    [account] = await Utils.createMultipleAliasAccounts(
      global.mirrorNode,
      global.accounts[0],
      1,
      global.initialBalance.toString(),
    );
    global.accounts.push(account);

    blockBeforeDeploy = numberTo0x((await global.mirrorNode.get(`/blocks?limit=1&order=desc`)).blocks[0].number);
    const contract = await Utils.deployContract(basicContractJson.abi, basicContractJson.bytecode, account.wallet);
    contractAddress = contract.target as string;
    const storageContract = await Utils.deployContract(
      storageContractJson.abi,
      storageContractJson.bytecode,
      account.wallet,
    );
    storageContractAddress = storageContract.target as string;
    const logsContract = await Utils.deployContract(logsContractJson.abi, logsContractJson.bytecode, account.wallet);

    const tx = await account.wallet.sendTransaction({ to: contractAddress, value: ethers.parseEther('1') });
    const receipt = await global.relay.pollForValidTransactionReceipt(tx.hash);
    txHash = tx.hash;
    txBlockNumber = receipt.blockNumber;
    txBlockHash = receipt.blockHash;
    txIndex = receipt.transactionIndex;

    const logsTx = await account.wallet.sendTransaction({ to: logsContract.target, data: LOG1_CALL_DATA });
    const logsReceipt = await global.relay.pollForValidTransactionReceipt(logsTx.hash);
    logsFilter = {
      fromBlock: logsReceipt.blockNumber,
      toBlock: logsReceipt.blockNumber,
      address: logsContract.target as string,
    };
    logsBlockHash = logsReceipt.blockHash;
    logsFilterId = await global.relay.call('eth_newFilter', [logsFilter]);

    wrongChainIdTx = await account.wallet.signTransaction({
      type: 2,
      chainId: 1,
      to: contractAddress,
      gasLimit: 100_000,
      maxFeePerGas: ethers.parseUnits('1000', 'gwei'),
    });
  });

  after(async () => {
    sandbox.restore();
    if (global?.socketServer) {
      expect(global.socketServer._connections).to.eq(0);
    }
  });

  const CASES: ParityCase[] = [
    {
      method: 'eth_chainId',
      description: 'chain id',
      params: () => [],
    },
    {
      method: 'eth_parityUnknownMethod',
      description: 'unknown method',
      params: () => [],
    },
    {
      method: 'eth_accounts',
      description: 'no params',
      params: () => [],
    },
    {
      method: 'eth_gasPrice',
      description: 'no params',
      params: () => [],
    },
    {
      method: 'eth_hashrate',
      description: 'no params',
      params: () => [],
    },
    {
      method: 'eth_maxPriorityFeePerGas',
      description: 'no params',
      params: () => [],
    },
    {
      method: 'eth_mining',
      description: 'no params',
      params: () => [],
    },
    {
      method: 'eth_submitWork',
      description: 'no params',
      params: () => [],
    },
    {
      method: 'eth_syncing',
      description: 'no params',
      params: () => [],
    },
    {
      method: 'eth_getBlockByNumber',
      description: 'pinned block',
      params: () => [txBlockNumber, false],
    },
    {
      method: 'eth_getBlockByNumber',
      description: 'pinned block, hydrated',
      params: () => [txBlockNumber, true],
    },
    {
      method: 'eth_getBlockByNumber',
      description: 'invalid block number',
      params: () => ['0xhedera', true],
    },
    {
      method: 'eth_getBlockByHash',
      description: 'pinned block',
      params: () => [txBlockHash, false],
    },
    {
      method: 'eth_getBlockByHash',
      description: 'pinned block, hydrated',
      params: () => [txBlockHash, true],
    },
    {
      method: 'eth_getBlockByHash',
      description: 'invalid block hash',
      params: () => ['0xhbar', false],
    },
    {
      method: 'eth_getBlockReceipts',
      description: 'pinned block',
      params: () => [txBlockNumber],
    },
    {
      method: 'eth_getBlockTransactionCountByHash',
      description: 'pinned block',
      params: () => [txBlockHash],
    },
    {
      method: 'eth_getBlockTransactionCountByNumber',
      description: 'pinned block',
      params: () => [txBlockNumber],
    },
    {
      method: 'eth_getUncleByBlockHashAndIndex',
      description: 'pinned block',
      params: () => [txBlockHash, '0x0'],
    },
    {
      method: 'eth_getUncleByBlockNumberAndIndex',
      description: 'pinned block',
      params: () => [txBlockNumber, '0x0'],
    },
    {
      method: 'eth_getUncleCountByBlockHash',
      description: 'pinned block',
      params: () => [txBlockHash],
    },
    {
      method: 'eth_getUncleCountByBlockNumber',
      description: 'pinned block',
      params: () => [txBlockNumber],
    },
    {
      method: 'eth_feeHistory',
      description: 'pinned newest block',
      params: () => ['0x2', txBlockNumber, [25, 75]],
    },
    {
      method: 'eth_getTransactionReceipt',
      description: 'known hash',
      params: () => [txHash],
    },
    {
      method: 'eth_getTransactionReceipt',
      description: 'non-existing hash',
      params: () => [Address.NON_EXISTING_TX_HASH],
    },
    {
      method: 'eth_getTransactionReceipt',
      description: 'malformed hash',
      params: () => ['0xhbar'],
    },
    {
      method: 'eth_getTransactionByHash',
      description: 'known hash',
      params: () => [txHash],
    },
    {
      method: 'eth_getTransactionByHash',
      description: 'non-existing hash',
      params: () => [Address.NON_EXISTING_TX_HASH],
    },
    {
      method: 'eth_getTransactionByHash',
      description: 'malformed hash',
      params: () => ['0xhbar'],
    },
    {
      method: 'eth_getTransactionByBlockHashAndIndex',
      description: 'pinned block',
      params: () => [txBlockHash, txIndex],
    },
    {
      method: 'eth_getTransactionByBlockNumberAndIndex',
      description: 'pinned block',
      params: () => [txBlockNumber, txIndex],
    },
    {
      method: 'eth_getBalance',
      description: 'pinned block',
      params: () => [account.address, txBlockNumber],
    },
    {
      method: 'eth_getBalance',
      description: 'invalid address',
      params: () => ['0xhbar', 'latest'],
    },
    {
      method: 'eth_getTransactionCount',
      description: 'pinned block',
      params: () => [account.address, txBlockNumber],
    },
    {
      method: 'eth_getCode',
      description: 'deployed contract',
      params: () => [contractAddress, 'latest'],
    },
    {
      method: 'eth_getCode',
      description: 'block before deployment',
      params: () => [contractAddress, blockBeforeDeploy],
    },
    {
      method: 'eth_getCode',
      description: 'invalid address',
      params: () => ['0xhbar', 'latest'],
    },
    {
      method: 'eth_getStorageAt',
      description: 'pinned block',
      params: () => [storageContractAddress, '0x0', txBlockNumber],
    },
    {
      method: 'eth_getStorageAt',
      description: 'invalid slot',
      params: () => [storageContractAddress, '0xhbar', 'latest'],
    },
    {
      method: 'eth_call',
      description: 'pinned block',
      params: () => [{ to: contractAddress, data: PING_CALL_DATA }, txBlockNumber],
    },
    {
      method: 'eth_estimateGas',
      description: 'contract call',
      params: () => [{ from: account.address, to: contractAddress, data: PING_CALL_DATA }],
    },
    {
      method: 'eth_getLogs',
      description: 'pinned block range',
      params: () => [logsFilter],
    },
    {
      method: 'eth_getLogs',
      description: 'block hash',
      params: () => [{ blockHash: logsBlockHash }],
    },
    {
      method: 'eth_getLogs',
      description: 'block hash with block range',
      params: () => [{ blockHash: logsBlockHash, fromBlock: 'latest' }],
    },
    {
      method: 'eth_newFilter',
      description: 'block hash with block range',
      params: () => [{ blockHash: logsBlockHash, fromBlock: 'latest' }],
    },
    {
      method: 'eth_getFilterLogs',
      description: 'pinned block range filter',
      params: () => [logsFilterId],
    },
    {
      method: 'eth_getFilterLogs',
      description: 'unknown filter id',
      params: () => ['0x1'],
    },
    {
      method: 'eth_getFilterChanges',
      description: 'unknown filter id',
      params: () => ['0x1'],
    },
    {
      method: 'eth_uninstallFilter',
      description: 'unknown filter id',
      params: () => ['0x1'],
    },
    {
      method: 'eth_sendRawTransaction',
      description: 'malformed transaction',
      params: () => ['0x1234'],
    },
    {
      method: 'eth_sendRawTransaction',
      description: 'wrong chain id',
      params: () => [wrongChainIdTx],
    },
    {
      method: 'net_listening',
      description: 'no params',
      params: () => [],
    },
    {
      method: 'net_version',
      description: 'no params',
      params: () => [],
    },
    {
      method: 'web3_clientVersion',
      description: 'no params',
      params: () => [],
    },
    {
      method: 'web3_sha3',
      description: 'hex input',
      params: () => ['0x68656c6c6f'],
    },
    {
      method: 'debug_getBadBlocks',
      description: 'no params',
      params: () => [],
    },
    {
      method: 'debug_getRawBlock',
      description: 'pinned block',
      params: () => [txBlockNumber],
    },
    {
      method: 'debug_getRawHeader',
      description: 'pinned block',
      params: () => [txBlockNumber],
    },
    {
      method: 'debug_getRawReceipts',
      description: 'pinned block',
      params: () => [txBlockNumber],
    },
    {
      method: 'debug_getRawTransaction',
      description: 'known hash',
      params: () => [txHash],
    },
    {
      method: 'debug_traceTransaction',
      description: 'call tracer',
      params: () => [txHash, { tracer: TracerType.CallTracer }],
    },
    {
      method: 'debug_traceTransaction',
      description: 'prestate tracer',
      params: () => [txHash, { tracer: TracerType.PrestateTracer }],
    },
    {
      method: 'debug_traceBlockByNumber',
      description: 'call tracer',
      params: () => [txBlockNumber, { tracer: TracerType.CallTracer }],
    },
    {
      method: 'debug_traceBlockByNumber',
      description: 'prestate tracer',
      params: () => [txBlockNumber, { tracer: TracerType.PrestateTracer }],
    },
    {
      method: 'debug_traceBlockByHash',
      description: 'call tracer',
      params: () => [txBlockHash, { tracer: TracerType.CallTracer }],
    },
    {
      method: 'debug_traceBlockByHash',
      description: 'prestate tracer',
      params: () => [txBlockHash, { tracer: TracerType.PrestateTracer }],
    },
    {
      method: 'txpool_content',
      description: 'no params',
      params: () => [],
    },
    {
      method: 'txpool_contentFrom',
      description: 'idle account',
      params: () => [account.address],
    },
    {
      method: 'txpool_status',
      description: 'no params',
      params: () => [],
    },
  ];

  for (const { method, description, params } of CASES) {
    it(`${method}: ${description}`, async () => {
      await assertSameJsonRpcResultAcrossTransports(method, params());
    });
  }
});
