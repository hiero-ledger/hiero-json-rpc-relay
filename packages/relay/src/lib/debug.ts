// SPDX-License-Identifier: Apache-2.0

import { ConfigService } from '@hashgraph/json-rpc-config-service/dist/services';
import type { Logger } from 'pino';

import { decodeErrorMessage, mapKeysAndValues, numberTo0x, strip0x } from '../formatters';
import { type Debug } from '../index';
import { MirrorNodeClient } from './clients';
import { IOpcode } from './clients/models/IOpcode';
import { IOpcodesResponse } from './clients/models/IOpcodesResponse';
import constants, { CallType, TracerType } from './constants';
import { cache, RPC_LAYOUT, rpcMethod, rpcParamLayoutConfig, rpcParamValidationRules } from './decorators';
import { predefined } from './errors/JsonRpcError';
import { CommonService } from './services';
import { CACHE_LEVEL, CacheService } from './services/cacheService/cacheService';
import {
  BlockTracerConfig,
  CallTracerResult,
  EntityTraceStateMap,
  ICallTracerConfig,
  IOpcodeLoggerConfig,
  MirrorNodeContractResult,
  ParamType,
  RequestDetails,
  TraceBlockByNumberTxResult,
  TransactionTracerConfig,
} from './types';

/**
 * Represents a DebugService for tracing and debugging transactions.
 *
 * @class
 * @implements {Debug}
 */
export class DebugImpl implements Debug {
  static debugTraceTransaction = 'debug_traceTransaction';
  static traceBlockByNumber = 'debug_traceBlockByNumber';
  static zeroHex = '0x0';

  /**
   * The interface through which we interact with the mirror node.
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
   * The cacheService containing useful functions
   * @private
   */
  private readonly cacheService: CacheService;

  /**
   * Creates an instance of DebugImpl.
   *
   * @constructor
   * @param {MirrorNodeClient} mirrorNodeClient - The client for interacting with the mirror node.
   * @param {Logger} logger - The logger used for logging output from this class.
   * @param {CacheService} cacheService - Service for managing cached data.
   */
  constructor(mirrorNodeClient: MirrorNodeClient, logger: Logger, cacheService: CacheService) {
    this.logger = logger;
    this.common = new CommonService(mirrorNodeClient, logger, cacheService);
    this.mirrorNodeClient = mirrorNodeClient;
    this.cacheService = cacheService;
  }

  /**
   * Checks if the Debug API is enabled
   * @public
   */
  static requireDebugAPIEnabled(): void {
    if (!ConfigService.get('DEBUG_API_ENABLED')) {
      throw predefined.UNSUPPORTED_METHOD;
    }
  }

  /**
   * Trace a transaction for debugging purposes.
   *
   * @async
   * @rpcMethod Exposed as debug_traceTransaction RPC endpoint
   * @rpcParamValidationRules Applies JSON-RPC parameter validation according to the API specification
   *
   * @param {string} transactionIdOrHash - The ID or hash of the transaction to be traced.
   * @param {TracerType} tracer - The type of tracer to use (either 'CallTracer' or 'OpcodeLogger').
   * @param {ITracerConfig} tracerConfig - The configuration object for the tracer.
   * @param {RequestDetails} requestDetails - The request details for logging and tracking.
   * @throws {Error} Throws an error if the specified tracer type is not supported or if an exception occurs during the trace.
   * @returns {Promise<any>} A Promise that resolves to the result of the trace operation.
   *
   * @example
   * const result = await traceTransaction('0x123abc', TracerType.CallTracer, {"tracerConfig": {"onlyTopCall": false}}, some request id);
   */
  @rpcMethod
  @rpcParamValidationRules({
    0: { type: ParamType.TRANSACTION_HASH_OR_ID, required: true },
    1: { type: ParamType.TRACER_CONFIG_WRAPPER, required: false },
  })
  @rpcParamLayoutConfig(RPC_LAYOUT.custom((params) => [params[0], params[1]]))
  @cache(CacheService.getInstance(CACHE_LEVEL.L1))
  async traceTransaction(
    transactionIdOrHash: string,
    tracerObject: TransactionTracerConfig,
    requestDetails: RequestDetails,
  ): Promise<any> {
    if (tracerObject?.tracer === TracerType.PrestateTracer) {
      throw predefined.INVALID_PARAMETER(1, 'Prestate tracer is not yet supported on debug_traceTransaction');
    }

    if (this.logger.isLevelEnabled('trace')) {
      this.logger.trace(`${requestDetails.formattedRequestId} traceTransaction(${transactionIdOrHash})`);
    }

    //we use a wrapper since we accept a transaction where a second param with tracer/tracerConfig may not be provided
    //and we will still default to opcodeLogger
    const tracer = tracerObject?.tracer ?? TracerType.OpcodeLogger;
    const tracerConfig = tracerObject?.tracerConfig ?? {};

    try {
      DebugImpl.requireDebugAPIEnabled();
      if (tracer === TracerType.CallTracer) {
        return await this.callTracer(transactionIdOrHash, tracerConfig as ICallTracerConfig, requestDetails);
      }

      if (!ConfigService.get('OPCODELOGGER_ENABLED')) {
        throw predefined.UNSUPPORTED_METHOD;
      }
      return await this.callOpcodeLogger(transactionIdOrHash, tracerConfig as IOpcodeLoggerConfig, requestDetails);
    } catch (e) {
      throw this.common.genericErrorHandler(e);
    }
  }

  /**
   * Trace a block by its number for debugging purposes.
   *
   * @async
   * @rpcMethod Exposed as debug_traceBlockByNumber RPC endpoint
   * @rpcParamValidationRules Applies JSON-RPC parameter validation according to the API specification
   *
   * @param {string} blockNumber - The block number to be traced (in hex format or as a tag like 'latest').
   * @param {BlockTracerConfig} tracerObject - The configuration wrapper containing tracer type and config.
   * @param {RequestDetails} requestDetails - The request details for logging and tracking.
   * @throws {Error} Throws an error if the debug API is not enabled or if an exception occurs during the trace.
   * @returns {Promise<any>} A Promise that resolves to the result of the block trace operation.
   *
   * @example
   * const result = await traceBlockByNumber('0x1234', { tracer: TracerType.CallTracer, tracerConfig: { onlyTopCall: false } }, requestDetails);
   */
  @rpcMethod
  @rpcParamValidationRules({
    0: { type: ParamType.BLOCK_NUMBER, required: true },
    1: { type: ParamType.TRACER_CONFIG_WRAPPER, required: false },
  })
  @rpcParamLayoutConfig(RPC_LAYOUT.custom((params) => [params[0], params[1]]))
  @cache(CacheService.getInstance(CACHE_LEVEL.L1), {
    skipParams: [{ index: '0', value: constants.NON_CACHABLE_BLOCK_PARAMS }],
  })
  async traceBlockByNumber(
    blockNumber: string,
    tracerObject: BlockTracerConfig,
    requestDetails: RequestDetails,
  ): Promise<TraceBlockByNumberTxResult[]> {
    if (this.logger.isLevelEnabled('trace')) {
      this.logger.trace(
        `${
          requestDetails.formattedRequestId
        } traceBlockByNumber(blockNumber=${blockNumber}, tracerObject=${JSON.stringify(tracerObject)})`,
      );
    }

    try {
      DebugImpl.requireDebugAPIEnabled();
      const blockResponse = await this.common.getHistoricalBlockResponse(requestDetails, blockNumber, true);

      if (blockResponse == null) throw predefined.RESOURCE_NOT_FOUND(`Block ${blockNumber} not found`);

      const timestampRangeParams = [`gte:${blockResponse.timestamp.from}`, `lte:${blockResponse.timestamp.to}`];

      const contractResults: MirrorNodeContractResult[] = await this.mirrorNodeClient.getContractResultWithRetry(
        this.mirrorNodeClient.getContractResults.name,
        [requestDetails, { timestamp: timestampRangeParams }, undefined],
        requestDetails,
      );

      if (contractResults == null || contractResults.length === 0) {
        // return empty array if no EthereumTransaction typed transactions found in the block
        return [];
      }

      let tracer: TracerType = TracerType.CallTracer;
      let onlyTopCall;

      if (tracerObject) {
        tracer = tracerObject.tracer;
        onlyTopCall = tracerObject.tracerConfig?.onlyTopCall;
      }

      if (tracer === TracerType.CallTracer) {
        const result = await Promise.all(
          contractResults
            // filter out transactions with wrong nonce since they do not reach consensus
            .filter((contractResult) => contractResult.result !== 'WRONG_NONCE')
            .map(async (contractResult) => {
              return {
                txHash: contractResult.hash,
                result: await this.callTracer(
                  contractResult.hash,
                  { onlyTopCall } as ICallTracerConfig,
                  requestDetails,
                ),
              };
            }),
        );

        return result;
      }

      if (tracer === TracerType.PrestateTracer) {
        const result = await Promise.all(
          contractResults
            // filter out transactions with wrong nonce since they do not reach consensus
            .filter((contractResult) => contractResult.result !== 'WRONG_NONCE')
            .map(async (contractResult) => {
              return {
                txHash: contractResult.hash,
                result: await this.prestateTracer(contractResult.hash, onlyTopCall, requestDetails),
              };
            }),
        );

        return result;
      }

      return [];
    } catch (error) {
      throw this.common.genericErrorHandler(error);
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
      DebugImpl.debugTraceTransaction,
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

  async resolveMultipleAddresses(
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
  async callOpcodeLogger(
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

      if (!response) {
        throw predefined.RESOURCE_NOT_FOUND(
          `Failed to retrieve contract results for transaction ${transactionIdOrHash}`,
        );
      }

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
  async callTracer(
    transactionHash: string,
    tracerConfig: ICallTracerConfig,
    requestDetails: RequestDetails,
  ): Promise<CallTracerResult | null> {
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

      // return empty array if no actions
      if (actionsResponse.length === 0) return null;

      const { call_type: type } = actionsResponse[0];
      const formattedActions = await this.formatActionsResult(actionsResponse, requestDetails);

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

      const value = amount === 0 ? DebugImpl.zeroHex : numberTo0x(amount);
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
        calls: tracerConfig?.onlyTopCall || actionsResponse.length === 1 ? undefined : formattedActions.slice(1),
      };
    } catch (e) {
      throw this.common.genericErrorHandler(e);
    }
  }

  /**
   * Retrieves the pre-state information for contracts and accounts involved in a transaction.
   * This tracer collects the state (balance, nonce, code, and storage) of all accounts and
   * contracts just before the transaction execution.
   *
   * @async
   * @param {string} transactionHash - The hash of the transaction to trace.
   * @param {boolean} onlyTopCall - When true, only includes accounts involved in top-level calls.
   * @param {RequestDetails} requestDetails - Details for request tracking and logging.
   * @returns {Promise<object>} A Promise that resolves to an object containing the pre-state information.
   *                           The object keys are EVM addresses, and values contain balance, nonce, code, and storage data.
   * @throws {Error} Throws a RESOURCE_NOT_FOUND error if contract results cannot be retrieved.
   */
  async prestateTracer(
    transactionHash: string,
    onlyTopCall: boolean = false,
    requestDetails: RequestDetails,
  ): Promise<EntityTraceStateMap> {
    // Try to get cached result first
    const cacheKey = `${constants.CACHE_KEY.PRESTATE_TRACER}_${transactionHash}_${onlyTopCall}`;

    const cachedResult = await this.cacheService.getAsync(cacheKey, this.prestateTracer.name, requestDetails);
    if (cachedResult) {
      return cachedResult;
    }

    // Get transaction actions
    const actionsResponse = await this.mirrorNodeClient.getContractsResultsActions(transactionHash, requestDetails);
    if (!actionsResponse) {
      throw predefined.RESOURCE_NOT_FOUND(`Failed to retrieve contract results for transaction ${transactionHash}`);
    }

    // Filter by call_depth if onlyTopCall is true
    const filteredActions = onlyTopCall ? actionsResponse.filter((action) => action.call_depth === 0) : actionsResponse;

    // Extract unique addresses involved in the transaction with their metadata
    const addressMap = new Map();
    filteredActions.forEach((action) => {
      if (action.from) {
        addressMap.set(action.from, {
          address: action.from,
          type: action.caller_type,
          timestamp: action.timestamp,
        });
      }

      if (action.to) {
        addressMap.set(action.to, {
          address: action.to,
          type: action.recipient_type,
          timestamp: action.timestamp,
        });
      }
    });

    // Return empty result if no accounts are involved
    const accountEntities = Array.from(addressMap.values());
    if (accountEntities.length === 0) return {};

    const result: EntityTraceStateMap = {};

    await Promise.all(
      accountEntities.map(async (accountEntity) => {
        try {
          // Resolve entity type (contract or account)
          const entityObject = await this.mirrorNodeClient.resolveEntityType(
            accountEntity.address,
            DebugImpl.debugTraceTransaction,
            requestDetails,
            [accountEntity.type],
            1,
            accountEntity.timestamp,
          );

          if (!entityObject || !entityObject.entity?.evm_address) return;

          const evmAddress = entityObject.entity.evm_address;

          // Process based on entity type
          if (entityObject.type === constants.TYPE_CONTRACT) {
            const contractId = entityObject.entity.contract_id;

            // Fetch balance and state concurrently
            const [balanceResponse, stateResponse] = await Promise.all([
              this.mirrorNodeClient.getBalanceAtTimestamp(contractId, requestDetails, accountEntity.timestamp),
              this.mirrorNodeClient.getContractState(contractId, requestDetails, accountEntity.timestamp),
            ]);

            // Build storage map from state items
            const storageMap = stateResponse.reduce((map, stateItem) => {
              map[stateItem.slot] = stateItem.value;
              return map;
            }, {});

            // Add contract data to result
            result[evmAddress] = {
              balance: numberTo0x(balanceResponse.balances[0]?.balance || '0'),
              nonce: entityObject.entity.nonce,
              code: entityObject.entity.runtime_bytecode,
              storage: storageMap,
            };
          } else if (entityObject.type === constants.TYPE_ACCOUNT) {
            result[evmAddress] = {
              balance: numberTo0x(entityObject.entity.balance?.balance || '0'),
              nonce: entityObject.entity.ethereum_nonce,
              code: '0x',
              storage: {},
            };
          }
        } catch (error) {
          this.logger.error(
            `Error processing entity ${accountEntity.address} for transaction ${transactionHash}: ${error}`,
          );
        }
      }),
    );

    // Cache the result before returning
    await this.cacheService.set(cacheKey, result, this.prestateTracer.name, requestDetails);
    return result;
  }
}
