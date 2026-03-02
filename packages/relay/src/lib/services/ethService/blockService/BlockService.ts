// SPDX-License-Identifier: Apache-2.0

import { Logger } from 'pino';

import { numberTo0x } from '../../../../formatters';
import { ICacheClient } from '../../../clients/cache/ICacheClient';
import { MirrorNodeClient } from '../../../clients/mirrorNodeClient';
import constants from '../../../constants';
import { Block } from '../../../model';
import { ITransactionReceipt, MirrorNodeBlock, RequestDetails } from '../../../types';
import { IBlockService, ICommonService } from '../../index';
import { WorkersPool } from '../../workersService/WorkersPool';

export class BlockService implements IBlockService {
  /**
   * The cache service used for caching all responses.
   * @private
   */
  private readonly cacheService: ICacheClient;

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
    cacheService: ICacheClient,
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
    return WorkersPool.run(
      {
        type: 'getBlockReceipts',
        blockHashOrBlockNumber,
        requestDetails,
      },
      this.mirrorNodeClient,
      this.cacheService,
    );
  }

  /**
   * Gets the raw transaction receipts for a block by block hash or block number.
   *
   * @param {string} blockHashOrBlockNumber The block hash or block number
   * @param {RequestDetails} requestDetails The request details for logging and tracking
   * @returns {Promise<string[]>} Array of raw block receipts for the block
   */
  public async getRawReceipts(blockHashOrBlockNumber: string, requestDetails: RequestDetails): Promise<string[]> {
    return WorkersPool.run(
      {
        type: 'getRawReceipts',
        blockHashOrBlockNumber,
        requestDetails,
      },
      this.mirrorNodeClient,
      this.cacheService,
    );
  }

  /**
   * Gets the number of transaction in a block by its block hash.
   *
   * @param {string} hash The block hash
   * @param {RequestDetails} requestDetails The request details for logging and tracking
   * @returns {Promise<string | null>} The transaction count
   */
  async getBlockTransactionCountByHash(hash: string, requestDetails: RequestDetails): Promise<string | null> {
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
    return null;
  }

  /**
   * Always returns '0x0'. There are no uncles in Hedera.
   *
   * @param blockHash - The block hash
   * @returns '0x0' as Hedera does not support uncle blocks
   */
  getUncleCountByBlockHash(blockHash: string): string {
    return constants.ZERO_HEX;
  }

  /**
   * Always returns '0x0'. There are no uncles in Hedera.
   *
   * @param blockNumOrTag - The block number or tag
   * @returns '0x0' as Hedera does not support uncle blocks
   */
  getUncleCountByBlockNumber(blockNumOrTag: string): string {
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
    return WorkersPool.run(
      {
        type: 'getBlock',
        blockHashOrNumber,
        showDetails,
        requestDetails,
        chain: this.chain,
      },
      this.mirrorNodeClient,
      this.cacheService,
    );
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
}
