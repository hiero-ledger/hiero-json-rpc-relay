// SPDX-License-Identifier: Apache-2.0

import { ConfigService } from '@hashgraph/json-rpc-config-service/dist/services';
import { Logger } from 'pino';

import {
  isValidEthereumAddress,
  numberTo0x,
  parseNumericEnvVar,
  prepend0x,
  trimPrecedingZeros,
  weibarHexToTinyBarInt,
} from '../../../../formatters';
import { MirrorNodeClient } from '../../../clients';
import constants from '../../../constants';
import { JsonRpcError, predefined } from '../../../errors/JsonRpcError';
import { MirrorNodeClientError } from '../../../errors/MirrorNodeClientError';
import { Log } from '../../../model';
import { Precheck } from '../../../precheck';
import { IContractCallRequest, IContractCallResponse, IGetLogsParams, RequestDetails } from '../../../types';
import { CacheService } from '../../cacheService/cacheService';
import { CommonService } from '../../ethService/ethCommonService/CommonService';
import { ICommonService } from '../../ethService/ethCommonService/ICommonService';
import HAPIService from '../../hapiService/hapiService';
import { IContractService } from './IContractService';

/**
 * Service responsible for handling contract-related operations.
 */
export class ContractService implements IContractService {
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
   * The default gas value for transactions.
   * @private
   * @readonly
   */
  private readonly defaultGas = numberTo0x(parseNumericEnvVar('TX_DEFAULT_GAS', 'TX_DEFAULT_GAS_DEFAULT'));

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
   * @returns An empty array of addresses
   */
  public accounts(): [] {
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
      const gas = this.getCappedBlockGasLimit(call.gas?.toString());
      await this.contractCallFormat(call, requestDetails);

      const result = await this.callMirrorNode(call, gas, call.value, blockNumberOrTag, requestDetails);
      if (this.logger.isLevelEnabled('debug')) {
        this.logger.debug(`eth_call response: %s`, JSON.stringify(result));
      }

      return result;
    } catch (e: any) {
      this.logger.error(e, `Failed to successfully submit eth_call`);
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
    try {
      const response = await this.estimateGasFromMirrorNode(transaction, requestDetails);

      if (!response?.result) {
        if (this.logger.isLevelEnabled('debug')) {
          this.logger.debug(`No gas estimate returned from mirror-node: ${JSON.stringify(response)}`);
        }
        return predefined.INTERNAL_ERROR('Fail to retrieve gas estimate');
      }

      return prepend0x(trimPrecedingZeros(response.result));
    } catch (e: any) {
      if (e instanceof MirrorNodeClientError) {
        if (e.isContractRevert()) {
          throw predefined.CONTRACT_REVERT(e.detail || e.message, e.data);
        } else if (e.statusCode === 400) {
          throw predefined.COULD_NOT_SIMULATE_TRANSACTION(e.detail || e.message);
        }
      }

      // for any other error or Mirror Node upstream server errors (429, 500, 502, 503, 504, etc.),
      // preserve the original error and re-throw to the upper layer for further handling logic
      throw e;
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
  public async getCode(address: string, blockNumber: string | null, requestDetails: RequestDetails): Promise<string> {
    if (!this.common.isBlockParamValid(blockNumber)) {
      throw predefined.UNKNOWN_BLOCK(
        `The value passed is not a valid blockHash/blockNumber/blockTag value: ${blockNumber}`,
      );
    }

    // check for static precompile cases first before consulting nodes
    // this also account for environments where system entities were not yet exposed to the mirror node
    if (address === constants.HTS_ADDRESS) {
      this.logger.trace(`HTS precompile case, return %s for byte code`, constants.INVALID_EVM_INSTRUCTION);
      return constants.INVALID_EVM_INSTRUCTION;
    }

    try {
      const result = await this.mirrorNodeClient.resolveEntityType(address, constants.ETH_GET_CODE, requestDetails, [
        constants.TYPE_CONTRACT,
        constants.TYPE_TOKEN,
      ]);
      if (result) {
        const blockInfo = await this.common.getHistoricalBlockResponse(requestDetails, blockNumber, true);
        if (!blockInfo || parseFloat(result.entity?.created_timestamp) > parseFloat(blockInfo.timestamp.to)) {
          return constants.EMPTY_HEX;
        }
        if (result.type === constants.TYPE_TOKEN) {
          this.logger.trace(`Token redirect case, return redirectBytecode`);
          return CommonService.redirectBytecodeAddressReplace(address);
        } else if (result.type === constants.TYPE_CONTRACT) {
          if (result.entity.runtime_bytecode !== constants.EMPTY_HEX) {
            return result.entity.runtime_bytecode;
          }
        }
      }

      this.logger.debug(`Address %s is not a contract nor an HTS token, returning empty hex`, address);

      return constants.EMPTY_HEX;
    } catch (error: any) {
      this.logger.error(
        `Error raised during getCode: address=%s, blockNumber=%s, error=%s`,
        address,
        blockNumber,
        error.message,
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
   * @param {string} blockNumberOrTagOrHash - Block number, tag, or hash
   * @param {RequestDetails} requestDetails - The request details for logging and tracking
   * @returns {Promise<string>} The value at the given storage position
   */
  public async getStorageAt(
    address: string,
    slot: string,
    blockNumberOrTagOrHash: string,
    requestDetails: RequestDetails,
  ): Promise<string> {
    let result = constants.ZERO_HEX_32_BYTE; // if contract or slot not found then return 32 byte 0

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
          `Failed to retrieve current contract state for address ${address} at slot=${slot}`,
        );
      });

    return result;
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
    try {
      this.logger.debug(
        `Making eth_call on contract %s with gas %s and call data "%s" from "%s" at blockBlockNumberOrTag: "%s" using mirror-node.`,
        call.to,
        gas,
        call.data,
        call.from,
        block,
      );
      const callData = this.prepareMirrorNodeCallData(call, gas, value, block);
      return await this.executeMirrorNodeCall(callData, requestDetails);
    } catch (e: any) {
      return this.handleMirrorNodeError(e);
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
        transaction.from = this.hapiService.getOperatorPublicKey()?.toEvmAddress();
      } else {
        const operatorId = this.hapiService.getOperatorAccountId()!.toString();
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
   * Executes the mirror node call and formats the response.
   *
   * @param {IContractCallRequest} callData - The prepared call data
   * @param {RequestDetails} requestDetails - The request details
   * @returns {Promise<string>} The formatted call response
   * @private
   */
  private async executeMirrorNodeCall(callData: IContractCallRequest, requestDetails: RequestDetails): Promise<string> {
    const contractCallResponse = await this.mirrorNodeClient.postContractCall(callData, requestDetails);
    return contractCallResponse?.result ? prepend0x(contractCallResponse.result) : constants.EMPTY_HEX;
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
   * @returns {number | null} The capped gas limit as a number, or null if no valid gas limit could be determined
   * @private
   */
  private getCappedBlockGasLimit(gasString: string | undefined): number | null {
    if (!gasString) {
      // Return null and don't include in the mirror node call, as mirror is doing this estimation on the go.
      return null;
    }

    // Gas limit for `eth_call` is 50_000_000, but the current Hedera network limit is 15_000_000
    // With values over the gas limit, the call will fail with BUSY error so we cap it at 15_000_000
    const gas = Number.parseInt(gasString);
    if (gas > constants.MAX_GAS_PER_SEC) {
      this.logger.trace(
        `eth_call gas amount (%s) exceeds network limit, capping gas to %s`,
        gas,
        constants.MAX_GAS_PER_SEC,
      );
      return constants.MAX_GAS_PER_SEC;
    }

    return gas;
  }

  /**
   * Handles specific mirror node client errors.
   *
   * @param {MirrorNodeClientError} e - The mirror node client error
   * @returns {Promise<string | JsonRpcError>} The appropriate error response or consensus node fallback result
   * @private
   */
  private async handleMirrorNodeClientError(e: MirrorNodeClientError): Promise<string | JsonRpcError> {
    if (e.isFailInvalid() || e.isInvalidTransaction()) {
      return constants.EMPTY_HEX;
    }

    if (e.isContractRevert()) {
      throw predefined.CONTRACT_REVERT(e.detail || e.message, e.data);
    } else if (e.statusCode === 400) {
      throw predefined.COULD_NOT_SIMULATE_TRANSACTION(e.detail || e.message);
    }

    // for any other error or Mirror Node upstream server errors (429, 500, 502, 503, 504, etc.),
    // preserve the original error and re-throw to the upper layer for further handling logic
    throw e;
  }

  /**
   * Handles various error cases from mirror node calls.
   *
   * @param {any} e - The error to handle
   * @returns {Promise<string | JsonRpcError>} The error response or consensus node fallback result
   * @private
   */
  private async handleMirrorNodeError(e: any): Promise<string | JsonRpcError> {
    if (e instanceof JsonRpcError) {
      return e;
    }

    if (e instanceof MirrorNodeClientError) {
      return await this.handleMirrorNodeClientError(e);
    }

    this.logger.error(e, 'Failed to successfully submit eth_call');
    return predefined.INTERNAL_ERROR(e.message.toString());
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
}
