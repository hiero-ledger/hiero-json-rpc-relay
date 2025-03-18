// SPDX-License-Identifier: Apache-2.0

import { ConfigService } from '@hashgraph/json-rpc-config-service/dist/services';
import { predefined, type RelayImpl } from '@hashgraph/json-rpc-relay/dist';
import { MirrorNodeClient } from '@hashgraph/json-rpc-relay/dist/lib/clients';
import constants from '@hashgraph/json-rpc-relay/dist/lib/constants';
import { RequestDetails } from '@hashgraph/json-rpc-relay/dist/lib/types';
import { IJsonRpcRequest } from '@hashgraph/json-rpc-server/dist/koaJsonRpc/lib/IJsonRpcRequest';
import { IJsonRpcResponse } from '@hashgraph/json-rpc-server/dist/koaJsonRpc/lib/IJsonRpcResponse';
import jsonResp from '@hashgraph/json-rpc-server/dist/koaJsonRpc/lib/RpcResponse';
import { Context } from 'koa';
import { Logger } from 'pino';

import { constructValidLogSubscriptionFilter, getMultipleAddressesEnabled } from '../utils/utils';
import { validateSubscribeEthLogsParams } from '../utils/validators';
import { ISharedParams } from './index';

/**
 * Subscribes to new block headers (newHeads) events and returns the response and subscription ID.
 * @param {any} filters - The filters object specifying criteria for the subscription.
 * @param {Context} ctx - The context object containing information about the WebSocket connection.
 * @param {string} event - The event name to subscribe to (e.g., "newHeads").
 * @param {RelayImpl} relay - The relay object used for managing WebSocket subscriptions.
 * @param {Logger} logger - The logger object used for logging subscription information.
 * @returns {string | undefined} Returns the subscription ID.
 */
const subscribeToNewHeads = (
  filters: any,
  ctx: Context,
  event: string,
  relay: RelayImpl,
  logger: Logger,
): string | undefined => {
  const subscriptionId = relay.subs()?.subscribe(ctx.websocket, event, filters);
  logger.info(`Subscribed to newHeads, subscriptionId: ${subscriptionId}`);
  return subscriptionId;
};

/**
 * Handles the subscription request for newHeads events.
 * If newHeads subscription is enabled, subscribes to the event; otherwise, sends an unsupported method response.
 * @param {any} filters - The filters object specifying criteria for the subscription.
 * @param {any} request - The request object received from the client.
 * @param {any} ctx - The context object containing information about the WebSocket connection.
 * @param {string} event - The event name to subscribe to (e.g., "newHeads").
 * @param {Relay} relay - The relay object used for managing WebSocket subscriptions.
 * @param {any} logger - The logger object used for logging subscription information.
 * @param {RequestDetails} requestDetails - The request details for logging and tracking.
 * @returns {{ response: any; subscriptionId: any }} Returns an object containing the response and subscription ID.
 */
const handleEthSubscribeNewHeads = (
  filters: any,
  request: IJsonRpcRequest,
  ctx: Context,
  event: string,
  relay: RelayImpl,
  logger: Logger,
  requestDetails: RequestDetails,
): IJsonRpcResponse => {
  const wsNewHeadsEnabled = ConfigService.get('WS_NEW_HEADS_ENABLED');

  if (!wsNewHeadsEnabled) {
    logger.warn(
      `${requestDetails.formattedLogPrefix}: Unsupported JSON-RPC method due to the value of environment variable WS_NEW_HEADS_ENABLED`,
    );
    throw predefined.UNSUPPORTED_METHOD;
  }

  const subscriptionId = subscribeToNewHeads(filters, ctx, event, relay, logger);
  return jsonResp(request.id, null, subscriptionId);
};

/**
 * Handles the subscription request for logs events.
 * Validates the subscription parameters, checks if multiple addresses are enabled,
 * and subscribes to the event or sends an error response accordingly.
 * @param {any} filters - The filters object specifying criteria for the subscription.
 * @param {IJsonRpcRequest} request - The request object received from the client.
 * @param {Context} ctx - The context object containing information about the WebSocket connection.
 * @param {string} event - The event name to subscribe to.
 * @param {Relay} relay - The relay object used for managing WebSocket subscriptions.
 * @param {MirrorNodeClient} mirrorNodeClient - The client for interacting with the MirrorNode API.
 * @param {RequestDetails} requestDetails - The request details for logging and tracking.
 * @returns {{ response: any; subscriptionId: any }} Returns an object containing the response and subscription ID.
 */
const handleEthSubscribeLogs = async (
  filters: any,
  request: IJsonRpcRequest,
  ctx: Context,
  event: string,
  relay: RelayImpl,
  mirrorNodeClient: MirrorNodeClient,
  requestDetails: RequestDetails,
): Promise<IJsonRpcResponse> => {
  const validFiltersObject = constructValidLogSubscriptionFilter(filters);

  await validateSubscribeEthLogsParams(validFiltersObject, mirrorNodeClient, requestDetails);
  if (
    !getMultipleAddressesEnabled() &&
    Array.isArray(validFiltersObject['address']) &&
    validFiltersObject['address'].length > 1
  ) {
    throw predefined.INVALID_PARAMETER('filters.address', 'Only one contract address is allowed');
  }

  const subscriptionId = relay.subs()?.subscribe(ctx.websocket, event, validFiltersObject);
  return jsonResp(request.id, null, subscriptionId);
};

/**
 * Handles subscription requests for on-chain events.
 * Subscribes to the specified event type and returns the response.
 * @param {object} args - An object containing the function parameters as properties.
 * @param {Context} args.ctx - The context object containing information about the WebSocket connection.
 * @param {any[]} args.params - The parameters of the method request, expecting an event and filters.
 * @param {IJsonRpcRequest} args.request - The request object received from the client.
 * @param {Relay} args.relay - The relay object for interacting with the Hedera network.
 * @param {MirrorNodeClient} args.mirrorNodeClient - The mirror node client for handling subscriptions.
 * @param {ConnectionLimiter} args.limiter - The limiter object for managing connection subscriptions.
 * @param {Logger} args.logger - The logger object for logging messages and events.
 * @param {RequestDetails} args.requestDetails - The request details for logging and tracking.
 * @returns {Promise<any>} Returns a promise that resolves with the subscription response.
 */
export const handleEthSubscribe = async ({
  ctx,
  params,
  request,
  relay,
  mirrorNodeClient,
  limiter,
  logger,
  requestDetails,
}: ISharedParams): Promise<IJsonRpcResponse> => {
  const event = params[0];
  const filters = params[1];
  let response: IJsonRpcResponse;

  switch (event) {
    case constants.SUBSCRIBE_EVENTS.LOGS:
      response = await handleEthSubscribeLogs(filters, request, ctx, event, relay, mirrorNodeClient, requestDetails);
      break;

    case constants.SUBSCRIBE_EVENTS.NEW_HEADS:
      response = handleEthSubscribeNewHeads(filters, request, ctx, event, relay, logger, requestDetails);
      break;

    default:
      throw predefined.UNSUPPORTED_METHOD;
  }

  limiter.incrementSubs(ctx);

  return response;
};

/**
 * Handles unsubscription requests for on-chain events.
 * Unsubscribes the WebSocket from the specified subscription ID and returns the response.
 * @param {object} args - An object containing the function parameters as properties.
 * @param {Context} args.ctx - The context object containing information about the WebSocket connection.
 * @param {any[]} args.params - The parameters of the unsubscription request.
 * @param {IJsonRpcRequest} args.request - The request object received from the client.
 * @param {Relay} args.relay - The relay object used for managing WebSocket subscriptions.
 * @param {ConnectionLimiter} args.limiter - The limiter object used for rate limiting WebSocket connections.
 * @returns {IJsonRpcResponse} Returns the response to the unsubscription request.
 */
export const handleEthUnsubscribe = ({ ctx, params, request, relay, limiter }: ISharedParams): IJsonRpcResponse => {
  const subId = params[0];
  const unsubbedCount = relay.subs()?.unsubscribe(ctx.websocket, subId);
  limiter.decrementSubs(ctx, unsubbedCount);
  return jsonResp(request.id, null, unsubbedCount !== 0);
};
