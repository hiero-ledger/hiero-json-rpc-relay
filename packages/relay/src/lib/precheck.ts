// SPDX-License-Identifier: Apache-2.0

import { ConfigService } from '@hashgraph/json-rpc-config-service/dist/services';
import { ethers, Transaction } from 'ethers';

import { prepend0x } from '../formatters';
import { MirrorNodeClient } from './clients';
import constants from './constants';
import { predefined } from './errors/JsonRpcError';
import { CommonService, TransactionPoolService } from './services';
import { RequestDetails } from './types';
import { IAccountBalance } from './types/mirrorNode';

/**
 * Precheck class for handling various prechecks before sending a raw transaction.
 */
export class Precheck {
  private readonly mirrorNodeClient: MirrorNodeClient;
  private readonly chain: string;
  private readonly transactionPoolService: TransactionPoolService;

  /**
   * Creates an instance of Precheck.
   * @param mirrorNodeClient - The MirrorNodeClient instance.
   * @param chainId - The chain ID.
   * @param transactionPoolService
   */
  constructor(mirrorNodeClient: MirrorNodeClient, chainId: string, transactionPoolService: TransactionPoolService) {
    this.mirrorNodeClient = mirrorNodeClient;
    this.chain = chainId;
    this.transactionPoolService = transactionPoolService;
  }

  /**
   * Parses the transaction if needed.
   * @param transaction - The transaction to parse.
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
   * @param tx - The transaction.
   */
  value(tx: Transaction): void {
    if ((tx.value > 0 && tx.value < constants.TINYBAR_TO_WEIBAR_COEF) || tx.value < 0) {
      throw predefined.VALUE_TOO_LOW;
    }
  }

  /**
   * Sends a raw transaction after performing various prechecks.
   * @param parsedTx - The parsed transaction.
   * @param networkGasPriceInWeiBars - The predefined gas price of the network in weibar.
   * @param requestDetails - The request details for logging and tracking.
   */
  async sendRawTransactionCheck(
    parsedTx: ethers.Transaction,
    networkGasPriceInWeiBars: number,
    requestDetails: RequestDetails,
  ): Promise<void> {
    this.callDataSize(parsedTx);
    this.transactionSize(parsedTx);
    this.transactionType(parsedTx);
    this.gasLimit(parsedTx);
    this.chainId(parsedTx);
    this.value(parsedTx);
    this.gasPrice(parsedTx, networkGasPriceInWeiBars);
    const mirrorAccountInfo = await this.verifyAccount(parsedTx, requestDetails);
    // const signerNonce =
    //   mirrorAccountInfo.ethereum_nonce +
    //   (ConfigService.get('ENABLE_TX_POOL') ? await this.transactionPoolService.getPendingCount(parsedTx.from!) : 0);
    const signerNonce = mirrorAccountInfo.ethereum_nonce;
    this.nonce(parsedTx, signerNonce);
    this.balance(parsedTx, mirrorAccountInfo.balance);
    await this.receiverAccount(parsedTx, requestDetails);
  }

  /**
   * Verifies the account.
   * @param tx - The transaction.
   * @param requestDetails - The request details for logging and tracking.
   */
  async verifyAccount(tx: Transaction, requestDetails: RequestDetails): Promise<any> {
    const accountInfo = await this.mirrorNodeClient.getAccount(tx.from!, requestDetails);
    if (accountInfo == null) {
      throw predefined.RESOURCE_NOT_FOUND(`address '${tx.from}'.`);
    }

    return accountInfo;
  }

  /**
   * Checks the nonce of the transaction.
   * @param tx - The transaction.
   * @param accountNonce - The nonce of the account.
   */
  nonce(tx: Transaction, accountNonce: number | undefined): void {
    if (accountNonce == undefined) {
      throw predefined.RESOURCE_NOT_FOUND(`Account nonce unavailable for address: ${tx.from}.`);
    }

    if (accountNonce > tx.nonce) {
      throw predefined.NONCE_TOO_LOW(tx.nonce, accountNonce);
    }
  }

  /**
   * Validates that the transaction's chain ID matches the network's chain ID.
   * Legacy unprotected transactions (pre-EIP155) are exempt from this check.
   *
   * @param tx - The transaction to validate.
   * @throws {JsonRpcError} If the transaction's chain ID doesn't match the network's chain ID.
   */
  chainId(tx: Transaction): void {
    const txChainId = prepend0x(Number(tx.chainId).toString(16));
    const passes = this.isLegacyUnprotectedEtx(tx) || txChainId === this.chain;
    if (!passes) {
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
   * @param tx - The transaction.
   * @param networkGasPriceInWeiBars - The predefined gas price of the network in weibar.
   */
  gasPrice(tx: Transaction, networkGasPriceInWeiBars: number): void {
    const networkGasPrice = BigInt(networkGasPriceInWeiBars);

    const txGasPrice = BigInt(tx.gasPrice || tx.maxFeePerGas! + tx.maxPriorityFeePerGas!);

    // **notice: Pass gasPrice precheck if txGasPrice is greater than the minimum network's gas price value,
    //          OR if the transaction is the deterministic deployment transaction (a special case),
    //          OR paymaster is used for fully subsidized transactions where gasPrice was set 0 by the user and the provider set a gas allowance
    // **explanation: The deterministic deployment transaction is pre-signed with a gasPrice value of only 10 hbars,
    //                which is lower than the minimum gas price value in all Hedera network environments. Therefore,
    //                this special case is exempt from the precheck in the Relay, and the gas price logic will be resolved at the Services level.
    //                The same is true for fully subsidized transactions, where the precheck about the gasPrice is not needed anymore.
    const passes =
      txGasPrice >= networkGasPrice ||
      Precheck.isDeterministicDeploymentTransaction(tx) ||
      CommonService.isSubsidizedTransaction(tx.to);

    if (!passes) {
      if (ConfigService.get('GAS_PRICE_TINY_BAR_BUFFER')) {
        // Check if failure is within buffer range (Often it's by 1 tinybar) as network gasprice calculation can change slightly.
        // e.g gasPrice=1450000000000, requiredGasPrice=1460000000000, in which case we should allow users to go through and let the network check
        const txGasPriceWithBuffer = txGasPrice + BigInt(ConfigService.get('GAS_PRICE_TINY_BAR_BUFFER'));
        if (txGasPriceWithBuffer >= networkGasPrice) {
          return;
        }
      }

      throw predefined.GAS_PRICE_TOO_LOW(txGasPrice, networkGasPrice);
    }
  }

  /**
   * Checks if a transaction is the deterministic deployment transaction.
   * @param tx - The transaction to check.
   * @returns Returns true if the transaction is the deterministic deployment transaction, otherwise false.
   */
  static isDeterministicDeploymentTransaction(tx: Transaction): boolean {
    return tx.serialized === constants.DETERMINISTIC_DEPLOYER_TRANSACTION;
  }

  /**
   * Checks the balance of the sender account.
   * @param tx - The transaction.
   * @param accountBalance - The account balance information.
   */
  balance(tx: Transaction, accountBalance: IAccountBalance | undefined): void {
    if (accountBalance?.balance == undefined) {
      throw predefined.RESOURCE_NOT_FOUND(`Account balance unavailable for address: ${tx.from}.`);
    }

    const txGasPrice = BigInt(tx.gasPrice || tx.maxFeePerGas! + tx.maxPriorityFeePerGas!);
    const txTotalValue = tx.value + txGasPrice * tx.gasLimit;
    const accountBalanceInWeiBars = BigInt(accountBalance.balance) * BigInt(constants.TINYBAR_TO_WEIBAR_COEF);

    if (accountBalanceInWeiBars < txTotalValue) {
      throw predefined.INSUFFICIENT_ACCOUNT_BALANCE;
    }
  }

  /**
   * Checks the gas limit of the transaction.
   * @param tx - The transaction.
   */
  gasLimit(tx: Transaction): void {
    const gasLimit = Number(tx.gasLimit);
    const intrinsicGasCost = Precheck.transactionIntrinsicGasCost(tx.data);

    if (gasLimit > constants.MAX_TRANSACTION_FEE_THRESHOLD) {
      throw predefined.GAS_LIMIT_TOO_HIGH(gasLimit, constants.MAX_TRANSACTION_FEE_THRESHOLD);
    } else if (gasLimit < intrinsicGasCost) {
      throw predefined.GAS_LIMIT_TOO_LOW(gasLimit, intrinsicGasCost);
    }
  }

  /**
   * Calculates the intrinsic gas cost based on the number of bytes in the data field.
   * Using a loop that goes through every two characters in the string it counts the zero and non-zero bytes.
   * Every two characters that are packed together and are both zero counts towards zero bytes.
   * @param data - The data with the bytes to be calculated
   * @returns The intrinsic gas cost.
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
   * @param tx - The transaction to validate.
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
   * @param tx - The transaction to validate.
   * @throws {JsonRpcError} If the call data size exceeds the configured limit.
   */
  callDataSize(tx: Transaction): void {
    const totalCallDataSizeInBytes = tx.data.replace('0x', '').length / 2;
    const callDataSizeLimit = constants.CALL_DATA_SIZE_LIMIT;
    if (totalCallDataSizeInBytes > callDataSizeLimit) {
      throw predefined.CALL_DATA_SIZE_LIMIT_EXCEEDED(totalCallDataSizeInBytes, callDataSizeLimit);
    }
  }

  /**
   * Validates the transaction type and throws an error if the transaction is unsupported.
   * Specifically, blob transactions (type 3) are not supported as per HIP 866.
   * @param tx The transaction object to validate.
   * @throws {Error} Throws a predefined error if the transaction type is unsupported.
   */
  transactionType(tx: Transaction) {
    // Blob transactions are not supported as per HIP 866
    if (tx.type === 3) {
      throw predefined.UNSUPPORTED_TRANSACTION_TYPE_3;
    }
  }

  /**
   * Checks if the receiver account exists and has receiver_sig_required set to true.
   * @param tx - The transaction.
   * @param requestDetails - The request details for logging and tracking.
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
