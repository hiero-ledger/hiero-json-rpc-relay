// SPDX-License-Identifier: Apache-2.0
import { ConfigService } from '@hashgraph/json-rpc-config-service/dist/services';
import _ from 'lodash';
import { Logger } from 'pino';

import { nanOrNumberTo0x, numberTo0x } from '../../../../formatters';
import { IReceiptRootHash, ReceiptsRootUtils } from '../../../../receiptsRootUtils';
import { Utils } from '../../../../utils';
import { MirrorNodeClient } from '../../../clients/mirrorNodeClient';
import constants from '../../../constants';
import { predefined } from '../../../errors/JsonRpcError';
import { BlockFactory } from '../../../factories/blockFactory';
import { createTransactionFromContractResult, TransactionFactory } from '../../../factories/transactionFactory';
import {
  IRegularTransactionReceiptParams,
  TransactionReceiptFactory,
} from '../../../factories/transactionReceiptFactory';
import { Block, Log, Transaction } from '../../../model';
import { IContractResultsParams, ITransactionReceipt, MirrorNodeBlock, RequestDetails } from '../../../types';
import { CacheService } from '../../cacheService/cacheService';
import { IBlockService, ICommonService } from '../../index';

export class BlockService implements IBlockService {
  /**
   * The cache service used for caching all responses.
   * @private
   */
  private readonly cacheService: CacheService;

  /**
   * The chain id.
   * @private
   */
  private readonly chain: string;

  /**
   * The common service used for all common methods.
   * @private
   */
  private readonly common: ICommonService;

  /**
   * The maximum block range for the transaction count.
   */
  private readonly ethGetTransactionCountMaxBlockRange = ConfigService.get('ETH_GET_TRANSACTION_COUNT_MAX_BLOCK_RANGE');

  /**
   * The logger used for logging all output from this class.
   * @private
   */
  private readonly logger: Logger;

  /**
   * The interface through which we interact with the mirror node
   * @private
   */
  private readonly mirrorNodeClient: MirrorNodeClient;

  /** Constructor */
  constructor(
    cacheService: CacheService,
    chain: string,
    common: ICommonService,
    mirrorNodeClient: MirrorNodeClient,
    logger: Logger,
  ) {
    this.cacheService = cacheService;
    this.chain = chain;
    this.common = common;
    this.mirrorNodeClient = mirrorNodeClient;
    this.logger = logger;
  }

  /**
   * Gets the block with the given hash.
   *
   * @param {string} hash the block hash
   * @param {boolean} showDetails whether to show the details of the block
   * @param {RequestDetails} requestDetails The request details for logging and tracking
   * @returns {Promise<Block | null>} The block
   */
  public async getBlockByHash(
    hash: string,
    showDetails: boolean,
    requestDetails: RequestDetails,
  ): Promise<Block | null> {
    this.logger.trace(`getBlockByHash(hash=${hash}, showDetails=${showDetails})`);

    return this.getBlock(hash, showDetails, requestDetails).catch((e: any) => {
      throw this.common.genericErrorHandler(e, `Failed to retrieve block for hash ${hash}`);
    });
  }

  /**
   * Gets the block with the given number.
   *
   * @param {string} blockNumber The block number
   * @param {boolean} showDetails Whether to show the details of the block
   * @param {RequestDetails} requestDetails The request details for logging and tracking
   * @returns {Promise<Block | null>} The block
   */
  public async getBlockByNumber(
    blockNumber: string,
    showDetails: boolean,
    requestDetails: RequestDetails,
  ): Promise<Block | null> {
    this.logger.trace(`getBlockByNumber(blockNumber=${blockNumber}, showDetails=${showDetails})`);

    return this.getBlock(blockNumber, showDetails, requestDetails).catch((e: any) => {
      throw this.common.genericErrorHandler(e, `Failed to retrieve block for blockNumber ${blockNumber}`);
    });
  }

  /**
   * Gets all transaction receipts for a block by block hash or block number.
   *
   * @param {string} blockHashOrBlockNumber The block hash, block number, or block tag
   * @param {RequestDetails} requestDetails The request details for logging and tracking
   * @returns {Promise<Receipt[] | null>} Array of transaction receipts for the block or null if block not found
   */
  public async getBlockReceipts(
    blockHashOrBlockNumber: string,
    requestDetails: RequestDetails,
  ): Promise<ITransactionReceipt[] | null> {
    if (this.logger.isLevelEnabled('trace')) {
      this.logger.trace(`getBlockReceipt(${JSON.stringify(blockHashOrBlockNumber)})`);
    }

    const block = await this.common.getHistoricalBlockResponse(requestDetails, blockHashOrBlockNumber);

    if (block == null) {
      return null;
    }

    const paramTimestamp: IContractResultsParams = {
      timestamp: [`lte:${block.timestamp.to}`, `gte:${block.timestamp.from}`],
    };

    const contractResults = await this.mirrorNodeClient.getContractResults(requestDetails, paramTimestamp);
    if (!contractResults || contractResults.length === 0) {
      return [];
    }

    const receipts: ITransactionReceipt[] = [];
    const effectiveGas = numberTo0x(await this.common.getGasPriceInWeibars(block.timestamp.from.split('.')[0]));

    const logs = await this.common.getLogsWithParams(null, paramTimestamp, requestDetails);

    const logsByHash = new Map<string, Log[]>();
    for (const log of logs) {
      const existingLogs = logsByHash.get(log.transactionHash) || [];
      existingLogs.push(log);
      logsByHash.set(log.transactionHash, existingLogs);
    }

    const receiptPromises = contractResults.map(async (contractResult) => {
      if (Utils.isRevertedDueToHederaSpecificValidation(contractResult)) {
        this.logger.debug(
          'Transaction with hash %s is skipped due to hedera-specific validation failure (%s)',
          contractResult.hash,
          contractResult.result,
        );
        return null;
      }

      contractResult.logs = logsByHash.get(contractResult.hash) || [];
      const [from, to] = await Promise.all([
        this.common.resolveEvmAddress(contractResult.from, requestDetails),
        contractResult.to === null ? null : this.common.resolveEvmAddress(contractResult.to, requestDetails),
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
  }

  /**
   * Gets the number of transaction in a block by its block hash.
   *
   * @param {string} hash The block hash
   * @param {RequestDetails} requestDetails The request details for logging and tracking
   * @returns {Promise<string | null>} The transaction count
   */
  async getBlockTransactionCountByHash(hash: string, requestDetails: RequestDetails): Promise<string | null> {
    this.logger.trace(`getBlockTransactionCountByHash(hash=${hash}, showDetails=%o)`);

    try {
      const block = await this.mirrorNodeClient.getBlock(hash, requestDetails);
      return this.getTransactionCountFromBlockResponse(block);
    } catch (error: any) {
      throw this.common.genericErrorHandler(error, `Failed to retrieve block for hash ${hash}`);
    }
  }

  /**
   * Gets the number of transaction in a block by its block number.
   * @param {string} blockNumOrTag Possible values are earliest/pending/latest or hex
   * @param {RequestDetails} requestDetails The request details for logging and tracking
   * @returns {Promise<string | null>} The transaction count
   */
  async getBlockTransactionCountByNumber(
    blockNumOrTag: string,
    requestDetails: RequestDetails,
  ): Promise<string | null> {
    if (this.logger.isLevelEnabled('trace')) {
      this.logger.trace(`getBlockTransactionCountByNumber(blockNum=${blockNumOrTag}, showDetails=%o)`);
    }

    const blockNum = await this.common.translateBlockTag(blockNumOrTag, requestDetails);
    try {
      const block = await this.mirrorNodeClient.getBlock(blockNum, requestDetails);
      return this.getTransactionCountFromBlockResponse(block);
    } catch (error: any) {
      throw this.common.genericErrorHandler(error, `Failed to retrieve block for blockNum ${blockNum}`);
    }
  }

  /**
   * Always returns null. There are no uncles in Hedera.
   *
   * @param blockHash - The block hash
   * @param index - The uncle index
   * @returns null as Hedera does not support uncle blocks
   */
  getUncleByBlockHashAndIndex(blockHash: string, index: string): null {
    if (this.logger.isLevelEnabled('trace')) {
      this.logger.trace(`getUncleByBlockHashAndIndex(blockHash=${blockHash}, index=${index})`);
    }
    return null;
  }

  /**
   * Always returns null. There are no uncles in Hedera.
   *
   * @param blockNumOrTag - The block number or tag
   * @param index - The uncle index
   * @returns null as Hedera does not support uncle blocks
   */
  getUncleByBlockNumberAndIndex(blockNumOrTag: string, index: string): null {
    if (this.logger.isLevelEnabled('trace')) {
      this.logger.trace(`getUncleByBlockNumberAndIndex(blockNumOrTag=${blockNumOrTag}, index=${index})`);
    }
    return null;
  }

  /**
   * Always returns '0x0'. There are no uncles in Hedera.
   *
   * @param blockHash - The block hash
   * @returns '0x0' as Hedera does not support uncle blocks
   */
  getUncleCountByBlockHash(blockHash: string): string {
    if (this.logger.isLevelEnabled('trace')) {
      this.logger.trace(`getUncleCountByBlockHash(blockHash=${blockHash})`);
    }
    return constants.ZERO_HEX;
  }

  /**
   * Always returns '0x0'. There are no uncles in Hedera.
   *
   * @param blockNumOrTag - The block number or tag
   * @returns '0x0' as Hedera does not support uncle blocks
   */
  getUncleCountByBlockNumber(blockNumOrTag: string): string {
    if (this.logger.isLevelEnabled('trace')) {
      this.logger.trace(`getUncleCountByBlockNumber(blockNumOrTag=${blockNumOrTag})`);
    }
    return constants.ZERO_HEX;
  }

  /**
   * Gets the block with the given hash.
   * Given an ethereum transaction hash, call the mirror node to get the block info.
   * Then using the block timerange get all contract results to get transaction details.
   * If showDetails is set to true subsequently call mirror node for additional transaction details
   *
   * @param {string} blockHashOrNumber The block hash or block number
   * @param {boolean} showDetails Whether to show transaction details
   * @param {RequestDetails} requestDetails The request details for logging and tracking
   * @returns {Promise<Block | null>} The block
   */
  private async getBlock(
    blockHashOrNumber: string,
    showDetails: boolean,
    requestDetails: RequestDetails,
  ): Promise<Block | null> {
    const blockResponse: MirrorNodeBlock = await this.common.getHistoricalBlockResponse(
      requestDetails,
      blockHashOrNumber,
      true,
    );

    if (blockResponse == null) return null;
    const timestampRange = blockResponse.timestamp;
    const timestampRangeParams = [`gte:${timestampRange.from}`, `lte:${timestampRange.to}`];
    const params = { timestamp: timestampRangeParams };

    const [contractResults, logs] = await Promise.all([
      this.mirrorNodeClient.getContractResultWithRetry(this.mirrorNodeClient.getContractResults.name, [
        requestDetails,
        params,
        undefined,
      ]),
      this.common.getLogsWithParams(null, params, requestDetails),
    ]);

    if (contractResults == null && logs.length == 0) {
      return null;
    }

    if (showDetails && contractResults.length >= this.ethGetTransactionCountMaxBlockRange) {
      throw predefined.MAX_BLOCK_SIZE(blockResponse.count);
    }

    let txArray: Transaction[] | string[] = await this.prepareTransactionArray(
      contractResults,
      showDetails,
      requestDetails,
    );

    txArray = this.populateSyntheticTransactions(showDetails, logs, txArray);

    const receipts: IReceiptRootHash[] = ReceiptsRootUtils.buildReceiptRootHashes(
      txArray.map((tx) => (showDetails ? tx.hash : tx)),
      contractResults,
      logs,
    );

    const gasPrice = await this.common.gasPrice(requestDetails);

    return await BlockFactory.createBlock({
      blockResponse,
      receipts,
      txArray,
      gasPrice,
    });
  }

  /**
   * Gets the transaction count from the block response.
   * @param block The block response
   * @returns The transaction count
   */
  private getTransactionCountFromBlockResponse(block: MirrorNodeBlock): null | string {
    if (block === null || block.count === undefined) {
      // block not found
      return null;
    }

    return numberTo0x(block.count);
  }

  /**
   * Populates the synthetic transactions for the block.
   * @param showDetails Whether to show transaction details
   * @param logs[] The logs to populate the synthetic transactions from
   * @param transactionsArray The array of transactions to populate
   * @param requestDetails The request details for logging and tracking
   * @returns {Array<Transaction | string>} The populated transactions
   */
  private populateSyntheticTransactions(
    showDetails: boolean,
    logs: Log[],
    transactionsArray: Transaction[] | string[],
  ): Transaction[] | string[] {
    let filteredLogs: Log[];
    if (showDetails) {
      filteredLogs = logs.filter(
        (log) => !(transactionsArray as Transaction[]).some((transaction) => transaction.hash === log.transactionHash),
      );
      filteredLogs.forEach((log) => {
        const transaction: Transaction | null = TransactionFactory.createTransactionByType(2, {
          accessList: undefined, // we don't support access lists for now
          blockHash: log.blockHash,
          blockNumber: log.blockNumber,
          chainId: this.chain,
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
          type: constants.TWO_HEX, // 0x0 for legacy transactions, 0x1 for access list types, 0x2 for dynamic fees.
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

    if (this.logger.isLevelEnabled('trace')) {
      this.logger.trace(`Synthetic transaction hashes will be populated in the block response`);
    }

    transactionsArray = _.uniqWith(transactionsArray as string[], _.isEqual);
    return transactionsArray;
  }

  /**
   * Prepares the transaction array for the block.
   * @param contractResults The contract results to prepare the transaction array from
   * @param showDetails Whether to show transaction details
   * @param requestDetails The request details for logging and tracking
   * @returns {Array<Transaction | string>} The prepared transaction array
   */
  private async prepareTransactionArray(
    contractResults: any[],
    showDetails: boolean,
    requestDetails: RequestDetails,
  ): Promise<Transaction[] | string[]> {
    const txArray: Transaction[] | string[] = [];
    for (const contractResult of contractResults) {
      // there are several hedera-specific validations that occur right before entering the evm
      // if a transaction has reverted there, we should not include that tx in the block response
      if (Utils.isRevertedDueToHederaSpecificValidation(contractResult)) {
        if (this.logger.isLevelEnabled('debug')) {
          this.logger.debug(
            `Transaction with hash ${contractResult.hash} is skipped due to hedera-specific validation failure (${contractResult.result})`,
          );
        }
        continue;
      }

      [contractResult.from, contractResult.to] = await Promise.all([
        this.common.resolveEvmAddress(contractResult.from, requestDetails, [constants.TYPE_ACCOUNT]),
        this.common.resolveEvmAddress(contractResult.to, requestDetails),
      ]);

      contractResult.chain_id = contractResult.chain_id || this.chain;
      txArray.push(showDetails ? createTransactionFromContractResult(contractResult) : contractResult.hash);
    }

    return txArray;
  }
}
