// SPDX-License-Identifier: Apache-2.0

import { RLP } from '@ethereumjs/rlp';
import { Trie } from '@ethereumjs/trie';
import { bytesToInt, concatBytes, hexToBytes, intToBytes, intToHex } from '@ethereumjs/util';
import { ConfigService } from '@hashgraph/json-rpc-config-service/dist/services';
import _ from 'lodash';
import pino from 'pino';

import { nanOrNumberTo0x, numberTo0x, prepend0x } from '../../../../formatters';
import { LogsBloomUtils } from '../../../../logsBloomUtils';
import { Utils } from '../../../../utils';
import { MirrorNodeClient } from '../../../clients/mirrorNodeClient';
import constants from '../../../constants';
import { predefined } from '../../../errors/JsonRpcError';
import { BlockFactory } from '../../../factories/blockFactory';
import { CacheClientFactory } from '../../../factories/cacheClientFactory';
import { RegistryFactory } from '../../../factories/registryFactory';
import { createTransactionFromContractResult, TransactionFactory } from '../../../factories/transactionFactory';
import {
  IRegularTransactionReceiptParams,
  TransactionReceiptFactory,
} from '../../../factories/transactionReceiptFactory';
import { Block, Log, Transaction } from '../../../model';
import { IContractResultsParams, ITransactionReceipt, MirrorNodeBlock, RequestDetails } from '../../../types';
import { CacheService } from '../../cacheService/cacheService';
import { WorkersPool } from '../../workersService/WorkersPool';
import { CommonService } from '../ethCommonService/CommonService';

/**
 * Worker threads run in separate V8 Isolates with isolated memory heaps.
 * Complex objects (like network clients with sockets) cannot be shared by reference.
 * Therefore, we must instantiate separate clients for the worker.
 * Ref: https://nodejs.org/api/worker_threads.html#worker-threads
 */
const logger = pino({ level: ConfigService.get('LOG_LEVEL') || 'trace' });
const register = RegistryFactory.getInstance();
const cacheService = new CacheService(CacheClientFactory.create(logger, register), register);
const mirrorNodeClient = new MirrorNodeClient(ConfigService.get('MIRROR_NODE_URL'), logger, register, cacheService);
const commonService = new CommonService(mirrorNodeClient, logger, cacheService);

interface IReceiptRootHashLog {
  address: string;
  data: string;
  topics: string[];
}

interface IReceiptRootHash {
  cumulativeGasUsed: string;
  logs: IReceiptRootHashLog[];
  logsBloom: string;
  root: string;
  status: string;
  transactionIndex: string;
  type: string | null;
}

type SerializedLog = [Uint8Array, Uint8Array[], Uint8Array];

function populateSyntheticTransactions(
  showDetails: boolean,
  logs: Log[],
  transactionsArray: Transaction[] | string[],
  chain: string,
): Transaction[] | string[] {
  let filteredLogs: Log[];

  if (showDetails) {
    filteredLogs = logs.filter(
      (log) => !(transactionsArray as Transaction[]).some((transaction) => transaction.hash === log.transactionHash),
    );

    filteredLogs.forEach((log) => {
      const transaction: Transaction | null = TransactionFactory.createTransactionByType(2, {
        accessList: undefined,
        blockHash: log.blockHash,
        blockNumber: log.blockNumber,
        chainId: chain,
        from: log.address,
        gas: numberTo0x(constants.TX_DEFAULT_GAS_DEFAULT),
        gasPrice: constants.INVALID_EVM_INSTRUCTION,
        hash: log.transactionHash,
        input: constants.ZERO_HEX_8_BYTE,
        maxPriorityFeePerGas: constants.ZERO_HEX,
        maxFeePerGas: constants.ZERO_HEX,
        nonce: nanOrNumberTo0x(0),
        r: constants.ZERO_HEX,
        s: constants.ZERO_HEX,
        to: log.address,
        transactionIndex: log.transactionIndex,
        type: constants.TWO_HEX,
        v: constants.ZERO_HEX,
        value: constants.ZERO_HEX,
      });

      if (transaction !== null) {
        (transactionsArray as Transaction[]).push(transaction);
      }
    });
  } else {
    filteredLogs = logs.filter((log) => !(transactionsArray as string[]).includes(log.transactionHash));
    filteredLogs.forEach((log) => {
      (transactionsArray as string[]).push(log.transactionHash);
    });
  }

  transactionsArray = _.uniqWith(transactionsArray as string[], _.isEqual);
  return transactionsArray;
}

function buildReceiptRootHashes(txHashes: string[], contractResults: any[], logs: Log[]): IReceiptRootHash[] {
  const receipts: IReceiptRootHash[] = [];

  for (const i in txHashes) {
    const txHash: string = txHashes[i];
    const logsPerTx: Log[] = logs.filter((log) => log.transactionHash == txHash);
    const crPerTx: any[] = contractResults.filter((cr) => cr.hash == txHash);

    let transactionIndex: any = null;
    if (crPerTx.length && crPerTx[0].transaction_index != null) {
      transactionIndex = intToHex(crPerTx[0].transaction_index);
    } else if (logsPerTx.length) {
      transactionIndex = logsPerTx[0].transactionIndex;
    }

    receipts.push({
      transactionIndex,
      type: crPerTx.length && crPerTx[0].type ? intToHex(crPerTx[0].type) : null,
      root: crPerTx.length ? crPerTx[0].root : constants.ZERO_HEX_32_BYTE,
      status: crPerTx.length ? crPerTx[0].status : constants.ONE_HEX,
      cumulativeGasUsed:
        crPerTx.length && crPerTx[0].block_gas_used ? intToHex(crPerTx[0].block_gas_used) : constants.ZERO_HEX,
      logsBloom: crPerTx.length
        ? crPerTx[0].bloom
        : LogsBloomUtils.buildLogsBloom(logs[0].address, logsPerTx[0].topics),
      logs: logsPerTx.map((log: IReceiptRootHashLog) => {
        return {
          address: log.address,
          data: log.data,
          topics: log.topics,
        };
      }),
    });
  }

  return receipts;
}

function encodeLogs(logs: IReceiptRootHashLog[]): SerializedLog[] {
  const serializedLogs: SerializedLog[] = [];
  for (const log of logs) {
    const topics: Uint8Array[] = [];
    for (const topic of log.topics) {
      topics.push(hexToBytes(topic));
    }
    serializedLogs.push([hexToBytes(log.address), topics, hexToBytes(log.data)]);
  }
  return serializedLogs;
}

function encodeReceipt(receipt: IReceiptRootHash, txType: number): Uint8Array {
  let receiptRoot: Uint8Array;
  if (receipt.root) {
    receiptRoot = hexToBytes(receipt.root);
  } else if (bytesToInt(hexToBytes(receipt.status)) === 0) {
    receiptRoot = Uint8Array.from([]);
  } else {
    receiptRoot = hexToBytes(constants.ONE_HEX);
  }

  const encodedReceipt: Uint8Array = RLP.encode([
    receiptRoot,
    hexToBytes(receipt.cumulativeGasUsed),
    hexToBytes(receipt.logsBloom),
    encodeLogs(receipt.logs),
  ]);

  // legacy transactions
  if (txType === 0) {
    return encodedReceipt;
  }

  // EIP-2718 serialization
  return concatBytes(intToBytes(txType), encodedReceipt);
}

async function getRootHash(receipts: IReceiptRootHash[]): Promise<string> {
  if (!receipts.length) {
    return constants.ZERO_HEX_32_BYTE;
  }

  const trie: Trie = new Trie();

  // Process receipts sequentially to build the trie
  for (const receipt of receipts) {
    const path: Uint8Array =
      receipt.transactionIndex === constants.ZERO_HEX
        ? RLP.encode(Buffer.alloc(0))
        : RLP.encode(bytesToInt(hexToBytes(receipt.transactionIndex ?? constants.ZERO_HEX)));
    await trie.put(path, encodeReceipt(receipt, bytesToInt(hexToBytes(receipt.type ?? constants.ZERO_HEX))));
  }

  trie.checkpoint();
  await trie.commit();

  return prepend0x(Buffer.from(trie.root()).toString('hex'));
}

async function prepareTransactionArray(
  contractResults: any[],
  showDetails: boolean,
  requestDetails: RequestDetails,
  chain: string,
  commonService: CommonService,
): Promise<Transaction[] | string[]> {
  const txArray: Transaction[] | string[] = [];
  for (const contractResult of contractResults) {
    if (Utils.isRevertedDueToHederaSpecificValidation(contractResult)) {
      logger.debug(
        `Transaction with hash %s is skipped due to hedera-specific validation failure (%s)`,
        contractResult.hash,
        contractResult.result,
      );
      continue;
    }

    [contractResult.from, contractResult.to] = await Promise.all([
      commonService.resolveEvmAddress(contractResult.from, requestDetails, [constants.TYPE_ACCOUNT]),
      commonService.resolveEvmAddress(contractResult.to, requestDetails),
    ]);

    contractResult.chain_id = contractResult.chain_id || chain;
    txArray.push(showDetails ? createTransactionFromContractResult(contractResult) : contractResult.hash);
  }

  return txArray;
}

export async function getBlock(
  blockHashOrNumber: string,
  showDetails: boolean,
  requestDetails: RequestDetails,
  chain: string,
): Promise<Block | null> {
  try {
    const blockResponse: MirrorNodeBlock = await commonService.getHistoricalBlockResponse(
      requestDetails,
      blockHashOrNumber,
      true,
    );

    if (blockResponse == null) return null;
    const timestampRange = blockResponse.timestamp;
    const timestampRangeParams = [`gte:${timestampRange.from}`, `lte:${timestampRange.to}`];
    const params = { timestamp: timestampRangeParams };

    const [contractResults, logs] = await Promise.all([
      mirrorNodeClient.getContractResultWithRetry(mirrorNodeClient.getContractResults.name, [
        requestDetails,
        params,
        undefined,
      ]),
      commonService.getLogsWithParams(null, params, requestDetails),
    ]);

    if (contractResults == null && logs.length == 0) {
      return null;
    }

    const ethGetTransactionCountMaxBlockRange = ConfigService.get('ETH_GET_TRANSACTION_COUNT_MAX_BLOCK_RANGE');
    if (showDetails && contractResults.length >= ethGetTransactionCountMaxBlockRange) {
      throw predefined.MAX_BLOCK_SIZE(blockResponse.count);
    }

    let txArray: Transaction[] | string[] = await prepareTransactionArray(
      contractResults,
      showDetails,
      requestDetails,
      chain,
      commonService,
    );

    txArray = populateSyntheticTransactions(showDetails, logs, txArray, chain);

    const receipts: IReceiptRootHash[] = buildReceiptRootHashes(
      txArray.map((tx) => (showDetails ? (tx as Transaction).hash : (tx as string))),
      contractResults,
      logs,
    );

    const receiptsRoot: string = await getRootHash(receipts);

    const gasPrice = await commonService.gasPrice(requestDetails);

    return await BlockFactory.createBlock({
      blockResponse,
      txArray,
      gasPrice,
      receiptsRoot,
    });
  } catch (e: unknown) {
    throw WorkersPool.wrapError(e);
  }
}

export async function getBlockReceipts(
  blockHashOrBlockNumber: string,
  requestDetails: RequestDetails,
): Promise<ITransactionReceipt[] | null> {
  try {
    const block = await commonService.getHistoricalBlockResponse(requestDetails, blockHashOrBlockNumber);

    if (block == null) {
      return null;
    }

    const paramTimestamp: IContractResultsParams = {
      timestamp: [`lte:${block.timestamp.to}`, `gte:${block.timestamp.from}`],
    };

    const [contractResults, logs] = await Promise.all([
      mirrorNodeClient.getContractResults(requestDetails, paramTimestamp),
      commonService.getLogsWithParams(null, paramTimestamp, requestDetails),
    ]);

    if ((!contractResults || contractResults.length === 0) && logs.length == 0) {
      return [];
    }

    const receipts: ITransactionReceipt[] = [];
    const effectiveGas = numberTo0x(
      await commonService.getGasPriceInWeibars(requestDetails, block.timestamp.from.split('.')[0]),
    );

    const logsByHash = new Map<string, Log[]>();
    for (const log of logs) {
      const existingLogs = logsByHash.get(log.transactionHash) || [];
      existingLogs.push(log);
      logsByHash.set(log.transactionHash, existingLogs);
    }

    const receiptPromises = contractResults.map(async (contractResult) => {
      if (Utils.isRevertedDueToHederaSpecificValidation(contractResult)) {
        logger.debug(
          `Transaction with hash %s is skipped due to hedera-specific validation failure (%s)`,
          contractResult.hash,
          contractResult.result,
        );
        return null;
      }

      contractResult.logs = logsByHash.get(contractResult.hash) || [];
      const [from, to] = await Promise.all([
        commonService.resolveEvmAddress(contractResult.from, requestDetails),
        contractResult.to === null ? null : commonService.resolveEvmAddress(contractResult.to, requestDetails),
      ]);

      const transactionReceiptParams: IRegularTransactionReceiptParams = {
        effectiveGas,
        from,
        logs: contractResult.logs,
        receiptResponse: contractResult,
        to,
      };
      return TransactionReceiptFactory.createRegularReceipt(transactionReceiptParams) as ITransactionReceipt;
    });

    const resolvedReceipts = await Promise.all(receiptPromises);
    receipts.push(...resolvedReceipts.filter(Boolean));

    const regularTxHashes = new Set(contractResults.map((result) => result.hash));

    // filtering out the synthetic tx hashes and creating the synthetic receipt
    for (const [txHash, logGroup] of logsByHash.entries()) {
      if (!regularTxHashes.has(txHash)) {
        const syntheticReceipt = TransactionReceiptFactory.createSyntheticReceipt({
          syntheticLogs: logGroup,
          gasPriceForTimestamp: effectiveGas,
        });
        receipts.push(syntheticReceipt as ITransactionReceipt);
      }
    }

    return receipts;
  } catch (e: unknown) {
    throw WorkersPool.wrapError(e);
  }
}

// export private methods under __test__ "namespace" but using const
// due to `ES2015 module syntax is preferred over namespaces` eslint warning
export const __test__ = {
  __private: {
    populateSyntheticTransactions,
  },
};
