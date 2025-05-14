// SPDX-License-Identifier: Apache-2.0
import { ConfigService } from '@hashgraph/json-rpc-config-service/dist/services';
import _ from 'lodash';
import { Logger } from 'pino';

import { nanOrNumberTo0x, nullableNumberTo0x, numberTo0x, toHash32 } from '../../../../formatters';
import { LogsBloomUtils } from '../../../../logsBloomUtils';
import { IReceiptRootHash, ReceiptsRootUtils } from '../../../../receiptsRootUtils';
import { Utils } from '../../../../utils';
import { MirrorNodeClient } from '../../../clients/mirrorNodeClient';
import constants from '../../../constants';
import { predefined } from '../../../errors/JsonRpcError';
import { BlockFactory } from '../../../factories/blockFactory';
import { TransactionFactory } from '../../../factories/transactionFactory';
import {
  IRegularTransactionReceiptParams,
  TransactionReceiptFactory,
} from '../../../factories/transactionReceiptFactory';
import { Block, Log, Transaction } from '../../../model';
import { IContractResultsParams, ITransactionReceipt, MirrorNodeBlock, RequestDetails } from '../../../types';
import { IBlockService, ICommonService } from '../../index';
import { CommonService } from '../ethCommonService/CommonService';

export class BlockService implements IBlockService {
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
  constructor(chain: string, common: ICommonService, mirrorNodeClient: MirrorNodeClient, logger: Logger) {
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
    const requestIdPrefix = requestDetails.formattedRequestId;
    this.logger.trace(`${requestIdPrefix} getBlockByHash(hash=${hash}, showDetails=${showDetails})`);

    return this.getBlock(hash, showDetails, requestDetails).catch((e: any) => {
      throw this.common.genericErrorHandler(e, `${requestIdPrefix} Failed to retrieve block for hash ${hash}`);
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
    const requestIdPrefix = requestDetails.formattedRequestId;
    this.logger.trace(`${requestIdPrefix} getBlockByNumber(blockNumber=${blockNumber}, showDetails=${showDetails})`);

    return this.getBlock(blockNumber, showDetails, requestDetails).catch((e: any) => {
      throw this.common.genericErrorHandler(
        e,
        `${requestIdPrefix} Failed to retrieve block for blockNumber ${blockNumber}`,
      );
    });
  }

  /**
   * Gets all transaction receipts for a block by block hash or block number.
   *
   * @param {string} blockHashOrBlockNumber The block hash, block number, or block tag
   * @param {RequestDetails} requestDetails The request details for logging and tracking
   * @returns {Promise<Receipt[]>} Array of transaction receipts for the block
   */
  public async getBlockReceipts(
    blockHashOrBlockNumber: string,
    requestDetails: RequestDetails,
  ): Promise<ITransactionReceipt[]> {
    const requestIdPrefix = requestDetails.formattedRequestId;
    if (this.logger.isLevelEnabled('trace')) {
      this.logger.trace(`${requestIdPrefix} getBlockReceipt(${JSON.stringify(blockHashOrBlockNumber)})`);
    }

    const block = await this.common.getHistoricalBlockResponse(requestDetails, blockHashOrBlockNumber);
    const paramTimestamp: IContractResultsParams = {
      timestamp: [`lte:${block.timestamp.to}`, `gte:${block.timestamp.from}`],
    };

    const contractResults = await this.mirrorNodeClient.getContractResults(requestDetails, paramTimestamp);
    if (!contractResults || contractResults.length === 0) {
      return [];
    }

    const receipts: ITransactionReceipt[] = [];
    const effectiveGas = await this.common.getCurrentGasPriceForBlock(block.hash, requestDetails);

    const logs = await this.common.getLogsWithParams(null, paramTimestamp, requestDetails);

    if (contractResults && contractResults.length > 0) {
      contractResults.forEach((contractResult) => {
        contractResult.logs = logs.filter((log) => log.transactionHash === contractResult.hash);
      });

      for (const contractResult of contractResults) {
        const [from, to] = await Promise.all([
          this.common.resolveEvmAddress(contractResult.from, requestDetails),
          this.common.resolveEvmAddress(contractResult.to, requestDetails),
        ]);

        const transactionReceiptParams: IRegularTransactionReceiptParams = {
          effectiveGas,
          from,
          logs: contractResult.logs,
          receiptResponse: contractResult,
          to,
        };
        const receipt: ITransactionReceipt = TransactionReceiptFactory.createRegularReceipt(transactionReceiptParams);

        receipts.push(receipt);
      }
    }

    const regularTxHashes = contractResults ? contractResults.map((result) => result.hash) : [];

    // Filter logs that don't belong to any regular transaction
    const syntheticLogs = logs.filter((log) => !regularTxHashes.includes(log.transactionHash));

    // Group logs by transaction hash since one transaction hash may have multiple logs
    const syntheticTxGroups = new Map<string, Log[]>();
    syntheticLogs.forEach((log) => {
      if (!syntheticTxGroups.has(log.transactionHash)) {
        syntheticTxGroups.set(log.transactionHash, []);
      }
      syntheticTxGroups.get(log.transactionHash)?.push(log);
    });

    // Create synthetic receipts for each group
    for (const [txHash, syntheticLogGroup] of syntheticTxGroups.entries()) {
      const params = {
        syntheticLogs: syntheticLogGroup,
        gasPriceForTimestamp: effectiveGas,
      };

      const syntheticReceipt = TransactionReceiptFactory.createSyntheticReceipt(params);
      receipts.push(syntheticReceipt as ITransactionReceipt);
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
    const requestIdPrefix = requestDetails.formattedRequestId;
    this.logger.trace(`${requestIdPrefix} getBlockTransactionCountByHash(hash=${hash}, showDetails=%o)`);

    try {
      const block = await this.mirrorNodeClient.getBlock(hash, requestDetails);
      return this.getTransactionCountFromBlockResponse(block);
    } catch (error: any) {
      throw this.common.genericErrorHandler(error, `${requestIdPrefix} Failed to retrieve block for hash ${hash}`);
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
    const requestIdPrefix = requestDetails.formattedRequestId;
    if (this.logger.isLevelEnabled('trace')) {
      this.logger.trace(
        `${requestIdPrefix} getBlockTransactionCountByNumber(blockNum=${blockNumOrTag}, showDetails=%o)`,
      );
    }

    const blockNum = await this.common.translateBlockTag(blockNumOrTag, requestDetails);
    try {
      const block = await this.mirrorNodeClient.getBlock(blockNum, requestDetails);
      return this.getTransactionCountFromBlockResponse(block);
    } catch (error: any) {
      throw this.common.genericErrorHandler(
        error,
        `${requestIdPrefix} Failed to retrieve block for blockNum ${blockNum}`,
      );
    }
  }

  /**
   * Always returns null. There are no uncles in Hedera.
   * @param {RequestDetails} requestDetails The request details for logging and tracking
   * @returns {Promise<null>} null
   */
  async getUncleByBlockHashAndIndex(requestDetails: RequestDetails): Promise<null> {
    if (this.logger.isLevelEnabled('trace')) {
      this.logger.trace(`${requestDetails.formattedRequestId} getUncleByBlockHashAndIndex()`);
    }
    return null;
  }

  /**
   * Always returns null. There are no uncles in Hedera.
   * @param {RequestDetails} requestDetails The request details for logging and tracking
   * @returns {Promise<null>} null
   */
  async getUncleByBlockNumberAndIndex(requestDetails: RequestDetails): Promise<null> {
    if (this.logger.isLevelEnabled('trace')) {
      this.logger.trace(`${requestDetails.formattedRequestId} getUncleByBlockNumberAndIndex()`);
    }
    return null;
  }

  /**
   * Always returns '0x0'. There are no uncles in Hedera.
   * @param {RequestDetails} requestDetails The request details for logging and tracking
   * @returns {Promise<string>} '0x0'
   */
  async getUncleCountByBlockHash(requestDetails: RequestDetails): Promise<string> {
    if (this.logger.isLevelEnabled('trace')) {
      this.logger.trace(`${requestDetails.formattedRequestId} getUncleCountByBlockHash()`);
    }
    return constants.ZERO_HEX;
  }

  /**
   * Always returns '0x0'. There are no uncles in Hedera.
   * @param {RequestDetails} requestDetails The request details for logging and tracking
   * @returns {Promise<string>} '0x0'
   */
  async getUncleCountByBlockNumber(requestDetails: RequestDetails): Promise<string> {
    if (this.logger.isLevelEnabled('trace')) {
      this.logger.trace(`${requestDetails.formattedRequestId} getUncleCountByBlockNumber()`);
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
      this.mirrorNodeClient.getContractResultWithRetry(
        this.mirrorNodeClient.getContractResults.name,
        [requestDetails, params, undefined],
        requestDetails,
      ),
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

    txArray = this.populateSyntheticTransactions(showDetails, logs, txArray, requestDetails);

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
    requestDetails: RequestDetails,
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
          value: constants.ONE_TWO_THREE_FOUR_HEX,
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
      this.logger.trace(
        `${requestDetails.formattedRequestId} Synthetic transaction hashes will be populated in the block response`,
      );
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
            `${requestDetails.formattedRequestId} Transaction with hash ${contractResult.hash} is skipped due to hedera-specific validation failure (${contractResult.result})`,
          );
        }
        continue;
      }

      [contractResult.from, contractResult.to] = await Promise.all([
        this.common.resolveEvmAddress(contractResult.from, requestDetails, [constants.TYPE_ACCOUNT]),
        this.common.resolveEvmAddress(contractResult.to, requestDetails),
      ]);

      contractResult.chain_id = contractResult.chain_id || this.chain;
      txArray.push(showDetails ? CommonService.formatContractResult(contractResult) : contractResult.hash);
    }

    return txArray;
  }
}
