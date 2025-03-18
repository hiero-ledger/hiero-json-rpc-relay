// SPDX-License-Identifier: Apache-2.0

import { ConfigService } from '@hashgraph/json-rpc-config-service/dist/services';
import type { Logger } from 'pino';

import { decodeErrorMessage, mapKeysAndValues, numberTo0x, strip0x } from '../formatters';
import { type Debug, rpc } from '../index';
import type { MirrorNodeClient } from './clients';
import { IOpcode } from './clients/models/IOpcode';
import { IOpcodesResponse } from './clients/models/IOpcodesResponse';
import constants, { CallType, TracerType } from './constants';
import { predefined } from './errors/JsonRpcError';
import { EthImpl } from './eth';
import type { CommonService } from './services/ethService';
import { ICallTracerConfig, IOpcodeLoggerConfig, ITracerConfig, RequestDetails } from './types';

/**
 * Represents a DebugService for tracing and debugging transactions and debugging
 *
 * @class
 * @implements {IDebugService}
 */
export class DebugImpl implements Debug {
  /**
   * The interface through which we interact with the mirror node
   * @private
   */
  private readonly mirrorNodeClient: MirrorNodeClient;

  /**
   * The logger used for logging all output from this class.
   * @private
   */
  private readonly logger: Logger;

  /**
   * The commonService containing useful functions
   * @private
   */
  private readonly common: CommonService;

  /**
   * Creates an instance of DebugService.
   *
   * @constructor
   * @param {MirrorNodeClient} mirrorNodeClient - The client for interacting with the mirror node.
   * @param {Logger} logger - The logger used for logging output from this class.
   * @param {CommonService} common - The common service containing useful functions.
   */
  constructor(mirrorNodeClient: MirrorNodeClient, logger: Logger, common: CommonService) {
    this.logger = logger;
    this.common = common;
    this.mirrorNodeClient = mirrorNodeClient;
  }

  /**
   * Checks if the Debug API is enabled
   * @public
   */
  public static readonly isDebugAPIEnabled = ConfigService.get('DEBUG_API_ENABLED');

  static requireDebugAPIEnabled(): void {
    if (!ConfigService.get('DEBUG_API_ENABLED')) {
      throw predefined.UNSUPPORTED_METHOD;
    }
  }

  /**
   * Trace a transaction for debugging purposes.
   *
   * @async
   * @param {string} transactionIdOrHash - The ID or hash of the transaction to be traced.
   * @param {TracerType} tracer - The type of tracer to use (either 'CallTracer' or 'OpcodeLogger').
   * @param {ITracerConfig} tracerConfig - The configuration object for the tracer.
   * @param {RequestDetails} requestDetails - The request details for logging and tracking.
   * @throws {Error} Throws an error if the specified tracer type is not supported or if an exception occurs during the trace.
   * @returns {Promise<any>} A Promise that resolves to the result of the trace operation.
   *
   * @example
   * const result = await debug_traceTransaction('0x123abc', TracerType.CallTracer, {"tracerConfig": {"onlyTopCall": false}}, some request id);
   */
  @rpc
  async traceTransaction(
    transactionIdOrHash: string,
    tracer: TracerType,
    tracerConfig: ITracerConfig,
    requestDetails: RequestDetails,
  ): Promise<any> {
    if (this.logger.isLevelEnabled('trace')) {
      this.logger.trace(`${requestDetails.formattedRequestId} debug_traceTransaction(${transactionIdOrHash})`);
    }
    try {
      DebugImpl.requireDebugAPIEnabled();
      if (tracer === TracerType.CallTracer) {
        return await this.callTracer(transactionIdOrHash, tracerConfig as ICallTracerConfig, requestDetails);
      } else if (tracer === TracerType.OpcodeLogger) {
        return await this.callOpcodeLogger(transactionIdOrHash, tracerConfig as IOpcodeLoggerConfig, requestDetails);
      }
    } catch (e) {
      throw this.common.genericErrorHandler(e);
    }
  }

  /**
   * Formats the result from the actions endpoint to the expected response
   *
   * @async
   * @param {any} result - The response from the actions endpoint.
   * @param {RequestDetails} requestDetails - The request details for logging and tracking.
   * @returns {Promise<[] | any>} The formatted actions response in an array.
   */
  async formatActionsResult(result: any, requestDetails: RequestDetails): Promise<[] | any> {
    return await Promise.all(
      result.map(async (action, index) => {
        const { resolvedFrom, resolvedTo } = await this.resolveMultipleAddresses(
          action.from,
          action.to,
          requestDetails,
        );

        // The actions endpoint does not return input and output for the calls so we get them from another endpoint
        // The first one is excluded because we take its input and output from the contracts/results/{transactionIdOrHash} endpoint
        const contract =
          index !== 0 && action.call_operation_type === CallType.CREATE
            ? await this.mirrorNodeClient.getContract(action.to, requestDetails)
            : undefined;

        return {
          type: action.call_operation_type,
          from: resolvedFrom,
          to: resolvedTo,
          gas: numberTo0x(action.gas),
          gasUsed: numberTo0x(action.gas_used),
          input: contract?.bytecode ?? action.input,
          output: contract?.runtime_bytecode ?? action.result_data,
          value: numberTo0x(action.value),
        };
      }),
    );
  }

  /**
   * Formats the result from the opcodes endpoint to the expected
   * response for the debug_traceTransaction method.
   *
   * @async
   * @param {IOpcodesResponse | null} result - The response from mirror node.
   * @param {object} options - The options used for the opcode tracer.
   * @returns {Promise<object>} The formatted opcode response.
   */
  async formatOpcodesResult(
    result: IOpcodesResponse | null,
    options: { memory?: boolean; stack?: boolean; storage?: boolean },
  ): Promise<object> {
    if (!result) {
      return {
        gas: 0,
        failed: true,
        returnValue: '',
        structLogs: [],
      };
    }
    const { gas, failed, return_value, opcodes } = result;

    return {
      gas,
      failed,
      returnValue: return_value ? strip0x(return_value) : '',
      structLogs: opcodes?.map((opcode: IOpcode) => {
        return {
          pc: opcode.pc,
          op: opcode.op,
          gas: opcode.gas,
          gasCost: opcode.gas_cost,
          depth: opcode.depth,
          stack: options.stack ? opcode.stack?.map(strip0x) || [] : null,
          memory: options.memory ? opcode.memory?.map(strip0x) || [] : null,
          storage: options.storage ? mapKeysAndValues(opcode.storage ?? {}, { key: strip0x, value: strip0x }) : null,
          reason: opcode.reason ? strip0x(opcode.reason) : null,
        };
      }),
    };
  }

  /**
   * Returns an address' evm equivalence.
   *
   * @async
   * @param {string} address - The address to be resolved.
   * @param {[string]} types - The possible types of the address.
   * @param {RequestDetails} requestDetails - The request details for logging and tracking.
   * @returns {Promise<string>} The address returned as an EVM address.
   */
  async resolveAddress(
    address: string,
    requestDetails: RequestDetails,
    types: string[] = [constants.TYPE_CONTRACT, constants.TYPE_TOKEN, constants.TYPE_ACCOUNT],
  ): Promise<string> {
    // if the address is null or undefined we return it as is
    if (!address) return address;

    const entity = await this.mirrorNodeClient.resolveEntityType(
      address,
      'debugTraceTransaction',
      requestDetails,
      types,
    );

    if (
      entity &&
      (entity.type === constants.TYPE_CONTRACT || entity.type === constants.TYPE_ACCOUNT) &&
      entity.entity?.evm_address
    ) {
      return entity.entity.evm_address;
    }

    return address;
  }

  private async resolveMultipleAddresses(
    from: string,
    to: string,
    requestDetails: RequestDetails,
  ): Promise<{ resolvedFrom: string; resolvedTo: string }> {
    const [resolvedFrom, resolvedTo] = await Promise.all([
      this.resolveAddress(from, requestDetails, [
        constants.TYPE_CONTRACT,
        constants.TYPE_TOKEN,
        constants.TYPE_ACCOUNT,
      ]),
      this.resolveAddress(to, requestDetails, [constants.TYPE_CONTRACT, constants.TYPE_TOKEN, constants.TYPE_ACCOUNT]),
    ]);

    return { resolvedFrom, resolvedTo };
  }

  /**
   * Returns the final formatted response for opcodeLogger config.
   * @async
   * @param {string} transactionIdOrHash - The ID or hash of the transaction to be debugged.
   * @param {IOpcodeLoggerConfig} tracerConfig - The tracer config to be used.
   * @param {boolean} tracerConfig.enableMemory - Whether to enable memory.
   * @param {boolean} tracerConfig.disableStack - Whether to disable stack.
   * @param {boolean} tracerConfig.disableStorage - Whether to disable storage.
   * @param {RequestDetails} requestDetails - The request details for logging and tracking.
   * @returns {Promise<object>} The formatted response.
   */
  private async callOpcodeLogger(
    transactionIdOrHash: string,
    tracerConfig: IOpcodeLoggerConfig,
    requestDetails: RequestDetails,
  ): Promise<object> {
    try {
      const options = {
        memory: !!tracerConfig.enableMemory,
        stack: !tracerConfig.disableStack,
        storage: !tracerConfig.disableStorage,
      };
      const response = await this.mirrorNodeClient.getContractsResultsOpcodes(
        transactionIdOrHash,
        requestDetails,
        options,
      );
      return await this.formatOpcodesResult(response, options);
    } catch (e) {
      throw this.common.genericErrorHandler(e);
    }
  }

  /**
   * Returns the final formatted response for callTracer config.
   *
   * @async
   * @param {string} transactionHash - The hash of the transaction to be debugged.
   * @param {ICallTracerConfig} tracerConfig - The tracer config to be used.
   * @param {RequestDetails} requestDetails - The request details for logging and tracking.
   * @returns {Promise<object>} The formatted response.
   */
  private async callTracer(
    transactionHash: string,
    tracerConfig: ICallTracerConfig,
    requestDetails: RequestDetails,
  ): Promise<object> {
    try {
      const [actionsResponse, transactionsResponse] = await Promise.all([
        this.mirrorNodeClient.getContractsResultsActions(transactionHash, requestDetails),
        this.mirrorNodeClient.getContractResultWithRetry(
          this.mirrorNodeClient.getContractResult.name,
          [transactionHash, requestDetails],
          requestDetails,
        ),
      ]);
      if (!actionsResponse || !transactionsResponse) {
        throw predefined.RESOURCE_NOT_FOUND(`Failed to retrieve contract results for transaction ${transactionHash}`);
      }

      const { call_type: type } = actionsResponse.actions[0];
      const formattedActions = await this.formatActionsResult(actionsResponse.actions, requestDetails);

      const {
        from,
        to,
        amount,
        gas_limit: gas,
        gas_used: gasUsed,
        function_parameters: input,
        call_result: output,
        error_message: error,
        result,
      } = transactionsResponse;

      const { resolvedFrom, resolvedTo } = await this.resolveMultipleAddresses(from, to, requestDetails);

      const value = amount === 0 ? EthImpl.zeroHex : numberTo0x(amount);
      const errorResult = result !== constants.SUCCESS ? result : undefined;

      return {
        type,
        from: resolvedFrom,
        to: resolvedTo,
        value,
        gas: numberTo0x(gas),
        gasUsed: numberTo0x(gasUsed),
        input,
        output: result !== constants.SUCCESS ? error : output,
        ...(result !== constants.SUCCESS && { error: errorResult }),
        ...(result !== constants.SUCCESS && { revertReason: decodeErrorMessage(error) }),
        // if we have more than one call executed during the transactions we would return all calls
        // except the first one in the sub-calls array,
        // therefore we need to exclude the first one from the actions response
        calls:
          tracerConfig?.onlyTopCall || actionsResponse.actions.length === 1 ? undefined : formattedActions.slice(1),
      };
    } catch (e) {
      throw this.common.genericErrorHandler(e);
    }
  }
}
