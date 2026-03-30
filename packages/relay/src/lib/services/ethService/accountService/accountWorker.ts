// SPDX-License-Identifier: Apache-2.0

import { ConfigService } from '@hashgraph/json-rpc-config-service/dist/services';
import pino from 'pino';

import { numberTo0x } from '../../../../formatters';
import { MirrorNodeClient } from '../../../clients/mirrorNodeClient';
import constants from '../../../constants';
import { CacheClientFactory } from '../../../factories/cacheClientFactory';
import { RegistryFactory } from '../../../factories/registryFactory';
import { RequestDetails } from '../../../types';
import { LatestBlockNumberTimestamp } from '../../../types/mirrorNode';
import { LocalPendingTransactionStorage } from '../../transactionPoolService/LocalPendingTransactionStorage';
import { TransactionPoolService } from '../../transactionPoolService/transactionPoolService';
import { wrapError } from '../../workersService/WorkersErrorUtils';
import { CommonService } from '../ethCommonService/CommonService';
import { AccountService } from './AccountService';

const logger = pino({ level: ConfigService.get('LOG_LEVEL') || 'trace' });
const register = RegistryFactory.getInstance();
const cacheService = CacheClientFactory.create(logger, register);
const mirrorNodeClient = new MirrorNodeClient(ConfigService.get('MIRROR_NODE_URL'), logger, register, cacheService);
const commonService = new CommonService(mirrorNodeClient, logger, cacheService);
// Can use LocalPendingTransactionStorage() as transactionPoolService is required in AccountService constructor but not used for getBalance
const transactionPoolService = new TransactionPoolService(new LocalPendingTransactionStorage(), logger, register);
const accountService = new AccountService(
  cacheService,
  commonService,
  logger,
  mirrorNodeClient,
  transactionPoolService,
);

/**
 * Gets the balance of an account as of the given block from the mirror node.
 *
 * @param {string} account The account to get the balance from
 * @param {string} blockNumberOrTagOrHash The block number or tag or hash to get the balance from
 * @param {RequestDetails} requestDetails The request details for logging and tracking
 */
export async function getBalance(
  account: string,
  blockNumberOrTagOrHash: string,
  requestDetails: RequestDetails,
): Promise<string> {
  try {
    let latestBlock: LatestBlockNumberTimestamp | null | undefined;
    // this check is required, because some tools like Metamask pass for parameter latest block, with a number (ex 0x30ea)
    // tolerance is needed, because there is a small delay between requesting latest block from blockNumber and passing it here
    // `blockTagIsLatestOrPending` is called twice because `extractBlockNumberAndTimestamp` can change the state of `blockNumberOrTagOrHash` in place
    // so we need to check again if it is still `latest` or `pending` after extracting the block number and timestamp, if it was not `latest` or `pending` before
    if (!commonService.blockTagIsLatestOrPending(blockNumberOrTagOrHash)) {
      ({ latestBlock, blockNumberOrTagOrHash } = await accountService.extractBlockNumberAndTimestamp(
        blockNumberOrTagOrHash,
        requestDetails,
      ));
    }

    let blockNumber = null;
    let balanceFound = false;
    let weibars = BigInt(0);
    let mirrorAccount;

    if (!commonService.blockTagIsLatestOrPending(blockNumberOrTagOrHash)) {
      const block = await commonService.getHistoricalBlockResponse(requestDetails, blockNumberOrTagOrHash, true);
      if (block) {
        blockNumber = block.number;
        // A blockNumberOrTag has been provided. If it is `latest` or `pending` retrieve the balance from /accounts/{account.id}
        // If the parsed blockNumber is the same as the one from the latest block retrieve the balance from /accounts/{account.id}
        if (latestBlock && block.number !== latestBlock.blockNumber) {
          ({ balanceFound, weibars } = await accountService.getBalanceAtBlockNumber(
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
      mirrorAccount = await mirrorNodeClient.getAccount(account, requestDetails);
      // Test if exists here
      if (mirrorAccount !== null && mirrorAccount !== undefined) {
        balanceFound = true;
        weibars = BigInt(mirrorAccount.balance.balance) * BigInt(constants.TINYBAR_TO_WEIBAR_COEF);
      }
    }

    if (!balanceFound) {
      if (logger.isLevelEnabled('debug')) {
        logger.debug(
          `Unable to find account %s in block %s (%s), returning 0x0 balance`,
          account,
          JSON.stringify(blockNumber),
          blockNumberOrTagOrHash,
        );
      }
      return constants.ZERO_HEX;
    }

    return numberTo0x(weibars);
  } catch (e: unknown) {
    throw wrapError(e);
  }
}
