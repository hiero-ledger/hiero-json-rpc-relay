// SPDX-License-Identifier: Apache-2.0

import { RLP } from '@ethereumjs/rlp';
import { hexToBytes } from '@ethereumjs/util';
import { expect } from 'chai';

import { prepend0x, toHexString } from '../../../src/formatters';
import constants from '../../../src/lib/constants';
import { TransactionReceiptFactory } from '../../../src/lib/factories/transactionReceiptFactory';
import type { ITransactionReceipt } from '../../../src/lib/types';

export type DecodedLog = [Uint8Array, Uint8Array[], Uint8Array];
export type DecodedReceipt = [Uint8Array, Uint8Array, Uint8Array, DecodedLog[]];

function decodeEncodedReceipt(encoded: string) {
  const bytes = hexToBytes(encoded as `0x${string}`);

  const isTyped = bytes.length > 0 && (bytes[0] === 0x01 || bytes[0] === 0x02);
  const txType = isTyped ? bytes[0] : 0;
  const payload = isTyped ? bytes.slice(1) : bytes;

  const decoded = RLP.decode(payload) as DecodedReceipt;
  const [rootOrStatus, cumulativeGasUsed, logsBloom, logs] = decoded;

  return { txType, rootOrStatus, cumulativeGasUsed, logsBloom, logs };
}

describe('TransactionReceiptFactory', () => {
  describe('encodeReceiptToHex', () => {
    it('encodes a legacy (type 0) receipt with state root (pre-Byzantium style)', () => {
      const receipt: ITransactionReceipt = {
        blockHash: '0x8af70e7f281dd721a9fa61d9437a5f1b0ca0cb449ef65be98a70b7cbac2ef40e',
        blockNumber: '0x1',
        from: '0x1111111111111111111111111111111111111111',
        to: '0x2222222222222222222222222222222222222222',
        cumulativeGasUsed: '0x1234',
        gasUsed: '0x1234',
        contractAddress: '0x3333333333333333333333333333333333333333',
        logs: [],
        logsBloom: '0x' + '00'.repeat(256),
        root: '0x01',
        status: '0x1',
        transactionHash: '0xe494b1bb298216f2f6c97b3aa04be60e456c5e8d401e041e6da371c06bcad1d2',
        transactionIndex: '0x0',
        effectiveGasPrice: '0x1',
        type: '0x0',
      };

      const encoded = TransactionReceiptFactory.encodeReceiptToHex(receipt);
      const { txType, rootOrStatus, cumulativeGasUsed, logsBloom, logs } = decodeEncodedReceipt(encoded);

      expect(txType).to.equal(0); // no EIP‑2718 prefix
      expect(prepend0x(toHexString(rootOrStatus))).to.equal(receipt.root);
      expect(BigInt(prepend0x(toHexString(cumulativeGasUsed)))).to.equal(BigInt(receipt.cumulativeGasUsed));
      expect(prepend0x(toHexString(logsBloom))).to.equal(receipt.logsBloom);
      expect(logs).to.have.lengthOf(0);
    });

    it('encodes a post-Byzantium success receipt with status=1 and cumulativeGasUsed=0 as RLP-empty (0x80)', () => {
      const receipt: ITransactionReceipt = {
        blockHash: '0x8af70e7f281dd721a9fa61d9437a5f1b0ca0cb449ef65be98a70b7cbac2ef40e',
        blockNumber: '0x1',
        from: '0xc37f417fa09933335240fca72dd257bfbde9c275',
        to: '0x637a6a8e5a69c087c24983b05261f63f64ed7e9b',
        cumulativeGasUsed: '0x0',
        gasUsed: '0x0',
        contractAddress: '0x3333333333333333333333333333333333333333',
        logs: [],
        logsBloom: '0x' + '00'.repeat(256),
        root: '0x',
        status: constants.ONE_HEX,
        transactionHash: '0xe494b1bb298216f2f6c97b3aa04be60e456c5e8d401e041e6da371c06bcad1d2',
        transactionIndex: '0x0',
        effectiveGasPrice: '0x1',
        type: '0x0',
      };

      const encoded = TransactionReceiptFactory.encodeReceiptToHex(receipt);
      const { txType, rootOrStatus, cumulativeGasUsed } = decodeEncodedReceipt(encoded);

      expect(txType).to.equal(0);
      expect(rootOrStatus).to.have.lengthOf(1);
      expect(rootOrStatus[0]).to.equal(0x01);

      // cumulativeGasUsed=0 must be encoded as empty string → RLP 0x80.
      // After RLP decode we see an empty byte array:
      expect(cumulativeGasUsed.length).to.equal(0);
    });

    it('encodes a post-Byzantium receipt cumulativeGasUsed=0x0001', () => {
      const receipt: ITransactionReceipt = {
        blockHash: '0x8af70e7f281dd721a9fa61d9437a5f1b0ca0cb449ef65be98a70b7cbac2ef40e',
        blockNumber: '0x1',
        from: '0xc37f417fa09933335240fca72dd257bfbde9c275',
        to: '0x637a6a8e5a69c087c24983b05261f63f64ed7e9b',
        cumulativeGasUsed: '0x0001',
        gasUsed: '0x0',
        contractAddress: '0x3333333333333333333333333333333333333333',
        logs: [],
        logsBloom: '0x' + '00'.repeat(256),
        root: '0x',
        status: constants.ONE_HEX,
        transactionHash: '0xe494b1bb298216f2f6c97b3aa04be60e456c5e8d401e041e6da371c06bcad1d2',
        transactionIndex: '0x0',
        effectiveGasPrice: '0x1',
        type: '0x0',
      };

      const encoded = TransactionReceiptFactory.encodeReceiptToHex(receipt);
      const { cumulativeGasUsed } = decodeEncodedReceipt(encoded);

      const decodedHex = prepend0x(toHexString(cumulativeGasUsed));
      expect(BigInt(decodedHex)).to.equal(BigInt(receipt.cumulativeGasUsed));
      expect(cumulativeGasUsed.length).to.be.greaterThan(0);
      expect(cumulativeGasUsed[0]).to.not.equal(0x00);
      expect(BigInt(decodedHex)).to.equal(1n);
    });

    it('encodes logs as [address, topics[], data] per Yellow Paper', () => {
      const receipt = {
        blockHash: '0x8af70e7f281dd721a9fa61d9437a5f1b0ca0cb449ef65be98a70b7cbac2ef40e',
        blockNumber: '0x1',
        from: '0xc37f417fa09933335240fca72dd257bfbde9c275',
        to: '0x637a6a8e5a69c087c24983b05261f63f64ed7e9b',
        cumulativeGasUsed: '0x10',
        logsBloom: '0x' + '00'.repeat(256),
        root: '0x',
        status: constants.ONE_HEX,
        effectiveGasPrice: '0x1',
        type: '0x0',
        logs: [
          {
            address: '0x0000000000000000000000000000000000001000',
            topics: [
              '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
              '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
            ],
            data: '0x000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000002e6',
            blockHash: '0x8af70e7f281dd721a9fa61d9437a5f1b0ca0cb449ef65be98a70b7cbac2ef40e',
            blockNumber: '0x1',
            blockTimestamp: '0x1',
            transactionHash: '0xe494b1bb298216f2f6c97b3aa04be60e456c5e8d401e041e6da371c06bcad1d2',
            transactionIndex: '0x0',
            logIndex: '0x0',
            removed: false,
          },
        ],
      } as ITransactionReceipt;

      const encoded = TransactionReceiptFactory.encodeReceiptToHex(receipt);
      const { logs } = decodeEncodedReceipt(encoded);

      expect(logs).to.have.lengthOf(1);
      const [addr, topics, data] = logs[0];

      expect(prepend0x(toHexString(addr))).to.equal(receipt.logs[0].address);
      expect(topics).to.have.lengthOf(receipt.logs[0].topics.length);
      receipt.logs[0].topics.forEach((t, i) => {
        expect(prepend0x(toHexString(topics[i]))).to.equal(t);
      });
      expect(prepend0x(toHexString(data))).to.equal(receipt.logs[0].data);
    });

    it('adds EIP-2718 type byte for typed (e.g. type 0x2) receipts', () => {
      const receipt: ITransactionReceipt = {
        blockHash: '0x8af70e7f281dd721a9fa61d9437a5f1b0ca0cb449ef65be98a70b7cbac2ef40e',
        blockNumber: '0x1',
        from: '0xc37f417fa09933335240fca72dd257bfbde9c275',
        to: '0x637a6a8e5a69c087c24983b05261f63f64ed7e9b',
        cumulativeGasUsed: '0x10',
        gasUsed: '0x10',
        contractAddress: '0x3333333333333333333333333333333333333333',
        logs: [],
        logsBloom: '0x' + '00'.repeat(256),
        root: '0x',
        status: constants.ONE_HEX,
        transactionHash: '0xe494b1bb298216f2f6c97b3aa04be60e456c5e8d401e041e6da371c06bcad1d2',
        transactionIndex: '0x0',
        effectiveGasPrice: '0x1',
        type: '0x2',
      };

      const encoded = TransactionReceiptFactory.encodeReceiptToHex(receipt);
      const { txType, rootOrStatus } = decodeEncodedReceipt(encoded);

      expect(txType).to.equal(0x02);
      expect(rootOrStatus).to.have.lengthOf(1);
      expect(rootOrStatus[0]).to.equal(0x01);
    });

    it('encodes a failed receipt (status=0) with empty first field', () => {
      const receipt: ITransactionReceipt = {
        blockHash: '0x8af70e7f281dd721a9fa61d9437a5f1b0ca0cb449ef65be98a70b7cbac2ef40e',
        blockNumber: '0x1',
        from: '0xc37f417fa09933335240fca72dd257bfbde9c275',
        to: '0x637a6a8e5a69c087c24983b05261f63f64ed7e9b',
        cumulativeGasUsed: '0x1234',
        gasUsed: '0x1234',
        contractAddress: '0x3333333333333333333333333333333333333333',
        logs: [],
        logsBloom: '0x' + '00'.repeat(256),
        root: '0x',
        status: '0x0',
        transactionHash: '0xe494b1bb298216f2f6c97b3aa04be60e456c5e8d401e041e6da371c06bcad1d2',
        transactionIndex: '0x0',
        effectiveGasPrice: '0x1',
        type: '0x0',
      };

      const encoded = TransactionReceiptFactory.encodeReceiptToHex(receipt);
      const { rootOrStatus } = decodeEncodedReceipt(encoded);

      // status=0 → first field is encoded as empty string (RLP 0x80), so decode gives empty bytes
      expect(rootOrStatus.length).to.equal(0);
    });

    it('does not add a type prefix when receipt.type is null', () => {
      const receipt: ITransactionReceipt = {
        blockHash: '0x8af70e7f281dd721a9fa61d9437a5f1b0ca0cb449ef65be98a70b7cbac2ef40e',
        blockNumber: '0x1',
        from: '0xc37f417fa09933335240fca72dd257bfbde9c275',
        to: '0x637a6a8e5a69c087c24983b05261f63f64ed7e9b',
        cumulativeGasUsed: '0x10',
        gasUsed: '0x10',
        contractAddress: '0x3333333333333333333333333333333333333333',
        logs: [],
        logsBloom: '0x' + '00'.repeat(256),
        root: '0x',
        status: constants.ONE_HEX,
        transactionHash: '0xe494b1bb298216f2f6c97b3aa04be60e456c5e8d401e041e6da371c06bcad1d2',
        transactionIndex: '0x0',
        effectiveGasPrice: '0x1',
        type: null,
      };

      const encoded = TransactionReceiptFactory.encodeReceiptToHex(receipt);
      const { txType } = decodeEncodedReceipt(encoded);

      // No EIP‑2718 prefix should be added
      expect(txType).to.equal(0);
    });
  });
});
