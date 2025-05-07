// SPDX-License-Identifier: Apache-2.0

import { nanOrNumberTo0x, numberTo0x, prepend0x, trimPrecedingZeros } from '../../formatters';
import constants from '../constants';
import { Log, Transaction, Transaction1559, Transaction2930 } from '../model';

// TransactionFactory is a factory class that creates a Transaction object based on the type of transaction.
export class TransactionFactory {
  public static createTransactionByType(type: number, fields: any): Transaction | null {
    switch (type) {
      case 0:
        return new Transaction(fields); // eip 155 fields
      case 1:
        return new Transaction2930({
          ...fields,
          accessList: [],
        }); // eip 2930 fields
      case 2:
        return new Transaction1559({
          ...fields,
          accessList: [],
          maxPriorityFeePerGas:
            fields.maxPriorityFeePerGas === null || fields.maxPriorityFeePerGas === constants.EMPTY_HEX
              ? constants.ZERO_HEX
              : prepend0x(trimPrecedingZeros(fields.maxPriorityFeePerGas)),
          maxFeePerGas:
            fields.maxFeePerGas === null || fields.maxFeePerGas === constants.EMPTY_HEX
              ? constants.ZERO_HEX
              : prepend0x(trimPrecedingZeros(fields.maxFeePerGas)),
        }); // eip 1559 fields
      case null:
        return new Transaction(fields); //hapi
    }

    return null;
  }

  /**
   * Creates a transaction object from a log entry
   * @param log The log entry containing transaction data
   * @returns {Transaction1559 | null} A Transaction1559 object or null if creation fails
   */
  public static createTransactionFromLog(chainId: string, log: Log): Transaction1559 | null {
    const transaction = TransactionFactory.createTransactionByType(2, {
      accessList: undefined, // we don't support access lists for now
      blockHash: log.blockHash,
      blockNumber: log.blockNumber,
      chainId: chainId,
      from: log.address,
      gas: numberTo0x(constants.TX_DEFAULT_GAS_DEFAULT),
      gasPrice: constants.INVALID_EVM_INSTRUCTION,
      hash: log.transactionHash,
      input: constants.ZERO_HEX_8_BYTE,
      maxPriorityFeePerGas: constants.ZERO_HEX,
      maxFeePerGas: constants.ZERO_HEX,
      nonce: nanOrNumberTo0x(0),
      r: constants.EMPTY_HEX,
      s: constants.EMPTY_HEX,
      to: log.address,
      transactionIndex: log.transactionIndex,
      type: constants.TWO_HEX, // 0x0 for legacy transactions, 0x1 for access list types, 0x2 for dynamic fees.
      v: constants.ZERO_HEX,
    }) as Transaction1559;

    return transaction;
  }
}
