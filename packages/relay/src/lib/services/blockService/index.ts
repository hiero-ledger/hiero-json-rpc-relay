// SPDX-License-Identifier: Apache-2.0
import { ConfigService } from '@hashgraph/json-rpc-config-service/dist/services';
import _ from 'lodash';
import { Logger } from 'pino';

import { formatContractResult, nanOrNumberTo0x, numberTo0x } from '../../../formatters';
import { IReceiptRootHash, ReceiptsRootUtils } from '../../../receiptsRootUtils';
import { Utils } from '../../../utils';
import { MirrorNodeClient } from '../../clients/mirrorNodeClient';
import constants from '../../constants';
import { predefined } from '../../errors/JsonRpcError';
import { EthImpl } from '../../eth';
import { Block, Log, Transaction } from '../../model';
import { RequestDetails } from '../../types';
import { CacheService } from '../cacheService/cacheService';
import { CommonService } from '../ethService/ethCommonService';
import { BlockFactory } from '../factories/blockFactory';
import { TransactionFactory } from '../factories/transactionFactory';
import { IBlockMirrorNode, IBlockService } from './IBlockService';

export class BlockService implements IBlockService {
  private readonly cacheService: CacheService;

  private readonly chain: string;

  private readonly common: CommonService;

  private readonly logger: Logger;

  private readonly mirrorNodeClient: MirrorNodeClient;

  private readonly ethGetTransactionCountMaxBlockRange = ConfigService.get('ETH_GET_TRANSACTION_COUNT_MAX_BLOCK_RANGE');

  static ethGetBlockByHash = 'eth_GetBlockByHash';

  constructor(
    cacheService: CacheService,
    chain: string,
    common: CommonService,
    mirrorNodeClient: MirrorNodeClient,
    logger: Logger,
  ) {
    this.common = common;
    this.chain = chain;
    this.mirrorNodeClient = mirrorNodeClient;
    this.logger = logger;
    this.cacheService = cacheService;
  }

  public async getBlockByNumber(
    blockNumber: string,
    showDetails: boolean,
    requestDetails: RequestDetails,
  ): Promise<Block> {
    const requestIdPrefix = requestDetails.formattedRequestId;
    this.logger.trace(`${requestIdPrefix} getBlockByNumber(blockNumber=${blockNumber}, showDetails=${showDetails})`);

    const cacheKey = `${constants.CACHE_KEY.ETH_GET_BLOCK_BY_NUMBER}_${blockNumber}_${showDetails}`;
    let block = await this.cacheService.getAsync(cacheKey, EthImpl.ethGetBlockByNumber, requestDetails);
    if (!block) {
      block = await this.getBlock(blockNumber, showDetails, requestDetails).catch((e: any) => {
        throw this.common.genericErrorHandler(
          e,
          `${requestIdPrefix} Failed to retrieve block for blockNumber ${blockNumber}`,
        );
      });

      if (!this.common.blockTagIsLatestOrPending(blockNumber)) {
        await this.cacheService.set(cacheKey, block, EthImpl.ethGetBlockByNumber, requestDetails);
      }
    }

    return block;
  }

  /**
   * Gets the block with the given hash.
   *
   * @param {string} hash the block hash
   * @param {boolean} showDetails whether to show the details of the block
   * @param {RequestDetails} requestDetails The request details for logging and tracking
   */
  async getBlockByHash(hash: string, showDetails: boolean, requestDetails: RequestDetails): Promise<Block | null> {
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
   * Gets the block with the given hash.
   * Given an ethereum transaction hash, call the mirror node to get the block info.
   * Then using the block timerange get all contract results to get transaction details.
   * If showDetails is set to true subsequently call mirror node for additional transaction details
   *
   * @param {string} blockHashOrNumber The block hash or block number
   * @param {boolean} showDetails Whether to show transaction details
   * @param {RequestDetails} requestDetails The request details for logging and tracking
   */
  private async getBlock(
    blockHashOrNumber: string,
    showDetails: boolean,
    requestDetails: RequestDetails,
  ): Promise<Block | null> {
    const blockResponse: IBlockMirrorNode = await this.common.getHistoricalBlockResponse(
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
        [requestDetails, { timestamp: timestampRangeParams }, undefined],
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

    let txArray: any[] = [];

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
      txArray.push(showDetails ? this.common.formatContractResult(contractResult) : contractResult.hash);
    }

    txArray = this.populateSyntheticTransactions(showDetails, logs, txArray, requestDetails);
    txArray = showDetails ? txArray : _.uniq(txArray);

    const receipts: IReceiptRootHash[] = ReceiptsRootUtils.buildReceiptRootHashes(
      txArray.map((tx) => (showDetails ? tx.hash : tx)),
      contractResults,
      logs,
    );

    const gasPrice = await this.common.gasPrice(requestDetails);

    try {
      return await BlockFactory.createBlock({
        blockResponse,
        receipts,
        txArray,
        gasPrice,
      });
    } catch (error: any) {
      this.logger.error(`Error creating Block: ${error.message}`);
      return null;
    }
  }

  /**
   * Gets the number of transaction in a block by its block hash.
   *
   * @param {string} hash The block hash
   * @param {RequestDetails} requestDetails The request details for logging and tracking
   */
  async getBlockTransactionCountByHash(hash: string, requestDetails: RequestDetails): Promise<string | null> {
    const requestIdPrefix = requestDetails.formattedRequestId;
    this.logger.trace(`${requestIdPrefix} getBlockTransactionCountByHash(hash=${hash}, showDetails=%o)`);

    const cacheKey = `${constants.CACHE_KEY.ETH_GET_TRANSACTION_COUNT_BY_HASH}_${hash}`;
    const cachedResponse = await this.cacheService.getAsync(
      cacheKey,
      EthImpl.ethGetTransactionCountByHash,
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

    const transactionCount = await this.mirrorNodeClient
      .getBlock(hash, requestDetails)
      .then((block) => this.getTransactionCountFromBlockResponse(block))
      .catch((e: any) => {
        throw this.common.genericErrorHandler(e, `${requestIdPrefix} Failed to retrieve block for hash ${hash}`);
      });

    await this.cacheService.set(cacheKey, transactionCount, EthImpl.ethGetTransactionCountByHash, requestDetails);
    return transactionCount;
  }

  /**
   * Gets the number of transaction in a block by its block number.
   * @param {string} blockNumOrTag Possible values are earliest/pending/latest or hex
   * @param {RequestDetails} requestDetails The request details for logging and tracking
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
      EthImpl.ethGetTransactionCountByNumber,
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

    const transactionCount = await this.mirrorNodeClient
      .getBlock(blockNum, requestDetails)
      .then((block) => this.getTransactionCountFromBlockResponse(block))
      .catch((e: any) => {
        throw this.common.genericErrorHandler(
          e,
          `${requestIdPrefix} Failed to retrieve block for blockNum ${blockNum}`,
        );
      });

    await this.cacheService.set(cacheKey, transactionCount, EthImpl.ethGetTransactionCountByNumber, requestDetails);
    return transactionCount;
  }

  /**
   * Always returns null. There are no uncles in Hedera.
   */
  async getUncleByBlockHashAndIndex(requestDetails: RequestDetails): Promise<null> {
    if (this.logger.isLevelEnabled('trace')) {
      this.logger.trace(`${requestDetails.formattedRequestId} getUncleByBlockHashAndIndex()`);
    }
    return null;
  }

  /**
   * Always returns null. There are no uncles in Hedera.
   */
  async getUncleByBlockNumberAndIndex(requestDetails: RequestDetails): Promise<null> {
    if (this.logger.isLevelEnabled('trace')) {
      this.logger.trace(`${requestDetails.formattedRequestId} getUncleByBlockNumberAndIndex()`);
    }
    return null;
  }

  /**
   * Always returns '0x0'. There are no uncles in Hedera.
   */
  async getUncleCountByBlockHash(requestDetails: RequestDetails): Promise<string> {
    if (this.logger.isLevelEnabled('trace')) {
      this.logger.trace(`${requestDetails.formattedRequestId} getUncleCountByBlockHash()`);
    }
    return EthImpl.zeroHex;
  }

  /**
   * Always returns '0x0'. There are no uncles in Hedera.
   */
  async getUncleCountByBlockNumber(requestDetails: RequestDetails): Promise<string> {
    if (this.logger.isLevelEnabled('trace')) {
      this.logger.trace(`${requestDetails.formattedRequestId} getUncleCountByBlockNumber()`);
    }
    return EthImpl.zeroHex;
  }

  /**
   * Populates the synthetic transactions for the block.
   * @param showDetails Whether to show transaction details
   * @param logs[] The logs to populate the synthetic transactions from
   * @param transactionsArray The array of transactions to populate
   * @param requestDetails The request details for logging and tracking
   */
  private populateSyntheticTransactions(
    showDetails: boolean,
    logs: Log[],
    transactionsArray: Array<any>,
    requestDetails: RequestDetails,
  ): Array<any> {
    let filteredLogs: Log[];
    if (showDetails) {
      filteredLogs = logs.filter(
        (log) => !transactionsArray.some((transaction) => transaction.hash === log.transactionHash),
      );
      filteredLogs.forEach((log) => {
        const transaction: Transaction | null = TransactionFactory.createTransactionByType(2, {
          accessList: undefined, // we don't support access lists for now
          blockHash: log.blockHash,
          blockNumber: log.blockNumber,
          chainId: '0x12a', //this.chain,
          from: log.address,
          gas: EthImpl.defaultTxGas,
          gasPrice: EthImpl.invalidEVMInstruction,
          hash: log.transactionHash,
          input: EthImpl.zeroHex8Byte,
          maxPriorityFeePerGas: EthImpl.zeroHex,
          maxFeePerGas: EthImpl.zeroHex,
          nonce: nanOrNumberTo0x(0),
          r: EthImpl.zeroHex,
          s: EthImpl.zeroHex,
          to: log.address,
          transactionIndex: log.transactionIndex,
          type: EthImpl.twoHex, // 0x0 for legacy transactions, 0x1 for access list types, 0x2 for dynamic fees.
          v: EthImpl.zeroHex,
          value: EthImpl.oneTwoThreeFourHex,
        });
        transactionsArray.push(transaction);
      });
    } else {
      filteredLogs = logs.filter((log) => !transactionsArray.includes(log.transactionHash));
      filteredLogs.forEach((log) => {
        transactionsArray.push(log.transactionHash);
      });
    }

    if (this.logger.isLevelEnabled('trace')) {
      this.logger.trace(
        `${requestDetails.formattedRequestId} Synthetic transaction hashes will be populated in the block response`,
      );
    }

    return transactionsArray;
  }

  private getTransactionCountFromBlockResponse(block: any): null | string {
    if (block === null || block.count === undefined) {
      // block not found
      return null;
    }

    return numberTo0x(block.count);
  }
}
