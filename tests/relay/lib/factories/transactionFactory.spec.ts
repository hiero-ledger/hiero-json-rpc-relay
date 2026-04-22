// SPDX-License-Identifier: Apache-2.0

import { RLP } from '@ethereumjs/rlp';
import { expect } from 'chai';

import { numberTo0x, prepend0x, strip0x } from '../../../../src/relay/formatters';
import constants from '../../../../src/relay/lib/constants';
import {
  createTransactionFromContractResult,
  TransactionFactory,
} from '../../../../src/relay/lib/factories/transactionFactory';
import type {
  AccessListEntry,
  AuthorizationListEntry,
  Log,
  Transaction,
  Transaction1559,
  Transaction2930,
  Transaction7702,
} from '../../../../src/relay/lib/model';

describe('TransactionFactory', () => {
  describe('createTransactionByType', () => {
    const baseFields = {
      blockHash: '0x' + 'ab'.repeat(32),
      blockNumber: '0x1',
      chainId: '0x12a',
      from: '0x05fba803be258049a27b820088bab1cad2058871',
      gas: '0x5208',
      gasPrice: '0x0',
      hash: '0x' + 'cd'.repeat(32),
      input: '0x',
      nonce: '0x2',
      r: '0x' + '11'.repeat(32),
      s: '0x' + '22'.repeat(32),
      to: '0x0000000000000000000000000000000000000409',
      transactionIndex: '0x0',
      type: '0x0',
      v: '0x1',
      value: '0x0',
    };

    it('should create a legacy (type 0) Transaction with provided fields untouched', () => {
      const tx = TransactionFactory.createTransactionByType(0, {
        ...baseFields,
        type: '0x0',
      });

      expect(tx).to.not.equal(null);
      expect(tx!.type).to.equal('0x0');
      expect(tx!.from).to.equal(baseFields.from);
      expect(tx!.to).to.equal(baseFields.to);
      expect(tx).to.not.have.property('accessList');
    });

    it('should create an access list (type 1) Transaction2930 with empty accessList', () => {
      const tx = TransactionFactory.createTransactionByType(1, {
        ...baseFields,
        type: '0x1',
        accessList: ['should be ignored'],
      });

      expect(tx).to.not.equal(null);
      expect(tx!.type).to.equal('0x1');
      expect(tx).to.have.property('accessList').that.deep.eq([]);
      expect(tx!.from).to.equal(baseFields.from);
    });

    it('should create an EIP-1559 (type 2) Transaction1559 with sanitized fees and empty accessList', () => {
      const tx = TransactionFactory.createTransactionByType(2, {
        ...baseFields,
        type: '0x2',
        accessList: ['should be ignored'],
        maxPriorityFeePerGas: null,
        maxFeePerGas: '0x00000059',
      });

      expect(tx).to.not.equal(null);
      expect(tx!.type).to.equal('0x2');
      expect(tx).have.property('accessList').that.deep.eq([]);
      expect(tx).to.have.property('maxPriorityFeePerGas').that.equals(constants.ZERO_HEX);
      expect(tx).to.have.property('maxFeePerGas').that.equals('0x59');
    });

    it('should replace EMPTY_HEX fees with ZERO_HEX for type 2', () => {
      const tx = TransactionFactory.createTransactionByType(2, {
        ...baseFields,
        type: '0x2',
        maxPriorityFeePerGas: constants.EMPTY_HEX,
        maxFeePerGas: constants.EMPTY_HEX,
      });

      expect(tx).to.have.property('maxPriorityFeePerGas').that.equals(constants.ZERO_HEX);
      expect(tx).to.have.property('maxFeePerGas').that.equals(constants.ZERO_HEX);
    });

    it('should handle null case by creating a legacy Transaction with provided fields', () => {
      const tx = TransactionFactory.createTransactionByType(null as unknown as number, {
        ...baseFields,
        type: '0x0',
      });

      expect(tx).to.not.equal(null);
      expect(tx!.type).to.equal('0x0');
      expect(tx).to.not.have.property('accessList');
    });

    it('should return null for unsupported types', () => {
      const tx = TransactionFactory.createTransactionByType(3, { ...baseFields, type: '0x3' });
      expect(tx).to.equal(null);
    });

    it('should return null when type is undefined', () => {
      const tx = TransactionFactory.createTransactionByType(undefined as unknown as number, baseFields);
      expect(tx).to.equal(null);
    });
  });

  describe('createTransactionFromLog', () => {
    const chainId = '0x12a';

    const log = {
      address: '0x05fba803be258049a27b820088bab1cad2058871',
      blockHash: '0xb0f10139fa0bf9e66402c8c0e5ed364e07cf83b3726c8045fabf86a07f488713',
      blockNumber: '0x210',
      transactionHash: '0xfc4ab7133197016293d2e14e8cf9c5227b07357e6385184f1cd1cb40d783cfbd',
      transactionIndex: '0x9',
    } as Log;

    const expectTxFromLog = (tx: Transaction, inputLog: Log, expectedChainId: string) => {
      expect(tx).to.exist;
      expect(tx.type).to.equal(constants.ZERO_HEX);
      expect(tx).to.not.have.property('accessList');

      expect(tx.blockHash).to.equal(inputLog.blockHash);
      expect(tx.blockNumber).to.equal(inputLog.blockNumber);
      expect(tx.chainId).to.equal(expectedChainId);

      expect(tx.from).to.equal(inputLog.address);
      expect(tx.to).to.equal(inputLog.address);

      expect(tx.hash).to.equal(inputLog.transactionHash);
      expect(tx.transactionIndex).to.equal(inputLog.transactionIndex);

      expect(tx.gas).to.equal(numberTo0x(constants.TX_DEFAULT_GAS_DEFAULT));
      expect(tx.gasPrice).to.equal(constants.INVALID_EVM_INSTRUCTION);
      expect(tx.input).to.equal(constants.ZERO_HEX_8_BYTE);

      expect(tx).to.not.have.property('maxPriorityFeePerGas');
      expect(tx).to.not.have.property('maxFeePerGas');
      expect(tx.nonce).to.equal(numberTo0x(0));

      expect(tx.r).to.equal(constants.EMPTY_HEX);
      expect(tx.s).to.equal(constants.EMPTY_HEX);
      expect(tx.v).to.equal(constants.ZERO_HEX);
      expect(tx.value).to.equal(constants.ZERO_HEX);
    };

    it('should create a valid EIP-1559 tx from a log with defaulted fields', () => {
      const tx = TransactionFactory.createTransactionFromLog(chainId, log);
      expectTxFromLog(tx!, log, chainId);
    });

    it('should mirror the log address to both from and to', () => {
      const anotherLog = {
        ...log,
        address: '0x0000000000000000000000000000000000000409',
      };
      const tx = TransactionFactory.createTransactionFromLog(chainId, anotherLog);
      expect(tx!.from).to.equal(anotherLog.address);
      expect(tx!.to).to.equal(anotherLog.address);
    });

    it('should keep the provided chainId untouched', () => {
      const customChainId = '0x127';
      const tx = TransactionFactory.createTransactionFromLog(customChainId, log);
      expect(tx!.chainId).to.equal(customChainId);
    });

    it('should keep the block, hash and index values untouched', () => {
      const modifiedLog = {
        ...log,
        blockHash: '0x' + 'ab'.repeat(32),
        blockNumber: '0x7b',
        transactionHash: '0x' + 'cd'.repeat(32),
        transactionIndex: '0x1',
      };
      const tx = TransactionFactory.createTransactionFromLog(chainId, modifiedLog);
      expect(tx!.blockHash).to.equal(modifiedLog.blockHash);
      expect(tx!.blockNumber).to.equal(modifiedLog.blockNumber);
      expect(tx!.hash).to.equal(modifiedLog.transactionHash);
      expect(tx!.transactionIndex).to.equal(modifiedLog.transactionIndex);
    });
  });

  describe('createTransactionFromContractResult', () => {
    const expectFormattedResult = (
      formattedResult: any,
      expectedValues: {
        blockNumber?: string | null;
        r?: string;
        s?: string;
        gas?: string;
        gasPrice?: string;
        maxPriorityFeePerGas?: string;
        maxFeePerGas?: string;
        nonce?: string;
        transactionIndex?: string | null;
        v?: string;
        yParity?: string;
        value?: string;
      },
    ) => {
      expect(formattedResult.accessList).to.deep.eq([]);
      expect(formattedResult.blockHash).to.equal('0xb0f10139fa0bf9e66402c8c0e5ed364e07cf83b3726c8045fabf86a07f488713');
      expect(formattedResult.blockNumber).to.equal(
        'blockNumber' in expectedValues ? expectedValues.blockNumber : '0x210',
      );
      expect(formattedResult.chainId).to.equal('0x12a');
      expect(formattedResult.from).to.equal('0x05fba803be258049a27b820088bab1cad2058871');
      expect(formattedResult.gas).to.equal(expectedValues.gas ?? '0x7a120');
      expect(formattedResult.gasPrice).to.equal(expectedValues.gasPrice ?? '0x0');
      expect(formattedResult.hash).to.equal('0xfc4ab7133197016293d2e14e8cf9c5227b07357e6385184f1cd1cb40d783cfbd');
      expect(formattedResult.input).to.equal('0x08090033');
      expect(formattedResult.maxPriorityFeePerGas).to.equal(expectedValues.maxPriorityFeePerGas ?? '0x0');
      expect(formattedResult.maxFeePerGas).to.equal(expectedValues.maxFeePerGas ?? '0xcf38224400');
      expect(formattedResult.nonce).to.equal(expectedValues.nonce ?? '0x2');
      expect(formattedResult.r).to.equal(
        expectedValues.r ?? '0x2af9d41244c702764ed86c5b9f1a734b075b91c4d9c65e78bc584b0e35181e42',
      );
      expect(formattedResult.s).to.equal(
        expectedValues.s ?? '0x3f0a6baa347876e08c53ffc70619ba75881841885b2bd114dbb1905cd57112a5',
      );
      expect(formattedResult.to).to.equal('0x0000000000000000000000000000000000000409');
      expect(formattedResult.transactionIndex).to.equal(
        'transactionIndex' in expectedValues ? expectedValues.transactionIndex : '0x9',
      );
      expect(formattedResult.type).to.equal('0x2');
      expect(formattedResult.yParity).to.equal(expectedValues.yParity ?? '0x1');
      expect(formattedResult.v).to.equal(expectedValues.v ?? '0x1');
      expect(formattedResult.value).to.equal(expectedValues.value ?? '0x0');
    };
    const contractResult = {
      amount: 0,
      from: '0x05fba803be258049a27b820088bab1cad2058871',
      function_parameters: '0x08090033',
      gas_used: 400000,
      gas_limit: 500_000,
      to: '0x0000000000000000000000000000000000000409',
      hash: '0xfc4ab7133197016293d2e14e8cf9c5227b07357e6385184f1cd1cb40d783cfbd',
      block_hash: '0xb0f10139fa0bf9e66402c8c0e5ed364e07cf83b3726c8045fabf86a07f4887130e4650cb5cf48a9f6139a805b78f0312',
      block_number: 528,
      transaction_index: 9,
      chain_id: '0x12a',
      gas_price: '0x',
      max_fee_per_gas: '0xcf38224400',
      max_priority_fee_per_gas: '0x',
      r: '0x2af9d41244c702764ed86c5b9f1a734b075b91c4d9c65e78bc584b0e35181e42',
      s: '0x3f0a6baa347876e08c53ffc70619ba75881841885b2bd114dbb1905cd57112a5',
      type: 2,
      v: 1,
      nonce: 2,
    };

    const contractResultZeroPrefixedSignatureS = {
      ...contractResult,
      r: '0x58075c8984de34a46c9617ab2b4e0ed5ddc8803e718c42152ed5d58b82166676',
      s: '0x0dd3a5aeb203d9284e50a9973bc5e266a3ea66da1fbb793b244b19b42f19e00b',
    };

    it('should return null if null is passed', () => {
      expect(createTransactionFromContractResult(null)).to.equal(null);
    });

    it('should return a valid match', () => {
      const formattedResult: any = createTransactionFromContractResult(contractResult);
      expectFormattedResult(formattedResult, {});
    });

    it('should return a valid signature s value', () => {
      const formattedResult: any = createTransactionFromContractResult(contractResultZeroPrefixedSignatureS);
      expectFormattedResult(formattedResult, {
        r: '0x58075c8984de34a46c9617ab2b4e0ed5ddc8803e718c42152ed5d58b82166676',
        s: '0xdd3a5aeb203d9284e50a9973bc5e266a3ea66da1fbb793b244b19b42f19e00b',
      });
    });

    it('should return nullable fields', () => {
      const formattedResult: any = createTransactionFromContractResult({
        ...contractResult,
        block_number: null,
        gas_limit: null,
        gas_price: '0x',
        max_priority_fee_per_gas: '0x',
        max_fee_per_gas: '0x',
        nonce: null,
        r: null,
        s: null,
        transaction_index: null,
        v: null,
        value: null,
      });
      expectFormattedResult(formattedResult, {
        blockNumber: null,
        gas: '0x0',
        maxFeePerGas: '0x0',
        nonce: '0x0',
        r: '0x0',
        s: '0x0',
        transactionIndex: null,
        v: '0x0',
        yParity: '0x0',
      });
    });

    it('Should not include chainId field for legacy EIP155 transaction (tx.chainId=0x0)', () => {
      const formattedResult: any = createTransactionFromContractResult({ ...contractResult, chain_id: '0x' });
      expect(formattedResult.chainId).to.be.undefined;
    });

    it('Should return legacy EIP155 transaction when null type', () => {
      const formattedResult: any = createTransactionFromContractResult({ ...contractResult, type: null });
      expect(formattedResult.type).to.be.eq('0x0');
    });

    it('Should return null when contract result type is undefined', async function () {
      const formattedResult = createTransactionFromContractResult({ ...contractResult, type: undefined });
      expect(formattedResult).to.be.null;
    });
  });

  describe('formatAccessList', () => {
    /**
     * Test helper that exposes a private method's formatAccessList logic.
     *
     * This function intentionally routes the provided `input` through
     * `createTransactionFromContractResult` using a mocked transaction payload,
     * and then extracts the resulting `accessList`.
     *
     * It allows unit tests to validate the behavior of the private
     * `formatAccessList` implementation without exporting or
     * directly accessing it.
     *
     * The surrounding transaction fields are static, deterministic values
     * and are irrelevant to the assertions, only the transformation of
     * `access_list` is under test.
     *
     * @param {unknown} input - Raw access list input (may contain nulls,
     *                      malformed items).
     *
     * @returns {AccessListEntry[]} The normalized and sanitized
     * access list as produced by the internal formatter.
     */
    const formatAccessList = (input: unknown): AccessListEntry[] => {
      const result = createTransactionFromContractResult({
        amount: 0,
        from: '0x05fba803be258049a27b820088bab1cad2058871',
        function_parameters: '0x08090033',
        gas_used: 400000,
        gas_limit: 500_000,
        to: '0x0000000000000000000000000000000000000409',
        hash: '0xfc4ab7133197016293d2e14e8cf9c5227b07357e6385184f1cd1cb40d783cfbd',
        block_hash:
          '0xb0f10139fa0bf9e66402c8c0e5ed364e07cf83b3726c8045fabf86a07f4887130e4650cb5cf48a9f6139a805b78f0312',
        block_number: 528,
        transaction_index: 9,
        chain_id: '0x12a',
        gas_price: constants.EMPTY_HEX,
        max_fee_per_gas: '0x59',
        max_priority_fee_per_gas: constants.EMPTY_HEX,
        r: '0x2af9d41244c702764ed86c5b9f1a734b075b91c4d9c65e78bc584b0e35181e42',
        s: '0x3f0a6baa347876e08c53ffc70619ba75881841885b2bd114dbb1905cd57112a5',
        type: 2,
        v: 1,
        nonce: 2,
        access_list: input,
      }) as Transaction1559 | null;

      return result?.accessList ?? [];
    };

    const hexToBytes = (value: string): Uint8Array => {
      let hex = strip0x(value);
      hex = hex.length % 2 === 0 ? hex : `0${hex}`;
      if (!hex) return new Uint8Array(0);
      return Uint8Array.from(Buffer.from(hex, 'hex'));
    };

    const encodeAccessListRlpStream = (entries: unknown[]): string => {
      const encodedItems = entries
        .filter((entry) => entry && typeof entry === 'object' && !Array.isArray(entry))
        .map((entry) =>
          Buffer.from(
            RLP.encode([
              hexToBytes((entry as AccessListEntry).address ?? ''),
              Array.isArray((entry as AccessListEntry).storageKeys)
                ? (entry as AccessListEntry).storageKeys.map((key: string) => hexToBytes(key))
                : [],
            ]),
          ).toString('hex'),
        );
      return prepend0x(encodedItems.map((p) => p).join(''));
    };

    describe('array input', () => {
      it('returns an empty array for nullish/non-array input', () => {
        expect(formatAccessList(null)).to.deep.equal([]);
        expect(formatAccessList(undefined)).to.deep.equal([]);
        expect(formatAccessList('not-an-array')).to.deep.equal([]);
        expect(formatAccessList(123)).to.deep.equal([]);
        expect(formatAccessList({})).to.deep.equal([]);
      });

      it('filters out null items and non-object items', () => {
        const input = [null, undefined, 123, 'abc', true, () => ({}), { address: '0x1234' }, { storageKeys: [] }];

        const out = formatAccessList(input);

        expect(out).to.have.length(2);
        expect(out[0]).to.have.property('address').equal('0x0000000000000000000000000000000000001234');
        expect(out[1]).to.have.property('storageKeys').deep.equal([]);
      });

      it('falls back to zero defaults for missing/falsy fields', () => {
        const input = [
          {
            address: '',
            storageKeys: null,
          },
        ];

        const [out] = formatAccessList(input);

        expect(out.address).to.equal(constants.ZERO_ADDRESS_HEX);
        expect(out.storageKeys).to.deep.equal([]);
      });

      it('normalizes address: strips 0x, keeps last 40 hex chars, left-pads with zeros, re-adds 0x', () => {
        const input = [
          { address: '0x1234', storageKeys: [] },
          { address: '1234', storageKeys: [] },
          { address: `0x${'a'.repeat(60)}`, storageKeys: [] },
        ];

        const out = formatAccessList(input);

        expect(out[0].address).to.equal('0x0000000000000000000000000000000000001234');
        expect(out[1].address).to.equal('0x0000000000000000000000000000000000001234');
        expect(out[2].address).to.equal(`0x${'a'.repeat(60).slice(-40)}`);
      });

      it('keeps storageKeys as an array when provided', () => {
        const input = [
          {
            address: '0x1234',
            storageKeys: [`0x${'00'.repeat(31)}01`, `0x${'00'.repeat(31)}02`],
          },
        ];

        const [out] = formatAccessList(input);

        expect(out.storageKeys).to.deep.equal([`0x${'00'.repeat(31)}01`, `0x${'00'.repeat(31)}02`]);
      });

      it('falls back to empty array when storageKeys is malformed', () => {
        const input = [
          { address: '0x1234', storageKeys: null },
          { address: '0x1234', storageKeys: undefined },
        ];

        const out = formatAccessList(input);

        expect(out[0].storageKeys).to.deep.equal([]);
        expect(out[1].storageKeys).to.deep.equal([]);
      });

      it('does NOT preserve extra properties on items', () => {
        const item: any = {
          address: '0x1234',
          storageKeys: ['0x1'],
          extraField: 'keep-me',
        };

        const [out] = formatAccessList([item]);

        expect(out.address).to.equal('0x0000000000000000000000000000000000001234');
        expect(out.storageKeys).to.deep.equal(['0x1']);
        expect(out).to.not.have.property('extraField').equal('keep-me');
      });
    });

    describe('hex RLP stream input', () => {
      it('returns an empty array for nullish/empty input', () => {
        expect(formatAccessList(null)).to.deep.equal([]);
        expect(formatAccessList(undefined)).to.deep.equal([]);
        expect(formatAccessList('0x')).to.deep.equal([]);
      });

      it('returns an empty array for malformed input', () => {
        expect(formatAccessList('0x31321213')).to.deep.equal([]);
        expect(formatAccessList('0xtest')).to.deep.equal([]);
        expect(formatAccessList('test')).to.deep.equal([]);

        const correct = encodeAccessListRlpStream([{ address: '0x1234', storageKeys: [] }, { storageKeys: [] }]);
        expect(formatAccessList(correct.replace(correct[1], `${correct[1]}99`))).to.deep.equal([]);
      });

      it('decodes valid entries from an RLP stream', () => {
        const input = encodeAccessListRlpStream([{ address: '0x1234', storageKeys: [] }, { storageKeys: [] }]);

        const out = formatAccessList(input);

        expect(out).to.have.length(2);
        expect(out[0].address).to.equal('0x0000000000000000000000000000000000001234');
        expect(out[1].storageKeys).to.deep.equal([]);
      });

      it('falls back to zero defaults for missing/falsy fields', () => {
        const input = encodeAccessListRlpStream([
          {
            address: '',
            storageKeys: null,
          },
        ]);

        const [out] = formatAccessList(input);

        expect(out.address).to.equal(constants.ZERO_ADDRESS_HEX);
        expect(out.storageKeys).to.deep.equal([]);
      });

      it('normalizes address: strips 0x, keeps last 40 hex chars, left-pads with zeros, re-adds 0x', () => {
        const input = encodeAccessListRlpStream([
          { address: '0x1234', storageKeys: [] },
          { address: '1234', storageKeys: [] },
          { address: `0x${'a'.repeat(60)}`, storageKeys: [] },
        ]);

        const out = formatAccessList(input);

        expect(out[0].address).to.equal('0x0000000000000000000000000000000000001234');
        expect(out[1].address).to.equal('0x0000000000000000000000000000000000001234');
        expect(out[2].address).to.equal(`0x${'a'.repeat(60).slice(-40)}`);
      });

      it('keeps storageKeys as an array when provided', () => {
        const input = encodeAccessListRlpStream([
          {
            address: '0x1234',
            storageKeys: ['0x1', '0x2'],
          },
        ]);

        const [out] = formatAccessList(input);

        expect(out.storageKeys).to.deep.equal([`0x${'00'.repeat(31)}01`, `0x${'00'.repeat(31)}02`]);
      });

      it('falls back to empty array when storageKeys is not an array-equivalent field', () => {
        const input = encodeAccessListRlpStream([
          { address: '0x1234', storageKeys: null },
          { address: '0x1234', storageKeys: undefined },
        ]);

        const out = formatAccessList(input);

        expect(out[0].storageKeys).to.deep.equal([]);
        expect(out[1].storageKeys).to.deep.equal([]);
      });
    });
  });

  describe('formatAuthorizationList', () => {
    /**
     * Test helper that exposes a private method's formatAuthorizationList logic.
     *
     * This function intentionally routes the provided `input` through
     * `createTransactionFromContractResult` using a mocked EIP-7702
     * transaction payload (type = 4), and then extracts the resulting
     * `authorizationList`.
     *
     * It allows unit tests to validate the behavior of the private
     * `formatAuthorizationList` implementation without exporting or
     * directly accessing it.
     *
     * The surrounding transaction fields are static, deterministic values
     * and are irrelevant to the assertions, only the transformation of
     * `authorization_list` is under test.
     *
     * @param {unknown} input - Raw authorization list input (may contain nulls,
     *                          malformed items, non-0x-prefixed values, oversized
     *                          signatures, or extra properties).
     *
     * @returns {AuthorizationListEntry[]} The normalized and sanitized
     * authorization list as produced by the internal formatter.
     */
    const formatAuthorizationList = (input: unknown): AuthorizationListEntry[] =>
      (createTransactionFromContractResult({
        amount: 0,
        from: '0x05fba803be258049a27b820088bab1cad2058871',
        function_parameters: '0x08090033',
        gas_used: 400000,
        gas_limit: 500_000,
        to: '0x0000000000000000000000000000000000000409',
        hash: '0xfc4ab7133197016293d2e14e8cf9c5227b07357e6385184f1cd1cb40d783cfbd',
        block_hash:
          '0xb0f10139fa0bf9e66402c8c0e5ed364e07cf83b3726c8045fabf86a07f4887130e4650cb5cf48a9f6139a805b78f0312',
        block_number: 528,
        transaction_index: 9,
        chain_id: '0x12a',
        gas_price: constants.EMPTY_HEX,
        max_fee_per_gas: '0x59',
        max_priority_fee_per_gas: constants.EMPTY_HEX,
        r: '0x2af9d41244c702764ed86c5b9f1a734b075b91c4d9c65e78bc584b0e35181e42',
        s: '0x3f0a6baa347876e08c53ffc70619ba75881841885b2bd114dbb1905cd57112a5',
        type: 4,
        v: 1,
        authorization_list: input,
        nonce: 2,
      })?.authorizationList as AuthorizationListEntry[]) ?? [];

    it('filters out null items and non-object items', () => {
      const input = [null, undefined, 123, 'abc', true, () => ({}), { chainId: '1' }, { nonce: '2' }];

      const out = formatAuthorizationList(input);

      expect(out).to.have.length(2);
      expect(out[0]).to.have.property('chainId').equal('0x1');
      expect(out[1]).to.have.property('nonce').equal('0x2');
    });

    it('items with missing/falsy fields fall back to zero constants', () => {
      const input = [
        {
          chainId: '',
          nonce: 0,
          address: null,
          yParity: undefined,
          r: '',
          s: undefined,
        },
      ];

      const [out] = formatAuthorizationList(input);

      expect(out.chainId).to.equal(constants.ZERO_HEX);
      expect(out.nonce).to.equal(constants.ZERO_HEX);
      expect(out.address).to.equal(constants.ZERO_ADDRESS_HEX);
      expect(out.yParity).to.equal(constants.ZERO_HEX);
      expect(out.r).to.equal(constants.ZERO_HEX);
      expect(out.s).to.equal(constants.ZERO_HEX);
    });

    it('normalizes non-0x-prefixed values (chainId/nonce/yParity) using prepend0x and truncates yParity to 4 chars', () => {
      const input = [
        {
          chainId: '1',
          nonce: 'a',
          yParity: '01',
          address: 'abcd',
          r: '0x1',
          s: '0x2',
        },
      ];

      const [out] = formatAuthorizationList(input);

      expect(out.chainId).to.equal('0x1');
      expect(out.nonce).to.equal('0xa');
      expect(out.yParity).to.equal('0x01');
    });

    it('normalizes address: strips 0x, keeps last 40 hex chars, left-pads with zeros, re-adds 0x', () => {
      const input = [
        { address: '0x1234', chainId: '1', nonce: '1', yParity: '1', r: '0x1', s: '0x1' },
        { address: '1234', chainId: '1', nonce: '1', yParity: '1', r: '0x1', s: '0x1' },
        { address: `0x${'a'.repeat(60)}`, chainId: '1', nonce: '1', yParity: '1', r: '0x1', s: '0x1' }, // 60 hex chars
      ];

      const out = formatAuthorizationList(input);
      expect(out[0].address).to.equal('0x0000000000000000000000000000000000001234');
      expect(out[1].address).to.equal('0x0000000000000000000000000000000000001234');
      const oversizedNo0x = 'a'.repeat(60); // 60 chars
      expect(out[2].address).to.equal(`0x${oversizedNo0x.slice(-40)}`);
    });

    it('truncates oversized r/s to 66 chars before stripLeadingZeroForSignatures', () => {
      const oversizedR = `0x${'1'.repeat(80)}`;
      const oversizedS = `0x${'2'.repeat(80)}`;

      const input = [
        {
          chainId: '1',
          nonce: '1',
          address: '0x1',
          yParity: '1',
          r: oversizedR,
          s: oversizedS,
        },
      ];

      const [out] = formatAuthorizationList(input);
      expect(out.r).to.have.length(66);
      expect(out.s).to.have.length(66);
    });

    it('preserves extra properties on items', () => {
      const item: AuthorizationListEntry & { extraField: string } = {
        chainId: '1',
        nonce: '2',
        address: '0x1234',
        yParity: '1',
        r: prepend0x('00'.repeat(32)),
        s: prepend0x('00'.repeat(32)),
        extraField: 'keep-me',
      };

      const input = [item];

      const [out] = formatAuthorizationList(input);

      expect(out).to.have.property('extraField').equal('keep-me');
    });
  });

  describe('formatAccessList', () => {
    /**
     * Test helper that exposes the private formatAccessList logic.
     *
     * This function routes the provided `input` through
     * `createTransactionFromContractResult` using a mocked EIP-1559
     * transaction payload (type = 2), and then extracts the resulting
     * `accessList`.
     * @param {unknown} input - Raw access list input.
     * @returns {AccessListEntry[]} The normalized and sanitized access list.
     */
    const formatAccessList = (input: unknown): AccessListEntry[] => {
      const result = createTransactionFromContractResult({
        amount: 0,
        from: '0x05fba803be258049a27b820088bab1cad2058871',
        function_parameters: '0x08090033',
        gas_used: 400000,
        gas_limit: 500_000,
        to: '0x0000000000000000000000000000000000000409',
        hash: '0xfc4ab7133197016293d2e14e8cf9c5227b07357e6385184f1cd1cb40d783cfbd',
        block_hash:
          '0xb0f10139fa0bf9e66402c8c0e5ed364e07cf83b3726c8045fabf86a07f4887130e4650cb5cf48a9f6139a805b78f0312',
        block_number: 528,
        transaction_index: 9,
        chain_id: '0x12a',
        gas_price: constants.EMPTY_HEX,
        max_fee_per_gas: '0x59',
        max_priority_fee_per_gas: constants.EMPTY_HEX,
        r: '0x2af9d41244c702764ed86c5b9f1a734b075b91c4d9c65e78bc584b0e35181e42',
        s: '0x3f0a6baa347876e08c53ffc70619ba75881841885b2bd114dbb1905cd57112a5',
        type: 2,
        v: 1,
        nonce: 2,
        access_list: input,
      }) as Transaction1559 | null;

      return result?.accessList ?? [];
    };

    it('returns empty array for null input', () => {
      const out = formatAccessList(null);
      expect(out).to.deep.eq([]);
    });

    it('returns empty array for undefined input', () => {
      const out = formatAccessList(undefined);
      expect(out).to.deep.eq([]);
    });

    it('returns empty array for non-array input (string)', () => {
      const out = formatAccessList('0xdeadbeef');
      expect(out).to.deep.eq([]);
    });

    it('returns empty array for non-array input (number)', () => {
      const out = formatAccessList(123);
      expect(out).to.deep.eq([]);
    });

    it('returns empty array for empty array input', () => {
      const out = formatAccessList([]);
      expect(out).to.deep.eq([]);
    });

    it('filters out null and non-object items from the array', () => {
      const input = [null, undefined, 123, 'abc', true, { address: '0x1234' }];
      const out = formatAccessList(input);

      expect(out).to.have.length(1);
      expect(out[0]).to.have.property('address').that.equals('0x0000000000000000000000000000000000001234');
    });

    it('normalizes a valid access list entry with address and storageKeys', () => {
      const input = [
        {
          address: '0x0000000000000000000000000000000000000409',
          storageKeys: [
            '0x0000000000000000000000000000000000000000000000000000000000000001',
            '0x0000000000000000000000000000000000000000000000000000000000000002',
          ],
        },
      ];
      const out = formatAccessList(input);

      expect(out).to.have.length(1);
      expect(out[0].address).to.equal('0x0000000000000000000000000000000000000409');
      expect(out[0].storageKeys).to.have.length(2);
      expect(out[0].storageKeys[0]).to.equal('0x0000000000000000000000000000000000000000000000000000000000000001');
      expect(out[0].storageKeys[1]).to.equal('0x0000000000000000000000000000000000000000000000000000000000000002');
    });

    it('defaults storageKeys to empty array when missing', () => {
      const input = [{ address: '0x0000000000000000000000000000000000000409' }];
      const out = formatAccessList(input);

      expect(out).to.have.length(1);
      expect(out[0].storageKeys).to.deep.eq([]);
    });

    it('defaults storageKeys to empty array when null', () => {
      const input = [{ address: '0x0000000000000000000000000000000000000409', storageKeys: null }];
      const out = formatAccessList(input);

      expect(out).to.have.length(1);
      expect(out[0].storageKeys).to.deep.eq([]);
    });

    it('defaults address to ZERO_ADDRESS_HEX when missing', () => {
      const input = [{ storageKeys: [] }];
      const out = formatAccessList(input);

      expect(out).to.have.length(1);
      expect(out[0].address).to.equal(constants.ZERO_ADDRESS_HEX);
    });

    it('defaults address to ZERO_ADDRESS_HEX when null', () => {
      const input = [{ address: null, storageKeys: [] }];
      const out = formatAccessList(input);

      expect(out).to.have.length(1);
      expect(out[0].address).to.equal(constants.ZERO_ADDRESS_HEX);
    });

    it('normalizes short addresses by left-padding with zeros', () => {
      const input = [{ address: '0x1234', storageKeys: [] }];
      const out = formatAccessList(input);

      expect(out[0].address).to.equal('0x0000000000000000000000000000000000001234');
    });

    it('normalizes addresses without 0x prefix', () => {
      const input = [{ address: '0000000000000000000000000000000000000409', storageKeys: [] }];
      const out = formatAccessList(input);

      expect(out[0].address).to.equal('0x0000000000000000000000000000000000000409');
    });

    it('truncates oversized addresses to last 40 hex chars', () => {
      const input = [{ address: `0x${'a'.repeat(60)}`, storageKeys: [] }];
      const out = formatAccessList(input);

      expect(out[0].address).to.equal(`0x${'a'.repeat(40)}`);
    });

    it('handles multiple entries with mixed valid and invalid items', () => {
      const input = [
        { address: '0x0000000000000000000000000000000000000001', storageKeys: ['0xabc'] },
        null,
        42,
        { address: '0x0000000000000000000000000000000000000002', storageKeys: ['0xdef', '0x123'] },
      ];
      const out = formatAccessList(input);

      expect(out).to.have.length(2);
      expect(out[0].address).to.equal('0x0000000000000000000000000000000000000001');
      expect(out[0].storageKeys).to.deep.eq(['0xabc']);
      expect(out[1].address).to.equal('0x0000000000000000000000000000000000000002');
      expect(out[1].storageKeys).to.deep.eq(['0xdef', '0x123']);
    });

    it('does NOT preserve extra properties on access list items (unlike authorization list)', () => {
      const input = [
        {
          address: '0x0000000000000000000000000000000000000409',
          storageKeys: [],
          extraField: 'should-be-dropped',
        },
      ];
      const out = formatAccessList(input);

      expect(out[0]).to.not.have.property('extraField');
      expect(Object.keys(out[0])).to.have.members(['address', 'storageKeys']);
    });

    it('returns empty array for false input', () => {
      const out = formatAccessList(false);
      expect(out).to.deep.eq([]);
    });

    it('returns empty array for empty string input', () => {
      const out = formatAccessList('');
      expect(out).to.deep.eq([]);
    });

    it('returns empty array for EMPTY_HEX ("0x") input — current mirror node format', () => {
      const out = formatAccessList(constants.EMPTY_HEX);
      expect(out).to.deep.eq([]);
    });

    it('treats nested arrays as valid objects (typeof [] === "object") — address/storageKeys default', () => {
      // Arrays pass the filter (typeof [] === 'object' && [] !== null)
      // but array[0].address → undefined and array[0].storageKeys → undefined
      const input = [['0x0000000000000000000000000000000000000001']];
      const out = formatAccessList(input);

      expect(out).to.have.length(1);
      expect(out[0].address).to.equal(constants.ZERO_ADDRESS_HEX);
      expect(out[0].storageKeys).to.deep.eq([]);
    });

    it('defaults storageKeys to empty array when explicitly set to undefined', () => {
      const input = [{ address: '0x0000000000000000000000000000000000000409', storageKeys: undefined }];
      const out = formatAccessList(input);

      expect(out).to.have.length(1);
      expect(out[0].storageKeys).to.deep.eq([]);
    });

    it('propagates access_list through createTransactionFromContractResult for type 1 (EIP-2930)', () => {
      const result = createTransactionFromContractResult({
        amount: 0,
        from: '0x05fba803be258049a27b820088bab1cad2058871',
        function_parameters: constants.EMPTY_HEX,
        gas_used: 21000,
        gas_limit: 21000,
        to: '0x0000000000000000000000000000000000000409',
        hash: prepend0x('aa'.repeat(32)),
        block_hash: prepend0x('bb'.repeat(48)),
        block_number: 1,
        transaction_index: 0,
        chain_id: '0x12a',
        gas_price: constants.EMPTY_HEX,
        max_fee_per_gas: constants.EMPTY_HEX,
        max_priority_fee_per_gas: constants.EMPTY_HEX,
        r: prepend0x('11'.repeat(32)),
        s: prepend0x('22'.repeat(32)),
        type: 1,
        v: 1,
        nonce: 0,
        access_list: [
          {
            address: '0x0000000000000000000000000000000000000409',
            storageKeys: ['0x0000000000000000000000000000000000000000000000000000000000000001'],
          },
        ],
      });

      expect(result).to.not.be.null;
      expect(result?.type).to.equal('0x1');
      const accessList = (result as Transaction2930 | null)?.accessList ?? [];
      expect(accessList).to.have.length(1);
      expect(accessList[0].address).to.equal('0x0000000000000000000000000000000000000409');
      expect(accessList[0].storageKeys).to.deep.eq([
        '0x0000000000000000000000000000000000000000000000000000000000000001',
      ]);
    });

    it('propagates access_list through createTransactionFromContractResult for type 4 (EIP-7702)', () => {
      const result = createTransactionFromContractResult({
        amount: 0,
        from: '0x05fba803be258049a27b820088bab1cad2058871',
        function_parameters: constants.EMPTY_HEX,
        gas_used: 21000,
        gas_limit: 21000,
        to: '0x0000000000000000000000000000000000000409',
        hash: prepend0x('aa'.repeat(32)),
        block_hash: prepend0x('bb'.repeat(48)),
        block_number: 1,
        transaction_index: 0,
        chain_id: '0x12a',
        gas_price: constants.EMPTY_HEX,
        max_fee_per_gas: constants.EMPTY_HEX,
        max_priority_fee_per_gas: constants.EMPTY_HEX,
        r: prepend0x('11'.repeat(32)),
        s: prepend0x('22'.repeat(32)),
        type: 4,
        v: 1,
        nonce: 0,
        authorization_list: [],
        access_list: [
          {
            address: '0x0000000000000000000000000000000000000001',
            storageKeys: [],
          },
        ],
      });

      expect(result).to.not.be.null;
      expect(result?.type).to.equal('0x4');
      const accessList = (result as Transaction7702 | null)?.accessList ?? [];
      expect(accessList).to.have.length(1);
      expect(accessList[0].address).to.equal('0x0000000000000000000000000000000000000001');
    });

    it('returns empty accessList when access_list is absent from contract result', () => {
      const result = createTransactionFromContractResult({
        amount: 0,
        from: '0x05fba803be258049a27b820088bab1cad2058871',
        function_parameters: constants.EMPTY_HEX,
        gas_used: 21000,
        gas_limit: 21000,
        to: '0x0000000000000000000000000000000000000409',
        hash: prepend0x('aa'.repeat(32)),
        block_hash: prepend0x('bb'.repeat(48)),
        block_number: 1,
        transaction_index: 0,
        chain_id: '0x12a',
        gas_price: constants.EMPTY_HEX,
        max_fee_per_gas: constants.EMPTY_HEX,
        max_priority_fee_per_gas: constants.EMPTY_HEX,
        r: prepend0x('11'.repeat(32)),
        s: prepend0x('22'.repeat(32)),
        type: 2,
        v: 1,
        nonce: 0,
        // access_list intentionally omitted
      });

      expect(result).to.not.be.null;
      expect((result as Transaction1559).accessList).to.deep.eq([]);
    });
  });

  describe('formatAddress (via formatAccessList)', () => {
    /**
     * Helper that tests the formatAddress behavior by passing an address
     * through the access list formatting pipeline.
     */
    const formatAddress = (address: unknown): string => {
      const result = createTransactionFromContractResult({
        amount: 0,
        from: '0x05fba803be258049a27b820088bab1cad2058871',
        function_parameters: '0x08090033',
        gas_used: 400000,
        gas_limit: 500_000,
        to: '0x0000000000000000000000000000000000000409',
        hash: '0xfc4ab7133197016293d2e14e8cf9c5227b07357e6385184f1cd1cb40d783cfbd',
        block_hash:
          '0xb0f10139fa0bf9e66402c8c0e5ed364e07cf83b3726c8045fabf86a07f4887130e4650cb5cf48a9f6139a805b78f0312',
        block_number: 528,
        transaction_index: 9,
        chain_id: '0x12a',
        gas_price: constants.EMPTY_HEX,
        max_fee_per_gas: '0x59',
        max_priority_fee_per_gas: constants.EMPTY_HEX,
        r: '0x2af9d41244c702764ed86c5b9f1a734b075b91c4d9c65e78bc584b0e35181e42',
        s: '0x3f0a6baa347876e08c53ffc70619ba75881841885b2bd114dbb1905cd57112a5',
        type: 2,
        v: 1,
        nonce: 2,
        access_list: [{ address, storageKeys: [] }],
      });
      return (result as Transaction1559)?.accessList?.[0]?.address ?? constants.ZERO_ADDRESS_HEX;
    };

    it('returns ZERO_ADDRESS_HEX for null', () => {
      expect(formatAddress(null)).to.equal(constants.ZERO_ADDRESS_HEX);
    });

    it('returns ZERO_ADDRESS_HEX for undefined', () => {
      expect(formatAddress(undefined)).to.equal(constants.ZERO_ADDRESS_HEX);
    });

    it('returns ZERO_ADDRESS_HEX for empty string', () => {
      expect(formatAddress('')).to.equal(constants.ZERO_ADDRESS_HEX);
    });

    it('returns ZERO_ADDRESS_HEX for 0', () => {
      expect(formatAddress(0)).to.equal(constants.ZERO_ADDRESS_HEX);
    });

    it('normalizes a full 40-char hex address with 0x prefix', () => {
      expect(formatAddress('0x0000000000000000000000000000000000000409')).to.equal(
        '0x0000000000000000000000000000000000000409',
      );
    });

    it('normalizes a full 40-char hex address without 0x prefix', () => {
      expect(formatAddress('0000000000000000000000000000000000000409')).to.equal(
        '0x0000000000000000000000000000000000000409',
      );
    });

    it('left-pads short addresses to 40 hex chars', () => {
      expect(formatAddress('0x1234')).to.equal('0x0000000000000000000000000000000000001234');
      expect(formatAddress('abc')).to.equal('0x0000000000000000000000000000000000000abc');
    });

    it('keeps last 40 hex chars from oversized addresses', () => {
      const oversized = prepend0x('f'.repeat(60));
      expect(formatAddress(oversized)).to.equal(prepend0x('f'.repeat(40)));
    });

    it('strips EMPTY_HEX (0x) prefix before normalizing', () => {
      // "0x" prefix is stripped, then '1a2b' is left-padded to 40 chars
      expect(formatAddress('0x1a2b')).to.equal('0x0000000000000000000000000000000000001a2b');
    });

    it('returns ZERO_ADDRESS_HEX for false', () => {
      expect(formatAddress(false)).to.equal(constants.ZERO_ADDRESS_HEX);
    });

    it('returns ZERO_ADDRESS_HEX for exactly EMPTY_HEX ("0x")', () => {
      // formatAddress strips the "0x" prefix via regex, leaving empty string
      // empty string → padStart(40, '0') → ZERO_ADDRESS
      expect(formatAddress(constants.EMPTY_HEX)).to.equal(constants.ZERO_ADDRESS_HEX);
    });

    it('preserves mixed-case hex characters in address', () => {
      // formatAddress does NOT lowercase — it preserves the input casing
      expect(formatAddress('0xAbCdEf0000000000000000000000000000001234')).to.equal(
        '0xAbCdEf0000000000000000000000000000001234',
      );
    });

    it('produces consistent results through both formatAccessList and formatAuthorizationList', () => {
      // Verify both formatters use the same formatAddress logic
      const testAddress = '0xabcd';

      // Through access list (type 2)
      const accessListResult = createTransactionFromContractResult({
        amount: 0,
        from: '0x05fba803be258049a27b820088bab1cad2058871',
        function_parameters: constants.EMPTY_HEX,
        gas_used: 21000,
        gas_limit: 21000,
        to: '0x0000000000000000000000000000000000000409',
        hash: prepend0x('aa'.repeat(32)),
        block_hash: prepend0x('bb'.repeat(48)),
        block_number: 1,
        transaction_index: 0,
        chain_id: '0x12a',
        gas_price: constants.EMPTY_HEX,
        max_fee_per_gas: constants.EMPTY_HEX,
        max_priority_fee_per_gas: constants.EMPTY_HEX,
        r: prepend0x('11'.repeat(32)),
        s: prepend0x('22'.repeat(32)),
        type: 2,
        v: 1,
        nonce: 0,
        access_list: [{ address: testAddress, storageKeys: [] }],
      });

      // Through authorization list (type 4)
      const authListResult = createTransactionFromContractResult({
        amount: 0,
        from: '0x05fba803be258049a27b820088bab1cad2058871',
        function_parameters: constants.EMPTY_HEX,
        gas_used: 21000,
        gas_limit: 21000,
        to: '0x0000000000000000000000000000000000000409',
        hash: prepend0x('aa'.repeat(32)),
        block_hash: prepend0x('bb'.repeat(48)),
        block_number: 1,
        transaction_index: 0,
        chain_id: '0x12a',
        gas_price: constants.EMPTY_HEX,
        max_fee_per_gas: constants.EMPTY_HEX,
        max_priority_fee_per_gas: constants.EMPTY_HEX,
        r: prepend0x('11'.repeat(32)),
        s: prepend0x('22'.repeat(32)),
        type: 4,
        v: 1,
        nonce: 0,
        authorization_list: [{ address: testAddress, chainId: '1', nonce: '1', yParity: '1', r: '0x1', s: '0x1' }],
      });

      expect((accessListResult as Transaction1559)?.accessList?.[0].address).to.equal(
        (authListResult as Transaction7702)?.authorizationList?.[0].address,
      );
    });
  });
});
