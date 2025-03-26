// SPDX-License-Identifier: Apache-2.0

import { prepend0x, trimPrecedingZeros } from '../../../formatters';
import { Transaction, Transaction1559, Transaction2930 } from '../../model';

// TransactionFactory is a factory class that creates a Transaction object based on the type of transaction.
export class TransactionFactory {
  static createTransactionByType(type: number, fields: any): Transaction | Transaction2930 | Transaction1559 | null {
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
            fields.maxPriorityFeePerGas === null || fields.maxPriorityFeePerGas === '0x'
              ? '0x0'
              : prepend0x(trimPrecedingZeros(fields.maxPriorityFeePerGas)),
          maxFeePerGas:
            fields.maxFeePerGas === null || fields.maxFeePerGas === '0x'
              ? '0x0'
              : prepend0x(trimPrecedingZeros(fields.maxFeePerGas)),
        }); // eip 1559 fields
      case null:
        return new Transaction(fields); //hapi
    }

    return null;
  }
}
