// SPDX-License-Identifier: Apache-2.0

import { WS_CONSTANTS } from '../utils/constants';
import WsMetricRegistry from '../metrics/wsMetricRegistry';
import ConnectionLimiter from '../metrics/connectionLimiter';
import { Validator } from '@hashgraph/json-rpc-server/dist/validator';
import { handleEthSubscribe, handleEthUnsubscribe } from './eth_subscribe';
import { JsonRpcError, predefined, Relay } from '@hashgraph/json-rpc-relay/dist';
import { MirrorNodeClient } from '@hashgraph/json-rpc-relay/dist/lib/clients';
import jsonResp from '@hashgraph/json-rpc-server/dist/koaJsonRpc/lib/RpcResponse';
import { paramRearrangementMap, resolveParams, validateJsonRpcRequest, verifySupportedMethod } from '../utils/utils';
import {
  InvalidRequest,
  IPRateLimitExceeded,
  MethodNotFound,
} from '@hashgraph/json-rpc-server/dist/koaJsonRpc/lib/RpcError';
import { RequestDetails } from '@hashgraph/json-rpc-relay/dist/lib/types';
import { Logger } from 'pino';
import { IJsonRpcRequest } from '@hashgraph/json-rpc-server/dist/koaJsonRpc/lib/IJsonRpcRequest';
import Koa from 'koa';
import { IJsonRpcResponse } from '@hashgraph/json-rpc-server/dist/koaJsonRpc/lib/IJsonRpcResponse';

export type ISharedParams = {
  request: IJsonRpcRequest;
  method: string;
  params: any[];
  relay: Relay;
  logger: Logger;
  limiter: ConnectionLimiter;
  mirrorNodeClient: MirrorNodeClient;
  ctx: Koa.Context;
  requestDetails: RequestDetails;
};

/**
 * Handles sending requests to a Relay by calling a specified method with given parameters.
 * This function constructs a request tag, submits the request to the relay, and logs the process.
 * @notice This function is shared among all supported methods expect for eth_subscribe & eth_unsubscribe
 * @param {object} args - An object containing the function parameters as properties.
 * @param {any} args.request - The request object received from the client.
 * @param {string} args.method - The method to call on the relay.
 * @param {any} args.params - The parameters for the method call.
 * @param {Relay} args.relay - The relay object.
 * @param {any} args.logger - The logger object used for tracing.
 * @param {RequestDetails} args.requestDetails - The request details for logging and tracking.
 * @returns {Promise<any>} A promise that resolves to the result of the request.
 */
const handleSendingRequestsToRelay = async ({
  request,
  method,
  params,
  relay,
  logger,
  requestDetails,
}: ISharedParams): Promise<IJsonRpcResponse> => {
  if (logger.isLevelEnabled('trace')) {
    logger.trace(`${requestDetails.formattedLogPrefix}: Submitting request=${JSON.stringify(request)} to relay.`);
  }
  try {
    const resolvedParams = resolveParams(method, params);
    const [service, methodName] = method.split('_');

    const rearrangeParamsFn = paramRearrangementMap[methodName] || paramRearrangementMap['default'];
    const rearrangedParamsArray = rearrangeParamsFn(resolvedParams, requestDetails);

    // Call the relay method with the resolved parameters.
    // Method will be validated by "verifySupportedMethod" before reaching this point.
    let txRes: any;
    if (method === WS_CONSTANTS.METHODS.ETH_NEWFILTER) {
      txRes = await relay
        .eth()
        .filterService()
        [methodName](...rearrangedParamsArray);
    } else {
      txRes = await relay[service]()[methodName](...rearrangedParamsArray);
    }

    if (!txRes) {
      if (logger.isLevelEnabled('trace')) {
        logger.trace(
          `${requestDetails.formattedLogPrefix}: Fail to retrieve result for request=${JSON.stringify(
            request,
          )}. Result=${txRes}`,
        );
      }
    }

    return jsonResp(request.id, null, txRes);
  } catch (error: any) {
    if (error instanceof JsonRpcError) {
      throw error;
    } else {
      throw predefined.INTERNAL_ERROR(JSON.stringify(error.message || error));
    }
  }
};

/**
 * Retrieves the result of a request made to a Relay.
 * This function handles processing the request, including method validation, parameter validation, and method-specific logic.
 * @param {any} ctx - The context object.
 * @param {Relay} relay - The relay object.
 * @param {any} logger - The logger object.
 * @param {any} request - The request object.
 * @param {ConnectionLimiter} limiter - The connection limiter object.
 * @param {MirrorNodeClient} mirrorNodeClient - The MirrorNodeClient object.
 * @param {WsMetricRegistry} wsMetricRegistry - The WsMetricRegistry object.
 * @param {RequestDetails} requestDetails - The request details for logging and tracking.
 * @returns {Promise<any>} A promise that resolves to the response of the request.
 */
export const getRequestResult = async (
  ctx: Koa.Context,
  relay: Relay,
  logger: Logger,
  request: IJsonRpcRequest,
  limiter: ConnectionLimiter,
  mirrorNodeClient: MirrorNodeClient,
  wsMetricRegistry: WsMetricRegistry,
  requestDetails: RequestDetails,
): Promise<any> => {
  // Extract the method and parameters from the received request
  let { method, params } = request;

  // support go-ethereum client by turning undefined into empty array
  if (!params) params = [];

  // Increment metrics for the received method
  wsMetricRegistry.getCounter('methodsCounter').labels(method).inc();
  wsMetricRegistry.getCounter('methodsCounterByIp').labels(ctx.request.ip, method).inc();

  // validate request's jsonrpc object
  if (!validateJsonRpcRequest(request, logger, requestDetails)) {
    return jsonResp(request.id || null, new InvalidRequest(), undefined);
  }

  // verify supported method
  if (!verifySupportedMethod(request.method)) {
    logger.warn(`${requestDetails.formattedLogPrefix}: Method not supported: ${request.method}`);
    return jsonResp(request.id || null, new MethodNotFound(request.method), undefined);
  }

  // verify rate limit for method method based on IP
  if (limiter.shouldRateLimitOnMethod(ctx.ip, request.method, ctx.websocket.requestId)) {
    return jsonResp(null, new IPRateLimitExceeded(request.method), undefined);
  }

  // Validate request's params
  try {
    const methodValidations = Validator.METHODS[method];

    if (methodValidations) {
      Validator.validateParams(params, methodValidations);
    }
  } catch (error: any) {
    logger.warn(
      error,
      `${requestDetails.formattedLogPrefix} Error in parameter validation. Method: ${method}, params: ${JSON.stringify(
        params,
      )}.`,
    );

    let jsonRpcError: JsonRpcError;
    if (error instanceof JsonRpcError) {
      jsonRpcError = error;
    } else {
      jsonRpcError = predefined.INTERNAL_ERROR(JSON.stringify(error.message || error));
    }

    return jsonResp(request.id, jsonRpcError, undefined);
  }

  // Check if the subscription limit is exceeded for ETH_SUBSCRIBE method
  let response: IJsonRpcResponse;
  if (method === WS_CONSTANTS.METHODS.ETH_SUBSCRIBE && !limiter.validateSubscriptionLimit(ctx)) {
    return jsonResp(request.id, predefined.MAX_SUBSCRIPTIONS, undefined);
  }

  // processing method
  try {
    const sharedParams: ISharedParams = {
      ctx,
      params,
      logger,
      relay,
      request,
      method,
      limiter,
      mirrorNodeClient,
      requestDetails,
    };

    switch (method) {
      case WS_CONSTANTS.METHODS.ETH_SUBSCRIBE:
        response = await handleEthSubscribe({ ...sharedParams });
        break;
      case WS_CONSTANTS.METHODS.ETH_UNSUBSCRIBE:
        response = handleEthUnsubscribe({ ...sharedParams });
        break;
      default:
        // since unsupported methods have already been captured, the methods fall into this default block will always be valid and supported methods.
        response = await handleSendingRequestsToRelay({ ...sharedParams });
    }
  } catch (error: any) {
    logger.warn(
      error,
      `${requestDetails.formattedLogPrefix} Encountered error on connectionID: ${
        ctx.websocket.id
      }, method: ${method}, params: ${JSON.stringify(params)}`,
    );

    let jsonRpcError: JsonRpcError;
    if (error instanceof JsonRpcError) {
      jsonRpcError = error;
    } else {
      jsonRpcError = predefined.INTERNAL_ERROR(JSON.stringify(error.message || error));
    }

    response = jsonResp(request.id, jsonRpcError, undefined);
  }

  return response;
};
