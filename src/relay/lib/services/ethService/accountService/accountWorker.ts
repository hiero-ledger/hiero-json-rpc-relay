// SPDX-License-Identifier: Apache-2.0
import { numberTo0x } from '../../../../formatters';
import constants from '../../../constants';
import { type RequestDetails } from '../../../types';
import { type IWorkerContext } from '../../workersService/workerContext';
import { wrapError } from '../../workersService/WorkersErrorUtils';

/**
 * Gets the balance of an account as of the given block from the mirror node.
 *
 * @param {IWorkerContext} ctx The shared worker context providing the clients and services
 * @param {string} account The account to get the balance from
 * @param {string} blockNumberOrTagOrHash The block number or tag or hash to get the balance from
 * @param {RequestDetails} requestDetails The request details for logging and tracking
 */
export async function getBalance(
  ctx: IWorkerContext,
  account: string,
  blockNumberOrTagOrHash: string,
  requestDetails: RequestDetails,
): Promise<string> {
  const { commonService, accountService, mirrorNodeClient, logger } = ctx;
  try {
    let blockNumber: number | null = null;
    let balanceFound = false;
    let weibars = BigInt(0);

    // `latest`/`pending` always resolve to the live balance. For any other block identifier we ask
    // `extractBlockNumberAndTimestamp` whether it actually targets a historical block: it may still
    // resolve to the chain tip when the requested block is within `LATEST_BLOCK_TOLERANCE` of latest
    // (e.g. Metamask passing the latest block as an explicit number). The discriminated result makes
    // that routing explicit, so no second tag check is needed here.
    if (!commonService.blockTagIsLatestOrPending(blockNumberOrTagOrHash)) {
      const resolution = await accountService.extractBlockNumberAndTimestamp(blockNumberOrTagOrHash, requestDetails);

      if (!resolution.isLatest) {
        const block = await commonService.getHistoricalBlockResponse(requestDetails, blockNumberOrTagOrHash, true);
        if (block) {
          blockNumber = block.number;
          ({ balanceFound, weibars } = await accountService.getBalanceAtBlockNumber(
            account,
            block,
            resolution.latestBlock,
            requestDetails,
          ));
        }
      }
    }

    if (!balanceFound) {
      // Resolve the live balance: either the request targeted the tip, or no historical balance was
      // produced. Fetch the account's current balance from the mirror node.
      const mirrorAccount = await mirrorNodeClient.getAccount(account, requestDetails);
      if (mirrorAccount != null) {
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
