// SPDX-License-Identifier: Apache-2.0

import { ConfigService } from '@hashgraph/json-rpc-config-service/dist/services';
import EventEmitter from 'events';
import type { Logger } from 'pino';
import { Registry } from 'prom-client';

import {
  decodeErrorMessage,
  mapKeysAndValues,
  numberTo0x,
  prepend0x,
  strip0x,
  tinybarsToWeibars,
  toHexString,
} from '../formatters';
import { type Debug } from '../index';
import { JsonRpcError } from '../index';
import { Utils } from '../utils';
import { MirrorNodeClient } from './clients';
import type { ICacheClient } from './clients/cache/ICacheClient';
import { IOpcode } from './clients/models/IOpcode';
import { IOpcodesResponse } from './clients/models/IOpcodesResponse';
import constants, { CallType, TracerType } from './constants';
import { cache, RPC_LAYOUT, rpcMethod, rpcParamLayoutConfig } from './decorators';
import { predefined } from './errors/JsonRpcError';
import { BlockFactory } from './factories/blockFactory';
import { Block } from './model';
import {
  BlockService,
  CommonService,
  IBlockService,
  LockService,
  TransactionPoolService,
  TransactionService,
} from './services';
import { ITransactionService } from './services/ethService/transactionService/ITransactionService';
import HAPIService from './services/hapiService/hapiService';
import {
  BlockTracerConfig,
  CallTracerResult,
  EntityTraceStateMap,
  ICallTracerConfig,
  IOpcodeLoggerConfig,
  OpcodeLoggerResult,
  RequestDetails,
  TraceBlockTxResult,
  TransactionTracerConfig,
  TxHashToContractResultOrActionsMap,
  TypedEvents,
} from './types';
import type { ContractAction, MirrorNodeBlock, MirrorNodeContractResult } from './types/mirrorNode';
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
  static traceBlockByHash = 'debug_traceBlockByHash';
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
  private readonly cacheService: ICacheClient;

  /**
   * The Block Service implementation that takes care of all block API operations.
   * @private
   */
  private readonly blockService: IBlockService;

  /**
   * The Transaction Service implementation that handles all transaction-related operations.
   * @private
   */
  private readonly transactionService: ITransactionService;

  /**
   * Creates an instance of DebugImpl.
   *
   * @constructor
   * @param {MirrorNodeClient} mirrorNodeClient - The client for interacting with the mirror node.
   * @param {Logger} logger - The logger used for logging output from this class.
   * @param {ICacheClient} cacheService - Service for managing cached data.
   * @param {string} chainId - The chain identifier for the current blockchain environment.
   */
  constructor(
    mirrorNodeClient: MirrorNodeClient,
    logger: Logger,
    cacheService: ICacheClient,
    chainId: string,
    hapiService: HAPIService,
    transactionPoolService: TransactionPoolService,
    lockService: LockService,
    registry: Registry,
  ) {
    this.logger = logger;
    this.common = new CommonService(mirrorNodeClient, logger, cacheService);
    this.mirrorNodeClient = mirrorNodeClient;
    this.cacheService = cacheService;
    this.blockService = new BlockService(cacheService, chainId, this.common, mirrorNodeClient, logger);
    this.transactionService = new TransactionService(
      cacheService,
      chainId,
      this.common,
      new EventEmitter<TypedEvents>(),
      hapiService,
      logger,
      mirrorNodeClient,
      transactionPoolService,
      lockService,
      registry,
    );
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
   * Get a raw block for debugging purposes.
   *
   * @async
   * @rpcMethod Exposed as debug_getRawBlock RPC endpoint
   * @rpcParamValidationRules Applies JSON-RPC parameter validation according to the API specification
   *
   * @param {string} blockNrOrHash - The block number, tag or hash. Possible values are 'earliest', 'pending', 'latest', hex block number or 32 bytes hash.
   * @param {RequestDetails} requestDetails - Request details for logging and tracking
   *
   * @example
   * const result = await getRawBlock('0x160c', requestDetails);
   */
  @rpcMethod
  @rpcParamValidationRules({
    0: { type: ['blockNumber', 'blockHash'], required: true },
  })
  @cache({
    skipParams: [{ index: '0', value: constants.NON_CACHABLE_BLOCK_PARAMS }],
  })
  async getRawBlock(blockNrOrHash: string, requestDetails: RequestDetails): Promise<string | JsonRpcError> {
    DebugImpl.requireDebugAPIEnabled();

    const block: Block | null =
      blockNrOrHash.length === 66
        ? await this.blockService.getBlockByHash(blockNrOrHash, true, requestDetails)
        : await this.blockService.getBlockByNumber(blockNrOrHash, true, requestDetails);

    if (!block) {
      return constants.EMPTY_HEX;
    }

    return constants.EMPTY_HEX + Buffer.from(BlockFactory.rlpEncodeBlock(block)).toString('hex');
  }

  /**
   * Get a raw block header for debugging purposes.
   *
   * @async
   * @rpcMethod Exposed as debug_getRawHeader RPC endpoint
   * @rpcParamValidationRules Applies JSON-RPC parameter validation according to the API specification
   *
   * @param {string} blockNrOrHash - The block number, tag or hash. Possible values are 'earliest', 'pending', 'latest', hex block number or 32 bytes hash.
   * @param {RequestDetails} requestDetails - Request details for logging and tracking
   *
   * @example
   * const result = await getRawHeader('0x160c', requestDetails);
   */
  @rpcMethod
  @rpcParamValidationRules({
    0: { type: ['blockNumber', 'blockHash'], required: true },
  })
  @cache({
    skipParams: [{ index: '0', value: constants.NON_CACHABLE_BLOCK_PARAMS }],
  })
  async getRawHeader(blockNrOrHash: string, requestDetails: RequestDetails): Promise<string | JsonRpcError> {
    DebugImpl.requireDebugAPIEnabled();

    const block: Block | null =
      blockNrOrHash.length === 66
        ? await this.blockService.getBlockByHash(blockNrOrHash, false, requestDetails)
        : await this.blockService.getBlockByNumber(blockNrOrHash, false, requestDetails);

    if (!block) {
      return constants.EMPTY_HEX;
    }

    return prepend0x(toHexString(BlockFactory.rlpEncodeBlockHeader(block)));
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
  ): Promise<TraceBlockTxResult[]> {
    return this.traceBlock(blockNumber, tracerObject, requestDetails, false);
  }

  /**
   * Trace a block by its hash for debugging purposes.
   *
   * @async
   * @rpcMethod Exposed as debug_traceBlockByHash RPC endpoint
   * @rpcParamValidationRules Applies JSON-RPC parameter validation according to the API specification
   *
   * @param {string} blockHash - The block hash to be traced (32-byte hex string).
   * @param {BlockTracerConfig} tracerObject - The configuration wrapper containing tracer type and config.
   * @param {RequestDetails} requestDetails - The request details for logging and tracking.
   * @throws {Error} Throws an error if the debug API is not enabled or if an exception occurs during the trace.
   * @returns {Promise<any>} A Promise that resolves to the result of the block trace operation.
   *
   * @example
   * const result = await traceBlockByHash('0x1234...', { tracer: TracerType.CallTracer, tracerConfig: { onlyTopCall: false } }, requestDetails);
   */
  @rpcMethod
  @rpcParamValidationRules({
    0: { type: 'blockHash', required: true },
    1: { type: 'tracerConfigWrapper', required: false },
  })
  @rpcParamLayoutConfig(RPC_LAYOUT.custom((params) => [params[0], params[1]]))
  @cache()
  async traceBlockByHash(
    blockHash: string,
    tracerObject: BlockTracerConfig,
    requestDetails: RequestDetails,
  ): Promise<TraceBlockTxResult[]> {
    return this.traceBlock(blockHash, tracerObject, requestDetails, true);
  }

  /**
   * Returns a list of bad blocks that the client has seen.
   * Due to Hedera's architecture, bad blocks do not occur, so this method always returns an empty array.
   *
   * @async
   * @rpcMethod Exposed as debug_getBadBlocks RPC endpoint
   *
   * @returns {Promise<[]>} A Promise that resolves to an empty array.
   *
   * @example
   * const result = await getBadBlocks();
   * // result: []
   */
  @rpcMethod
  async getBadBlocks(): Promise<[]> {
    DebugImpl.requireDebugAPIEnabled();
    return [];
  }

  /**
   * Returns an array of EIP-2718 binary-encoded receipts.
   *
   * @async
   * @rpcMethod Exposed as debug_getRawReceipts RPC endpoint
   * @rpcParamValidationRules Applies JSON-RPC parameter validation according to the API specification
   *
   * @param {string} blockHashOrNumber - The block hash or block number.
   * @param {RequestDetails} requestDetails - The request details for logging and tracking.
   * @throws {Error} Throws an error if the debug API is not enabled or if an exception occurs.
   * @returns {Promise<string[]>} A Promise that resolves to an array of EIP-2718 binary-encoded receipts or empty array if block not found.
   *
   * @example
   * const result = await getRawReceipts('0x1234', requestDetails);
   * // result: ["0xe6808...", "0xe6809..."]
   */
  @rpcMethod
  @rpcParamValidationRules({
    0: { type: ['blockNumber', 'blockHash'], required: true },
  })
  @cache({
    skipParams: [{ index: '0', value: constants.NON_CACHABLE_BLOCK_PARAMS }],
  })
  async getRawReceipts(blockHashOrNumber: string, requestDetails: RequestDetails): Promise<string[]> {
    DebugImpl.requireDebugAPIEnabled();
    return await this.blockService.getRawReceipts(blockHashOrNumber, requestDetails);
  }

  /**
   * Returns the RLP-encoded transaction for the given transaction hash.
   * Reuses the same data-fetching and synthetic transaction handling approach as
   * {@link TransactionService.getTransactionByHash}, but instead of returning a
   * Transaction model, reconstructs the signed transaction and returns its RLP-encoded form.
   * For transactions not found, returns "0x".
   *
   * @async
   * @rpcMethod Exposed as debug_getRawTransaction RPC endpoint
   * @rpcParamValidationRules Applies JSON-RPC parameter validation according to the API specification
   *
   * @param {string} transactionHash - The hash of the transaction to retrieve.
   * @param {RequestDetails} requestDetails - The request details for logging and tracking.
   * @throws {Error} Throws an error if the debug API is not enabled or if an exception occurs.
   * @returns {Promise<string>} A Promise that resolves to the RLP-encoded transaction, or "0x" if not found.
   *
   * @example
   * const result = await getRawTransaction('0x4c4ef2a33ac952fab10bd9b1433486ee1258c5cb56700f98a9a6f45751db5d19', requestDetails);
   * // result: "0xe6808..."
   */
  @rpcMethod
  @rpcParamValidationRules({
    0: { type: 'transactionHash', required: true },
  })
  @cache()
  async getRawTransaction(transactionHash: string, requestDetails: RequestDetails): Promise<string> {
    DebugImpl.requireDebugAPIEnabled();
    const tx = await this.transactionService.getTransactionByHash(transactionHash, requestDetails);
    if (!tx) {
      return '0x';
    }
    return BlockFactory.rlpEncodeTx(tx);
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
          value: numberTo0x(tinybarsToWeibars(action.value) ?? 0),
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
      const response = await this.mirrorNodeClient.getContractsResultsOpcodes(
        transactionIdOrHash,
        requestDetails,
        options,
      );

      if (!response) {
        // Fetch contract result to check for pre-execution validation failure
        const contractResult = await this.mirrorNodeClient.getContractResultWithRetry(
          this.mirrorNodeClient.getContractResult.name,
          [transactionIdOrHash, requestDetails],
        );

        if (contractResult && Utils.isRejectedDueToHederaSpecificValidation(contractResult)) {
          return this.getEmptyTracerObject(TracerType.OpcodeLogger) as OpcodeLoggerResult;
        }

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
   * @param {MirrorNodeContractResult} preFetchedTransactionsResponse - Optional pre-fetched contract result data.
   * @param {ContractAction[]} preFetchedActionsResponse - Optional pre-fetched actions data.
   * @returns {Promise<object>} The formatted response.
   */
  async callTracer(
    transactionHash: string,
    tracerConfig: ICallTracerConfig,
    requestDetails: RequestDetails,
    preFetchedTransactionsResponse?: MirrorNodeContractResult,
    preFetchedActionsResponse?: ContractAction[],
  ): Promise<CallTracerResult> {
    let actionsResponse = preFetchedActionsResponse;
    let transactionsResponse = preFetchedTransactionsResponse;
    if (!preFetchedTransactionsResponse && !preFetchedActionsResponse) {
      [actionsResponse, transactionsResponse] = await Promise.all([
        this.mirrorNodeClient.getContractsResultsActions(transactionHash, requestDetails),
        this.mirrorNodeClient.getContractResultWithRetry(this.mirrorNodeClient.getContractResult.name, [
          transactionHash,
          requestDetails,
        ]),
      ]);
    }

    try {
      // Check for pre-execution validation failure first (e.g., MAX_GAS_LIMIT_EXCEEDED, WRONG_NONCE)
      // These transactions never executed EVM bytecode, so return an empty trace with the error
      if (transactionsResponse && Utils.isRejectedDueToHederaSpecificValidation(transactionsResponse)) {
        const { resolvedFrom, resolvedTo } = await this.resolveMultipleAddresses(
          transactionsResponse.from,
          transactionsResponse.to,
          requestDetails,
        );
        return {
          ...(this.getEmptyTracerObject(
            TracerType.CallTracer,
            resolvedFrom,
            resolvedTo ?? constants.ZERO_HEX,
          ) as CallTracerResult),
          error: transactionsResponse.result,
          revertReason: transactionsResponse.result,
        };
      }

      if (!actionsResponse?.[0]?.call_type || !transactionsResponse) {
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

      const value = numberTo0x(tinybarsToWeibars(amount) ?? 0);
      const errorResult = result !== constants.SUCCESS ? result : undefined;

      return {
        type,
        from: resolvedFrom,
        to: resolvedTo,
        value,
        gas: numberTo0x(gas),
        gasUsed: numberTo0x(gasUsed),
        input,
        output: result !== constants.SUCCESS && error ? error : output,
        ...(result !== constants.SUCCESS && { error: errorResult }),
        ...(result !== constants.SUCCESS && { revertReason: decodeErrorMessage(error ?? undefined) }),
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
   * @param {ContractAction[]} preFetchedActionsResponse - Optional pre-fetched actions data.
   * @returns {Promise<object>} A Promise that resolves to an object containing the pre-state information.
   *                           The object keys are EVM addresses, and values contain balance, nonce, code, and storage data.
   * @throws {Error} Throws a RESOURCE_NOT_FOUND error if contract results cannot be retrieved.
   */
  async prestateTracer(
    transactionHash: string,
    onlyTopCall: boolean = false,
    requestDetails: RequestDetails,
    preFetchedActionsResponse?: ContractAction[],
    preFetchedContractResult?: MirrorNodeContractResult,
  ): Promise<EntityTraceStateMap> {
    // Try to get cached result first
    const cacheKey = `${constants.CACHE_KEY.PRESTATE_TRACER}_${transactionHash}_${onlyTopCall}`;

    const cachedResult = await this.cacheService.getAsync(cacheKey, this.prestateTracer.name);
    if (cachedResult) {
      return cachedResult;
    }

    let actionsResponse = preFetchedActionsResponse;
    let transactionsResponse = preFetchedContractResult;
    if (!preFetchedContractResult && !preFetchedActionsResponse) {
      [actionsResponse, transactionsResponse] = await Promise.all([
        this.mirrorNodeClient.getContractsResultsActions(transactionHash, requestDetails),
        this.mirrorNodeClient.getContractResultWithRetry(this.mirrorNodeClient.getContractResult.name, [
          transactionHash,
          requestDetails,
        ]),
      ]);
    }

    // Check for pre-execution validation failure first - return empty prestate
    if (transactionsResponse && Utils.isRejectedDueToHederaSpecificValidation(transactionsResponse)) {
      return this.getEmptyTracerObject(TracerType.PrestateTracer) as EntityTraceStateMap;
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
   * Retrieves all transaction hashes in a block (EVM + synthetic) along with pre-fetched data.
   * Optimizes performance by using parallel timestamp slicing for large result sets.
   *
   * @private
   * @param blockResponse - Block metadata including timestamp range and transaction count
   * @param requestDetails - Request tracking details
   * @returns Object containing transaction hashes and pre-fetched data (contract results and actions)
   */
  private async getBlockTransactionDetails(
    blockResponse: MirrorNodeBlock,
    requestDetails: RequestDetails,
  ): Promise<{
    transactionHashes: string[];
    preFetchedData: TxHashToContractResultOrActionsMap;
  }> {
    const timestampRange = [`gte:${blockResponse.timestamp.from}`, `lte:${blockResponse.timestamp.to}`];

    // Calculate slice count based on actual transaction count in the block
    const maxLogsPerSlice = ConfigService.get('MIRROR_NODE_TIMESTAMP_SLICING_MAX_LOGS_PER_SLICE');
    const sliceCount = Math.ceil(blockResponse.count / maxLogsPerSlice);

    // Fetch both contract results and all logs in the block in parallel
    const [contractResults, allLogs] = await Promise.all([
      this.mirrorNodeClient.getContractResultWithRetry(this.mirrorNodeClient.getContractResults.name, [
        requestDetails,
        { timestamp: timestampRange },
        undefined,
      ]),
      this.mirrorNodeClient.getContractResultsLogsWithRetry(requestDetails, sliceCount, {
        timestamp: timestampRange,
      }),
    ]);

    // Collect all unique transaction hashes
    const transactionHashes = new Set<string>();

    // Create a map of contract results by hash for quick lookup
    // Include all transactions, even pre-execution failures - they will return empty traces
    const contractResultsByHash = new Map<string, MirrorNodeContractResult>();
    contractResults?.forEach((cr) => {
      contractResultsByHash.set(cr.hash, cr);
      transactionHashes.add(cr.hash);
    });

    // Capture synthetic HTS transaction hashes from logs
    allLogs?.forEach((log) => {
      if (log.transaction_hash) {
        transactionHashes.add(log.transaction_hash);
      }
    });

    const txHashArray = Array.from(transactionHashes);

    // Fetch actions for all transactions in parallel, skipping pre-execution failures
    // to avoid unnecessary API latency (they have no EVM actions)
    const actionsPromises = txHashArray.map(async (txHash) => {
      const cr = contractResultsByHash.get(txHash);
      if (cr && Utils.isRejectedDueToHederaSpecificValidation(cr)) {
        return { txHash, actions: [] };
      }
      try {
        const actions = await this.mirrorNodeClient.getContractsResultsActions(txHash, requestDetails);
        return { txHash, actions };
      } catch (error) {
        // If actions fetch fails, return empty array (synthetic transactions may not have actions)
        this.logger.warn(`Failed to fetch actions for transaction ${txHash}: ${error}`);
        return { txHash, actions: [] };
      }
    });

    const actionsResults = await Promise.all(actionsPromises);

    // Build pre-fetched data map
    const preFetchedData: TxHashToContractResultOrActionsMap = {};

    txHashArray.forEach((txHash) => {
      const contractResult = contractResultsByHash.get(txHash);
      const actionsResult = actionsResults.find((ar) => ar.txHash === txHash);
      preFetchedData[txHash] = {
        ...(contractResult && { contractResult }),
        ...(actionsResult?.actions && actionsResult.actions.length > 0 && { actions: actionsResult.actions }),
      };
    });

    return {
      transactionHashes: txHashArray,
      preFetchedData,
    };
  }

  /**
   * Returns an empty/minimal tracer result object for a given tracer type.
   * Used for pre-execution validation failures and synthetic transactions that have no EVM execution.
   *
   * @private
   * @param tracer - The tracer type to build the empty object for.
   * @param resolvedFrom - Optional resolved 'from' address (used by CallTracer).
   * @param resolvedTo - Optional resolved 'to' address (used by CallTracer).
   * @returns The empty tracer result object.
   */
  private getEmptyTracerObject(
    tracer: TracerType,
    resolvedFrom?: string,
    resolvedTo?: string,
  ): EntityTraceStateMap | OpcodeLoggerResult | CallTracerResult {
    switch (tracer) {
      case TracerType.PrestateTracer:
        return {};
      case TracerType.OpcodeLogger:
        return {
          gas: 0,
          failed: false,
          returnValue: '',
          structLogs: [],
        };
      case TracerType.CallTracer: {
        return {
          type: CallType.CALL,
          from: resolvedFrom ?? constants.ZERO_HEX,
          to: resolvedTo ?? constants.ZERO_HEX,
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

    if (tracer === TracerType.CallTracer) {
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

      return this.getEmptyTracerObject(TracerType.CallTracer, resolvedFrom, resolvedTo) as CallTracerResult;
    }

    return this.getEmptyTracerObject(tracer) as EntityTraceStateMap | OpcodeLoggerResult;
  }

  /**
   * Shared implementation for tracing all transactions in a block.
   * Used by both debug_traceBlockByNumber and debug_traceBlockByHash.
   *
   * @private
   * @param blockIdentifier - The block number (hex) or block hash to trace.
   * @param tracerObject - The configuration wrapper containing tracer type and config.
   * @param requestDetails - The request details for logging and tracking.
   * @param filterPreExecutionFailures - When true, filters out transactions with pre-execution validation failures (WRONG_NONCE, etc.).
   * @returns A Promise that resolves to an array of trace results for each transaction in the block.
   */
  private async traceBlock(
    blockIdentifier: string,
    tracerObject: BlockTracerConfig,
    requestDetails: RequestDetails,
    filterPreExecutionFailures: boolean = false,
  ): Promise<TraceBlockTxResult[]> {
    try {
      DebugImpl.requireDebugAPIEnabled();
      const blockResponse = await this.common.getHistoricalBlockResponse(requestDetails, blockIdentifier, true);

      if (blockResponse == null) throw predefined.RESOURCE_NOT_FOUND(`Block ${blockIdentifier} not found`);

      // Get ALL transaction hashes (EVM + synthetic) along with pre-fetched data
      const { transactionHashes, preFetchedData } = await this.getBlockTransactionDetails(
        blockResponse,
        requestDetails,
      );

      if (transactionHashes.length === 0) {
        return [];
      }

      // Filter out pre-execution validation failures if requested (for traceBlockByHash)
      const filteredTxHashes = filterPreExecutionFailures
        ? transactionHashes.filter((txHash) => {
            const contractResult = preFetchedData[txHash]?.contractResult;
            return !contractResult || !Utils.isRejectedDueToHederaSpecificValidation(contractResult);
          })
        : transactionHashes;

      if (filteredTxHashes.length === 0) {
        return [];
      }

      const tracer = tracerObject?.tracer ?? TracerType.CallTracer;
      const onlyTopCall = tracerObject?.tracerConfig?.onlyTopCall;

      // Trace all transactions using existing tracer methods with pre-fetched data
      if (tracer === TracerType.CallTracer) {
        return await Promise.all(
          filteredTxHashes.map(async (txHash) => ({
            txHash,
            result: await this.callTracer(
              txHash,
              { onlyTopCall },
              requestDetails,
              preFetchedData[txHash]?.contractResult,
              preFetchedData[txHash]?.actions,
            ),
          })),
        );
      }

      if (tracer === TracerType.PrestateTracer) {
        return await Promise.all(
          filteredTxHashes.map(async (txHash) => ({
            txHash,
            result: await this.prestateTracer(
              txHash,
              onlyTopCall,
              requestDetails,
              preFetchedData[txHash]?.actions,
              preFetchedData[txHash]?.contractResult,
            ),
          })),
        );
      }

      return [];
    } catch (error) {
      throw this.common.genericErrorHandler(error);
    }
  }
}
