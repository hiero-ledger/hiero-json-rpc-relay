// SPDX-License-Identifier: Apache-2.0

import { expect } from 'chai';
import { Transaction } from 'ethers';
import { Logger, pino } from 'pino';
import * as sinon from 'sinon';

import { TransactionPoolService } from '../../../../src/lib/services/transactionPoolService/transactionPoolService';
import { PendingTransactionStorage } from '../../../../src/lib/types/transactionPool';

describe('TransactionPoolService Test Suite', function () {
  this.timeout(10000);

  let logger: Logger;
  let mockStorage: sinon.SinonStubbedInstance<PendingTransactionStorage>;
  let transactionPoolService: TransactionPoolService;

  const testAddress = '0x742d35cc6629c0532c262d2d73f4c8e1a1b7b7b7';
  const testTxHash = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
  const testRlpHex = '0xf86c018502540be400825208947742d35cc6629c0532c262d2d73f4c8e1a1b7b7b780801ca0';
  const testTransaction: Transaction = {
    hash: testTxHash,
    serialized: testRlpHex,
    data: '0x',
    to: testAddress,
    from: testAddress,
    value: 0n,
    gasLimit: 21000n,
    gasPrice: 1000000000n,
    nonce: 1,
  } as Transaction;

  beforeEach(() => {
    logger = pino({ level: 'silent' });

    // Create a mock storage with all required methods
    mockStorage = {
      getList: sinon.stub(),
      addToList: sinon.stub(),
      removeFromList: sinon.stub(),
      removeAll: sinon.stub(),
      getTransactionPayload: sinon.stub(),
      getTransactionPayloads: sinon.stub(),
      getAllTransactionHashes: sinon.stub(),
      getTransactionHashes: sinon.stub(),
    };

    transactionPoolService = new TransactionPoolService(mockStorage, logger);
  });

  afterEach(() => {
    sinon.restore();
  });

  describe('Constructor', () => {
    it('should create instance with provided storage and logger', () => {
      expect(transactionPoolService).to.be.instanceOf(TransactionPoolService);
      expect(transactionPoolService['storage']).to.equal(mockStorage);
      expect(transactionPoolService['logger']).to.exist;
    });
  });

  describe('saveTransaction', () => {
    it('should successfully save transaction to pool', async () => {
      mockStorage.addToList.resolves();

      await transactionPoolService.saveTransaction(testAddress, testTransaction);

      expect(mockStorage.addToList.calledOnce).to.be.true;
      expect(mockStorage.addToList.calledWith(testAddress.toLowerCase(), testTxHash, testRlpHex)).to.be.true;
    });

    it('should throw error when transaction has no hash', async () => {
      const txWithoutHash = { ...testTransaction, hash: null } as Transaction;

      try {
        await transactionPoolService.saveTransaction(testAddress, txWithoutHash);
        expect.fail('Expected error to be thrown');
      } catch (error) {
        expect(error).to.be.instanceOf(Error);
        expect((error as Error).message).to.equal('Transaction hash is required for storage');
      }

      expect(mockStorage.addToList.called).to.be.false;
    });

    it('should propagate storage errors', async () => {
      const storageError = new Error('Storage connection failed');
      mockStorage.addToList.rejects(storageError);

      try {
        await transactionPoolService.saveTransaction(testAddress, testTransaction);
        expect.fail('Expected error to be thrown');
      } catch (error) {
        expect((error as Error).message).to.equal('Storage connection failed');
      }

      expect(mockStorage.addToList.calledOnce).to.be.true;
      expect(mockStorage.addToList.calledWith(testAddress.toLowerCase(), testTxHash, testRlpHex)).to.be.true;
    });
  });

  describe('removeTransaction', () => {
    it('should successfully remove transaction from pool', async () => {
      mockStorage.removeFromList.resolves();

      await transactionPoolService.removeTransaction(testAddress, testTxHash);

      expect(mockStorage.removeFromList.calledOnceWith(testAddress.toLowerCase(), testTxHash)).to.be.true;
    });

    it('should propagate storage errors', async () => {
      const storageError = new Error('Storage removal failed');
      mockStorage.removeFromList.rejects(storageError);

      try {
        await transactionPoolService.removeTransaction(testAddress, testTxHash);
        expect.fail('Expected error to be thrown');
      } catch (error) {
        expect(error).to.equal(storageError);
      }

      expect(mockStorage.removeFromList.calledOnceWith(testAddress.toLowerCase(), testTxHash)).to.be.true;
    });
  });

  describe('getPendingCount', () => {
    it('should successfully retrieve pending transaction count', async () => {
      const pendingCount = 5;
      mockStorage.getList.resolves(pendingCount);

      const result = await transactionPoolService.getPendingCount(testAddress);

      expect(result).to.equal(pendingCount);
      expect(mockStorage.getList.calledOnceWith(testAddress.toLowerCase())).to.be.true;
    });

    it('should return zero for address with no pending transactions', async () => {
      mockStorage.getList.resolves(0);

      const result = await transactionPoolService.getPendingCount(testAddress);

      expect(result).to.equal(0);
      expect(mockStorage.getList.calledOnceWith(testAddress.toLowerCase())).to.be.true;
    });

    it('should propagate storage errors', async () => {
      const storageError = new Error('Storage lookup failed');
      mockStorage.getList.rejects(storageError);

      try {
        await transactionPoolService.getPendingCount(testAddress);
        expect.fail('Expected error to be thrown');
      } catch (error) {
        expect(error).to.equal(storageError);
      }

      expect(mockStorage.getList.calledOnceWith(testAddress.toLowerCase())).to.be.true;
    });
  });

  describe('Integration scenarios', () => {
    it('should handle complete transaction lifecycle', async () => {
      // Setup initial state
      mockStorage.getList.resolves(0);
      mockStorage.addToList.resolves();
      mockStorage.removeFromList.resolves();

      // Save transaction
      await transactionPoolService.saveTransaction(testAddress, testTransaction);

      // Verify pending count increased
      mockStorage.getList.resolves(1);
      const pendingCount = await transactionPoolService.getPendingCount(testAddress);
      expect(pendingCount).to.equal(1);

      // Remove transaction (simulating consensus result)
      await transactionPoolService.removeTransaction(testAddress, testTxHash);

      // Verify all storage methods were called correctly
      expect(mockStorage.getList.called).to.be.true;
      expect(mockStorage.addToList.calledOnce).to.be.true;
      expect(mockStorage.removeFromList.calledOnce).to.be.true;
    });

    it('should handle multiple transactions for same address', async () => {
      const secondTxHash = '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890';
      const secondRlpHex = '0xf86c028502540be400825208947742d35cc6629c0532c262d2d73f4c8e1a1b7b7b780801ca0';
      const secondTx = {
        ...testTransaction,
        hash: secondTxHash,
        serialized: secondRlpHex,
      } as Transaction;

      // First transaction
      mockStorage.getList.resolves(0);
      mockStorage.addToList.resolves();
      await transactionPoolService.saveTransaction(testAddress, testTransaction);

      // Second transaction
      mockStorage.getList.resolves(1);
      mockStorage.addToList.resolves();
      await transactionPoolService.saveTransaction(testAddress, secondTx);

      expect(mockStorage.addToList.calledTwice).to.be.true;
      expect(mockStorage.addToList.firstCall.calledWith(testAddress.toLowerCase(), testTxHash, testRlpHex)).to.be.true;
      expect(mockStorage.addToList.secondCall.calledWith(testAddress.toLowerCase(), secondTxHash, secondRlpHex)).to.be
        .true;
    });
  });

  describe('Payload handling (new functionality)', () => {
    it('should pass RLP payload to addToList when saving transaction', async () => {
      mockStorage.addToList.resolves();

      await transactionPoolService.saveTransaction(testAddress, testTransaction);

      expect(mockStorage.addToList.calledOnce).to.be.true;
      const callArgs = mockStorage.addToList.firstCall.args;
      expect(callArgs[0]).to.equal(testAddress.toLowerCase());
      expect(callArgs[1]).to.equal(testTxHash);
      expect(callArgs[2]).to.equal(testRlpHex);
    });

    it('should atomically save address index and payload in single storage call', async () => {
      mockStorage.addToList.resolves();

      await transactionPoolService.saveTransaction(testAddress, testTransaction);

      // Verify only one storage call was made
      expect(mockStorage.addToList.callCount).to.equal(1);
    });

    it('should atomically remove address index and payload in single storage call', async () => {
      mockStorage.removeFromList.resolves();

      await transactionPoolService.removeTransaction(testAddress, testTxHash);

      // Verify only one storage call was made
      expect(mockStorage.removeFromList.callCount).to.equal(1);
    });
  });
});
