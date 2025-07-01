// SPDX-License-Identifier: Apache-2.0

import { ethers, Transaction } from 'ethers';
import { Logger } from 'pino';

import { prepend0x } from '../formatters';
import { MirrorNodeClient } from './clients';
import constants from './constants';
import { JsonRpcError, predefined } from './errors/JsonRpcError';
import { RequestDetails } from './types';

/**
 * Precheck class for handling various prechecks before sending a raw transaction.
 */
export class Precheck {
  private readonly mirrorNodeClient: MirrorNodeClient;
  private readonly chain: string;
  private readonly logger: Logger;

  /**
   * Creates an instance of Precheck.
   * @param {MirrorNodeClient} mirrorNodeClient - The MirrorNodeClient instance.
   * @param {Logger} logger - The logger instance.
   * @param {string} chainId - The chain ID.
   */
  constructor(mirrorNodeClient: MirrorNodeClient, logger: Logger, chainId: string) {
    this.mirrorNodeClient = mirrorNodeClient;
    this.logger = logger;
    this.chain = chainId;
  }

  /**
   * Parses the transaction if needed.
   * @param {string | Transaction} transaction - The transaction to parse.
   * @returns {Transaction} The parsed transaction.
   */
  public static parseRawTransaction(transaction: string | Transaction): Transaction {
    try {
      return typeof transaction === 'string' ? Transaction.from(transaction) : transaction;
    } catch (e: any) {
      throw predefined.INVALID_ARGUMENTS(e.message.toString());
    }
  }

  /**
   * Checks if the value of the transaction is valid.
   * @param {Transaction} tx - The transaction.
   */
  value(tx: Transaction): void {
    if ((tx.value > 0 && tx.value < constants.TINYBAR_TO_WEIBAR_COEF) || tx.value < 0) {
      throw predefined.VALUE_TOO_LOW;
    }
  }

  /**
   * Sends a raw transaction after performing various prechecks.
   * @param {ethers.Transaction} parsedTx - The parsed transaction.
   * @param {number} networkGasPriceInWeiBars - The predefined gas price of the network in weibar.
   * @param {RequestDetails} requestDetails - The request details for logging and tracking.
   */
  async sendRawTransactionCheck(
    parsedTx: ethers.Transaction,
    networkGasPriceInWeiBars: number,
    requestDetails: RequestDetails,
  ): Promise<void> {
    this.callDataSize(parsedTx);
    this.transactionSize(parsedTx);
    this.transactionType(parsedTx, requestDetails);
    this.gasLimit(parsedTx, requestDetails);
    const mirrorAccountInfo = await this.verifyAccount(parsedTx, requestDetails);
    this.nonce(parsedTx, mirrorAccountInfo.ethereum_nonce, requestDetails);
    this.chainId(parsedTx, requestDetails);
    this.value(parsedTx);
    this.gasPrice(parsedTx, networkGasPriceInWeiBars, requestDetails);
    this.balance(parsedTx, mirrorAccountInfo, requestDetails);
    await this.receiverAccount(parsedTx, requestDetails);
  }

  /**
   * Verifies the account.
   * @param {Transaction} tx - The transaction.
   * @param {RequestDetails} requestDetails - The request details for logging and tracking.
   * @returns {Promise<any>} A Promise.
   */
  async verifyAccount(tx: Transaction, requestDetails: RequestDetails): Promise<any> {
    const accountInfo = await this.mirrorNodeClient.getAccount(tx.from!, requestDetails);
    if (accountInfo == null) {
      if (this.logger.isLevelEnabled('trace')) {
        this.logger.trace(
          `${requestDetails.formattedRequestId} Failed to retrieve address '${
            tx.from
          }' account details from mirror node on verify account precheck for sendRawTransaction(transaction=${JSON.stringify(
            tx,
          )})`,
        );
      }
      throw predefined.RESOURCE_NOT_FOUND(`address '${tx.from}'.`);
    }

    return accountInfo;
  }

  /**
   * Checks the nonce of the transaction.
   * @param {Transaction} tx - The transaction.
   * @param {number} accountInfoNonce - The nonce of the account.
   * @param {RequestDetails} requestDetails - The request details for logging and tracking.
   */
  nonce(tx: Transaction, accountInfoNonce: number, requestDetails: RequestDetails): void {
    if (this.logger.isLevelEnabled('trace')) {
      this.logger.trace(
        `${requestDetails.formattedRequestId} Nonce precheck for sendRawTransaction(tx.nonce=${tx.nonce}, accountInfoNonce=${accountInfoNonce})`,
      );
    }

    if (accountInfoNonce > tx.nonce) {
      throw predefined.NONCE_TOO_LOW(tx.nonce, accountInfoNonce);
    }
  }

  /**
   * Checks the chain ID of the transaction.
   * @param {Transaction} tx - The transaction.
   * @param {RequestDetails} requestDetails - The request details for logging and tracking.
   */
  chainId(tx: Transaction, requestDetails: RequestDetails): void {
    const txChainId = prepend0x(Number(tx.chainId).toString(16));
    const passes = this.isLegacyUnprotectedEtx(tx) || txChainId === this.chain;
    if (!passes) {
      if (this.logger.isLevelEnabled('trace')) {
        this.logger.trace(
          `${requestDetails.formattedRequestId} Failed chainId precheck for sendRawTransaction(transaction=%s, chainId=%s)`,
          JSON.stringify(tx),
          txChainId,
        );
      }
      throw predefined.UNSUPPORTED_CHAIN_ID(txChainId, this.chain);
    }
  }

  /**
   * Checks if the transaction is an (unprotected) pre-EIP155 transaction.
   * Conditions include chainId being 0x0 and the signature's v value being either 27 or 28.
   * @param tx the Ethereum transaction
   */
  isLegacyUnprotectedEtx(tx: Transaction): boolean {
    const chainId = tx.chainId;
    const vValue = tx.signature?.v;
    return chainId === BigInt(0) && (vValue === 27 || vValue === 28);
  }

  /**
   * Checks the gas price of the transaction.
   * @param {Transaction} tx - The transaction.
   * @param {number} networkGasPriceInWeiBars - The predefined gas price of the network in weibar.
   * @param {string} [requestId] - The request ID.
   */
  gasPrice(tx: Transaction, networkGasPriceInWeiBars: number, requestDetails: RequestDetails): void {
    const networkGasPrice = BigInt(networkGasPriceInWeiBars);

    const txGasPrice = BigInt(tx.gasPrice || tx.maxFeePerGas! + tx.maxPriorityFeePerGas!);

    // **notice: Pass gasPrice precheck if txGasPrice is greater than the minimum network's gas price value,
    //          OR if the transaction is the deterministic deployment transaction (a special case).
    // **explanation: The deterministic deployment transaction is pre-signed with a gasPrice value of only 10 hbars,
    //                which is lower than the minimum gas price value in all Hedera network environments. Therefore,
    //                this special case is exempt from the precheck in the Relay, and the gas price logic will be resolved at the Services level.
    const passes = txGasPrice >= networkGasPrice || Precheck.isDeterministicDeploymentTransaction(tx);

    if (!passes) {
      if (constants.GAS_PRICE_TINY_BAR_BUFFER) {
        // Check if failure is within buffer range (Often it's by 1 tinybar) as network gasprice calculation can change slightly.
        // e.g gasPrice=1450000000000, requiredGasPrice=1460000000000, in which case we should allow users to go through and let the network check
        const txGasPriceWithBuffer = txGasPrice + BigInt(constants.GAS_PRICE_TINY_BAR_BUFFER);
        if (txGasPriceWithBuffer >= networkGasPrice) {
          return;
        }
      }

      if (this.logger.isLevelEnabled('trace')) {
        this.logger.trace(
          `${requestDetails.formattedRequestId} Failed gas price precheck for sendRawTransaction(transaction=%s, gasPrice=%s, requiredGasPrice=%s)`,
          JSON.stringify(tx),
          txGasPrice,
          networkGasPrice,
        );
      }
      throw predefined.GAS_PRICE_TOO_LOW(txGasPrice, networkGasPrice);
    }
  }

  /**
   * Checks if a transaction is the deterministic deployment transaction.
   * @param {Transaction} tx - The transaction to check.
   * @returns {boolean} Returns true if the transaction is the deterministic deployment transaction, otherwise false.
   */
  static isDeterministicDeploymentTransaction(tx: Transaction): boolean {
    return tx.serialized === constants.DETERMINISTIC_DEPLOYER_TRANSACTION;
  }

  /**
   * Checks the balance of the sender account.
   * @param {Transaction} tx - The transaction.
   * @param {any} account - The account information.
   * @param {RequestDetails} requestDetails - The request details for logging and tracking.
   */
  balance(tx: Transaction, account: any, requestDetails: RequestDetails): void {
    const result = {
      passes: false,
      error: predefined.INSUFFICIENT_ACCOUNT_BALANCE,
    };

    const txGasPrice = BigInt(tx.gasPrice || tx.maxFeePerGas! + tx.maxPriorityFeePerGas!);
    const txTotalValue = tx.value + txGasPrice * tx.gasLimit;

    if (account == null) {
      if (this.logger.isLevelEnabled('trace')) {
        this.logger.trace(
          `${
            requestDetails.formattedRequestId
          } Failed to retrieve account details from mirror node on balance precheck for sendRawTransaction(transaction=${JSON.stringify(
            tx,
          )}, totalValue=${txTotalValue})`,
        );
      }
      throw predefined.RESOURCE_NOT_FOUND(`tx.from '${tx.from}'.`);
    }

    let tinybars: bigint;
    try {
      tinybars = BigInt(account.balance.balance.toString()) * BigInt(constants.TINYBAR_TO_WEIBAR_COEF);
      result.passes = tinybars >= txTotalValue;
    } catch (error: any) {
      if (this.logger.isLevelEnabled('trace')) {
        this.logger.trace(
          `${requestDetails.formattedRequestId} Error on balance precheck for sendRawTransaction(transaction=%s, totalValue=%s, error=%s)`,
          JSON.stringify(tx),
          txTotalValue,
          error.message,
        );
      }
      if (error instanceof JsonRpcError) {
        // preserve original error
        throw error;
      } else {
        throw predefined.INTERNAL_ERROR(`balance precheck: ${error.message}`);
      }
    }

    if (!result.passes) {
      if (this.logger.isLevelEnabled('trace')) {
        this.logger.trace(
          `${requestDetails.formattedRequestId} Failed balance precheck for sendRawTransaction(transaction=%s, totalValue=%s, accountTinyBarBalance=%s)`,
          JSON.stringify(tx),
          txTotalValue,
          tinybars,
        );
      }
      throw predefined.INSUFFICIENT_ACCOUNT_BALANCE;
    }
  }

  /**
   * Checks the gas limit of the transaction.
   * @param {Transaction} tx - The transaction.
   * @param {RequestDetails} requestDetails - The request details for logging and tracking.
   */
  gasLimit(tx: Transaction, requestDetails: RequestDetails): void {
    const gasLimit = Number(tx.gasLimit);
    const failBaseLog = 'Failed gasLimit precheck for sendRawTransaction(transaction=%s).';

    const intrinsicGasCost = Precheck.transactionIntrinsicGasCost(tx.data);

    if (gasLimit > constants.MAX_TRANSACTION_FEE_THRESHOLD) {
      if (this.logger.isLevelEnabled('trace')) {
        this.logger.trace(
          `${requestDetails.formattedRequestId} ${failBaseLog} Gas Limit was too high: %s, block gas limit: %s`,
          JSON.stringify(tx),
          gasLimit,
          constants.MAX_TRANSACTION_FEE_THRESHOLD,
        );
      }
      throw predefined.GAS_LIMIT_TOO_HIGH(gasLimit, constants.MAX_TRANSACTION_FEE_THRESHOLD);
    } else if (gasLimit < intrinsicGasCost) {
      if (this.logger.isLevelEnabled('trace')) {
        this.logger.trace(
          `${requestDetails.formattedRequestId} ${failBaseLog} Gas Limit was too low: %s, intrinsic gas cost: %s`,
          JSON.stringify(tx),
          gasLimit,
          intrinsicGasCost,
        );
      }
      throw predefined.GAS_LIMIT_TOO_LOW(gasLimit, intrinsicGasCost);
    }
  }

  /**
   * Calculates the intrinsic gas cost based on the number of bytes in the data field.
   * Using a loop that goes through every two characters in the string it counts the zero and non-zero bytes.
   * Every two characters that are packed together and are both zero counts towards zero bytes.
   * @param {string} data - The data with the bytes to be calculated
   * @returns {number} The intrinsic gas cost.
   * @private
   */
  public static transactionIntrinsicGasCost(data: string): number {
    const trimmedData = data.replace('0x', '');

    let zeros = 0;
    let nonZeros = 0;
    for (let index = 0; index < trimmedData.length; index += 2) {
      const bytes = trimmedData[index] + trimmedData[index + 1];
      if (bytes === '00') {
        zeros++;
      } else {
        nonZeros++;
      }
    }

    return (
      constants.TX_BASE_COST + constants.TX_DATA_ZERO_COST * zeros + constants.ISTANBUL_TX_DATA_NON_ZERO_COST * nonZeros
    );
  }

  /**
   * Validates that the transaction size is within the allowed limit.
   * The serialized transaction length is converted from hex string length to byte count
   * by subtracting the '0x' prefix (2 characters) and dividing by 2 (since each byte is represented by 2 hex characters).
   *
   * @param {Transaction} tx - The transaction to validate.
   * @throws {JsonRpcError} If the transaction size exceeds the configured limit.
   */
  transactionSize(tx: Transaction): void {
    const totalRawTransactionSizeInBytes = tx.serialized.replace('0x', '').length / 2;
    const transactionSizeLimit = constants.SEND_RAW_TRANSACTION_SIZE_LIMIT;
    if (totalRawTransactionSizeInBytes > transactionSizeLimit) {
      throw predefined.TRANSACTION_SIZE_LIMIT_EXCEEDED(totalRawTransactionSizeInBytes, transactionSizeLimit);
    }
  }

  /**
   * Validates that the call data size is within the allowed limit.
   * The data field length is converted from hex string length to byte count
   * by subtracting the '0x' prefix (2 characters) and dividing by 2 (since each byte is represented by 2 hex characters).
   *
   * @param {Transaction} tx - The transaction to validate.
   * @throws {JsonRpcError} If the call data size exceeds the configured limit.
   */
  callDataSize(tx: Transaction): void {
    const totalCallDataSizeInBytes = tx.data.replace('0x', '').length / 2;
    const callDataSizeLimit = constants.CALL_DATA_SIZE_LIMIT;
    if (totalCallDataSizeInBytes > callDataSizeLimit) {
      throw predefined.CALL_DATA_SIZE_LIMIT_EXCEEDED(totalCallDataSizeInBytes, callDataSizeLimit);
    }
  }

  transactionType(tx: Transaction, requestDetails: RequestDetails) {
    // Blob transactions are not supported as per HIP 866
    if (tx.type === 3) {
      if (this.logger.isLevelEnabled('trace')) {
        this.logger.trace(
          `${requestDetails.formattedRequestId} Transaction with type=${
            tx.type
          } is unsupported for sendRawTransaction(transaction=${JSON.stringify(tx)})`,
        );
      }
      throw predefined.UNSUPPORTED_TRANSACTION_TYPE;
    }
  }

  /**
   * Checks if the receiver account exists and has receiver_sig_required set to true.
   * @param {Transaction} tx - The transaction.
   * @param {RequestDetails} requestDetails - The request details for logging and tracking.
   */
  async receiverAccount(tx: Transaction, requestDetails: RequestDetails) {
    if (tx.to) {
      const verifyAccount = await this.mirrorNodeClient.getAccount(tx.to, requestDetails);

      // When `receiver_sig_required` is set to true, the receiver's account must sign all incoming transactions.
      if (verifyAccount && verifyAccount.receiver_sig_required) {
        throw predefined.RECEIVER_SIGNATURE_ENABLED;
      }
    }
  }
}
