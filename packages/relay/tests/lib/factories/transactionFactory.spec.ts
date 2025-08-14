// SPDX-License-Identifier: Apache-2.0

import { expect } from 'chai';

import { createTransactionFromContractResult } from '../../../src/lib/factories/transactionFactory';

describe('TransactionFactory', () => {
  describe('createTransactionFromContractResult', () => {
    const contractResult = {
      amount: 0,
      from: '0x05fba803be258049a27b820088bab1cad2058871',
      function_parameters: '0x08090033',
      gas_used: 400000,
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
      amount: 0,
      from: '0x05fba803be258049a27b820088bab1cad2058871',
      function_parameters: '0x08090033',
      gas_used: 400000,
      to: '0x0000000000000000000000000000000000000409',
      hash: '0xfc4ab7133197016293d2e14e8cf9c5227b07357e6385184f1cd1cb40d783cfbd',
      block_hash: '0xb0f10139fa0bf9e66402c8c0e5ed364e07cf83b3726c8045fabf86a07f4887130e4650cb5cf48a9f6139a805b78f0312',
      block_number: 528,
      transaction_index: 9,
      chain_id: '0x12a',
      gas_price: '0x',
      max_fee_per_gas: '0x59',
      max_priority_fee_per_gas: '0x',
      r: '0x58075c8984de34a46c9617ab2b4e0ed5ddc8803e718c42152ed5d58b82166676',
      s: '0x0dd3a5aeb203d9284e50a9973bc5e266a3ea66da1fbb793b244b19b42f19e00b',
      type: 2,
      v: 1,
      nonce: 2,
    };

    it('should return null if null is passed', () => {
      expect(createTransactionFromContractResult(null)).to.equal(null);
    });

    it('should return a valid match', () => {
      const formattedResult: any = createTransactionFromContractResult(contractResult);
      expect(formattedResult.accessList).to.deep.eq([]);
      expect(formattedResult.blockHash).to.equal('0xb0f10139fa0bf9e66402c8c0e5ed364e07cf83b3726c8045fabf86a07f488713');
      expect(formattedResult.blockNumber).to.equal('0x210');
      expect(formattedResult.chainId).to.equal('0x12a');
      expect(formattedResult.from).to.equal('0x05fba803be258049a27b820088bab1cad2058871');
      expect(formattedResult.gas).to.equal('0x61a80');
      expect(formattedResult.gasPrice).to.equal('0x0');
      expect(formattedResult.hash).to.equal('0xfc4ab7133197016293d2e14e8cf9c5227b07357e6385184f1cd1cb40d783cfbd');
      expect(formattedResult.input).to.equal('0x08090033');
      expect(formattedResult.maxPriorityFeePerGas).to.equal('0x0');
      expect(formattedResult.maxFeePerGas).to.equal('0x59');
      expect(formattedResult.nonce).to.equal('0x2');
      expect(formattedResult.r).to.equal('0x2af9d41244c702764ed86c5b9f1a734b075b91c4d9c65e78bc584b0e35181e42');
      expect(formattedResult.s).to.equal('0x3f0a6baa347876e08c53ffc70619ba75881841885b2bd114dbb1905cd57112a5');
      expect(formattedResult.to).to.equal('0x0000000000000000000000000000000000000409');
      expect(formattedResult.transactionIndex).to.equal('0x9');
      expect(formattedResult.type).to.equal('0x2');
      expect(formattedResult.yParity).to.equal('0x1');
      expect(formattedResult.v).to.equal(`0x1`);
      expect(formattedResult.value).to.equal('0x0');
    });

    it('should return a valid signature s value', () => {
      const formattedResult: any = createTransactionFromContractResult(contractResultZeroPrefixedSignatureS);
      expect(formattedResult.accessList).to.deep.eq([]);
      expect(formattedResult.blockHash).to.equal('0xb0f10139fa0bf9e66402c8c0e5ed364e07cf83b3726c8045fabf86a07f488713');
      expect(formattedResult.blockNumber).to.equal('0x210');
      expect(formattedResult.chainId).to.equal('0x12a');
      expect(formattedResult.from).to.equal('0x05fba803be258049a27b820088bab1cad2058871');
      expect(formattedResult.gas).to.equal('0x61a80');
      expect(formattedResult.gasPrice).to.equal('0x0');
      expect(formattedResult.hash).to.equal('0xfc4ab7133197016293d2e14e8cf9c5227b07357e6385184f1cd1cb40d783cfbd');
      expect(formattedResult.input).to.equal('0x08090033');
      expect(formattedResult.maxPriorityFeePerGas).to.equal('0x0');
      expect(formattedResult.maxFeePerGas).to.equal('0x59');
      expect(formattedResult.nonce).to.equal('0x2');
      expect(formattedResult.r).to.equal('0x58075c8984de34a46c9617ab2b4e0ed5ddc8803e718c42152ed5d58b82166676');
      expect(formattedResult.s).to.equal('0xdd3a5aeb203d9284e50a9973bc5e266a3ea66da1fbb793b244b19b42f19e00b');
      expect(formattedResult.to).to.equal('0x0000000000000000000000000000000000000409');
      expect(formattedResult.transactionIndex).to.equal('0x9');
      expect(formattedResult.type).to.equal('0x2');
      expect(formattedResult.yParity).to.equal('0x1');
      expect(formattedResult.v).to.equal(`0x1`);
      expect(formattedResult.value).to.equal('0x0');
    });

    it('should return nullable fields', () => {
      const formattedResult: any = createTransactionFromContractResult({
        ...contractResult,
        block_number: null,
        gas_used: null,
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
      expect(formattedResult.blockHash).to.equal('0xb0f10139fa0bf9e66402c8c0e5ed364e07cf83b3726c8045fabf86a07f488713');
      expect(formattedResult.blockNumber).to.equal(null);
      expect(formattedResult.chainId).to.equal('0x12a');
      expect(formattedResult.from).to.equal('0x05fba803be258049a27b820088bab1cad2058871');
      expect(formattedResult.gas).to.equal('0x0');
      expect(formattedResult.gasPrice).to.equal('0x0');
      expect(formattedResult.hash).to.equal('0xfc4ab7133197016293d2e14e8cf9c5227b07357e6385184f1cd1cb40d783cfbd');
      expect(formattedResult.input).to.equal('0x08090033');
      expect(formattedResult.maxPriorityFeePerGas).to.equal('0x0');
      expect(formattedResult.maxFeePerGas).to.equal('0x0');
      expect(formattedResult.nonce).to.equal('0x0');
      expect(formattedResult.r).to.equal('0x0');
      expect(formattedResult.s).to.equal('0x0');
      expect(formattedResult.to).to.equal('0x0000000000000000000000000000000000000409');
      expect(formattedResult.transactionIndex).to.equal(null);
      expect(formattedResult.v).to.equal(`0x0`);
      expect(formattedResult.yParity).to.equal('0x0');
      expect(formattedResult.value).to.equal('0x0');
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
});
