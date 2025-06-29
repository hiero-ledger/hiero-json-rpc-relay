// SPDX-License-Identifier: Apache-2.0

import { ConfigService } from '@hashgraph/json-rpc-config-service/dist/services';
import { predefined, Relay } from '@hashgraph/json-rpc-relay/dist';
import { RequestDetails } from '@hashgraph/json-rpc-relay/dist/lib/types';
import { IJsonRpcRequest } from '@hashgraph/json-rpc-server/dist/koaJsonRpc/lib/IJsonRpcRequest';
import { IJsonRpcResponse } from '@hashgraph/json-rpc-server/dist/koaJsonRpc/lib/IJsonRpcResponse';
import jsonResp from '@hashgraph/json-rpc-server/dist/koaJsonRpc/lib/RpcResponse';
import Koa from 'koa';
import { Logger } from 'pino';

import ConnectionLimiter from '../metrics/connectionLimiter';
import WsMetricRegistry from '../metrics/wsMetricRegistry';
import { SubscriptionService } from '../service/subscriptionService';
import { WS_CONSTANTS } from './constants';

const hasOwnProperty = (obj: any, prop: any) => Object.prototype.hasOwnProperty.call(obj, prop);
const getRequestIdIsOptional = () => {
  return ConfigService.get('REQUEST_ID_IS_OPTIONAL');
};

/**
 * Handles the closure of a WebSocket connection.
 * @param {any} ctx - The context object containing information about the WebSocket connection.
 * @param {Relay} relay - The relay instance used for handling subscriptions.
 * @param {ConnectionLimiter} limiter - The limiter instance used for managing connection limits.
 * @param {WsMetricRegistry} wsMetricRegistry - The metric registry used for tracking WebSocket metrics.
 * @param {[number, number]} startTime - The start time of the connection represented as a tuple of seconds and nanoseconds.
 */
export const handleConnectionClose = async (
  ctx: any,
  subscriptionService: SubscriptionService,
  limiter: ConnectionLimiter,
  wsMetricRegistry: WsMetricRegistry,
  startTime: [number, number],
) => {
  // unsubcribe subscriptions
  subscriptionService.unsubscribe(ctx.websocket);

  // update limiter counters
  limiter.decrementCounters(ctx);

  // Increment the total closed connections
  wsMetricRegistry.getCounter('totalClosedConnections').inc();

  // Calculate the duration of the connection
  const endTime = process.hrtime(startTime);
  const durationInSeconds = endTime[0] + endTime[1] / 1e9; // Convert duration to seconds

  // Update the connection duration histogram with the calculated duration
  wsMetricRegistry.getHistogram('connectionDuration').observe(durationInSeconds);

  // terminate connection
  ctx.websocket.terminate();
};

/**
 * Sends a JSON-RPC response message to the client WebSocket connection.
 * Resets the TTL timer for inactivity on the client connection.
 * @param {any} connection - The WebSocket connection object to the client.
 * @param {IJsonRpcRequest | IJsonRpcRequest[]} request - The request object received from the client.
 * @param {IJsonRpcResponse | IJsonRpcResponse[]} response - The response data to be sent back to the client.
 * @param {Logger} logger - The logger object used for logging messages.
 * @param {RequestDetails} requestDetails - The request details for logging and tracking.
 */
export const sendToClient = (
  connection: any,
  request: IJsonRpcRequest | IJsonRpcRequest[],
  response: IJsonRpcResponse | IJsonRpcResponse[],
  logger: Logger,
  requestDetails: RequestDetails,
) => {
  logger.trace(
    `${requestDetails.formattedLogPrefix}: Sending result=${JSON.stringify(
      response,
    )} to client for request=${JSON.stringify(request)}`,
  );

  connection.send(JSON.stringify(response));
  connection.limiter.resetInactivityTTLTimer(connection);
};

/**
 * Validates a JSON-RPC request to ensure it has the correct JSON-RPC version, method, and id.
 * @param {IJsonRpcRequest} request - The JSON-RPC request object.
 * @param {Logger} logger - The logger instance used for logging.
 * @param {RequestDetails} requestDetails - The request details for logging and tracking.
 * @returns {boolean} A boolean indicating whether the request is valid.
 */
export const validateJsonRpcRequest = (
  request: IJsonRpcRequest,
  logger: Logger,
  requestDetails: RequestDetails,
): boolean => {
  if (
    request.jsonrpc !== '2.0' ||
    !hasOwnProperty(request, 'method') ||
    hasInvalidRequestId(request, logger, requestDetails) ||
    !hasOwnProperty(request, 'id')
  ) {
    logger.warn(
      `${requestDetails.formattedLogPrefix} Invalid request, request.jsonrpc: ${request.jsonrpc}, request.method: ${request.method}, request.id: ${request.id}, request.method: ${request.method}`,
    );
    return false;
  } else {
    return true;
  }
};

/**
 * Determines whether multiple addresses are enabled for WebSocket connections.
 * @returns {boolean} Returns true if multiple addresses are enabled, otherwise returns false.
 */
export const getMultipleAddressesEnabled = (): boolean => {
  return ConfigService.get('WS_MULTIPLE_ADDRESSES_ENABLED');
};

/**
 * Retrieves whether WebSocket batch requests are enabled.
 * @returns {boolean} A boolean indicating whether WebSocket batch requests are enabled.
 */
export const getWsBatchRequestsEnabled = (): boolean => {
  return ConfigService.get('WS_BATCH_REQUESTS_ENABLED');
};

/**
 * Retrieves the maximum size of batch requests for WebSocket.
 * @returns {number} The maximum size of batch requests for WebSocket.
 */
export const getBatchRequestsMaxSize = (): number => {
  return ConfigService.get('WS_BATCH_REQUESTS_MAX_SIZE');
};

/**
 * Verifies if the provided method is supported.
 * @param {string} method - The method to verify.
 * @returns {boolean} A boolean indicating whether the method is supported.
 */
export const verifySupportedMethod = (method: string): boolean => {
  return hasOwnProperty(WS_CONSTANTS.METHODS, method.toUpperCase());
};

/**
 * Checks if the JSON-RPC request has an invalid ID.
 * @param {IJsonRpcRequest} request - The JSON-RPC request object.
 * @param {Logger} logger - The logger instance used for logging.
 * @param {RequestDetails} requestDetails - The request details for logging and tracking.
 * @returns {boolean} A boolean indicating whether the request ID is invalid.
 */
const hasInvalidRequestId = (request: IJsonRpcRequest, logger: Logger, requestDetails: RequestDetails): boolean => {
  const hasId = hasOwnProperty(request, 'id');

  if (getRequestIdIsOptional() && !hasId) {
    // If the request is invalid, we still want to return a valid JSON-RPC response, default id to 0
    request.id = '0';
    logger.warn(
      `${requestDetails.formattedLogPrefix} Optional JSON-RPC 2.0 request id encountered. Will continue and default id to 0 in response`,
    );
    return false;
  }

  return !hasId;
};

/**
 * Checks if subscriptions are enabled.
 * @returns {boolean} A boolean indicating whether subscriptions are enabled.
 */
export const areSubscriptionsEnabled = (): boolean => {
  return ConfigService.get('SUBSCRIPTIONS_ENABLED');
};

/**
 * Constructs a valid log subscription filter from the provided filters, retaining only the 'address' and 'topics' fields while discarding any unexpected parameters.
 * @param {any} filters - The filters to construct the subscription filter from.
 * @returns {Object} A valid log subscription filter object.
 */
export const constructValidLogSubscriptionFilter = (filters: any): object => {
  return Object.fromEntries(
    Object.entries(filters).filter(([key, value]) => value !== undefined && ['address', 'topics'].includes(key)),
  );
};

/**
 * Handles sending the WS_SUBSCRIPTIONS_DISABLED error response.
 *
 * @param logger - The logger instance.
 * @param ctx - The Koa context.
 * @param requestDetails - Details of the current request.
 * @returns void
 */
export const sendSubscriptionsDisabledError = (logger: Logger, requestDetails: RequestDetails): IJsonRpcResponse => {
  const wsSubscriptionsDisabledError = predefined.WS_SUBSCRIPTIONS_DISABLED;
  logger.warn(`${requestDetails.formattedLogPrefix}: ${JSON.stringify(wsSubscriptionsDisabledError)}`);
  return jsonResp(null, wsSubscriptionsDisabledError, undefined);
};
