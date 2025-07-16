// SPDX-License-Identifier: Apache-2.0

import { JsonRpcError, predefined } from '@hashgraph/json-rpc-relay/dist';
import { MirrorNodeClient } from '@hashgraph/json-rpc-relay/dist/lib/clients';
import constants from '@hashgraph/json-rpc-relay/dist/lib/constants';
import { RequestDetails } from '@hashgraph/json-rpc-relay/dist/lib/types';
import { validateEthSubscribeLogsParamObject } from '@hashgraph/json-rpc-relay/dist/lib/validators';

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
) => {
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
      requestDetails.formattedRequestId,
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
) => {
  // validate address exists and is correct length and type
  // validate topics if exists and is array and each one is correct length and type
  // @todo: move EthSubscribeLogsParamsObject to ws-server package
  validateEthSubscribeLogsParamObject(filters);

  // validate address or addresses are an existing smart contract
  if (filters.address) {
    if (Array.isArray(filters.address)) {
      for (const address of filters.address) {
        await validateIsContractOrTokenAddress(address, mirrorNodeClient, requestDetails);
      }
    } else {
      await validateIsContractOrTokenAddress(filters.address, mirrorNodeClient, requestDetails);
    }
  }
};

/**
 * Validates whether a given string is a 32-byte hexadecimal string.
 * Checks if the string starts with '0x' followed by 64 hexadecimal characters.
 * @param {string} hash - The string to be validated.
 * @returns {boolean} Returns true if the string is a valid 32-byte hexadecimal string, otherwise false.
 */
export const validate32bytesHexaString = (hash: string): boolean => {
  return /^0x[0-9a-fA-F]{64}$/.test(hash);
};
