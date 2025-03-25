// SPDX-License-Identifier: Apache-2.0

import { JsonRpcError, MirrorNodeClientError, predefined } from '@hashgraph/json-rpc-relay';
import pino from 'pino';

import KoaJsonRpc from './koaJsonRpc';
import { Validator } from './validator';

/**
 * Receives the request, validates it, and returns the response
 * if it succeeds, otherwise throws a json rpc error.
 *
 * @param methodName
 * @param methodParams
 * @param methodFunction
 * @param app
 * @param logger
 */
const logAndHandleResponse = async (
  methodName: string,
  methodParams: any[],
  methodFunction: any,
  app: KoaJsonRpc,
  logger: pino.Logger,
) => {
  const requestDetails = app.getRequestDetails();

  try {
    const methodValidations = Validator.METHODS[methodName];
    if (methodValidations) {
      if (logger.isLevelEnabled('debug')) {
        logger.debug(
          `${
            requestDetails.formattedRequestId
          } Validating method parameters for ${methodName}, params: ${JSON.stringify(methodParams)}`,
        );
      }
      Validator.validateParams(methodParams, methodValidations);
    }

    const response = await methodFunction(requestDetails);
    if (response instanceof JsonRpcError) {
      // log error only if it is not a contract revert, otherwise log it as debug
      if (response.code === predefined.CONTRACT_REVERT().code) {
        if (logger.isLevelEnabled('debug')) {
          logger.debug(`${requestDetails.formattedRequestId} ${response.message}`);
        }
      } else {
        logger.error(`${requestDetails.formattedRequestId} ${response.message}`);
      }

      return new JsonRpcError(
        {
          code: response.code,
          message: response.message,
          data: response.data,
        },
        requestDetails.requestId,
      );
    }
    return response;
  } catch (e: any) {
    let error = predefined.INTERNAL_ERROR();
    if (e instanceof MirrorNodeClientError) {
      if (e.isTimeout()) {
        error = predefined.REQUEST_TIMEOUT;
      }
    } else if (e instanceof JsonRpcError) {
      error = e;
    } else {
      logger.error(`${requestDetails.formattedRequestId} ${e.message}`);
    }

    logger.error(`${requestDetails.formattedRequestId} ${error.message}`);
    return new JsonRpcError(
      {
        code: error.code,
        message: error.message,
        data: error.data,
      },
      requestDetails.requestId,
    );
  }
};

export { logAndHandleResponse };
