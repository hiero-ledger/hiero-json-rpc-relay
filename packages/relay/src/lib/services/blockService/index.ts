// SPDX-License-Identifier: Apache-2.0
import { ConfigService } from '@hashgraph/json-rpc-config-service/dist/services';
import _ from 'lodash';
import { Logger } from 'pino';

import { nanOrNumberTo0x } from '../../../formatters';
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
  private readonly common: CommonService;

  private readonly mirrorNodeClient: MirrorNodeClient;

  private readonly logger: Logger;

  private readonly cacheService: CacheService;

  static ethGetBlockByHash = 'eth_GetBlockByHash';

  constructor(mirrorNodeClient: MirrorNodeClient, common: CommonService, logger: Logger, cacheService: CacheService) {
    this.mirrorNodeClient = mirrorNodeClient;
    this.common = common;
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

    const contractResults = await this.mirrorNodeClient.getContractResultWithRetry(
      this.mirrorNodeClient.getContractResults.name,
      [requestDetails, { timestamp: timestampRangeParams }, undefined],
      requestDetails,
    );
    const params = { timestamp: timestampRangeParams };

    // get contract results logs using block timestamp range
    const logs = await this.common.getLogsWithParams(null, params, requestDetails);

    if (contractResults == null && logs.length == 0) {
      // contract result not found
      return null;
    }

    // The consensus timestamp of the block, with the nanoseconds part omitted.
    const timestamp = timestampRange.from.substring(0, timestampRange.from.indexOf('.'));
    if (showDetails && contractResults.length >= ConfigService.get('ETH_GET_TRANSACTION_COUNT_MAX_BLOCK_RANGE')) {
      throw predefined.MAX_BLOCK_SIZE(blockResponse.count);
    }

    // prepare transactionArray
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
      // make this promise.all ??
      contractResult.from = await this.common.resolveEvmAddress(contractResult.from, requestDetails, [
        constants.TYPE_ACCOUNT,
      ]);
      contractResult.to = await this.common.resolveEvmAddress(contractResult.to, requestDetails);

      //contractResult.chain_id = contractResult.chain_id //|| this.chain;
      txArray.push(showDetails ? CommonService.formatContractResult(contractResult) : contractResult.hash);
    }

    txArray = this.populateSyntheticTransactions(showDetails, logs, txArray, requestDetails);
    txArray = showDetails ? txArray : _.uniq(txArray);

    const receipts: IReceiptRootHash[] = ReceiptsRootUtils.buildReceiptRootHashes(
      txArray.map((tx) => (showDetails ? tx.hash : tx)),
      contractResults,
      logs,
    );

    const gasPrice = '0x0';
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
          chainId: '0x12', //this.chain,
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
}
