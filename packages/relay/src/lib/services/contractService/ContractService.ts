// SPDX-License-Identifier: Apache-2.0
import { disassemble } from '@ethersproject/asm';
import { ConfigService } from '@hashgraph/json-rpc-config-service/dist/services';
import { PrecheckStatusError } from '@hashgraph/sdk';
import crypto from 'crypto';
import { Logger } from 'pino';

import {
  isValidEthereumAddress,
  numberTo0x,
  parseNumericEnvVar,
  prepend0x,
  trimPrecedingZeros,
  weibarHexToTinyBarInt,
} from '../../../formatters';
import { getFunctionSelector } from '../../../formatters';
import { MirrorNodeClient } from '../../clients';
import constants from '../../constants';
import { JsonRpcError, predefined } from '../../errors/JsonRpcError';
import { MirrorNodeClientError } from '../../errors/MirrorNodeClientError';
import { SDKClientError } from '../../errors/SDKClientError';
import { EthImpl } from '../../eth';
import { Log } from '../../model';
import { Precheck } from '../../precheck';
import {
  IContractCallRequest,
  IContractCallResponse,
  IContractResult,
  IGetLogsParams,
  RequestDetails,
} from '../../types';
import { CommonService } from '..';
import { CacheService } from '../cacheService/cacheService';
import { ICommonService } from '../ethService/ethCommonService/ICommonService';
import HAPIService from '../hapiService/hapiService';
import { IContractService } from './IContractService';

/**
 * Service responsible for handling contract-related operations.
 */
export class ContractService implements IContractService {
  /**
   * The Hedera Token Service (HTS) precompiled contract address.
   * @public
   * @static
   */
  public static readonly iHTSAddress = '0x0000000000000000000000000000000000000167';

  /**
   * The base cost of a transaction.
   * @public
   * @static
   */
  public static readonly gasTxBaseCost = numberTo0x(constants.TX_BASE_COST);

  /**
   * The minimum gas for hollow account creation.
   * @public
   * @static
   */
  public static readonly minGasTxHollowAccountCreation = numberTo0x(constants.MIN_TX_HOLLOW_ACCOUNT_CREATION_GAS);

  /**
   * The postfix for redirect bytecode used in token redirection.
   * @public
   * @static
   */
  public static readonly redirectBytecodePostfix =
    '600052366000602037600080366018016008845af43d806000803e8160008114605857816000f35b816000fdfea2646970667358221220d8378feed472ba49a0005514ef7087017f707b45fb9bf56bb81bb93ff19a238b64736f6c634300080b0033';

  /**
   * The prefix for redirect bytecode used in token redirection.
   * @public
   * @static
   */
  public static readonly redirectBytecodePrefix = '6080604052348015600f57600080fd5b506000610167905077618dc65e';

  /**
   * The cache service used for caching responses.
   * @private
   * @readonly
   */
  private readonly cacheService: CacheService;

  /**
   * The common service used for all common methods.
   * @private
   * @readonly
   */
  private readonly common: ICommonService;

  /**
   * The average gas for contract calls.
   * @private
   * @readonly
   */
  private readonly contractCallAverageGas = numberTo0x(constants.TX_CONTRACT_CALL_AVERAGE_GAS);

  /**
   * The default gas value for transactions.
   * @private
   * @readonly
   */
  private readonly defaultGas = numberTo0x(parseNumericEnvVar('TX_DEFAULT_GAS', 'TX_DEFAULT_GAS_DEFAULT'));

  /**
   * Whether to throw errors during gas estimation.
   * @private
   * @readonly
   */
  private readonly estimateGasThrows = ConfigService.get('ESTIMATE_GAS_THROWS');

  /**
   * The cache TTL for Ethereum call responses.
   * @private
   * @readonly
   */
  private readonly ethCallCacheTtl = parseNumericEnvVar('ETH_CALL_CACHE_TTL', 'ETH_CALL_CACHE_TTL_DEFAULT');

  /**
   * The interface for HAPI service to interact with consensus nodes.
   * @private
   * @readonly
   */
  private readonly hapiService: HAPIService;

  /**
   * The logger used for logging all output from this class.
   * @private
   * @readonly
   */
  private readonly logger: Logger;

  /**
   * The interface through which we interact with the mirror node.
   * @private
   * @readonly
   */
  private readonly mirrorNodeClient: MirrorNodeClient;

  /**
   * Creates a new instance of the ContractService
   *
   * @param {CacheService} cacheService - The cache service for caching responses
   * @param {string} chain - The chain ID
   * @param {CommonService} common - The common service for shared functionality
   * @param {HAPIService} hapiService - The HAPI service for consensus node interaction
   * @param {Logger} logger - The logger for logging
   * @param {MirrorNodeClient} mirrorNodeClient - The mirror node client
   */
  constructor(
    cacheService: CacheService,
    common: ICommonService,
    hapiService: HAPIService,
    logger: Logger,
    mirrorNodeClient: MirrorNodeClient,
  ) {
    this.cacheService = cacheService;
    this.common = common;
    this.hapiService = hapiService;
    this.logger = logger;
    this.mirrorNodeClient = mirrorNodeClient;
  }

  /**
   * Returns an array of addresses owned by client.
   * Always returns an empty array for Hedera.
   *
   * @param {RequestDetails} requestDetails - The request details for logging and tracking
   * @returns {[]} An empty array of addresses
   */
  public accounts(requestDetails: RequestDetails): [] {
    if (this.logger.isLevelEnabled('trace')) {
      this.logger.trace(`${requestDetails.formattedRequestId} accounts()`);
    }
    return [];
  }

  /**
   * Executes a new message call immediately without creating a transaction on the blockchain.
   *
   * @param {IContractCallRequest} call - The transaction object with call data
   * @param {string | object | null} blockParam - Block number, tag, or object with blockHash/blockNumber
   * @param {RequestDetails} requestDetails - The request details for logging and tracking
   * @returns {Promise<string | JsonRpcError>} The return value of the executed contract call or error
   */
  public async call(
    call: IContractCallRequest,
    blockParam: string | object | null,
    requestDetails: RequestDetails,
  ): Promise<string | JsonRpcError> {
    try {
      if (call.to && !isValidEthereumAddress(call.to)) {
        throw predefined.INVALID_CONTRACT_ADDRESS(call.to);
      }

      const blockNumberOrTag = await this.extractBlockNumberOrTag(blockParam, requestDetails);
      const gas = this.getCappedBlockGasLimit(call.gas?.toString(), requestDetails);
      await this.contractCallFormat(call, requestDetails);

      const result = await this.routeAndExecuteCall(call, gas, blockNumberOrTag, requestDetails);
      console.log('result', result);
      if (this.logger.isLevelEnabled('debug')) {
        this.logger.debug(`${requestDetails.formattedRequestId} eth_call response: ${JSON.stringify(result)}`);
      }

      return result;
    } catch (e: any) {
      console.log('e', e);
      this.logger.error(e, `${requestDetails.formattedRequestId} Failed to successfully submit eth_call`);
      if (e instanceof JsonRpcError) {
        throw e;
      }
      // Preserve and re-throw MirrorNodeClientError to the upper layer
      if (e instanceof MirrorNodeClientError) {
        throw e;
      }
      return predefined.INTERNAL_ERROR(e.message.toString());
    }
  }

  /**
   * Estimates the amount of gas required to execute a contract call.
   *
   * @param {IContractCallRequest} transaction - The transaction data for the contract call.
   * @param {string | null} blockParam - Optional block parameter to specify the block to estimate gas for.
   * @param {RequestDetails} requestDetails - The details of the request for logging and tracking.
   * @returns {Promise<string | JsonRpcError>} A promise that resolves to the estimated gas in hexadecimal format or a JsonRpcError.
   */
  public async estimateGas(
    transaction: IContractCallRequest,
    blockParam: string | null,
    requestDetails: RequestDetails,
  ): Promise<string | JsonRpcError> {
    const requestIdPrefix = requestDetails.formattedRequestId;

    if (this.logger.isLevelEnabled('trace')) {
      this.logger.trace(
        `${requestIdPrefix} estimateGas(transaction=${JSON.stringify(transaction)}, blockParam=${blockParam})`,
      );
    }

    try {
      const response = await this.estimateGasFromMirrorNode(transaction, requestDetails);

      if (response?.result) {
        this.logger.info(`${requestIdPrefix} Returning gas: ${response.result}`);
        return prepend0x(trimPrecedingZeros(response.result));
      } else {
        this.logger.error(`${requestIdPrefix} No gas estimate returned from mirror-node: ${JSON.stringify(response)}`);
        return this.predefinedGasForTransaction(transaction, requestDetails);
      }
    } catch (e: any) {
      this.logger.error(
        `${requestIdPrefix} Error raised while fetching estimateGas from mirror-node: ${JSON.stringify(e)}`,
      );
      // in case of contract revert, we don't want to return a predefined gas but the actual error with the reason
      if (this.estimateGasThrows && e instanceof MirrorNodeClientError && e.isContractRevertOpcodeExecuted()) {
        return predefined.CONTRACT_REVERT(e.detail ?? e.message, e.data);
      }
      return this.predefinedGasForTransaction(transaction, requestDetails, e);
    }
  }

  /**
   * Returns the compiled smart contract code at a given address.
   *
   * @param {string} address - The address to get code from
   * @param {string | null} blockNumber - Block number or tag
   * @param {RequestDetails} requestDetails - The request details for logging and tracking
   * @returns {Promise<string>} The code at the given address
   */
  public async getCode(
    address: string,
    blockNumber: string | null,
    requestDetails: RequestDetails,
  ): Promise<string | null> {
    const requestIdPrefix = requestDetails.formattedRequestId;
    if (!this.common.isBlockParamValid(blockNumber)) {
      throw predefined.UNKNOWN_BLOCK(
        `The value passed is not a valid blockHash/blockNumber/blockTag value: ${blockNumber}`,
      );
    }
    if (this.logger.isLevelEnabled('trace')) {
      this.logger.trace(`${requestIdPrefix} getCode(address=${address}, blockNumber=${blockNumber})`);
    }

    // check for static precompile cases first before consulting nodes
    // this also account for environments where system entities were not yet exposed to the mirror node
    if (address === ContractService.iHTSAddress) {
      if (this.logger.isLevelEnabled('trace')) {
        this.logger.trace(
          `${requestIdPrefix} HTS precompile case, return ${EthImpl.invalidEVMInstruction} for byte code`,
        );
      }
      return EthImpl.invalidEVMInstruction;
    }

    const cachedLabel = `getCode.${address}.${blockNumber}`;
    const cachedResponse: string | undefined = await this.cacheService.getAsync(
      cachedLabel,
      CommonService.ethGetCode,
      requestDetails,
    );
    if (cachedResponse != undefined) {
      return cachedResponse;
    }

    try {
      const result = await this.mirrorNodeClient.resolveEntityType(address, CommonService.ethGetCode, requestDetails, [
        constants.TYPE_CONTRACT,
        constants.TYPE_TOKEN,
      ]);
      if (result) {
        const blockInfo = await this.common.getHistoricalBlockResponse(requestDetails, blockNumber, true);
        if (!blockInfo || parseFloat(result.entity?.created_timestamp) > parseFloat(blockInfo.timestamp.to)) {
          return CommonService.emptyHex;
        }
        if (result?.type === constants.TYPE_TOKEN) {
          if (this.logger.isLevelEnabled('trace')) {
            this.logger.trace(`${requestIdPrefix} Token redirect case, return redirectBytecode`);
          }
          return CommonService.redirectBytecodeAddressReplace(address);
        } else if (result?.type === constants.TYPE_CONTRACT) {
          if (result?.entity.runtime_bytecode !== CommonService.emptyHex) {
            const prohibitedOpcodes = ['CALLCODE', 'DELEGATECALL', 'SELFDESTRUCT', 'SUICIDE'];
            const opcodes = disassemble(result?.entity.runtime_bytecode);
            const hasProhibitedOpcode =
              opcodes.filter((opcode) => prohibitedOpcodes.indexOf(opcode.opcode.mnemonic) > -1).length > 0;
            if (!hasProhibitedOpcode) {
              await this.cacheService.set(
                cachedLabel,
                result?.entity.runtime_bytecode,
                CommonService.ethGetCode,
                requestDetails,
              );
            }
            return result?.entity.runtime_bytecode;
          }
        }
      }

      if (this.logger.isLevelEnabled('debug')) {
        this.logger.debug(
          `${requestIdPrefix} Address ${address} is not a contract nor an HTS token, returning empty hex`,
        );
      }

      return CommonService.emptyHex;
    } catch (error: any) {
      this.logger.error(
        `${requestIdPrefix} Error raised during getCode: address=${address}, blockNumber=${blockNumber}, error=${error.message}`,
      );
      throw error;
    }
  }

  /**
   * Returns an array of all logs matching the given filter criteria.
   *
   * @param {IGetLogsParams} params - The filter criteria
   * @param {RequestDetails} requestDetails - The request details for logging and tracking
   * @returns {Promise<Log[]>} An array of log objects
   */
  public async getLogs(params: IGetLogsParams, requestDetails: RequestDetails): Promise<Log[]> {
    return this.common.getLogs(
      params.blockHash,
      params.fromBlock,
      params.toBlock,
      params.address,
      params.topics,
      requestDetails,
    );
  }

  /**
   * Returns the value from a storage position at a given address.
   *
   * @param {string} address - The address of the storage
   * @param {string} slot - The slot index (hex string)
   * @param {string | null} blockNumberOrTagOrHash - Block number, tag, or hash
   * @param {RequestDetails} requestDetails - The request details for logging and tracking
   * @returns {Promise<string>} The value at the given storage position
   */
  public async getStorageAt(
    address: string,
    slot: string,
    blockNumberOrTagOrHash: string | null,
    requestDetails: RequestDetails,
  ): Promise<string> {
    const requestIdPrefix = requestDetails.formattedRequestId;
    if (this.logger.isLevelEnabled('trace')) {
      this.logger.trace(
        `${requestIdPrefix} getStorageAt(address=${address}, slot=${slot}, blockNumberOrOrHashTag=${blockNumberOrTagOrHash})`,
      );
    }

    let result = CommonService.zeroHex32Byte; // if contract or slot not found then return 32 byte 0

    const blockResponse = await this.common.getHistoricalBlockResponse(requestDetails, blockNumberOrTagOrHash, false);
    // To save a request to the mirror node for `latest` and `pending` blocks, we directly return null from `getHistoricalBlockResponse`
    // But if a block number or `earliest` tag is passed and the mirror node returns `null`, we should throw an error.
    if (!this.common.blockTagIsLatestOrPending(blockNumberOrTagOrHash) && blockResponse == null) {
      throw predefined.RESOURCE_NOT_FOUND(`block '${blockNumberOrTagOrHash}'.`);
    }

    const blockEndTimestamp = blockResponse?.timestamp?.to;

    await this.mirrorNodeClient
      .getContractStateByAddressAndSlot(address, slot, requestDetails, blockEndTimestamp)
      .then((response) => {
        if (response !== null && response.state.length > 0) {
          result = response.state[0].value;
        }
      })
      .catch((error: any) => {
        throw this.common.genericErrorHandler(
          error,
          `${requestIdPrefix} Failed to retrieve current contract state for address ${address} at slot=${slot}`,
        );
      });

    return result;
  }

  /**
   * Caches the response from a successful call.
   *
   * @param {IContractCallRequest} call - The original call request
   * @param {string} response - The response to cache
   * @param {RequestDetails} requestDetails - The request details
   * @returns {Promise<void>}
   * @private
   */
  private async cacheResponse(
    call: IContractCallRequest,
    response: string,
    requestDetails: RequestDetails,
  ): Promise<void> {
    const data = call.data
      ? crypto
          .createHash('sha1')
          .update(call.data || '0x')
          .digest('hex')
      : null; // NOSONAR
    const cacheKey = `${constants.CACHE_KEY.ETH_CALL}:${call.from || ''}.${call.to}.${data}`;
    await this.cacheService.set(cacheKey, response, CommonService.ethCall, requestDetails, this.ethCallCacheTtl);
  }

  /**
   * Execute a contract call query to the consensus node
   *
   * @param {IContractCallRequest} call - The call data
   * @param {number | null} gas - The gas limit
   * @param {RequestDetails} requestDetails - The request details for logging and tracking
   * @returns {Promise<string | JsonRpcError>} The call result or error
   */
  private async callConsensusNode(
    call: IContractCallRequest,
    gas: number | null,
    requestDetails: RequestDetails,
  ): Promise<string | JsonRpcError> {
    const requestIdPrefix = requestDetails.formattedRequestId;
    try {
      gas = gas ?? Number.parseInt(this.defaultGas);

      if (this.logger.isLevelEnabled('debug')) {
        this.logger.debug(
          `${requestIdPrefix} Making eth_call on contract ${call.to} with gas ${gas} and call data "${call.data}" from "${call.from}" using consensus-node.`,
          call.to,
          gas,
          call.data,
          call.from,
        );
      }

      await this.validateAddresses(call);
      const cachedResponse = await this.tryGetCachedResponse(call, requestDetails);
      if (cachedResponse != undefined) {
        if (this.logger.isLevelEnabled('debug')) {
          this.logger.debug(`${requestIdPrefix} eth_call returned cached response: ${cachedResponse}`);
        }
        return cachedResponse;
      }
      return await this.executeConsensusNodeCall(call, gas, requestDetails);
    } catch (e: any) {
      return this.handleConsensusNodeError(e, requestDetails);
    }
  }

  /**
   * Makes a contract call via the Mirror Node.
   *
   * @param {IContractCallRequest} call - The call data
   * @param {number | null} gas - The gas limit
   * @param {number | string | null | undefined} value - The value to send
   * @param {string | null} block - The block number or tag
   * @param {RequestDetails} requestDetails - The request details for logging and tracking
   * @returns {Promise<string | JsonRpcError>} The call result or error
   */
  private async callMirrorNode(
    call: IContractCallRequest,
    gas: number | null,
    value: number | string | null | undefined,
    block: string | null,
    requestDetails: RequestDetails,
  ): Promise<string | JsonRpcError> {
    const requestIdPrefix = requestDetails.formattedRequestId;
    try {
      if (this.logger.isLevelEnabled('debug')) {
        this.logger.debug(
          `${requestIdPrefix} Making eth_call on contract ${call.to} with gas ${gas} and call data "${call.data}" from "${call.from}" at blockBlockNumberOrTag: "${block}" using mirror-node.`,
          call.to,
          gas,
          call.data,
          call.from,
          block,
        );
      }
      const callData = this.prepareMirrorNodeCallData(call, gas, value, block);
      return await this.executeMirrorNodeCall(callData, requestDetails);
    } catch (e: any) {
      return this.handleMirrorNodeError(e, call, gas, requestDetails);
    }
  }

  /**
   * Perform value format precheck before making contract call towards the mirror node
   * @param {IContractCallRequest} transaction the transaction object
   * @param {RequestDetails} requestDetails the request details for logging and tracking
   */
  public async contractCallFormat(transaction: IContractCallRequest, requestDetails: RequestDetails): Promise<void> {
    if (transaction.value) {
      transaction.value = weibarHexToTinyBarInt(transaction.value);
    }
    if (transaction.gasPrice) {
      transaction.gasPrice = parseInt(transaction.gasPrice.toString());
    } else {
      transaction.gasPrice = await this.common.gasPrice(requestDetails).then((gasPrice) => parseInt(gasPrice));
    }
    if (transaction.gas) {
      transaction.gas = parseInt(transaction.gas.toString());
    }
    if (!transaction.from && transaction.value && (transaction.value as number) > 0) {
      if (ConfigService.get('OPERATOR_KEY_FORMAT') === 'HEX_ECDSA') {
        transaction.from = this.hapiService.getMainClientInstance().operatorPublicKey?.toEvmAddress();
      } else {
        const operatorId = this.hapiService.getMainClientInstance().operatorAccountId!.toString();
        const operatorAccount = await this.common.getAccount(operatorId, requestDetails);
        transaction.from = operatorAccount?.evm_address;
      }
    }

    // Support either data or input. https://ethereum.github.io/execution-apis/api-documentation/ lists input but many EVM tools still use data.
    // We chose in the mirror node to use data field as the correct one, however for us to be able to support all tools,
    // we have to modify transaction object, so that it complies with the mirror node.
    // That means that, if input field is passed, but data is not, we have to copy value of input to the data to comply with mirror node.
    // The second scenario occurs when both the data and input fields are present but hold different values.
    // In this case, the value in the input field should be the one used for consensus based on this resource https://github.com/ethereum/execution-apis/blob/main/tests/eth_call/call-contract.io
    // Eventually, for optimization purposes, we can rid of the input property or replace it with empty string.
    if ((transaction.input && transaction.data === undefined) || (transaction.input && transaction.data)) {
      transaction.data = transaction.input;
      delete transaction.input;
    }
  }

  /**
   * Executes an estimate contract call gas request in the mirror node.
   *
   * @param {IContractCallRequest} transaction The transaction data for the contract call.
   * @param {RequestDetails} requestDetails The request details for logging and tracking.
   * @returns {Promise<IContractCallResponse>} the response from the mirror node
   */
  private async estimateGasFromMirrorNode(
    transaction: IContractCallRequest,
    requestDetails: RequestDetails,
  ): Promise<IContractCallResponse | null> {
    await this.contractCallFormat(transaction, requestDetails);
    const callData = { ...transaction, estimate: true };
    return this.mirrorNodeClient.postContractCall(callData, requestDetails);
  }

  /**
   * Executes the consensus node call and handles the response.
   *
   * @param {IContractCallRequest} call - The call request
   * @param {number} gas - The gas limit
   * @param {RequestDetails} requestDetails - The request details
   * @returns {Promise<string | JsonRpcError>} The call result or error
   * @private
   */
  private async executeConsensusNodeCall(
    call: IContractCallRequest,
    gas: number,
    requestDetails: RequestDetails,
  ): Promise<string | JsonRpcError> {
    const contractCallResponse = await this.hapiService
      .getSDKClient()
      .submitContractCallQueryWithRetry(
        call.to as string,
        call.data as string,
        gas,
        call.from as string,
        CommonService.ethCall,
        requestDetails,
      );

    if (!contractCallResponse) {
      return predefined.INTERNAL_ERROR(
        `Invalid contractCallResponse from consensus-node: ${JSON.stringify(contractCallResponse)}`,
      );
    }

    const formattedCallResponse = prepend0x(Buffer.from(contractCallResponse.asBytes()).toString('hex'));
    await this.cacheResponse(call, formattedCallResponse, requestDetails);
    return formattedCallResponse;
  }

  /**
   * Executes the mirror node call and formats the response.
   *
   * @param {IContractCallRequest} callData - The prepared call data
   * @param {RequestDetails} requestDetails - The request details
   * @returns {Promise<string>} The formatted call response
   * @private
   */
  private async executeMirrorNodeCall(callData: IContractCallRequest, requestDetails: RequestDetails): Promise<string> {
    const contractCallResponse = await this.mirrorNodeClient.postContractCall(callData, requestDetails);
    return contractCallResponse?.result ? prepend0x(contractCallResponse.result) : CommonService.emptyHex;
  }

  /**
   * Extracts the block number or tag from a block parameter.
   * according to EIP-1898 (https://eips.ethereum.org/EIPS/eip-1898) block param can either be a string (blockNumber or Block Tag) or an object (blockHash or blockNumber)
   *
   * @param {string | object | null} blockParam - The block parameter (string, object, or null)
   * @param {RequestDetails} requestDetails - The request details for logging and tracking
   * @returns {Promise<string | null>} The extracted block number or tag, or null if not provided
   * @private
   */
  private async extractBlockNumberOrTag(
    blockParam: string | object | null,
    requestDetails: RequestDetails,
  ): Promise<string | null> {
    if (!blockParam) {
      return null;
    }

    // is an object
    if (typeof blockParam === 'object') {
      // object has property blockNumber, example: { "blockNumber": "0x0" }
      if (blockParam['blockNumber'] != null) {
        return blockParam['blockNumber'];
      }

      if (blockParam['blockHash'] != null) {
        return await this.getBlockNumberFromHash(blockParam['blockHash'], requestDetails);
      }

      // if is an object but doesn't have blockNumber or blockHash, then it's an invalid blockParam
      throw predefined.INVALID_ARGUMENTS('neither block nor hash specified');
    }

    // if blockParam is a string, could be a blockNumber or blockTag or blockHash
    if (blockParam.length > 0) {
      // if string is a blockHash, we return its corresponding blockNumber
      if (this.common.isBlockHash(blockParam)) {
        return await this.getBlockNumberFromHash(blockParam, requestDetails);
      } else {
        return blockParam;
      }
    }

    return null;
  }

  /**
   * Gets the block number from a block hash.
   *
   * @param {string} blockHash - The block hash
   * @param {RequestDetails} requestDetails - The request details for logging and tracking
   * @returns {Promise<string>} The block number as a hex string
   * @private
   */
  private async getBlockNumberFromHash(blockHash: string, requestDetails: RequestDetails): Promise<string> {
    const block = await this.mirrorNodeClient.getBlock(blockHash, requestDetails);
    if (block != null) {
      return numberTo0x(block.number);
    } else {
      throw predefined.RESOURCE_NOT_FOUND(`Block Hash: '${blockHash}'`);
    }
  }

  /**
   * Caps the block gas limit to a reasonable value.
   *
   * @param {string | undefined} gasString - The gas limit as a string
   * @param {RequestDetails} requestDetails - The request details for logging and tracking
   * @returns {number | null} The capped gas limit as a number, or null if no valid gas limit could be determined
   * @private
   */
  private getCappedBlockGasLimit(gasString: string | undefined, requestDetails: RequestDetails): number | null {
    if (!gasString) {
      // Return null and don't include in the mirror node call, as mirror is doing this estimation on the go.
      return null;
    }

    // Gas limit for `eth_call` is 50_000_000, but the current Hedera network limit is 15_000_000
    // With values over the gas limit, the call will fail with BUSY error so we cap it at 15_000_000
    const gas = Number.parseInt(gasString);
    if (gas > constants.MAX_GAS_PER_SEC) {
      if (this.logger.isLevelEnabled('trace')) {
        this.logger.trace(
          `${requestDetails.formattedRequestId} eth_call gas amount (${gas}) exceeds network limit, capping gas to ${constants.MAX_GAS_PER_SEC}`,
        );
      }
      return constants.MAX_GAS_PER_SEC;
    }

    return gas;
  }

  /**
   * Retrieves contract bytecode from the SDK client.
   *
   * @param {string} address - The contract address
   * @param {RequestDetails} requestDetails - The request details for logging and tracking
   * @returns {Promise<string>} The contract bytecode prefixed with '0x'
   * @private
   */
  private async getCodeFromSDKClient(address: string, requestDetails: RequestDetails): Promise<string> {
    const bytecode = await this.hapiService
      .getSDKClient()
      .getContractByteCode(0, 0, address, CommonService.ethGetCode, requestDetails);
    return prepend0x(Buffer.from(bytecode).toString('hex'));
  }

  /**
   * Attempts to get code from cache and mirror node.
   *
   * @param {string} address - The contract address
   * @param {string | null} blockNumber - Block number or tag
   * @param {RequestDetails} requestDetails - The request details
   * @returns {Promise<string | null>} The contract code if found, null otherwise
   * @private
   */
  private async getCodeWithCache(
    address: string,
    blockNumber: string | null,
    requestDetails: RequestDetails,
  ): Promise<string | null> {
    const cachedLabel = `getCode.${address}.${blockNumber}`;
    const cachedResponse: string | undefined = await this.cacheService.getAsync(
      cachedLabel,
      CommonService.ethGetCode,
      requestDetails,
    );
    if (cachedResponse != undefined) {
      return cachedResponse;
    }

    const mirrorNodeResult = await this.tryGetCodeFromMirrorNode(address, blockNumber, cachedLabel, requestDetails);
    if (mirrorNodeResult) {
      return mirrorNodeResult;
    }

    return null;
  }

  /**
   * Handles errors from consensus node calls.
   *
   * @param {any} e - The error to handle
   * @param {RequestDetails} requestDetails - The request details
   * @returns {string | JsonRpcError} The appropriate error response
   * @private
   */
  private handleConsensusNodeError(e: any, requestDetails: RequestDetails): string | JsonRpcError {
    const requestIdPrefix = requestDetails.formattedRequestId;
    this.logger.error(e, `${requestIdPrefix} Failed to successfully submit contractCallQuery`);

    if (e instanceof JsonRpcError) {
      return e;
    }

    if (e instanceof SDKClientError) {
      this.hapiService.decrementErrorCounter(e.statusCode);
    }
    return predefined.INTERNAL_ERROR(e.message.toString());
  }

  /**
   * Processes and caches contract bytecode if it doesn't contain prohibited opcodes.
   *
   * @param {IContractResult} result - The contract result containing bytecode
   * @param {string} cachedLabel - The cache key to store the bytecode
   * @param {RequestDetails} requestDetails - The request details for logging and tracking
   * @returns {Promise<string | null>} The runtime bytecode if valid, null otherwise
   * @private
   */
  private async handleContractBytecode(
    result: IContractResult,
    cachedLabel: string,
    requestDetails: RequestDetails,
  ): Promise<string | null> {
    if (result?.entity.runtime_bytecode !== CommonService.emptyHex) {
      if (!this.hasProhibitedOpcodes(result.entity.runtime_bytecode)) {
        await this.cacheService.set(
          cachedLabel,
          result.entity.runtime_bytecode,
          CommonService.ethGetCode,
          requestDetails,
        );
        return result.entity.runtime_bytecode;
      }
    }
    return null;
  }

  /**
   * Handles errors that occur during getCode operations.
   *
   * @param {any} e - The error to handle
   * @param {string} address - The contract address
   * @param {string | null} blockNumber - The block number or tag
   * @param {string} requestIdPrefix - The request ID prefix for logging
   * @returns {string | never} The error response or throws if unhandled
   * @private
   */
  private handleGetCodeError(
    e: any,
    address: string,
    blockNumber: string | null,
    requestIdPrefix: string,
  ): string | never {
    if (e instanceof SDKClientError) {
      return this.handleSDKClientError(e, address, blockNumber, requestIdPrefix);
    }

    if (e instanceof PrecheckStatusError) {
      return this.handlePrecheckStatusError(e, address, blockNumber, requestIdPrefix);
    }

    this.logger.error(e, `${requestIdPrefix} Error raised during getCode for address ${address}`);
    throw e;
  }

  /**
   * Handles specific mirror node client errors.
   *
   * @param {MirrorNodeClientError} e - The mirror node client error
   * @param {IContractCallRequest} call - The original call request
   * @param {number | null} gas - The gas limit
   * @param {RequestDetails} requestDetails - The request details
   * @returns {Promise<string | JsonRpcError>} The appropriate error response or consensus node fallback result
   * @private
   */
  private async handleMirrorNodeClientError(
    e: MirrorNodeClientError,
    call: IContractCallRequest,
    gas: number | null,
    requestDetails: RequestDetails,
  ): Promise<string | JsonRpcError> {
    const requestIdPrefix = requestDetails.formattedRequestId;

    if (e.isFailInvalid() || e.isInvalidTransaction()) {
      return CommonService.emptyHex;
    }

    if (e.isContractReverted()) {
      if (this.logger.isLevelEnabled('trace')) {
        this.logger.trace(
          `${requestIdPrefix} mirror node eth_call request encountered contract revert. message: ${e.message}, details: ${e.detail}, data: ${e.data}`,
        );
      }
      return predefined.CONTRACT_REVERT(e.detail || e.message, e.data);
    }
    // for any other Mirror Node upstream server errors (429, 500, 502, 503, 504, etc.), preserve the original error and re-throw to the upper layer
    throw e;
  }

  /**
   * Handles various error cases from mirror node calls.
   *
   * @param {any} e - The error to handle
   * @param {IContractCallRequest} call - The original call request
   * @param {number | null} gas - The gas limit
   * @param {RequestDetails} requestDetails - The request details
   * @returns {Promise<string | JsonRpcError>} The error response or consensus node fallback result
   * @private
   */
  private async handleMirrorNodeError(
    e: any,
    call: IContractCallRequest,
    gas: number | null,
    requestDetails: RequestDetails,
  ): Promise<string | JsonRpcError> {
    const requestIdPrefix = requestDetails.formattedRequestId;

    if (e instanceof JsonRpcError) {
      return e;
    }

    if (e instanceof MirrorNodeClientError) {
      return await this.handleMirrorNodeClientError(e, call, gas, requestDetails);
    }

    this.logger.error(e, `${requestIdPrefix} Failed to successfully submit eth_call`);
    return predefined.INTERNAL_ERROR(e.message.toString());
  }

  /**
   * Handles precheck status errors during contract operations.
   *
   * @param {PrecheckStatusError} e - The precheck status error
   * @param {string} address - The contract address
   * @param {string | null} blockNumber - The block number or tag
   * @param {string} requestIdPrefix - The request ID prefix for logging
   * @returns {string | never} The empty hex string for known errors or throws
   * @private
   */
  private handlePrecheckStatusError(
    e: PrecheckStatusError,
    address: string,
    blockNumber: string | null,
    requestIdPrefix: string,
  ): string | never {
    if (
      e.status._code === constants.PRECHECK_STATUS_ERROR_STATUS_CODES.INVALID_CONTRACT_ID ||
      e.status._code === constants.PRECHECK_STATUS_ERROR_STATUS_CODES.CONTRACT_DELETED
    ) {
      if (this.logger.isLevelEnabled('debug')) {
        this.logger.debug(
          `${requestIdPrefix} Unable to find code for contract ${address} in block "${blockNumber}", returning 0x0, err code: ${e.status._code}`,
        );
      }
      return CommonService.emptyHex;
    }

    this.hapiService.decrementErrorCounter(e.status._code);
    this.logger.error(
      e,
      `${requestIdPrefix} Error raised during getCode for address ${address}, err code: ${e.status._code}`,
    );
    throw e;
  }

  /**
   * Handles SDK client errors during contract operations.
   *
   * @param {SDKClientError} e - The SDK client error
   * @param {string} address - The contract address
   * @param {string | null} blockNumber - The block number or tag
   * @param {string} requestIdPrefix - The request ID prefix for logging
   * @returns {string | never} The empty hex string for known errors or throws
   * @private
   */
  private handleSDKClientError(
    e: SDKClientError,
    address: string,
    blockNumber: string | null,
    requestIdPrefix: string,
  ): string | never {
    if (e.isInvalidContractId() || e.isContractDeleted()) {
      if (this.logger.isLevelEnabled('debug')) {
        this.logger.debug(
          `${requestIdPrefix} Unable to find code for contract ${address} in block "${blockNumber}", returning 0x0, err code: ${e.statusCode}`,
        );
      }
      return CommonService.emptyHex;
    }

    this.hapiService.decrementErrorCounter(e.statusCode);
    this.logger.error(
      e,
      `${requestIdPrefix} Error raised during getCode for address ${address}, err code: ${e.statusCode}`,
    );
    throw e;
  }

  /**
   * Handles token redirect cases by generating appropriate bytecode.
   *
   * @param {string} address - The token address
   * @param {string} requestIdPrefix - The request ID prefix for logging
   * @returns {string} The redirect bytecode for the token
   * @private
   */
  private handleTokenRedirect(address: string, requestIdPrefix: string): string {
    if (this.logger.isLevelEnabled('trace')) {
      this.logger.trace(`${requestIdPrefix} Token redirect case, return redirectBytecode`);
    }
    return `${ContractService.redirectBytecodePrefix}${address.slice(2)}${ContractService.redirectBytecodePostfix}`;
  }

  /**
   * Checks if the provided bytecode contains any prohibited EVM opcodes.
   *
   * @param {string} bytecode - The bytecode to check
   * @returns {boolean} True if prohibited opcodes are found, false otherwise
   * @private
   */
  private hasProhibitedOpcodes(bytecode: string): boolean {
    const prohibitedOpcodes = ['CALLCODE', 'DELEGATECALL', 'SELFDESTRUCT', 'SUICIDE'];
    const opcodes = disassemble(bytecode);
    return opcodes.filter((opcode) => prohibitedOpcodes.indexOf(opcode.opcode.mnemonic) > -1).length > 0;
  }

  /**
   * Checks if the address is the HTS precompile address.
   *
   * @param {string} address - The address to check
   * @param {string} requestIdPrefix - The request ID prefix for logging
   * @returns {boolean} True if address is HTS precompile
   * @private
   */
  private isHTSPrecompile(address: string, requestIdPrefix: string): boolean {
    if (address === ContractService.iHTSAddress) {
      if (this.logger.isLevelEnabled('trace')) {
        this.logger.trace(
          `${requestIdPrefix} HTS precompile case, return ${constants.INVALID_EVM_INSTRUCTION} for byte code`,
        );
      }
      return true;
    }
    return false;
  }

  /**
   * Fallback calculations for the amount of gas to be used for a transaction.
   * This method is used when the mirror node fails to return a gas estimate.
   *
   * @param {IContractCallRequest} transaction The transaction data for the contract call.
   * @param {RequestDetails} requestDetails The request details for logging and tracking.
   * @param error (Optional) received error from the mirror-node contract call request.
   * @returns {Promise<string | JsonRpcError>} the calculated gas cost for the transaction
   */
  private async predefinedGasForTransaction(
    transaction: IContractCallRequest,
    requestDetails: RequestDetails,
    error?: any,
  ): Promise<string | JsonRpcError> {
    const requestIdPrefix = requestDetails.formattedRequestId;
    const isSimpleTransfer = !!transaction?.to && (!transaction.data || transaction.data === '0x');
    const isContractCall =
      !!transaction?.to && transaction?.data && transaction.data.length >= constants.FUNCTION_SELECTOR_CHAR_LENGTH;
    const isContractCreate = !transaction?.to && transaction?.data && transaction.data !== '0x';

    if (isSimpleTransfer) {
      // Handle Simple Transaction and Hollow Account creation
      const isZeroOrHigher = Number(transaction.value) >= 0;
      if (!isZeroOrHigher) {
        return predefined.INVALID_PARAMETER(
          0,
          `Invalid 'value' field in transaction param. Value must be greater than or equal to 0`,
        );
      }
      // when account exists return default base gas
      if (await this.common.getAccount(transaction.to!, requestDetails)) {
        this.logger.warn(
          `${requestIdPrefix} Returning predefined gas for simple transfer: ${ContractService.gasTxBaseCost}`,
        );
        return ContractService.gasTxBaseCost;
      }
      // otherwise, return the minimum amount of gas for hollow account creation
      this.logger.warn(
        `${requestIdPrefix} Returning predefined gas for hollow account creation: ${ContractService.minGasTxHollowAccountCreation}`,
      );
      return ContractService.minGasTxHollowAccountCreation;
    } else if (isContractCreate) {
      // The size limit of the encoded contract posted to the mirror node can
      // cause contract deployment transactions to fail with a 400 response code.
      // The contract is actually deployed on the consensus node, so the contract will work.
      // In these cases, we don't want to return a CONTRACT_REVERT error.
      if (
        this.estimateGasThrows &&
        error?.isContractReverted() &&
        error?.message !== MirrorNodeClientError.messages.INVALID_HEX
      ) {
        return predefined.CONTRACT_REVERT(error.detail, error.data);
      }
      this.logger.warn(
        `${requestIdPrefix} Returning predefined gas for contract creation: ${ContractService.gasTxBaseCost}`,
      );
      return numberTo0x(Precheck.transactionIntrinsicGasCost(transaction.data!));
    } else if (isContractCall) {
      this.logger.warn(`${requestIdPrefix} Returning predefined gas for contract call: ${this.contractCallAverageGas}`);
      return this.contractCallAverageGas;
    } else {
      this.logger.warn(`${requestIdPrefix} Returning predefined gas for unknown transaction: ${this.defaultGas}`);
      return this.defaultGas;
    }
  }

  /**
   * Prepares the call data for mirror node request.
   *
   * @param {IContractCallRequest} call - The original call request
   * @param {number | null} gas - The gas limit
   * @param {number | string | null | undefined} value - The value to send
   * @param {string | null} block - The block number or tag
   * @returns {IContractCallRequest} The prepared call data
   * @private
   */
  private prepareMirrorNodeCallData(
    call: IContractCallRequest,
    gas: number | null,
    value: number | string | null | undefined,
    block: string | null,
  ): IContractCallRequest {
    return {
      ...call,
      ...(gas !== null ? { gas } : {}),
      ...(value !== null ? { value } : {}),
      estimate: false,
      ...(block !== null ? { block } : {}),
    };
  }

  /**
   * Routes the call to either consensus or mirror node based on configuration and selector.
   *
   * @param {IContractCallRequest} call - The call request
   * @param {number | null} gas - The gas limit
   * @param {string | null} blockNumberOrTag - The block number or tag
   * @param {RequestDetails} requestDetails - The request details
   * @returns {Promise<string | JsonRpcError>} The call result
   * @private
   */
  private async routeAndExecuteCall(
    call: IContractCallRequest,
    gas: number | null,
    blockNumberOrTag: string | null,
    requestDetails: RequestDetails,
  ): Promise<string | JsonRpcError> {
    const selector = getFunctionSelector(call.data || '0x');

    // When eth_call is invoked with a selector listed in specialSelectors, it will be routed through the consensus node, regardless of ETH_CALL_DEFAULT_TO_CONSENSUS_NODE.
    // note: this feature is a workaround for when a feature is supported by consensus node but not yet by mirror node.
    const specialSelectors = ConfigService.get('ETH_CALL_CONSENSUS_SELECTORS');
    const shouldForceToConsensus = selector !== '' && specialSelectors.includes(selector);

    // ETH_CALL_DEFAULT_TO_CONSENSUS_NODE = false enables the use of Mirror node
    const shouldDefaultToConsensus = ConfigService.get('ETH_CALL_DEFAULT_TO_CONSENSUS_NODE');

    if (shouldForceToConsensus || shouldDefaultToConsensus) {
      return await this.callConsensusNode(call, gas, requestDetails);
    }

    //temporary workaround until precompiles are implemented in Mirror node evm module
    return await this.callMirrorNode(call, gas, call.value, blockNumberOrTag, requestDetails);
  }

  /**
   * Attempts to retrieve a cached response for the call.
   *
   * @param {IContractCallRequest} call - The call request
   * @param {RequestDetails} requestDetails - The request details
   * @returns {Promise<string | undefined>} The cached response if found
   * @private
   */
  private async tryGetCachedResponse(
    call: IContractCallRequest,
    requestDetails: RequestDetails,
  ): Promise<string | undefined> {
    const data = call.data
      ? crypto
          .createHash('sha1')
          .update(call.data || '0x')
          .digest('hex')
      : null; // NOSONAR
    const cacheKey = `${constants.CACHE_KEY.ETH_CALL}:${call.from || ''}.${call.to}.${data}`;
    const cachedResponse = await this.cacheService.getAsync(cacheKey, CommonService.ethCall, requestDetails);

    if (this.logger.isLevelEnabled('debug')) {
      this.logger.debug(
        `${requestDetails.formattedRequestId} Cache lookup for key ${cacheKey} returned: ${cachedResponse}`,
      );
    }

    return cachedResponse === null ? undefined : cachedResponse;
  }

  /**
   * Attempts to retrieve contract code from the mirror node.
   *
   * @param {string} address - The contract address
   * @param {string | null} blockNumber - The block number or tag
   * @param {string} cachedLabel - The cache key for storing results
   * @param {RequestDetails} requestDetails - The request details for logging and tracking
   * @returns {Promise<string | null>} The contract code if found, null otherwise
   * @private
   */
  private async tryGetCodeFromMirrorNode(
    address: string,
    blockNumber: string | null,
    cachedLabel: string,
    requestDetails: RequestDetails,
  ): Promise<string | null> {
    const result = await this.mirrorNodeClient.resolveEntityType(address, CommonService.ethGetCode, requestDetails, [
      constants.TYPE_CONTRACT,
      constants.TYPE_TOKEN,
    ]);

    if (!result) return null;

    // Check if contract was created after the requested block
    const blockInfo = await this.common.getHistoricalBlockResponse(requestDetails, blockNumber, true);
    if (!blockInfo || parseFloat(result.entity?.created_timestamp) > parseFloat(blockInfo.timestamp.to)) {
      return CommonService.emptyHex;
    }

    if (result.type === constants.TYPE_TOKEN) {
      return this.handleTokenRedirect(address, requestDetails.formattedRequestId);
    }

    if (result.type === constants.TYPE_CONTRACT) {
      return await this.handleContractBytecode(result, cachedLabel, requestDetails);
    }

    return null;
  }

  /**
   * Validates the from and to addresses in the call request.
   *
   * @param {IContractCallRequest} call - The call request to validate
   * @returns {Promise<void>}
   * @private
   */
  private async validateAddresses(call: IContractCallRequest): Promise<void> {
    if (call.from && !isValidEthereumAddress(call.from)) {
      throw predefined.NON_EXISTING_ACCOUNT(call.from);
    }

    if (!isValidEthereumAddress(call.to)) {
      throw predefined.INVALID_CONTRACT_ADDRESS(call.to);
    }
  }
}
