// SPDX-License-Identifier: Apache-2.0

import { ConfigService } from '@hashgraph/json-rpc-config-service/dist/services';
import { AccountId, PrivateKey } from '@hashgraph/sdk';
import { Operator } from '@hashgraph/sdk/lib/client/Client';
import crypto from 'crypto';
import createHash from 'keccak';
import { Logger } from 'pino';

import { hexToASCII, prepend0x, strip0x } from './formatters';
import constants from './lib/constants';

export class Utils {
  public static readonly IP_ADDRESS_REGEX = /\b((25[0-5]|(2[0-4]|1\d|[1-9]|)\d)(\.(?!$)|$)){4}\b/g;

  public static readonly addPercentageBufferToGasPrice = (gasPrice: number): number => {
    // converting to tinybar and afterward to weibar again is needed
    // in order to handle the possibility of an invalid floating number being calculated as a gas price
    // e.g.
    //   current gas price = 126
    //   buffer = 10%
    //   buffered gas price = 126 + 12.6 = 138.6 <--- invalid tinybars
    gasPrice +=
      Math.round(
        (gasPrice / constants.TINYBAR_TO_WEIBAR_COEF) * (ConfigService.get('GAS_PRICE_PERCENTAGE_BUFFER') / 100),
      ) * constants.TINYBAR_TO_WEIBAR_COEF;

    return gasPrice;
  };

  /**
   * @param operatorMainKey
   * @returns PrivateKey
   */
  public static createPrivateKeyBasedOnFormat(operatorMainKey: string): PrivateKey {
    switch (ConfigService.get('OPERATOR_KEY_FORMAT')) {
      case 'DER':
      case undefined:
      case null:
        return PrivateKey.fromStringDer(operatorMainKey);
      case 'HEX_ED25519':
        return PrivateKey.fromStringED25519(operatorMainKey);
      case 'HEX_ECDSA':
        return PrivateKey.fromStringECDSA(operatorMainKey);
      default:
        throw new Error(`Invalid OPERATOR_KEY_FORMAT provided: ${ConfigService.get('OPERATOR_KEY_FORMAT')}`);
    }
  }

  /**
   * Generates a random trace ID for requests.
   *
   * @returns {string} The generated random trace ID.
   */
  public static generateRequestId = (): string => {
    return crypto.randomUUID();
  };

  /**
   * Estimates the transaction fees for file create and file append transactions based on the provided
   * call data size, file chunk size, and current network exchange rate.
   *
   * @param {number} callDataSize - The size of the call data in bytes.
   * @param {number} fileChunkSize - The size of each file chunk in bytes.
   * @param {number} currentNetworkExchangeRateInCents - The current network exchange rate in cents.
   * @returns {number} The estimated transaction fee in tinybars.
   */
  public static estimateFileTransactionsFee(
    callDataSize: number,
    fileChunkSize: number,
    currentNetworkExchangeRateInCents: number,
  ): number {
    const fileCreateTransactions = 1;
    const fileCreateFeeInCents = constants.NETWORK_FEES_IN_CENTS.FILE_CREATE_PER_5_KB;

    // The first chunk goes in with FileCreateTransaciton, the rest are FileAppendTransactions
    const fileAppendTransactions = Math.floor(callDataSize / fileChunkSize) - 1;
    const lastFileAppendChunkSize = callDataSize % fileChunkSize;

    const fileAppendFeeInCents = constants.NETWORK_FEES_IN_CENTS.FILE_APPEND_PER_5_KB;
    const lastFileAppendChunkFeeInCents =
      constants.NETWORK_FEES_IN_CENTS.FILE_APPEND_BASE_FEE +
      lastFileAppendChunkSize * constants.NETWORK_FEES_IN_CENTS.FILE_APPEND_RATE_PER_BYTE;

    const totalTxFeeInCents =
      fileCreateTransactions * fileCreateFeeInCents +
      fileAppendFeeInCents * fileAppendTransactions +
      lastFileAppendChunkFeeInCents;

    const estimatedTxFee = Math.round(
      (totalTxFeeInCents / currentNetworkExchangeRateInCents) * constants.HBAR_TO_TINYBAR_COEF,
    );

    return estimatedTxFee;
  }

  /**
   * Check whether the transaction has reverted by a hedera-specific validation before the actual evm execution
   * @param contractResult
   * @returns {boolean}
   */
  public static isRevertedDueToHederaSpecificValidation(contractResult: {
    result: string;
    error_message: any;
  }): boolean {
    const statuses = ConfigService.get('HEDERA_SPECIFIC_REVERT_STATUSES');
    return (
      statuses.includes(contractResult.result) ||
      statuses.includes(hexToASCII(strip0x(contractResult.error_message ?? '')))
    );
  }

  /**
   * Computes the Keccak-256 hash of a transaction buffer and prepends '0x'
   * @param {Buffer} transactionBuffer - The raw transaction buffer to hash
   * @returns {string} The computed transaction hash with '0x' prefix
   */
  public static computeTransactionHash(transactionBuffer: Buffer): string {
    return prepend0x(createHash('keccak256').update(transactionBuffer).digest('hex'));
  }

  /**
   * Gets operator credentials based on the provided type.
   * @param {Logger} logger - The logger instance
   * @param {string | null} type - The type of operator (e.g. 'eth_sendRawTransaction')
   * @returns {Operator | null} The operator credentials or null if not found
   */
  public static getOperator(logger: Logger, type: string | null = null): Operator | null {
    let operatorId: string;
    let operatorKey: string;

    if (type === 'eth_sendRawTransaction') {
      operatorId = ConfigService.get('OPERATOR_ID_ETH_SENDRAWTRANSACTION') as string;
      operatorKey = ConfigService.get('OPERATOR_KEY_ETH_SENDRAWTRANSACTION') as string;
    } else {
      operatorId = ConfigService.get('OPERATOR_ID_MAIN');
      operatorKey = ConfigService.get('OPERATOR_KEY_MAIN');
    }

    if (!operatorId || !operatorKey) {
      logger.warn(`Invalid operatorId or operatorKey for ${type ?? 'main'} client.`);
      return null;
    }

    return {
      privateKey: Utils.createPrivateKeyBasedOnFormat(operatorKey),
      accountId: AccountId.fromString(operatorId.trim()),
    };
  }
}
