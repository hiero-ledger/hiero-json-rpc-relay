// SPDX-License-Identifier: Apache-2.0

import { ConfigService } from '@hashgraph/json-rpc-config-service/dist/services';
import { Logger } from 'pino';

import { numberTo0x, parseNumericEnvVar } from '../../../../formatters';
import { MirrorNodeClient } from '../../../clients';
import constants from '../../../constants';
import { JsonRpcError, predefined } from '../../../errors/JsonRpcError';
import { RequestDetails } from '../../../types';
import { LatestBlockNumberTimestamp } from '../../../types/mirrorNode';
import { CacheService } from '../../cacheService/cacheService';
import { CommonService } from '../ethCommonService/CommonService';
import { ICommonService } from '../ethCommonService/ICommonService';
import { IAccountService } from './IAccountService';

export class AccountService implements IAccountService {
  /**
   * The service used for caching items from requests.
   *
   * @private
   */
  private readonly cacheService: CacheService;

  /**
   * The Common Service implementation that contains logic shared by other services.
   *
   * @private
   */
  private readonly common: ICommonService;

  /**
   * @private
   */
  private readonly ethBlockNumberCacheTtlMs = parseNumericEnvVar(
    'ETH_BLOCK_NUMBER_CACHE_TTL_MS',
    'ETH_BLOCK_NUMBER_CACHE_TTL_MS_DEFAULT',
  );

  /**
   * @private
   */
  private readonly ethGetBalanceCacheTtlMs = parseNumericEnvVar(
    'ETH_GET_BALANCE_CACHE_TTL_MS',
    'ETH_GET_BALANCE_CACHE_TTL_MS_DEFAULT',
  );

  /**
   * @private
   */
  private readonly ethGetTransactionCountCacheTtl = parseNumericEnvVar(
    'ETH_GET_TRANSACTION_COUNT_CACHE_TTL',
    'ETH_GET_TRANSACTION_COUNT_CACHE_TTL',
  );

  /**
   * The logger used for logging all output from this class.
   *
   * @private
   */
  private readonly logger: Logger;

  /**
   * @private
   */
  private readonly maxBlockRange = parseNumericEnvVar('MAX_BLOCK_RANGE', 'MAX_BLOCK_RANGE');

  /**
   * The interface through which we interact with the mirror node.
   *
   * @private
   */
  private readonly mirrorNodeClient: MirrorNodeClient;

  /**
   * @constructor
   * @param cacheService
   * @param common
   * @param logger
   * @param mirrorNodeClient
   */
  constructor(cacheService: CacheService, common: ICommonService, logger: Logger, mirrorNodeClient: MirrorNodeClient) {
    this.cacheService = cacheService;
    this.common = common;
    this.logger = logger;
    this.mirrorNodeClient = mirrorNodeClient;
  }

  /**
   * Gets the balance of an account as of the given block from the mirror node.
   * Current implementation does not yet utilize blockNumber
   *
   * @param {string} account The account to get the balance from
   * @param {string} blockNumberOrTagOrHash The block number or tag or hash to get the balance from
   * @param {RequestDetails} requestDetails The request details for logging and tracking
   */
  public async getBalance(
    account: string,
    blockNumberOrTagOrHash: string,
    requestDetails: RequestDetails,
  ): Promise<string> {
    const requestIdPrefix = requestDetails.formattedRequestId;
    if (this.logger.isLevelEnabled('trace')) {
      this.logger.trace(
        `${requestIdPrefix} getBalance(account=${account}, blockNumberOrTag=${blockNumberOrTagOrHash})`,
      );
    }

    let latestBlock: LatestBlockNumberTimestamp | null | undefined;
    // this check is required, because some tools like Metamask pass for parameter latest block, with a number (ex 0x30ea)
    // tolerance is needed, because there is a small delay between requesting latest block from blockNumber and passing it here
    if (!this.common.blockTagIsLatestOrPending(blockNumberOrTagOrHash)) {
      ({ latestBlock, blockNumberOrTagOrHash } = await this.extractBlockNumberAndTimestamp(
        blockNumberOrTagOrHash,
        requestDetails,
      ));
    }

    let blockNumber = null;
    let balanceFound = false;
    let weibars = BigInt(0);
    let mirrorAccount;

    try {
      if (!this.common.blockTagIsLatestOrPending(blockNumberOrTagOrHash)) {
        const block = await this.common.getHistoricalBlockResponse(requestDetails, blockNumberOrTagOrHash, true);
        if (block) {
          blockNumber = block.number;
          // A blockNumberOrTag has been provided. If it is `latest` or `pending` retrieve the balance from /accounts/{account.id}
          // If the parsed blockNumber is the same as the one from the latest block retrieve the balance from /accounts/{account.id}
          if (latestBlock && block.number !== latestBlock.blockNumber) {
            ({ balanceFound, weibars } = await this.getBalanceAtBlockNumber(
              account,
              block,
              latestBlock,
              requestDetails,
            ));
          }
        }
      }

      if (!balanceFound && !mirrorAccount) {
        // If no balance and no account, then we need to make a request to the mirror node for the account.
        mirrorAccount = await this.mirrorNodeClient.getAccountPageLimit(account, requestDetails);
        // Test if exists here
        if (mirrorAccount !== null && mirrorAccount !== undefined) {
          balanceFound = true;
          weibars = BigInt(mirrorAccount.balance.balance) * BigInt(constants.TINYBAR_TO_WEIBAR_COEF);
        }
      }

      if (!balanceFound) {
        if (this.logger.isLevelEnabled('debug')) {
          this.logger.debug(
            `${requestIdPrefix} Unable to find account ${account} in block ${JSON.stringify(
              blockNumber,
            )}(${blockNumberOrTagOrHash}), returning 0x0 balance`,
          );
        }
        return constants.ZERO_HEX;
      }

      return numberTo0x(weibars);
    } catch (error: any) {
      throw this.common.genericErrorHandler(
        error,
        `${requestIdPrefix} Error raised during getBalance for account ${account}`,
      );
    }
  }

  /**
   * @param blockNumberOrTagOrHash
   * @param requestDetails
   * @private
   */
  private async extractBlockNumberAndTimestamp(blockNumberOrTagOrHash: string, requestDetails: RequestDetails) {
    let latestBlock: LatestBlockNumberTimestamp;
    const latestBlockTolerance = 1;
    let blockHashNumber, isHash;
    const cacheKey = `${constants.CACHE_KEY.ETH_BLOCK_NUMBER}`;
    const blockNumberCached = await this.cacheService.getAsync(cacheKey, constants.ETH_GET_BALANCE, requestDetails);

    if (blockNumberCached) {
      if (this.logger.isLevelEnabled('trace')) {
        this.logger.trace(
          `${requestDetails.requestId} returning cached value ${cacheKey}:${JSON.stringify(blockNumberCached)}`,
        );
      }
      latestBlock = { blockNumber: blockNumberCached, timeStampTo: '0' };
    } else {
      latestBlock = await this.blockNumberTimestamp(constants.ETH_GET_BALANCE, requestDetails);
    }

    if (blockNumberOrTagOrHash.length > 32) {
      isHash = true;
      blockHashNumber = await this.mirrorNodeClient.getBlock(blockNumberOrTagOrHash, requestDetails);
    }

    const currentBlockNumber = isHash ? Number(blockHashNumber.number) : Number(blockNumberOrTagOrHash);

    const blockDiff = Number(latestBlock.blockNumber) - currentBlockNumber;
    if (blockDiff <= latestBlockTolerance) {
      blockNumberOrTagOrHash = constants.BLOCK_LATEST;
    }

    // If ever we get the latest block from cache, and blockNumberOrTag is not latest, then we need to get the block timestamp
    // This should rarely happen.
    if (blockNumberOrTagOrHash !== constants.BLOCK_LATEST && latestBlock.timeStampTo === '0') {
      latestBlock = await this.blockNumberTimestamp(constants.ETH_GET_BALANCE, requestDetails);
    }

    return { latestBlock, blockNumberOrTagOrHash };
  }

  /**
   * @param nextPage
   * @param block
   * @param requestDetails
   * @private
   */
  private async getPagedTransactions(nextPage: string, block, requestDetails: RequestDetails) {
    let pagedTransactions = [];
    // if we have a pagination link that falls within the block.timestamp.to, we need to paginate to get the transactions for the block.timestamp.to
    const nextPageParams = new URLSearchParams(nextPage.split('?')[1]);
    const nextPageTimeMarker = nextPageParams.get('timestamp');
    // if nextPageTimeMarker is greater than the block.timestamp.to, then we need to paginate to get the transactions for the block.timestamp.to
    if (nextPageTimeMarker && nextPageTimeMarker?.split(':')[1] >= block.timestamp.to) {
      pagedTransactions = await this.mirrorNodeClient.getAccountPaginated(nextPage, requestDetails);
    }
    // if nextPageTimeMarker is less than the block.timestamp.to, then just run the getBalanceAtBlockTimestamp function in this case as well.

    return pagedTransactions;
  }

  /**
   * @param account
   * @param block
   * @param latestBlock
   * @param requestDetails
   * @private
   */
  private async getBalanceAtBlockNumber(account, block, latestBlock, requestDetails) {
    let balanceFound = false;
    let weibars = BigInt(0);
    let mirrorAccount;

    const latestTimestamp = Number(latestBlock.timeStampTo.split('.')[0]);
    const blockTimestamp = Number(block.timestamp.from.split('.')[0]);
    const timeDiff = latestTimestamp - blockTimestamp;
    // The block is NOT from the last 15 minutes, use /balances rest API
    if (timeDiff > constants.BALANCES_UPDATE_INTERVAL) {
      const balance = await this.mirrorNodeClient.getBalanceAtTimestamp(account, requestDetails, block.timestamp.from);
      balanceFound = true;
      if (balance?.balances?.length) {
        weibars = BigInt(balance.balances[0].balance) * BigInt(constants.TINYBAR_TO_WEIBAR_COEF);
      }
    }
    // The block is from the last 15 minutes, therefore the historical balance hasn't been imported in the Mirror Node yet
    else {
      let currentBalance = 0;
      let balanceFromTxs = 0;
      mirrorAccount = await this.mirrorNodeClient.getAccountPageLimit(account, requestDetails);
      if (mirrorAccount) {
        if (mirrorAccount.balance) {
          currentBalance = mirrorAccount.balance.balance;
        }

        // The balance in the account is real time, so we simply subtract the transactions to the block.timestamp.to to get a block relevant balance.
        // needs to be updated below.
        const nextPage: string = mirrorAccount.links.next;
        if (nextPage) {
          mirrorAccount.transactions = mirrorAccount.transactions.concat(
            await this.getPagedTransactions(nextPage, block, requestDetails),
          );
        }

        balanceFromTxs = this.getBalanceAtBlockTimestamp(
          mirrorAccount.account,
          mirrorAccount.transactions,
          block.timestamp.to,
        );

        balanceFound = true;
        weibars = BigInt(currentBalance - balanceFromTxs) * BigInt(constants.TINYBAR_TO_WEIBAR_COEF);
      }
    }

    return { balanceFound, weibars };
  }

  /**
   * Gets the number of transactions that have been executed for the given address.
   * This goes to the consensus nodes to determine the ethereumNonce.
   *
   * Queries mirror node for best effort and falls back to consensus node for contracts until HIP 729 is implemented.
   *
   * @param {string} address The account address
   * @param {string | null} blockNumOrTag Possible values are earliest/pending/latest or hex
   * @param {RequestDetails} requestDetails The request details for logging and tracking
   */
  public async getTransactionCount(
    address: string,
    blockNumOrTag: string | null,
    requestDetails: RequestDetails,
  ): Promise<string | JsonRpcError> {
    const requestIdPrefix = requestDetails.formattedRequestId;
    if (this.logger.isLevelEnabled('trace')) {
      this.logger.trace(`${requestIdPrefix} getTransactionCount(address=${address}, blockNumOrTag=${blockNumOrTag})`);
    }

    // cache considerations for high load
    const cacheKey = `eth_getTransactionCount_${address}_${blockNumOrTag}`;
    let nonceCount = await this.cacheService.getAsync(cacheKey, constants.ETH_GET_TRANSACTION_COUNT, requestDetails);
    if (nonceCount) {
      if (this.logger.isLevelEnabled('trace')) {
        this.logger.trace(`${requestIdPrefix} returning cached value ${cacheKey}:${JSON.stringify(nonceCount)}`);
      }
      return nonceCount;
    }

    const blockNum = Number(blockNumOrTag);
    if (blockNumOrTag) {
      if (blockNum === 0 || blockNum === 1) {
        // previewnet and testnet bug have a genesis blockNumber of 1 but non system account were yet to be created
        return constants.ZERO_HEX;
      } else if (this.common.blockTagIsLatestOrPending(blockNumOrTag)) {
        // if latest or pending, get latest ethereumNonce from mirror node account API
        nonceCount = await this.getAccountLatestEthereumNonce(address, requestDetails);
      } else if (blockNumOrTag === constants.BLOCK_EARLIEST) {
        nonceCount = await this.getAccountNonceForEarliestBlock(requestDetails);
      } else if (!isNaN(blockNum) && blockNumOrTag.length != constants.BLOCK_HASH_LENGTH && blockNum > 0) {
        nonceCount = await this.getAccountNonceForHistoricBlock(address, blockNum, requestDetails);
      } else if (blockNumOrTag.length == constants.BLOCK_HASH_LENGTH && blockNumOrTag.startsWith(constants.EMPTY_HEX)) {
        nonceCount = await this.getAccountNonceForHistoricBlock(address, blockNumOrTag, requestDetails);
      } else {
        // return a '-39001: Unknown block' error per api-spec
        throw predefined.UNKNOWN_BLOCK();
      }
    } else {
      // if no block consideration, get latest ethereumNonce from mirror node if account or from consensus node is contract until HIP 729 is implemented
      nonceCount = await this.getAccountLatestEthereumNonce(address, requestDetails);
    }

    const cacheTtl =
      blockNumOrTag === constants.BLOCK_EARLIEST || !isNaN(blockNum)
        ? constants.CACHE_TTL.ONE_DAY
        : this.ethGetTransactionCountCacheTtl; // cache historical values longer as they don't change
    await this.cacheService.set(cacheKey, nonceCount, constants.ETH_GET_TRANSACTION_COUNT, requestDetails, cacheTtl);

    return nonceCount;
  }

  /**
   *
   * @param tag
   * @private
   */
  private static shouldUseCacheForBalance(tag: string | null): boolean {
    // should only cache balance when is Not latest or pending and is not in dev mode
    return !CommonService.blockTagIsLatestOrPendingStrict(tag) && !ConfigService.get('DEV_MODE');
  }

  /**
   * Gets the most recent block number and timestamp.to which represents the block finality.
   */
  private async blockNumberTimestamp(
    caller: string,
    requestDetails: RequestDetails,
  ): Promise<LatestBlockNumberTimestamp> {
    if (this.logger.isLevelEnabled('trace')) {
      this.logger.trace(`${requestDetails.formattedRequestId} blockNumber()`);
    }

    const cacheKey = `${constants.CACHE_KEY.ETH_BLOCK_NUMBER}`;

    const blocksResponse = await this.mirrorNodeClient.getLatestBlock(requestDetails);
    const blocks = blocksResponse !== null ? blocksResponse.blocks : null;
    if (Array.isArray(blocks) && blocks.length > 0) {
      const currentBlock = numberTo0x(blocks[0].number);
      const timestamp = blocks[0].timestamp.to;
      const blockTimeStamp: LatestBlockNumberTimestamp = { blockNumber: currentBlock, timeStampTo: timestamp };
      // save the latest block number in cache
      await this.cacheService.set(cacheKey, currentBlock, caller, requestDetails, this.ethBlockNumberCacheTtlMs);

      return blockTimeStamp;
    }

    throw predefined.COULD_NOT_RETRIEVE_LATEST_BLOCK;
  }

  /**
   * Returns the difference between the balance of the account and the transactions summed up to the block number queried.
   * @param account
   * @param transactions
   * @param blockTimestamp
   * @private
   */
  private getBalanceAtBlockTimestamp(account: string, transactions: any[], blockTimestamp: number) {
    return transactions
      .filter((transaction) => {
        return transaction.consensus_timestamp >= blockTimestamp;
      })
      .flatMap((transaction) => {
        return transaction.transfers.filter((transfer) => {
          return transfer.account === account && !transfer.is_approval;
        });
      })
      .map((transfer) => {
        return transfer.amount;
      })
      .reduce((total, amount) => {
        return total + amount;
      }, 0);
  }

  /**
   * Get nonce for historical block
   * @param address
   * @param blockNumOrHash
   * @param requestDetails
   * @private
   */
  private async getAccountNonceForHistoricBlock(
    address: string,
    blockNumOrHash: number | string,
    requestDetails: RequestDetails,
  ): Promise<string> {
    let getBlock;
    const isParamBlockNum = typeof blockNumOrHash === 'number';

    if (isParamBlockNum && (blockNumOrHash as number) < 0) {
      throw predefined.UNKNOWN_BLOCK();
    }

    if (!isParamBlockNum) {
      getBlock = await this.mirrorNodeClient.getBlock(blockNumOrHash, requestDetails);
    }

    const blockNum = isParamBlockNum ? blockNumOrHash : getBlock.number;

    // check if on latest block, if so get latest ethereumNonce from mirror node account API
    const blockResponse = await this.mirrorNodeClient.getLatestBlock(requestDetails); // consider caching error responses
    if (blockResponse == null || blockResponse.blocks.length === 0) {
      throw predefined.UNKNOWN_BLOCK();
    }

    if (blockResponse.blocks[0].number - blockNum <= this.maxBlockRange) {
      return this.getAccountLatestEthereumNonce(address, requestDetails);
    }

    // if valid block number, get block timestamp
    return await this.getAccountNonceFromContractResult(address, blockNum, requestDetails);
  }

  private async getAccountLatestEthereumNonce(address: string, requestDetails: RequestDetails): Promise<string> {
    const accountData = await this.mirrorNodeClient.getAccount(address, requestDetails);
    if (accountData) {
      // with HIP 729 ethereum_nonce should always be 0+ and null. Historical contracts may have a null value as the nonce was not tracked, return default EVM compliant 0x1 in this case
      return accountData.ethereum_nonce !== null ? numberTo0x(accountData.ethereum_nonce) : constants.ONE_HEX;
    }

    return constants.ZERO_HEX;
  }

  /**
   * Returns the number of transactions sent from an address by searching for the ethereum transaction involving the address
   * Remove when https://github.com/hashgraph/hedera-mirror-node/issues/5862 is implemented
   *
   * @param {string} address The account address
   * @param {string | number} blockNumOrHash The block number or hash
   * @param {RequestDetails} requestDetails The request details for logging and tracking
   * @returns {Promise<string>} The number of transactions sent from the address
   */
  private async getAccountNonceFromContractResult(
    address: string,
    blockNumOrHash: string | number,
    requestDetails: RequestDetails,
  ): Promise<string> {
    const requestIdPrefix = requestDetails.formattedRequestId;
    // get block timestamp for blockNum
    const block = await this.mirrorNodeClient.getBlock(blockNumOrHash, requestDetails); // consider caching error responses
    if (block == null) {
      throw predefined.UNKNOWN_BLOCK();
    }

    // get the latest 2 ethereum transactions for the account
    const ethereumTransactions = await this.mirrorNodeClient.getAccountLatestEthereumTransactionsByTimestamp(
      address,
      block.timestamp.to,
      requestDetails,
      2,
    );
    if (ethereumTransactions == null || ethereumTransactions.transactions.length === 0) {
      return constants.ZERO_HEX;
    }

    // if only 1 transaction is returned when asking for 2, then the account has only sent 1 transaction
    // minor optimization to save a call to getContractResult as many accounts serve a single use
    if (ethereumTransactions.transactions.length === 1) {
      return constants.ONE_HEX;
    }

    // get the transaction result for the latest transaction
    const transactionResult = await this.mirrorNodeClient.getContractResult(
      ethereumTransactions.transactions[0].transaction_id,
      requestDetails,
    );
    if (transactionResult == null) {
      throw predefined.RESOURCE_NOT_FOUND(
        `Failed to retrieve contract results for transaction ${ethereumTransactions.transactions[0].transaction_id}`,
      );
    }

    const accountResult = await this.mirrorNodeClient.getAccount(transactionResult.from, requestDetails);

    if (accountResult.evm_address !== address.toLowerCase()) {
      this.logger.warn(
        `${requestIdPrefix} eth_transactionCount for a historical block was requested where address: ${address} was not sender: ${transactionResult.address}, returning latest value as best effort.`,
      );
      return await this.getAccountLatestEthereumNonce(address, requestDetails);
    }

    return numberTo0x(transactionResult.nonce + 1); // nonce is 0 indexed
  }

  /**
   * Get nonce for earliest block
   * @param requestDetails
   * @private
   */
  private async getAccountNonceForEarliestBlock(requestDetails: RequestDetails): Promise<string> {
    const block = await this.mirrorNodeClient.getEarliestBlock(requestDetails);
    if (block == null) {
      throw predefined.INTERNAL_ERROR('No network blocks found');
    }

    if (block.number <= 1) {
      // if the earliest block is the genesis block or 1 , then the nonce is 0 as only system accounts are present
      return constants.ZERO_HEX;
    }

    // note the mirror node may be a partial one, in which case there may be a valid block with number greater 1.
    throw predefined.INTERNAL_ERROR(`Partial mirror node encountered, earliest block number is ${block.number}`);
  }
}
