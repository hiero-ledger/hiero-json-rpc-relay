// SPDX-License-Identifier: Apache-2.0

import { RLP } from '@ethereumjs/rlp';
import { Trie } from '@ethereumjs/trie';
import { bytesToInt, concatBytes, hexToBytes, intToBytes, intToHex } from '@ethereumjs/util';
import { ConfigService } from '@hashgraph/json-rpc-config-service/dist/services';
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
import { IReceiptRlpInput } from '../../../types/IReceiptRlpInput';
import { wrapError } from '../../workersService/WorkersErrorUtils';
import { CommonService } from '../ethCommonService/CommonService';

/**
 * Worker threads run in separate V8 Isolates with isolated memory heaps.
 * Complex objects (like network clients with sockets) cannot be shared by reference.
 * Therefore, we must instantiate separate clients for the worker.
 * Ref: https://nodejs.org/api/worker_threads.html#worker-threads
 */
const logger = pino({ level: ConfigService.get('LOG_LEVEL') || 'trace' });
const register = RegistryFactory.getInstance();
const cacheService = CacheClientFactory.create(logger, register);
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

/**
 * Populates synthetic transactions from contract logs that are not already present
 * in the transactions array.
 *
 * @param showDetails - If true, returns full Transaction objects; if false, returns hash strings
 * @param logs - Array of contract logs to extract synthetic transactions from
 * @param transactionsArray - Existing transactions (either Transaction objects or hash strings)
 * @param chain - Chain ID for synthetic transaction creation
 * @returns Merged array of original and new synthetic transactions, deduplicated by hash
 */
function populateSyntheticTransactions(
  showDetails: boolean,
  logs: Log[],
  transactionsArray: Transaction[] | string[],
  chain: string,
): Transaction[] | string[] {
  // Deduplicate the input array and build O(1) lookup set from existing transaction hashes
  const seenHashes = new Set<string>();
  const deduplicatedInput: (Transaction | string)[] = [];

  // Single pass through transactions array
  for (const item of transactionsArray) {
    const hash = showDetails ? (item as Transaction).hash : (item as string);
    if (!seenHashes.has(hash)) {
      seenHashes.add(hash);
      deduplicatedInput.push(item);
    }
  }

  // Track new synthetic transactions; Map auto-deduplicates by key
  const syntheticTransactions = new Map<string, Transaction | string>();

  // Single pass through logs
  for (const log of logs) {
    const hash = log.transactionHash;

    // Skip if already in original array or already added as synthetic
    if (seenHashes.has(hash) || syntheticTransactions.has(hash)) {
      continue;
    }

    if (showDetails) {
      const transaction: Transaction | null = TransactionFactory.createTransactionByType(0, {
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
        type: constants.ZERO_HEX, // 0x0 for legacy and synthetic transactions, 0x1 for access list types, 0x2 for dynamic fees.
        v: constants.ZERO_HEX,
        value: constants.ZERO_HEX,
      });

      if (transaction !== null) {
        syntheticTransactions.set(hash, transaction);
      }
    } else {
      syntheticTransactions.set(hash, hash);
    }
  }

  // Merge deduplicated original transactions with new unique synthetic transactions
  return [...deduplicatedInput, ...syntheticTransactions.values()] as Transaction[] | string[];
}

/**
 * Builds Ethereum-style receipt objects.
 *
 * Groups mirror node logs and contract results by transaction hash, derives a numeric
 * transaction index for each transaction, orders them by that index, and then produces
 * `IReceiptRootHash` entries with cumulative gas, status, bloom, and logs.
 *
 * @param txHashes - Transaction hashes for the block.
 * @param contractResults - Contract results returned by the mirror node for the block.
 * @param logs - Log entries returned by the mirror node for the block.
 * @returns An array of receipt objects, sorted by transaction index.
 */
function buildReceiptRootHashes(txHashes: string[], contractResults: any[], logs: Log[]): IReceiptRootHash[] {
  const items: {
    transactionIndex: number;
    logsPerTx: Log[];
    crPerTx: any;
  }[] = [];

  //build lookup maps for logs and contract results by transaction hash to avoid O(n^2) complexity
  const logsByTxHash = new Map<string, Log[]>();
  for (const log of logs) {
    const list = logsByTxHash.get(log.transactionHash) ?? [];
    list.push(log);
    logsByTxHash.set(log.transactionHash, list);
  }

  const contractResultByHash = new Map<string, any>(contractResults.map((cr) => [cr.hash, cr]));

  for (const txHash of txHashes) {
    const logsPerTx = logsByTxHash.get(txHash) ?? [];
    const crPerTx = contractResultByHash.get(txHash);

    // Derive numeric transaction index (for ordering)
    let txIndexNum: number = 0;
    if (crPerTx && crPerTx.transaction_index != null) {
      txIndexNum = crPerTx.transaction_index;
    } else if (logsPerTx.length) {
      txIndexNum = parseInt(logsPerTx[0].transactionIndex, 16);
    }

    items.push({
      transactionIndex: txIndexNum,
      logsPerTx,
      crPerTx,
    });
  }

  // Sort by transaction index = block order
  items.sort((a, b) => a.transactionIndex - b.transactionIndex);

  const receipts: IReceiptRootHash[] = [];
  let cumulativeGas = 0;

  for (const item of items) {
    const { transactionIndex, logsPerTx, crPerTx } = item;

    const gasUsed = crPerTx?.gas_used ?? 0;
    cumulativeGas += gasUsed;
    const transactionIndexHex = intToHex(transactionIndex);

    receipts.push({
      transactionIndex: transactionIndexHex,
      type: crPerTx && crPerTx.type != undefined ? intToHex(crPerTx.type) : null,
      root: crPerTx ? crPerTx.root : constants.ZERO_HEX_32_BYTE,
      status: crPerTx ? crPerTx.status : constants.ONE_HEX,
      cumulativeGasUsed: intToHex(cumulativeGas),
      logsBloom: crPerTx
        ? crPerTx.bloom
        : logsPerTx.length > 0
          ? LogsBloomUtils.buildLogsBloom(logsPerTx)
          : constants.EMPTY_BLOOM,
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

    // Calculate slice count based on actual transaction count
    const calculatedSliceCount = Math.ceil(
      blockResponse.count / ConfigService.get('MIRROR_NODE_TIMESTAMP_SLICING_MAX_LOGS_PER_SLICE'),
    );

    const [contractResults, logs] = await Promise.all([
      mirrorNodeClient.getContractResultWithRetry(mirrorNodeClient.getContractResults.name, [
        requestDetails,
        params,
        undefined,
      ]),
      commonService.getLogsWithParams(null, params, requestDetails, calculatedSliceCount),
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

    // Log the error here rather than inside BlockFactory to preserve its static-only design.
    // Introducing a logger into BlockFactory would require either passing it as an argument to each static method,
    // or adding a constructor to accept it — forcing instantiation via `new BlockFactory(logger)`.
    const hapiVersion = blockResponse.hapi_version;
    // strips pre-release/build metadata identifiers (e.g. "0.59.20-node-alpha" → "0.59.20")
    const normalizedVersion = hapiVersion?.split(/[-+]/)[0];
    if (!normalizedVersion || !Utils.VERSION_REGEX.test(normalizedVersion)) {
      logger.error(
        `Invalid HAPI version format: "${hapiVersion}". Expected format "major.minor.patch". Returning default gas limit.`,
      );
    }

    return await BlockFactory.createBlock({
      blockResponse,
      txArray,
      gasPrice,
      receiptsRoot,
    });
  } catch (e: unknown) {
    throw wrapError(e);
  }
}

export async function getBlockReceipts(
  blockHashOrBlockNumber: string,
  requestDetails: RequestDetails,
): Promise<ITransactionReceipt[] | null> {
  try {
    const { block, contractResults, logsByHash } = await loadBlockExecutionData(blockHashOrBlockNumber, requestDetails);
    if (!block) return null;

    if ((!contractResults || contractResults.length === 0) && logsByHash.size === 0) {
      return [];
    }

    const effectiveGas = numberTo0x(
      await commonService.getGasPriceInWeibars(requestDetails, block.timestamp.from.split('.')[0]),
    );

    const resolved = await Promise.all(
      contractResults.map(async (contractResult) => {
        const logs = logsByHash.get(contractResult.hash) || [];
        const [from, to] = await Promise.all([
          commonService.resolveEvmAddress(contractResult.from, requestDetails),
          contractResult.to === null ? null : commonService.resolveEvmAddress(contractResult.to, requestDetails),
        ]);

        return { contractResult, logs, from, to };
      }),
    );

    const receipts: ITransactionReceipt[] = [];
    let cumulativeGasUsed = 0;

    for (const item of resolved) {
      if (!item) continue;

      const { contractResult, logs, from, to } = item;

      cumulativeGasUsed += contractResult.gas_used;
      const transactionReceiptParams: IRegularTransactionReceiptParams = {
        effectiveGas,
        from,
        logs,
        receiptResponse: contractResult,
        to,
        cumulativeGasUsed,
      };

      const receipt = TransactionReceiptFactory.createRegularReceipt(transactionReceiptParams) as ITransactionReceipt;

      receipts.push(receipt);
    }

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

    // after all the receipts are created, we need to sort them by transaction index and calculate the cumulative gas used for synthetic receipts
    const sortedReceipts = receipts.sort(
      (a, b) => parseInt(a.transactionIndex ?? '0', 16) - parseInt(b.transactionIndex ?? '0', 16),
    );

    sortedReceipts.forEach((receipt, index) => {
      const isSynthetic = receipt.cumulativeGasUsed === constants.ZERO_HEX; // assuming that synthetic receipts have 0 gas used and regular receipts have non-zero gas used
      if (index > 0 && isSynthetic) {
        // if the index is 0, we don't need to set the cumulative gas used for the synthetic receipt, as it's already set to 0
        receipt.cumulativeGasUsed = sortedReceipts[index - 1].cumulativeGasUsed; // assign the cumulative gas of previous transaction, as the synthetic transaction uses 0 gas
      }
    });

    return sortedReceipts as ITransactionReceipt[];
  } catch (e: unknown) {
    throw wrapError(e);
  }
}

/**
 * Returns RLP-encoded transaction receipts for a block as hex strings.
 *
 * Loads block execution data (contract results and logs), then for each contract result
 * builds a receipt (with logs and cumulative gas), encodes it to RLP hex. Also appends
 * synthetic receipts for log groups that have no matching contract result.
 *
 * @param blockHashOrBlockNumber - Block hash (0x-prefixed) or block number string
 * @param requestDetails - The request details for logging and tracking
 * @returns Promise of an array of hex-encoded receipt strings (RLP), or empty array if
 *   the block has no contract results and no logs. Re-throws errors via {@link wrapError}
 *   when running inside a worker thread, or propagates natively on the main thread.
 */
export async function getRawReceipts(
  blockHashOrBlockNumber: string,
  requestDetails: RequestDetails,
): Promise<string[]> {
  try {
    const { block, contractResults, logsByHash } = await loadBlockExecutionData(blockHashOrBlockNumber, requestDetails);
    if (!block || ((!contractResults || contractResults.length === 0) && logsByHash.size === 0)) {
      return [];
    }

    let cumulativeGasUsed = 0;
    const encodedReceipts = contractResults
      .map((contractResult) => {
        const logs = logsByHash.get(contractResult.hash) || [];

        cumulativeGasUsed += contractResult.gas_used;
        const receiptRlpInput = createReceiptRlpInput(logs, contractResult, cumulativeGasUsed);
        return TransactionReceiptFactory.encodeReceiptToHex(receiptRlpInput);
      })
      .filter((encodedReceipt): encodedReceipt is string => encodedReceipt !== null);

    const regularTxHashes = new Set(contractResults.map((result) => result.hash));

    // filtering out the synthetic tx hashes and creating the synthetic receipt
    for (const [txHash, logGroup] of logsByHash.entries()) {
      if (!regularTxHashes.has(txHash)) {
        const syntheticReceiptRlpInput = createSyntheticReceiptRlpInput(logGroup);
        encodedReceipts.push(TransactionReceiptFactory.encodeReceiptToHex(syntheticReceiptRlpInput));
      }
    }

    return encodedReceipts;
  } catch (e: unknown) {
    throw wrapError(e);
  }
}

/**
 * Loads block metadata plus execution data (contract results and logs) for a given block.
 *
 * Fetches the block by hash or number, then in parallel loads contract results and logs
 * for the block's timestamp range. Logs are grouped by transaction hash for quick lookup.
 *
 * @param blockHashOrBlockNumber - Block hash (0x-prefixed) or block number string
 * @param requestDetails - The request details for logging and tracking
 * @returns Promise resolving to `{ block, contractResults, logsByHash }`. If the block is
 *   not found, returns `{ block: null, contractResults: [], logsByHash: new Map() }`.
 *   - `block`: The mirror node block or null
 *   - `contractResults`: Contract results in the block's time range
 *   - `logsByHash`: Map of transaction hash → log entries for that tx
 */
async function loadBlockExecutionData(
  blockHashOrBlockNumber: string,
  requestDetails: RequestDetails,
): Promise<{
  block: MirrorNodeBlock | null;
  contractResults: any[];
  logsByHash: Map<string, Log[]>;
}> {
  const block = await commonService.getHistoricalBlockResponse(requestDetails, blockHashOrBlockNumber);
  if (!block) return { block: null, contractResults: [], logsByHash: new Map() };

  const paramTimestamp: IContractResultsParams = {
    timestamp: [`lte:${block.timestamp.to}`, `gte:${block.timestamp.from}`],
  };

  const sliceCount = Math.ceil(block.count / ConfigService.get('MIRROR_NODE_TIMESTAMP_SLICING_MAX_LOGS_PER_SLICE'));

  const [contractResults, logs] = await Promise.all([
    mirrorNodeClient.getContractResults(requestDetails, paramTimestamp),
    commonService.getLogsWithParams(null, paramTimestamp, requestDetails, sliceCount),
  ]);

  const logsByHash = new Map<string, Log[]>();
  for (const log of logs) {
    const existingLogs = logsByHash.get(log.transactionHash) || [];
    existingLogs.push(log);
    logsByHash.set(log.transactionHash, existingLogs);
  }
  return { block, contractResults, logsByHash };
}

/**
 * Creates a minimal receipt payload for RLP-encoding of a regular transaction.
 *
 * Builds an `IReceiptRlpInput` from mirror node contract result data and the
 * running cumulative gas used before this transaction. The returned shape
 * contains only the fields required for Yellow Paper receipt encoding, including the updated cumulative gas used,
 * logs and bloom, root and status, transaction index, and normalized type.
 * @param params - Parameters required to build the RLP input, including
 *   contract result data, associated logs, and the cumulative gas used.
 * @returns Minimal receipt data suitable for RLP encoding.
 */
function createReceiptRlpInput(logs: Log[], receiptResponse: any, cumulativeGasUsed: number): IReceiptRlpInput {
  return {
    cumulativeGasUsed: numberTo0x(cumulativeGasUsed),
    logs: logs,
    logsBloom: receiptResponse.bloom === constants.EMPTY_HEX ? constants.EMPTY_BLOOM : receiptResponse.bloom,
    root: receiptResponse.root || constants.DEFAULT_ROOT_HASH,
    status: receiptResponse.status,
    transactionIndex: numberTo0x(receiptResponse.transaction_index),
    type: nanOrNumberTo0x(receiptResponse.type),
  };
}

/**
 * Creates a minimal receipt payload for RLP-encoding of a synthetic transaction.
 *
 * Builds an `IReceiptRlpInput` from synthetic logs only, without resolving any
 * addresses or constructing a full `ITransactionReceipt`. The returned shape
 * contains the fields required for Yellow Paper receipt encoding, including a zero
 * cumulative gas used, zero gas used, a logs bloom computed from the first
 * synthetic log, default root and status values, the transaction index from
 * the first log, and a fallback type of `0x0`.
 *
 * @param syntheticLogs - Logs belonging to the synthetic transaction.
 * @returns Minimal receipt data suitable for RLP encoding.
 */
function createSyntheticReceiptRlpInput(syntheticLogs: Log[]): IReceiptRlpInput {
  return {
    cumulativeGasUsed: constants.ZERO_HEX,
    logs: syntheticLogs,
    logsBloom: LogsBloomUtils.buildLogsBloom(syntheticLogs),
    root: constants.DEFAULT_ROOT_HASH,
    status: constants.ONE_HEX,
    transactionIndex: syntheticLogs[0].transactionIndex,
    type: constants.ZERO_HEX, // fallback to 0x0 from HAPI transactions
  };
}

// export private methods under __test__ "namespace" but using const
// due to `ES2015 module syntax is preferred over namespaces` eslint warning
export const __test__ = {
  __private: {
    populateSyntheticTransactions,
  },
};
