// SPDX-License-Identifier: Apache-2.0

import { ConfigService } from '@hashgraph/json-rpc-config-service/dist/services';
import type { Logger } from 'pino';

import { decodeErrorMessage, mapKeysAndValues, numberTo0x, prepend0x, strip0x } from '../formatters';
import { type Debug } from '../index';
import { MirrorNodeClient } from './clients';
import { IOpcode } from './clients/models/IOpcode';
import { IOpcodesResponse } from './clients/models/IOpcodesResponse';
import constants, { CallType, TracerType } from './constants';
import { cache, RPC_LAYOUT, rpcMethod, rpcParamLayoutConfig } from './decorators';
import { predefined } from './errors/JsonRpcError';
import { CommonService } from './services';
import type { CacheService } from './services/cacheService/cacheService';
import {
  BlockTracerConfig,
  CallTracerResult,
  EntityTraceStateMap,
  ICallTracerConfig,
  IOpcodeLoggerConfig,
  OpcodeLoggerResult,
  RequestDetails,
  TraceBlockByNumberTxResult,
  TransactionTracerConfig,
} from './types';
import { rpcParamValidationRules } from './validators';

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
    0: { type: 'transactionHash', required: true },
    1: { type: 'tracerConfigWrapper', required: false },
  })
  @rpcParamLayoutConfig(RPC_LAYOUT.custom((params) => [params[0], params[1]]))
  @cache()
  async traceTransaction(
    transactionIdOrHash: string,
    tracerObject: TransactionTracerConfig,
    requestDetails: RequestDetails,
  ): Promise<any> {
    //we use a wrapper since we accept a transaction where a second param with tracer/tracerConfig may not be provided
    //and we will still default to opcodeLogger
    const tracer = tracerObject?.tracer ?? TracerType.OpcodeLogger;

    // Extract tracer config from either nested tracerConfig or top-level properties
    let tracerConfig = tracerObject?.tracerConfig ?? {};

    // If no nested tracerConfig is provided AND no tracer is explicitly set,
    // check for top-level opcodeLogger config properties (defaults to opcodeLogger)
    if (!tracerObject?.tracerConfig && !tracerObject?.tracer && tracerObject) {
      const topLevelConfig = Object.fromEntries(
        Object.entries(tracerObject).filter(([key]) => key !== 'tracer' && key !== 'tracerConfig'),
      );
      // Only include valid opcodeLogger config properties
      const validOpcodeLoggerKeys = ['enableMemory', 'disableStack', 'disableStorage', 'fullStorage'];
      const filteredConfig = Object.keys(topLevelConfig)
        .filter((key) => validOpcodeLoggerKeys.includes(key))
        .reduce((obj, key) => {
          // Filter out non-standard parameters that shouldn't be passed to the actual tracer
          if (key !== 'fullStorage') {
            obj[key] = topLevelConfig[key];
          }
          return obj;
        }, {} as any);

      if (Object.keys(filteredConfig).length > 0) {
        tracerConfig = filteredConfig;
      }
    }

    try {
      DebugImpl.requireDebugAPIEnabled();
      if (tracer === TracerType.CallTracer) {
        return await this.callTracer(transactionIdOrHash, tracerConfig as ICallTracerConfig, requestDetails);
      }

      if (tracer === TracerType.PrestateTracer) {
        const onlyTopCall = (tracerConfig as ICallTracerConfig)?.onlyTopCall ?? false;
        return await this.prestateTracer(transactionIdOrHash, onlyTopCall, requestDetails);
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
    0: { type: 'blockNumber', required: true },
    1: { type: 'tracerConfigWrapper', required: false },
  })
  @rpcParamLayoutConfig(RPC_LAYOUT.custom((params) => [params[0], params[1]]))
  @cache({
    skipParams: [{ index: '0', value: constants.NON_CACHABLE_BLOCK_PARAMS }],
  })
  async traceBlockByNumber(
    blockNumber: string,
    tracerObject: BlockTracerConfig,
    requestDetails: RequestDetails,
  ): Promise<TraceBlockByNumberTxResult[]> {
    try {
      DebugImpl.requireDebugAPIEnabled();
      const blockResponse = await this.common.getHistoricalBlockResponse(requestDetails, blockNumber, true);

      if (blockResponse == null) throw predefined.RESOURCE_NOT_FOUND(`Block ${blockNumber} not found`);

      // Get ALL transaction hashes (EVM + synthetic)
      const transactionHashes = await this.getAllTransactionHashesFromBlock(blockResponse, requestDetails);

      if (transactionHashes.length === 0) {
        return [];
      }

      const tracer = tracerObject?.tracer ?? TracerType.CallTracer;
      const onlyTopCall = tracerObject?.tracerConfig?.onlyTopCall;

      // Trace all transactions using existing tracer methods
      if (tracer === TracerType.CallTracer) {
        return await Promise.all(
          transactionHashes.map(async (txHash) => ({
            txHash,
            result: await this.callTracer(txHash, { onlyTopCall }, requestDetails),
          })),
        );
      }

      if (tracer === TracerType.PrestateTracer) {
        return await Promise.all(
          transactionHashes.map(async (txHash) => ({
            txHash,
            result: await this.prestateTracer(txHash, onlyTopCall, requestDetails),
          })),
        );
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
          index !== 0 &&
          (action.call_operation_type === CallType.CREATE || action.call_operation_type === CallType.CREATE2) &&
          action.to
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
   * @returns {Promise<OpcodeLoggerResult>} The formatted opcode response.
   */
  async formatOpcodesResult(
    result: IOpcodesResponse | null,
    options: { memory?: boolean; stack?: boolean; storage?: boolean },
  ): Promise<OpcodeLoggerResult> {
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
   * @returns {Promise<OpcodeLoggerResult>} The formatted response.
   */
  async callOpcodeLogger(
    transactionIdOrHash: string,
    tracerConfig: IOpcodeLoggerConfig,
    requestDetails: RequestDetails,
  ): Promise<OpcodeLoggerResult> {
    try {
      const options = {
        memory: !!tracerConfig.enableMemory,
        stack: !tracerConfig.disableStack,
        storage: !tracerConfig.disableStorage,
      };

      let response: any = null;

      try {
        response = await this.mirrorNodeClient.getContractsResultsOpcodes(transactionIdOrHash, requestDetails, options);
      } catch (e: any) {
        // If contract result not found (404), treat as potential synthetic transaction
        // and allow fallback to handleSyntheticTransaction
        if (e?.code === -32001 || e?.message?.includes('not found') || e?.isNotFound?.()) {
          this.logger.debug(
            `Opcodes not found for transaction ${transactionIdOrHash}, attempting synthetic transaction handling`,
          );
        } else {
          throw e;
        }
      }

      if (!response) {
        return (await this.handleSyntheticTransaction(
          transactionIdOrHash,
          TracerType.OpcodeLogger,
          requestDetails,
        )) as OpcodeLoggerResult;
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
  ): Promise<CallTracerResult> {
    try {
      let actionsResponse: any[] | null = null;
      let transactionsResponse: any = null;

      try {
        [actionsResponse, transactionsResponse] = await Promise.all([
          this.mirrorNodeClient.getContractsResultsActions(transactionHash, requestDetails),
          this.mirrorNodeClient.getContractResultWithRetry(this.mirrorNodeClient.getContractResult.name, [
            transactionHash,
            requestDetails,
          ]),
        ]);
      } catch (e: any) {
        // If contract result not found (404), treat as potential synthetic transaction
        // and allow fallback to handleSyntheticTransaction
        if (e?.code === -32001 || e?.message?.includes('not found') || e?.isNotFound?.()) {
          this.logger.debug(
            `Contract result not found for transaction ${transactionHash}, attempting synthetic transaction handling`,
          );
        } else {
          throw e;
        }
      }

      if (!actionsResponse || actionsResponse.length === 0 || !transactionsResponse) {
        return (await this.handleSyntheticTransaction(
          transactionHash,
          TracerType.CallTracer,
          requestDetails,
        )) as CallTracerResult;
      }

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
        calls: tracerConfig?.onlyTopCall || actionsResponse.length === 1 ? [] : formattedActions.slice(1),
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

    const cachedResult = await this.cacheService.getAsync(cacheKey, this.prestateTracer.name);
    if (cachedResult) {
      return cachedResult;
    }

    // Get transaction actions
    let actionsResponse: any[] | null = null;

    try {
      actionsResponse = await this.mirrorNodeClient.getContractsResultsActions(transactionHash, requestDetails);
    } catch (e: any) {
      // If contract result not found (404), treat as potential synthetic transaction
      // and allow fallback to handleSyntheticTransaction
      if (e?.code === -32001 || e?.message?.includes('not found') || e?.isNotFound?.()) {
        this.logger.debug(
          `Contract actions not found for transaction ${transactionHash}, attempting synthetic transaction handling`,
        );
      } else {
        throw e;
      }
    }

    if (!actionsResponse || actionsResponse.length === 0) {
      return (await this.handleSyntheticTransaction(
        transactionHash,
        TracerType.PrestateTracer,
        requestDetails,
      )) as EntityTraceStateMap;
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
            `Error processing entity %s for transaction %s: %s`,
            accountEntity.address,
            transactionHash,
            error,
          );
        }
      }),
    );

    // Cache the result before returning
    await this.cacheService.set(cacheKey, result, this.prestateTracer.name);
    return result;
  }

  /**
   * Retrieves all transaction hashes in a block (EVM + synthetic).
   *
   * @private
   * @param blockResponse - Block metadata with timestamp range
   * @param requestDetails - Request tracking details
   * @returns Array of unique transaction hashes in the block
   */
  private async getAllTransactionHashesFromBlock(
    blockResponse: { timestamp: { from: string; to: string } },
    requestDetails: RequestDetails,
  ): Promise<string[]> {
    const timestampRange = [`gte:${blockResponse.timestamp.from}`, `lte:${blockResponse.timestamp.to}`];

    // Fetch both contract results and all logs in the block in parallel
    const [contractResults, allLogs] = await Promise.all([
      this.mirrorNodeClient.getContractResultWithRetry(this.mirrorNodeClient.getContractResults.name, [
        requestDetails,
        { timestamp: timestampRange },
        undefined,
      ]),
      this.mirrorNodeClient.getContractResultsLogsWithRetry(requestDetails, { timestamp: timestampRange }),
    ]);

    // Collect all unique transaction hashes
    const transactionHashes = new Set<string>();

    // Add EVM transaction hashes (excluding WRONG_NONCE)
    contractResults?.filter((cr) => cr.result !== 'WRONG_NONCE').forEach((cr) => transactionHashes.add(cr.hash));

    // Capture synthetic HTS transaction hashes from logs
    allLogs?.forEach((log) => {
      if (log.transaction_hash) {
        transactionHashes.add(log.transaction_hash);
      }
    });

    return Array.from(transactionHashes);
  }

  /**
   * Handles synthetic HTS transactions by fetching logs and building
   * a minimal synthetic trace object for the appropriate trace.
   *
   * @private
   * @param transactionIdOrHash - The ID or hash of the transaction.
   * @param tracer - The tracer type to use for building the synthetic trace.
   * @param requestDetails - The request details for logging and tracking.
   * @returns The synthetic trace result.
   * @throws Throws RESOURCE_NOT_FOUND if no logs are found.
   */
  private async handleSyntheticTransaction(
    transactionIdOrHash: string,
    tracer: TracerType,
    requestDetails: RequestDetails,
  ): Promise<EntityTraceStateMap | OpcodeLoggerResult | CallTracerResult> {
    const logs = await this.common.getLogsWithParams(null, { 'transaction.hash': transactionIdOrHash }, requestDetails);

    if (logs.length === 0) {
      throw predefined.RESOURCE_NOT_FOUND(`Failed to retrieve transaction information for ${transactionIdOrHash}`);
    }

    const log = logs[0];
    switch (tracer) {
      case TracerType.PrestateTracer:
        // Return empty prestate tracer result for synthetic transactions (no EVM execution)
        return {};
      case TracerType.OpcodeLogger:
        // Return minimal opcode tracer result for synthetic transactions (no EVM execution)
        return {
          gas: 0,
          failed: false,
          returnValue: '',
          structLogs: [],
        };
      case TracerType.CallTracer: {
        let from = log.address;
        let to = log.address;

        // For HTS token transfer logs, the 'from' and 'to' addresses are typically in topics[1] and topics[2]
        if (log.topics && log.topics.length >= 3) {
          // Extract addresses from topics - topics are 32-byte hex strings, addresses are last 20 bytes
          from = prepend0x(log.topics[1].slice(-40));
          to = prepend0x(log.topics[2].slice(-40));
        }

        // Resolve addresses to their EVM equivalents
        const { resolvedFrom, resolvedTo } = await this.resolveMultipleAddresses(from, to, requestDetails);

        // Return minimal call tracer result for synthetic transactions (no EVM execution)
        return {
          type: CallType.CALL,
          from: resolvedFrom,
          to: resolvedTo,
          gas: numberTo0x(constants.TX_DEFAULT_GAS_DEFAULT),
          gasUsed: constants.ZERO_HEX,
          value: constants.ZERO_HEX,
          input: constants.EMPTY_HEX,
          output: constants.EMPTY_HEX,
          calls: [],
        };
      }
    }
  }
}
