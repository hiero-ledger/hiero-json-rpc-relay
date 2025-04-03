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
import { IContractCallRequest, IContractResult, IGetLogsParams, RequestDetails } from '../../types';
import { CacheService } from '../cacheService/cacheService';
import { CommonService } from '../ethService/ethCommonService';
import HAPIService from '../hapiService/hapiService';
import { IContractService } from './IContractService';

/**
 * Service responsible for handling contract-related operations.
 */
export class ContractService implements IContractService {
  /**
   * The cache service used for caching responses.
   * @private
   */
  private readonly cacheService: CacheService;

  /**
   * The common service used for all common methods.
   * @private
   */
  private readonly common: CommonService;

  /**
   * The default gas value for transactions.
   * @private
   */
  private readonly defaultGas = numberTo0x(parseNumericEnvVar('TX_DEFAULT_GAS', 'TX_DEFAULT_GAS_DEFAULT'));

  /**
   * The cache TTL for Ethereum call responses.
   * @private
   */
  private readonly ethCallCacheTtl = parseNumericEnvVar('ETH_CALL_CACHE_TTL', 'ETH_CALL_CACHE_TTL_DEFAULT');

  /**
   * The interface for HAPI service to interact with consensus nodes.
   * @private
   */
  private readonly hapiService: HAPIService;

  /**
   * The logger used for logging all output from this class.
   * @private
   */
  private readonly logger: Logger;

  /**
   * The interface through which we interact with the mirror node.
   * @private
   */
  private readonly mirrorNodeClient: MirrorNodeClient;

  static redirectBytecodePrefix = '6080604052348015600f57600080fd5b506000610167905077618dc65e';
  static redirectBytecodePostfix =
    '600052366000602037600080366018016008845af43d806000803e8160008114605857816000f35b816000fdfea2646970667358221220d8378feed472ba49a0005514ef7087017f707b45fb9bf56bb81bb93ff19a238b64736f6c634300080b0033';

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
    mirrorNodeClient: MirrorNodeClient,
    common: CommonService,
    logger: Logger,
    cacheService: CacheService,
    hapiService: HAPIService,
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
   * @returns {never[]} An empty array of addresses
   */
  accounts(requestDetails: RequestDetails): never[] {
    if (this.logger.isLevelEnabled('trace')) {
      this.logger.trace(`${requestDetails.formattedRequestId} accounts()`);
    }
    return EthImpl.accounts;
  }

  /**
   * Executes a new message call immediately without creating a transaction on the blockchain.
   *
   * @param {IContractCallRequest} call - The transaction object with call data
   * @param {string | object | null} blockParam - Block number, tag, or object with blockHash/blockNumber
   * @param {RequestDetails} requestDetails - The request details for logging and tracking
   * @returns {Promise<string | JsonRpcError>} The return value of the executed contract call or error
   */
  async call(
    call: IContractCallRequest,
    blockParam: string | object | null,
    requestDetails: RequestDetails,
  ): Promise<string | JsonRpcError> {
    const requestIdPrefix = requestDetails.formattedRequestId;
    const callData = call.data ? call.data : call.input;
    // log request
    this.logger.info(
      `${requestIdPrefix} call({to=${call.to}, from=${call.from}, data=${callData}, gas=${call.gas}, gasPrice=${call.gasPrice} blockParam=${blockParam}, estimate=${call.estimate})`,
    );
    // log call data size
    const callDataSize = callData ? callData.length : 0;
    if (this.logger.isLevelEnabled('trace')) {
      this.logger.trace(`${requestIdPrefix} call data size: ${callDataSize}`);
    }
    const blockNumberOrTag = await this.extractBlockNumberOrTag(blockParam, requestDetails);
    await this.performCallChecks(call);
    // Get a reasonable value for "gas" if it is not specified.
    const gas = this.getCappedBlockGasLimit(call.gas?.toString(), requestDetails);

    await this.contractCallFormat(call, requestDetails);
    const selector = getFunctionSelector(call.data!);

    // When eth_call is invoked with a selector listed in specialSelectors, it will be routed through the consensus node, regardless of ETH_CALL_DEFAULT_TO_CONSENSUS_NODE.
    // note: this feature is a workaround for when a feature is supported by consensus node but not yet by mirror node.
    const specialSelectors = ConfigService.get('ETH_CALL_CONSENSUS_SELECTORS');
    const shouldForceToConsensus = selector !== '' && specialSelectors.includes(selector);

    // ETH_CALL_DEFAULT_TO_CONSENSUS_NODE = false enables the use of Mirror node
    const shouldDefaultToConsensus = ConfigService.get('ETH_CALL_DEFAULT_TO_CONSENSUS_NODE');

    let result: string | JsonRpcError = '';
    try {
      if (shouldForceToConsensus || shouldDefaultToConsensus) {
        result = await this.callConsensusNode(call, gas, requestDetails);
      } else {
        //temporary workaround until precompiles are implemented in Mirror node evm module
        // Execute the call and get the response
        result = await this.callMirrorNode(call, gas, call.value, blockNumberOrTag, requestDetails);
      }

      if (this.logger.isLevelEnabled('debug')) {
        this.logger.debug(`${requestIdPrefix} eth_call response: ${JSON.stringify(result)}`);
      }

      return result;
    } catch (e: any) {
      this.logger.error(e, `${requestIdPrefix} Failed to successfully submit eth_call`);
      if (e instanceof JsonRpcError) {
        return e;
      }
      return predefined.INTERNAL_ERROR(e.message.toString());
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
  async getCode(address: string, blockNumber: string | null, requestDetails: RequestDetails): Promise<string> {
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
    if (address === EthImpl.iHTSAddress) {
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
      EthImpl.ethGetCode,
      requestDetails,
    );
    if (cachedResponse != undefined) {
      return cachedResponse;
    }

    try {
      const mirrorNodeResult = await this.tryGetCodeFromMirrorNode(address, blockNumber, cachedLabel, requestDetails);
      if (mirrorNodeResult) {
        return mirrorNodeResult;
      }

      return await this.getCodeFromSDKClient(address, requestDetails);
    } catch (e: any) {
      return this.handleGetCodeError(e, address, blockNumber, requestDetails.formattedRequestId);
    }
  }

  /**
   * Returns an array of all logs matching the given filter criteria.
   *
   * @param {IGetLogsParams} params - The filter criteria
   * @param {RequestDetails} requestDetails - The request details for logging and tracking
   * @returns {Promise<Log[]>} An array of log objects
   */
  async getLogs(params: IGetLogsParams, requestDetails: RequestDetails): Promise<Log[]> {
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
  async getStorageAt(
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

    let result = EthImpl.zeroHex32Byte; // if contract or slot not found then return 32 byte 0

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
   * Perform value format precheck before making contract call towards the mirror node
   * @param {IContractCallRequest} transaction the transaction object
   * @param {RequestDetails} requestDetails the request details for logging and tracking
   */
  async contractCallFormat(transaction: IContractCallRequest, requestDetails: RequestDetails): Promise<void> {
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
   * Performs validation checks for contract calls.
   *
   * @param {IContractCallRequest} call - The call to validate
   * @returns {Promise<void>} A promise that resolves when validation is complete
   * @private
   */
  async performCallChecks(call: IContractCallRequest): Promise<void> {
    if (call.to && !isValidEthereumAddress(call.to)) {
      throw predefined.INVALID_CONTRACT_ADDRESS(call.to);
    }
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
  async extractBlockNumberOrTag(
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
   * Makes a contract call via the Mirror Node.
   *
   * @param {IContractCallRequest} call - The call data
   * @param {number | null} gas - The gas limit
   * @param {number | string | null | undefined} value - The value to send
   * @param {string | null} block - The block number or tag
   * @param {RequestDetails} requestDetails - The request details for logging and tracking
   * @returns {Promise<string | JsonRpcError>} The call result or error
   */
  async callMirrorNode(
    call: IContractCallRequest,
    gas: number | null,
    value: number | string | null | undefined,
    block: string | null,
    requestDetails: RequestDetails,
  ): Promise<string | JsonRpcError> {
    const requestIdPrefix = requestDetails.formattedRequestId;
    let callData: IContractCallRequest = {};
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
      callData = {
        ...call,
        ...(gas !== null ? { gas } : {}), // Add gas only if it's not null
        ...(value !== null ? { value } : {}),
        estimate: false,
        ...(block !== null ? { block } : {}),
      };
      const contractCallResponse = await this.mirrorNodeClient.postContractCall(callData, requestDetails);
      return contractCallResponse?.result ? prepend0x(contractCallResponse.result) : EthImpl.emptyHex;
    } catch (e: any) {
      if (e instanceof JsonRpcError) {
        return e;
      }

      if (e instanceof MirrorNodeClientError) {
        // Handles mirror node error for missing contract
        if (e.isFailInvalid() || e.isInvalidTransaction()) {
          return EthImpl.emptyHex;
        }

        if (e.isRateLimit()) {
          return predefined.IP_RATE_LIMIT_EXCEEDED(e.data || `Rate limit exceeded on ${EthImpl.ethCall}`);
        }

        if (e.isContractReverted()) {
          if (this.logger.isLevelEnabled('trace')) {
            this.logger.trace(
              `${requestIdPrefix} mirror node eth_call request encountered contract revert. message: ${e.message}, details: ${e.detail}, data: ${e.data}`,
            );
          }
          return predefined.CONTRACT_REVERT(e.detail || e.message, e.data);
        }

        // Temporary workaround until mirror node web3 module implements the support of precompiles
        // If mirror node throws, rerun eth_call and force it to go through the Consensus network
        if (e.isNotSupported() || e.isNotSupportedSystemContractOperaton()) {
          const errorTypeMessage =
            e.isNotSupported() || e.isNotSupportedSystemContractOperaton() ? 'Unsupported' : 'Unhandled';
          if (this.logger.isLevelEnabled('trace')) {
            this.logger.trace(
              `${requestIdPrefix} ${errorTypeMessage} mirror node eth_call request, retrying with consensus node. details: ${JSON.stringify(
                callData,
              )} with error: "${e.message}"`,
            );
          }
          return await this.callConsensusNode(call, gas, requestDetails);
        }
      }

      this.logger.error(e, `${requestIdPrefix} Failed to successfully submit eth_call`);

      return predefined.INTERNAL_ERROR(e.message.toString());
    }
  }

  /**
   * Execute a contract call query to the consensus node
   *
   * @param {IContractCallRequest} call - The call data
   * @param {number | null} gas - The gas limit
   * @param {RequestDetails} requestDetails - The request details for logging and tracking
   * @returns {Promise<string | JsonRpcError>} The call result or error
   */
  async callConsensusNode(
    call: IContractCallRequest,
    gas: number | null,
    requestDetails: RequestDetails,
  ): Promise<string | JsonRpcError> {
    const requestIdPrefix = requestDetails.formattedRequestId;
    // Execute the call and get the response
    if (!gas) {
      gas = Number.parseInt(this.defaultGas);
    }
    if (this.logger.isLevelEnabled('debug')) {
      this.logger.debug(
        `${requestIdPrefix} Making eth_call on contract ${call.to} with gas ${gas} and call data "${call.data}" from "${call.from}" using consensus-node.`,
        call.to,
        gas,
        call.data,
        call.from,
      );
    }

    // If "From" is distinct from blank, we check is a valid account
    if (call.from) {
      if (!isValidEthereumAddress(call.from)) {
        throw predefined.NON_EXISTING_ACCOUNT(call.from);
      }
    }

    // Check "To" is a valid Contract or HTS Address
    if (!isValidEthereumAddress(call.to)) {
      throw predefined.INVALID_CONTRACT_ADDRESS(call.to);
    }

    try {
      let data = call.data;
      if (data) {
        data = crypto
          .createHash('sha1')
          .update(call.data || '0x')
          .digest('hex'); // NOSONAR
      }
      const cacheKey = `${constants.CACHE_KEY.ETH_CALL}:${call.from || ''}.${call.to}.${data}`;
      const cachedResponse = await this.cacheService.getAsync(cacheKey, EthImpl.ethCall, requestDetails);
      if (cachedResponse != undefined) {
        if (this.logger.isLevelEnabled('debug')) {
          this.logger.debug(`${requestIdPrefix} eth_call returned cached response: ${cachedResponse}`);
        }
        return cachedResponse;
      }
      const contractCallResponse = await this.hapiService
        .getSDKClient()
        .submitContractCallQueryWithRetry(
          call.to as string,
          call.data as string,
          gas,
          call.from as string,
          EthImpl.ethCall,
          requestDetails,
        );
      if (contractCallResponse) {
        const formattedCallReponse = prepend0x(Buffer.from(contractCallResponse.asBytes()).toString('hex'));
        await this.cacheService.set(
          cacheKey,
          formattedCallReponse,
          EthImpl.ethCall,
          requestDetails,
          this.ethCallCacheTtl,
        );
        return formattedCallReponse;
      }

      return predefined.INTERNAL_ERROR(
        `Invalid contractCallResponse from consensus-node: ${JSON.stringify(contractCallResponse)}`,
      );
    } catch (e: any) {
      this.logger.error(e, `${requestIdPrefix} Failed to successfully submit contractCallQuery`);
      if (e instanceof JsonRpcError) {
        return e;
      }

      if (e instanceof SDKClientError) {
        this.hapiService.decrementErrorCounter(e.statusCode);
      }
      return predefined.INTERNAL_ERROR(e.message.toString());
    }
  }

  private async tryGetCodeFromMirrorNode(
    address: string,
    blockNumber: string | null,
    cachedLabel: string,
    requestDetails: RequestDetails,
  ): Promise<string | null> {
    const result = await this.mirrorNodeClient.resolveEntityType(address, EthImpl.ethGetCode, requestDetails, [
      constants.TYPE_CONTRACT,
      constants.TYPE_TOKEN,
    ]);

    if (!result) return null;

    // Check if contract was created after the requested block
    const blockInfo = await this.common.getHistoricalBlockResponse(requestDetails, blockNumber, true);
    if (!blockInfo || parseFloat(result.entity?.created_timestamp) > parseFloat(blockInfo.timestamp.to)) {
      return EthImpl.emptyHex;
    }

    if (result.type === constants.TYPE_TOKEN) {
      return this.handleTokenRedirect(address, requestDetails.formattedRequestId);
    }

    if (result.type === constants.TYPE_CONTRACT) {
      return await this.handleContractBytecode(result, cachedLabel, requestDetails);
    }

    return null;
  }

  private handleTokenRedirect(address: string, requestIdPrefix: string): string {
    if (this.logger.isLevelEnabled('trace')) {
      this.logger.trace(`${requestIdPrefix} Token redirect case, return redirectBytecode`);
    }
    return ContractService.redirectBytecodeAddressReplace(address);
  }

  private async handleContractBytecode(
    result: IContractResult,
    cachedLabel: string,
    requestDetails: RequestDetails,
  ): Promise<string | null> {
    if (result?.entity.runtime_bytecode !== EthImpl.emptyHex) {
      if (!this.hasProhibitedOpcodes(result.entity.runtime_bytecode)) {
        await this.cacheService.set(cachedLabel, result.entity.runtime_bytecode, EthImpl.ethGetCode, requestDetails);
        return result.entity.runtime_bytecode;
      }
    }
    return null;
  }

  private hasProhibitedOpcodes(bytecode: string): boolean {
    const prohibitedOpcodes = ['CALLCODE', 'DELEGATECALL', 'SELFDESTRUCT', 'SUICIDE'];
    const opcodes = disassemble(bytecode);
    return opcodes.filter((opcode) => prohibitedOpcodes.indexOf(opcode.opcode.mnemonic) > -1).length > 0;
  }

  private async getCodeFromSDKClient(address: string, requestDetails: RequestDetails): Promise<string> {
    const bytecode = await this.hapiService
      .getSDKClient()
      .getContractByteCode(0, 0, address, EthImpl.ethGetCode, requestDetails);
    return prepend0x(Buffer.from(bytecode).toString('hex'));
  }

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
      return EthImpl.emptyHex;
    }

    this.hapiService.decrementErrorCounter(e.statusCode);
    this.logger.error(
      e,
      `${requestIdPrefix} Error raised during getCode for address ${address}, err code: ${e.statusCode}`,
    );
    throw e;
  }

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
      return EthImpl.emptyHex;
    }

    this.hapiService.decrementErrorCounter(e.status._code);
    this.logger.error(
      e,
      `${requestIdPrefix} Error raised during getCode for address ${address}, err code: ${e.status._code}`,
    );
    throw e;
  }

  private static redirectBytecodeAddressReplace(address: string): string {
    return `${ContractService.redirectBytecodePrefix}${address.slice(2)}${ContractService.redirectBytecodePostfix}`;
  }
}
