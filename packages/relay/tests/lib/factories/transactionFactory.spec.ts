// SPDX-License-Identifier: Apache-2.0

import { expect } from 'chai';

import { numberTo0x } from '../../../src/formatters';
import constants from '../../../src/lib/constants';
import { createTransactionFromContractResult, TransactionFactory } from '../../../src/lib/factories/transactionFactory';
import { AuthorizationListEntry, Log, Transaction1559 } from '../../../src/lib/model';

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
      expect(tx.type).to.equal('0x0');
      expect(tx.from).to.equal(baseFields.from);
      expect(tx.to).to.equal(baseFields.to);
      expect(tx.accessList).to.be.undefined;
    });

    it('should create an access list (type 1) Transaction2930 with empty accessList', () => {
      const tx = TransactionFactory.createTransactionByType(1, {
        ...baseFields,
        type: '0x1',
        accessList: ['should be ignored'],
      });

      expect(tx).to.not.equal(null);
      expect(tx.type).to.equal('0x1');
      expect(tx.accessList).to.deep.eq([]);
      expect(tx.from).to.equal(baseFields.from);
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
      expect(tx.type).to.equal('0x2');
      expect(tx.accessList).to.deep.eq([]);
      expect(tx.maxPriorityFeePerGas).to.equal(constants.ZERO_HEX);
      expect(tx.maxFeePerGas).to.equal('0x59');
    });

    it('should replace EMPTY_HEX fees with ZERO_HEX for type 2', () => {
      const tx = TransactionFactory.createTransactionByType(2, {
        ...baseFields,
        type: '0x2',
        maxPriorityFeePerGas: constants.EMPTY_HEX,
        maxFeePerGas: constants.EMPTY_HEX,
      });

      expect(tx.maxPriorityFeePerGas).to.equal(constants.ZERO_HEX);
      expect(tx.maxFeePerGas).to.equal(constants.ZERO_HEX);
    });

    it('should handle null case by creating a legacy Transaction with provided fields', () => {
      const tx = TransactionFactory.createTransactionByType(null as unknown as number, {
        ...baseFields,
        type: '0x0',
      });

      expect(tx).to.not.equal(null);
      expect(tx.type).to.equal('0x0');
      expect(tx.accessList).to.be.undefined;
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

    const expectTxFromLog = (tx: Transaction1559, inputLog: Log, expectedChainId: string) => {
      expect(tx).to.exist;
      expect(tx.type).to.equal(constants.TWO_HEX);
      expect(tx.accessList).to.deep.eq([]);

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

      expect(tx.maxPriorityFeePerGas).to.equal(constants.ZERO_HEX);
      expect(tx.maxFeePerGas).to.equal(constants.ZERO_HEX);
      expect(tx.nonce).to.equal(numberTo0x(0));

      expect(tx.r).to.equal(constants.EMPTY_HEX);
      expect(tx.s).to.equal(constants.EMPTY_HEX);
      expect(tx.v).to.equal(constants.ZERO_HEX);
      expect(tx.value).to.equal(constants.ZERO_HEX);
    };

    it('should create a valid EIP-1559 tx from a log with defaulted fields', () => {
      const tx = TransactionFactory.createTransactionFromLog(chainId, log);
      expectTxFromLog(tx, log, chainId);
    });

    it('should mirror the log address to both from and to', () => {
      const anotherLog = {
        ...log,
        address: '0x0000000000000000000000000000000000000409',
      };
      const tx = TransactionFactory.createTransactionFromLog(chainId, anotherLog);
      expect(tx.from).to.equal(anotherLog.address);
      expect(tx.to).to.equal(anotherLog.address);
    });

    it('should keep the provided chainId untouched', () => {
      const customChainId = '0x127';
      const tx = TransactionFactory.createTransactionFromLog(customChainId, log);
      expect(tx.chainId).to.equal(customChainId);
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
      expect(tx.blockHash).to.equal(modifiedLog.blockHash);
      expect(tx.blockNumber).to.equal(modifiedLog.blockNumber);
      expect(tx.hash).to.equal(modifiedLog.transactionHash);
      expect(tx.transactionIndex).to.equal(modifiedLog.transactionIndex);
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
      expect(formattedResult.maxFeePerGas).to.equal(expectedValues.maxFeePerGas ?? '0x59');
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
      max_fee_per_gas: '0x59',
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
     * @param {any} input - Raw authorization list input (may contain nulls,
     *                      malformed items, non-0x-prefixed values, oversized
     *                      signatures, or extra properties).
     *
     * @returns {AuthorizationListEntry[]} The normalized and sanitized
     * authorization list as produced by the internal formatter.
     */
    const formatAuthorizationList = (input: any): AuthorizationListEntry[] =>
      createTransactionFromContractResult({
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
        gas_price: '0x',
        max_fee_per_gas: '0x59',
        max_priority_fee_per_gas: '0x',
        r: '0x2af9d41244c702764ed86c5b9f1a734b075b91c4d9c65e78bc584b0e35181e42',
        s: '0x3f0a6baa347876e08c53ffc70619ba75881841885b2bd114dbb1905cd57112a5',
        type: 4,
        v: 1,
        authorization_list: input,
        nonce: 2,
      })!['authorizationList'];

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
      const item: any = {
        chainId: '1',
        nonce: '2',
        address: '0x1234',
        yParity: '1',
        r: '0x' + '00'.repeat(32),
        s: '0x' + '00'.repeat(32),
        extraField: 'keep-me',
      };

      const input = [item];

      const [out] = formatAuthorizationList(input);

      expect(out).to.have.property('extraField').equal('keep-me');
    });
  });
});
