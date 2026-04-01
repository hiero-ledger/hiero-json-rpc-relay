// SPDX-License-Identifier: Apache-2.0

import {
  isHex,
  nanOrNumberInt64To0x,
  nanOrNumberTo0x,
  nullableNumberTo0x,
  numberTo0x,
  prepend0x,
  stripLeadingZeroForSignatures,
  tinybarsToWeibars,
  toHash32,
  trimPrecedingZeros,
} from '../../formatters';
import constants from '../constants';
import { AuthorizationListEntry, Log, Transaction, Transaction1559, Transaction2930, Transaction7702 } from '../model';

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
          maxPriorityFeePerGas: formatGasFee(fields.maxPriorityFeePerGas),
          maxFeePerGas: formatGasFee(fields.maxFeePerGas),
        }); // eip 1559 fields
      case 4:
        return new Transaction7702({
          ...fields,
          accessList: [],
          maxPriorityFeePerGas: formatGasFee(fields.maxPriorityFeePerGas),
          maxFeePerGas: formatGasFee(fields.maxFeePerGas),
          authorizationList: formatAuthorizationList(fields.authorizationList),
        }); // eip 7702 fields
      case null:
        return new Transaction(fields); //hapi
    }

    return null;
  }

  /**
   * Creates a transaction object from a log entry
   * @param log The log entry containing transaction data
   * @param type Transaction type (2 by default)
   * @returns {Transaction | null} A Transaction object or null if creation fails
   */
  public static createTransactionFromLog(chainId: string, log: Log, type: number = 2): Transaction | null {
    return TransactionFactory.createTransactionByType(type, {
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
      type: numberTo0x(type), // 0x0 for legacy transactions, 0x1 for access list types, 0x2 for dynamic fees.
      v: constants.ZERO_HEX,
      value: constants.ZERO_HEX,
    });
  }
}

/**
 * Formats an authorization list by normalizing and sanitizing its fields.
 *
 * - Ensures the input is an array of objects.
 * - Normalizes numeric fields to 0x-prefixed hex values.
 * - Pads and sanitizes addresses to 40 hex characters.
 * - Truncates signature fields (r, s) to valid length.
 * - Falls back to zero-value constants when fields are missing.
 *
 * Additional unknown properties on each authorization item are preserved.
 *
 * @param {any} authorizationList - The raw authorization list.
 * @returns {AuthorizationListEntry[]} A normalized authorization list. Returns an empty array if input is invalid.
 */
const formatAuthorizationList = (authorizationList: any): AuthorizationListEntry[] =>
  authorizationList && Array.isArray(authorizationList)
    ? authorizationList
        .filter((item: any) => item !== null && typeof item === 'object')
        .map((item: any) => ({
          ...item, // additional properties remain allowed for authorization list items
          chainId: !item.chainId ? constants.ZERO_HEX : prepend0x(item.chainId),
          nonce: !item.nonce ? constants.ZERO_HEX : prepend0x(item.nonce),
          address: !item.address
            ? constants.ZERO_ADDRESS_HEX
            : `0x${item.address.replace(/^0x/i, '').slice(-40).padStart(40, '0')}`,
          yParity: !item.yParity ? constants.ZERO_HEX : prepend0x(item.yParity).substring(0, 4),
          r: !item.r ? constants.ZERO_HEX : stripLeadingZeroForSignatures(item.r.substring(0, 66)),
          s: !item.s ? constants.ZERO_HEX : stripLeadingZeroForSignatures(item.s.substring(0, 66)),
        }))
    : [];

/**
 * Formats a gas fee value into a 0x-prefixed hex string.
 *
 * @TODO There is a known issue with this algorithm, track fix in:
 *       https://github.com/hiero-ledger/hiero-json-rpc-relay/issues/4901
 *       The value should be returned in weibars, not tinybars, as it is currently.
 *
 * @param {any} gasFee - The raw gas price value (hex or number).
 * @returns {string} The formatted gas fee as a 0x-prefixed hex string.
 */
const formatGasFee = (gasFee: any): string =>
  gasFee === null || gasFee === constants.EMPTY_HEX ? constants.ZERO_HEX : prepend0x(trimPrecedingZeros(gasFee) ?? '0');

/**
 * Creates a Transaction object from a contract result
 * @param cr The contract result object from the mirror node
 * @returns {Transaction | null} A Transaction object or null if creation fails
 */
export const createTransactionFromContractResult = (cr: any): Transaction | null => {
  if (cr === null) {
    return null;
  }

  const gasPrice =
    cr.gas_price === null || cr.gas_price === '0x'
      ? '0x0'
      : isHex(cr.gas_price)
        ? numberTo0x(BigInt(cr.gas_price) * BigInt(constants.TINYBAR_TO_WEIBAR_COEF))
        : nanOrNumberTo0x(cr.gas_price);

  const commonFields = {
    blockHash: toHash32(cr.block_hash),
    blockNumber: nullableNumberTo0x(cr.block_number),
    from: cr.from.substring(0, 42),
    gas: nanOrNumberTo0x(cr.gas_limit),
    gasPrice,
    hash: cr.hash.substring(0, 66),
    input: cr.function_parameters,
    nonce: nanOrNumberTo0x(cr.nonce),
    r: cr.r === null ? '0x0' : stripLeadingZeroForSignatures(cr.r.substring(0, 66)),
    s: cr.s === null ? '0x0' : stripLeadingZeroForSignatures(cr.s.substring(0, 66)),
    to: cr.to?.substring(0, 42) ?? null,
    transactionIndex: nullableNumberTo0x(cr.transaction_index),
    type: cr.type === null ? '0x0' : nanOrNumberTo0x(cr.type),
    v: cr.v === null ? '0x0' : nanOrNumberTo0x(cr.v),
    value: nanOrNumberInt64To0x(tinybarsToWeibars(cr.amount, true)),
    // for legacy EIP155 with tx.chainId=0x0, mirror-node will return a '0x' (EMPTY_HEX) value for contract result's chain_id
    //   which is incompatibile with certain tools (i.e. foundry). By setting this field, chainId, to undefined, the end jsonrpc
    //   object will leave out this field, which is the proper behavior for other tools to be compatible with.
    chainId: cr.chain_id === constants.EMPTY_HEX ? undefined : cr.chain_id,
  };

  return TransactionFactory.createTransactionByType(cr.type, {
    ...commonFields,
    maxPriorityFeePerGas: cr.max_priority_fee_per_gas,
    maxFeePerGas: cr.max_fee_per_gas,
    authorizationList: cr.authorization_list,
  });
};
