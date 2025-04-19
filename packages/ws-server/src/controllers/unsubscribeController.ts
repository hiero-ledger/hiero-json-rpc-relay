// SPDX-License-Identifier: Apache-2.0
import { IJsonRpcResponse } from '@hashgraph/json-rpc-server/dist/koaJsonRpc/lib/IJsonRpcResponse';
import jsonResp from '@hashgraph/json-rpc-server/dist/koaJsonRpc/lib/RpcResponse';

import { areSubscriptionsEnabled } from '../utils/utils';
import { sendSubscriptionsDisabledError } from '../utils/utils';
import { ISharedParams } from './jsonRpcController';

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
export const handleEthUnsubscribe = ({
  ctx,
  params,
  request,
  limiter,
  logger,
  requestDetails,
  subscriptionService,
}: ISharedParams): IJsonRpcResponse => {
  if (!areSubscriptionsEnabled()) {
    return sendSubscriptionsDisabledError(logger, requestDetails);
  }
  const subId = params[0];
  const unsubbedCount = subscriptionService.unsubscribe(ctx.websocket, subId);
  limiter.decrementSubs(ctx, unsubbedCount);
  return jsonResp(request.id, null, unsubbedCount !== 0);
};
