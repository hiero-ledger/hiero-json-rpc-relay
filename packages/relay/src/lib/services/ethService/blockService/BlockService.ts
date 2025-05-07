// SPDX-License-Identifier: Apache-2.0
import { ConfigService } from '@hashgraph/json-rpc-config-service/dist/services';
import _ from 'lodash';
import { Logger } from 'pino';

import { nanOrNumberTo0x, nullableNumberTo0x, numberTo0x, toHash32 } from '../../../../formatters';
import { IReceiptRootHash, ReceiptsRootUtils } from '../../../../receiptsRootUtils';
import { Utils } from '../../../../utils';
import { MirrorNodeClient } from '../../../clients/mirrorNodeClient';
import constants from '../../../constants';
import { predefined } from '../../../errors/JsonRpcError';
import { BlockFactory } from '../../../factories/blockFactory';
import { TransactionFactory } from '../../../factories/transactionFactory';
import { Block, Log, Receipt, Transaction } from '../../../model';
import { IContractResultsParams, MirrorNodeBlock, RequestDetails } from '../../../types';
import { CacheService } from '../../cacheService/cacheService';
import { IBlockService, ICommonService } from '../../index';
import { CommonService } from '../ethCommonService/CommonService';

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

  /**
   * The static method for the eth_getBlockByHash RPC call.
   */
  private static ethGetBlockByHash = 'eth_GetBlockByHash';

  /**
   * The static method for the eth_getBlockByNumber RPC call.
   */
  private static ethGetBlockByNumber = 'eth_GetBlockByNumber';

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
    const requestIdPrefix = requestDetails.formattedRequestId;
    this.logger.trace(`${requestIdPrefix} getBlockByHash(hash=${hash}, showDetails=${showDetails})`);

    const cacheKey = `${constants.CACHE_KEY.ETH_GET_BLOCK_BY_HASH}_${hash}_${showDetails}`;
    let block = await this.cacheService.getAsync(cacheKey, BlockService.ethGetBlockByHash, requestDetails);
    if (!block) {
      block = await this.getBlock(hash, showDetails, requestDetails).catch((e: any) => {
        throw this.common.genericErrorHandler(e, `${requestIdPrefix} Failed to retrieve block for hash ${hash}`);
      });
      await this.cacheService.set(cacheKey, block, BlockService.ethGetBlockByHash, requestDetails);
    }

    return block;
  }

  /**
   * Gets the block with the given number.
   *
   * @param {string} blockNumber The block number
   * @param {boolean} showDetails Whether to show the details of the block
   * @param {RequestDetails} requestDetails The request details for logging and tracking
   * @returns {Promise<Block>} The block
   */
  public async getBlockByNumber(
    blockNumber: string,
    showDetails: boolean,
    requestDetails: RequestDetails,
  ): Promise<Block> {
    const requestIdPrefix = requestDetails.formattedRequestId;
    this.logger.trace(`${requestIdPrefix} getBlockByNumber(blockNumber=${blockNumber}, showDetails=${showDetails})`);

    const cacheKey = `${constants.CACHE_KEY.ETH_GET_BLOCK_BY_NUMBER}_${blockNumber}_${showDetails}`;
    let block = await this.cacheService.getAsync(cacheKey, BlockService.ethGetBlockByNumber, requestDetails);
    if (!block) {
      block = await this.getBlock(blockNumber, showDetails, requestDetails).catch((e: any) => {
        throw this.common.genericErrorHandler(
          e,
          `${requestIdPrefix} Failed to retrieve block for blockNumber ${blockNumber}`,
        );
      });

      if (!this.common.blockTagIsLatestOrPending(blockNumber)) {
        await this.cacheService.set(cacheKey, block, BlockService.ethGetBlockByNumber, requestDetails);
      }
    }

    return block;
  }

  /**
   * Gets all transaction receipts for a block by block hash or block number.
   *
   * @param {string} blockHashOrBlockNumber The block hash, block number, or block tag
   * @param {RequestDetails} requestDetails The request details for logging and tracking
   * @returns {Promise<Receipt[]>} Array of transaction receipts for the block
   */
  public async getBlockReceipts(blockHashOrBlockNumber: string, requestDetails: RequestDetails): Promise<Receipt[]> {
    const requestIdPrefix = requestDetails.formattedRequestId;
    if (this.logger.isLevelEnabled('trace')) {
      this.logger.trace(`${requestIdPrefix} getBlockReceipt(${JSON.stringify(blockHashOrBlockNumber)})`);
    }

    const block = await this.common.getHistoricalBlockResponse(requestDetails, blockHashOrBlockNumber);
    const blockNumber = block.number;

    const cacheKey = `${constants.CACHE_KEY.ETH_GET_BLOCK_RECEIPTS}_${blockNumber}`;
    const cachedResponse = await this.cacheService.getAsync(cacheKey, constants.ETH_GET_BLOCK_RECEIPTS, requestDetails);
    if (cachedResponse) {
      if (this.logger.isLevelEnabled('debug')) {
        this.logger.debug(
          `${requestIdPrefix} getBlockReceipts returned cached response: ${JSON.stringify(cachedResponse)}`,
        );
      }
      return cachedResponse;
    }

    const paramTimestamp: IContractResultsParams = {
      timestamp: [`lte:${block.timestamp.to}`, `gte:${block.timestamp.from}`],
    };

    const contractResults = await this.mirrorNodeClient.getContractResults(requestDetails, paramTimestamp);
    if (!contractResults || contractResults.length === 0) {
      return [];
    }

    const effectiveGas = await this.common.getCurrentGasPriceForBlock(block.hash, requestDetails);

    const logs = await this.common.getLogsWithParams(null, paramTimestamp, requestDetails);
    contractResults.forEach((contractResult) => {
      contractResult.logs = logs.filter((log) => log.transactionHash === contractResult.hash);
    });

    const receipts: Receipt[] = [];

    for (const contractResult of contractResults) {
      const from = await this.common.resolveEvmAddress(contractResult.from, requestDetails);
      const to = await this.common.resolveEvmAddress(contractResult.to, requestDetails);

      const contractAddress = this.common.getContractAddressFromReceipt(contractResult);
      const receipt = {
        blockHash: toHash32(contractResult.block_hash),
        blockNumber: numberTo0x(contractResult.block_number),
        from: from,
        to: to,
        cumulativeGasUsed: numberTo0x(contractResult.block_gas_used),
        gasUsed: nanOrNumberTo0x(contractResult.gas_used),
        contractAddress: contractAddress,
        logs: contractResult.logs,
        logsBloom: contractResult.bloom === constants.EMPTY_HEX ? constants.EMPTY_BLOOM : contractResult.bloom,
        transactionHash: toHash32(contractResult.hash),
        transactionIndex: numberTo0x(contractResult.transaction_index),
        effectiveGasPrice: effectiveGas,
        root: contractResult.root || constants.DEFAULT_ROOT_HASH,
        status: contractResult.status,
        type: nullableNumberTo0x(contractResult.type),
      };

      receipts.push(receipt);
    }

    await this.cacheService.set(cacheKey, receipts, constants.ETH_GET_BLOCK_RECEIPTS, requestDetails);
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

    const cacheKey = `${constants.CACHE_KEY.ETH_GET_TRANSACTION_COUNT_BY_HASH}_${hash}`;
    const cachedResponse = await this.cacheService.getAsync(
      cacheKey,
      constants.ETH_GET_TRANSACTION_COUNT_BY_HASH,
      requestDetails,
    );
    if (cachedResponse) {
      if (this.logger.isLevelEnabled('debug')) {
        this.logger.debug(
          `${requestIdPrefix} getBlockTransactionCountByHash returned cached response: ${cachedResponse}`,
        );
      }
      return cachedResponse;
    }

    try {
      const block = await this.mirrorNodeClient.getBlock(hash, requestDetails);
      const transactionCount = this.getTransactionCountFromBlockResponse(block);
      await this.cacheService.set(
        cacheKey,
        transactionCount,
        constants.ETH_GET_TRANSACTION_COUNT_BY_HASH,
        requestDetails,
      );

      return transactionCount;
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

    const cacheKey = `${constants.CACHE_KEY.ETH_GET_TRANSACTION_COUNT_BY_NUMBER}_${blockNum}`;
    const cachedResponse = await this.cacheService.getAsync(
      cacheKey,
      constants.ETH_GET_TRANSACTION_COUNT_BY_NUMBER,
      requestDetails,
    );
    if (cachedResponse) {
      if (this.logger.isLevelEnabled('debug')) {
        this.logger.debug(
          `${requestIdPrefix} getBlockTransactionCountByNumber returned cached response: ${cachedResponse}`,
        );
      }
      return cachedResponse;
    }

    try {
      const block = await this.mirrorNodeClient.getBlock(blockNum, requestDetails);
      const transactionCount = this.getTransactionCountFromBlockResponse(block);
      await this.cacheService.set(
        cacheKey,
        transactionCount,
        constants.ETH_GET_TRANSACTION_COUNT_BY_NUMBER,
        requestDetails,
      );
      return transactionCount;
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
