// SPDX-License-Identifier: Apache-2.0

import { RelayImpl } from '@hashgraph/json-rpc-relay';
import { ITracerConfig, RequestDetails } from '@hashgraph/json-rpc-relay/dist/lib/types';
import pino from 'pino';

import KoaJsonRpc from '../koaJsonRpc';
import { logAndHandleResponse } from '../utils';
import { TracerType, TYPES } from '../validator';

const defineDebugRoutes = function (app: KoaJsonRpc, relay: RelayImpl, logger: pino.Logger) {
  /**
   * Returns all traces of a given transaction.
   *
   * @param hex
   * @param tracer type
   * @returns transaction info
   */
  app.useRpc('debug_traceTransaction', async (params: any) => {
    return logAndHandleResponse(
      'debug_traceTransaction',
      params,
      (requestDetails: RequestDetails) => {
        const transactionIdOrHash = params[0];
        let tracer: TracerType = TracerType.OpcodeLogger;
        let tracerConfig: ITracerConfig = {};

        // Second param can be either a TracerType string, or an object for TracerConfig or TracerConfigWrapper
        if (TYPES.tracerType.test(params[1])) {
          tracer = params[1];
          if (TYPES.tracerConfig.test(params[2])) {
            tracerConfig = params[2];
          }
        } else if (TYPES.tracerConfig.test(params[1])) {
          tracerConfig = params[1];
        } else if (TYPES.tracerConfigWrapper.test(params[1])) {
          if (TYPES.tracerType.test(params[1].tracer)) {
            tracer = params[1].tracer;
          }
          if (TYPES.tracerConfig.test(params[1].tracerConfig)) {
            tracerConfig = params[1].tracerConfig;
          }
        }

        return relay.debug().traceTransaction(transactionIdOrHash, tracer, tracerConfig, requestDetails);
      },
      app,
      logger,
    );
  });
};

export { defineDebugRoutes };
