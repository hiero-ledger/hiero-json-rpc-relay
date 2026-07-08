// SPDX-License-Identifier: Apache-2.0

import { ConfigService } from '../../config-service/services';
import { JsonRpcError, predefined } from '../../relay';
import { type MirrorNodeClient } from '../../relay/lib/clients';
import constants from '../../relay/lib/constants';
import { type RequestDetails } from '../../relay/lib/types';
import { validateEthSubscribeLogsParamObject } from '../../relay/lib/validators';
import { WS_CONSTANTS } from './constants';
import { getMultipleAddressesEnabled } from './utils';

interface EthSubscribeLogsParams {
  address?: string | string[];
  topics?: any[];
}

/**
 * Validates whether the provided address corresponds to a contract or token type.
 * Throws an error if the address is not a valid contract or token type or does not exist.
 * @param {string} address - The address to validate.
 * @param {MirrorNodeClient} mirrorNodeClient - The client for interacting with the MirrorNode API.
 * @param {RequestDetails} requestDetails - The request details for logging and tracking.
 * @throws {JsonRpcError} Throws a JsonRpcError if the address is not a valid contract or token type or does not exist.
 */
const validateIsContractOrTokenAddress = async (
  address: string,
  mirrorNodeClient: MirrorNodeClient,
  requestDetails: RequestDetails,
): Promise<void> => {
  const isContractOrToken = await mirrorNodeClient.resolveEntityType(
    address,
    constants.METHODS.ETH_SUBSCRIBE,
    requestDetails,
    [constants.TYPE_CONTRACT, constants.TYPE_TOKEN],
  );
  if (!isContractOrToken) {
    throw new JsonRpcError(
      predefined.INVALID_PARAMETER(
        'filters.address',
        `${address} is not a valid contract or token type or does not exists`,
      ),
    );
  }
};

/**
 * Validates the parameters for subscribing to ETH logs.
 * @param {any} filters - The filters object containing parameters for subscribing to ETH logs.
 * @param {MirrorNodeClient} mirrorNodeClient - The client for interacting with the MirrorNode API.
 * @param {RequestDetails} requestDetails - The request details for logging and tracking.
 */
export const validateSubscribeEthLogsParams = async (
  filters: EthSubscribeLogsParams,
  mirrorNodeClient: MirrorNodeClient,
  requestDetails: RequestDetails,
): Promise<void> => {
  // validate address exists and is correct length and type
  // validate topics if exists and is array and each one is correct length and type
  // @todo: move EthSubscribeLogsParamsObject to ws-server package
  validateEthSubscribeLogsParamObject(filters);

  // validate address or addresses are an existing smart contract
  if (filters.address) {
    if (Array.isArray(filters.address)) {
      // Dedupe so a repeated address does not multiply upstream lookups.
      const uniqueAddresses = [...new Set(filters.address)];

      // Enforce the count bound before any Mirror Node lookup, otherwise a large address array fans out
      // into one lookup per address before being rejected. Disabled => one address; enabled => capped by
      // WS_MULTIPLE_ADDRESSES_LIMIT, so the fan-out stays bounded.
      const maxAddresses = getMultipleAddressesEnabled() ? ConfigService.get('WS_MULTIPLE_ADDRESSES_LIMIT') : 1;
      if (uniqueAddresses.length > maxAddresses) {
        throw predefined.INVALID_PARAMETER(
          'filters.address',
          maxAddresses === 1
            ? 'Only one contract address is allowed'
            : `A maximum of ${maxAddresses} contract addresses are allowed`,
        );
      }

      filters.address = uniqueAddresses;

      // Validate in bounded parallel batches: parallelism cuts latency, while the batch size caps how many
      // Mirror Node lookups run at once so a large (but within-limit) filter cannot burst the Mirror Node.
      for (let i = 0; i < uniqueAddresses.length; i += WS_CONSTANTS.SUBSCRIBE_LOGS_ADDRESS_BATCH_SIZE) {
        const batch = uniqueAddresses.slice(i, i + WS_CONSTANTS.SUBSCRIBE_LOGS_ADDRESS_BATCH_SIZE);
        await Promise.all(
          batch.map((address) => validateIsContractOrTokenAddress(address, mirrorNodeClient, requestDetails)),
        );
      }
    } else {
      await validateIsContractOrTokenAddress(filters.address, mirrorNodeClient, requestDetails);
    }
  }
};
