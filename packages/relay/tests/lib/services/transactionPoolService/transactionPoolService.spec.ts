// SPDX-License-Identifier: Apache-2.0

import { expect } from 'chai';
import { Transaction } from 'ethers';
import { Logger, pino } from 'pino';
import * as sinon from 'sinon';

import { TransactionPoolService } from '../../../../src/lib/services/transactionPoolService/transactionPoolService';
import { IExecuteTransactionEventPayload } from '../../../../src/lib/types/events';
import { AddToListResult, PendingTransactionStorage } from '../../../../src/lib/types/transactionPool';

describe('TransactionPoolService Test Suite', function () {
  this.timeout(10000);

  let logger: Logger;
  let mockStorage: sinon.SinonStubbedInstance<PendingTransactionStorage>;
  let transactionPoolService: TransactionPoolService;

  const testAddress = '0x742d35cc6629c0532c262d2d73f4c8e1a1b7b7b7';
  const testTxHash = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
  const testTransactionId = '0.0.123@1234567890.123456789';
  const testTransaction: Transaction = {
    hash: testTxHash,
    data: '0x',
    to: testAddress,
    from: testAddress,
    value: 0n,
    gasLimit: 21000n,
    gasPrice: 1000000000n,
    nonce: 1,
  } as Transaction;

  const createTestEventPayload = (
    overrides?: Partial<IExecuteTransactionEventPayload>,
  ): IExecuteTransactionEventPayload => ({
    transactionId: testTransactionId,
    transactionHash: testTxHash,
    txConstructorName: 'EthereumTransaction',
    operatorAccountId: '0.0.2',
    requestDetails: {
      requestId: 'test-request-id',
      ipAddress: '127.0.0.1',
    } as any,
    originalCallerAddress: testAddress,
    ...overrides,
  });

  beforeEach(() => {
    logger = pino({ level: 'silent' });

    // Create a mock storage with all required methods
    mockStorage = {
      getList: sinon.stub(),
      addToList: sinon.stub(),
      removeFromList: sinon.stub(),
      removeAll: sinon.stub(),
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
      const newPending = 3;

      mockStorage.addToList.resolves({ ok: true, newValue: newPending } as AddToListResult);

      await transactionPoolService.saveTransaction(testAddress, testTransaction);

      expect(mockStorage.addToList.calledOnce).to.be.true;
      expect(mockStorage.addToList.calledWith(testAddress, testTxHash)).to.be.true;
    });

    it('should throw error on concurrent modification', async () => {
      const actualPending = 3;

      mockStorage.addToList.resolves({ ok: false, current: actualPending } as AddToListResult);

      try {
        await transactionPoolService.saveTransaction(testAddress, testTransaction);
        expect.fail('Expected error to be thrown');
      } catch (error) {
        expect(error).to.be.instanceOf(Error);
        expect((error as Error).message).to.equal('Failed to add transaction to list');
      }

      expect(mockStorage.addToList.calledOnce).to.be.true;
      expect(mockStorage.addToList.calledWith(testAddress, testTxHash)).to.be.true;
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
      expect(mockStorage.addToList.calledWith(testAddress, testTxHash)).to.be.true;
    });
  });

  describe('onConsensusResult', () => {
    it('should successfully remove transaction from pool when transaction hash is provided', async () => {
      const remainingCount = 1;
      const payload = createTestEventPayload();

      mockStorage.removeFromList.resolves(remainingCount);

      await transactionPoolService.onConsensusResult(payload);

      expect(mockStorage.removeFromList.calledOnceWith(testAddress, testTxHash)).to.be.true;
    });

    it('should handle missing transaction hash gracefully', async () => {
      const payload = createTestEventPayload({ transactionHash: undefined });

      await transactionPoolService.onConsensusResult(payload);

      expect(mockStorage.removeFromList.called).to.be.false;
    });

    it('should handle empty transaction hash gracefully', async () => {
      const payload = createTestEventPayload({ transactionHash: '' });

      await transactionPoolService.onConsensusResult(payload);

      expect(mockStorage.removeFromList.called).to.be.false;
    });

    it('should throw storage errors during transaction removal', async () => {
      const payload = createTestEventPayload();
      const storageError = new Error('Storage removal failed');
      mockStorage.removeFromList.rejects(storageError);

      // Should throw - errors are no longer caught
      await expect(transactionPoolService.onConsensusResult(payload)).to.be.rejectedWith('Storage removal failed');

      expect(mockStorage.removeFromList.calledOnceWith(testAddress, testTxHash)).to.be.true;
    });

    it('should throw when removal fails', async () => {
      const payload = createTestEventPayload();
      mockStorage.removeFromList.rejects(new Error('Storage error'));

      // Should throw when storage fails
      await expect(transactionPoolService.onConsensusResult(payload)).to.be.rejectedWith('Storage error');
    });

    it('should use originalCallerAddress from payload for transaction removal', async () => {
      const customAddress = '0x999999999999999999999999999999999999999';
      const payload = createTestEventPayload({ originalCallerAddress: customAddress });

      mockStorage.removeFromList.resolves(0);

      await transactionPoolService.onConsensusResult(payload);

      expect(mockStorage.removeFromList.calledOnceWith(customAddress, testTxHash)).to.be.true;
    });

    it('should handle multiple transaction removals correctly', async () => {
      const payload1 = createTestEventPayload();
      const payload2 = createTestEventPayload({
        transactionHash: '0xabcdef1234567890',
        originalCallerAddress: '0x1111111111111111111111111111111111111111',
      });

      mockStorage.removeFromList.resolves(0);

      await transactionPoolService.onConsensusResult(payload1);
      await transactionPoolService.onConsensusResult(payload2);

      expect(mockStorage.removeFromList.calledTwice).to.be.true;
      expect(mockStorage.removeFromList.firstCall.calledWith(testAddress, testTxHash)).to.be.true;
      expect(
        mockStorage.removeFromList.secondCall.calledWith(
          '0x1111111111111111111111111111111111111111',
          '0xabcdef1234567890',
        ),
      ).to.be.true;
    });
  });

  describe('removeTransaction', () => {
    it('should successfully remove transaction from pool', async () => {
      const remainingCount = 1;
      mockStorage.removeFromList.resolves(remainingCount);

      const result = await transactionPoolService.removeTransaction(testAddress, testTxHash);

      expect(result).to.equal(remainingCount);
      expect(mockStorage.removeFromList.calledOnceWith(testAddress, testTxHash)).to.be.true;
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

      expect(mockStorage.removeFromList.calledOnceWith(testAddress, testTxHash)).to.be.true;
    });
  });

  describe('getPendingCount', () => {
    it('should successfully retrieve pending transaction count', async () => {
      const pendingCount = 5;
      mockStorage.getList.resolves(pendingCount);

      const result = await transactionPoolService.getPendingCount(testAddress);

      expect(result).to.equal(pendingCount);
      expect(mockStorage.getList.calledOnceWith(testAddress)).to.be.true;
    });

    it('should return zero for address with no pending transactions', async () => {
      mockStorage.getList.resolves(0);

      const result = await transactionPoolService.getPendingCount(testAddress);

      expect(result).to.equal(0);
      expect(mockStorage.getList.calledOnceWith(testAddress)).to.be.true;
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

      expect(mockStorage.getList.calledOnceWith(testAddress)).to.be.true;
    });
  });

  describe('resetState', () => {
    it('should successfully reset transaction pool state', async () => {
      mockStorage.removeAll.resolves();

      await transactionPoolService.resetState();

      expect(mockStorage.removeAll.calledOnce).to.be.true;
    });

    it('should propagate storage errors', async () => {
      const storageError = new Error('Storage reset failed');
      mockStorage.removeAll.rejects(storageError);

      try {
        await transactionPoolService.resetState();
        expect.fail('Expected error to be thrown');
      } catch (error) {
        expect(error).to.equal(storageError);
      }

      expect(mockStorage.removeAll.calledOnce).to.be.true;
    });
  });

  describe('Integration scenarios', () => {
    it('should handle complete transaction lifecycle', async () => {
      // Setup initial state
      mockStorage.getList.resolves(0);
      mockStorage.addToList.resolves({ ok: true, newValue: 1 } as AddToListResult);
      mockStorage.removeFromList.resolves(0);

      // Save transaction
      await transactionPoolService.saveTransaction(testAddress, testTransaction);

      // Verify pending count increased
      mockStorage.getList.resolves(1);
      const pendingCount = await transactionPoolService.getPendingCount(testAddress);
      expect(pendingCount).to.equal(1);

      // Remove transaction (simulating consensus result)
      const remainingCount = await transactionPoolService.removeTransaction(testAddress, testTxHash);
      expect(remainingCount).to.equal(0);

      // Verify all storage methods were called correctly
      expect(mockStorage.getList.called).to.be.true;
      expect(mockStorage.addToList.calledOnce).to.be.true;
      expect(mockStorage.removeFromList.calledOnce).to.be.true;
    });

    it('should handle complete transaction lifecycle using onConsensusResult', async () => {
      // Setup initial state
      mockStorage.getList.resolves(0);
      mockStorage.addToList.resolves({ ok: true, newValue: 1 } as AddToListResult);
      mockStorage.removeFromList.resolves(0);

      // Save transaction
      await transactionPoolService.saveTransaction(testAddress, testTransaction);

      // Verify pending count increased
      mockStorage.getList.resolves(1);
      const pendingCount = await transactionPoolService.getPendingCount(testAddress);
      expect(pendingCount).to.equal(1);

      // Process consensus result (simulating transaction execution event)
      const payload = createTestEventPayload();
      await transactionPoolService.onConsensusResult(payload);

      // Verify all storage methods were called correctly
      expect(mockStorage.getList.called).to.be.true;
      expect(mockStorage.addToList.calledOnce).to.be.true;
      expect(mockStorage.removeFromList.calledOnceWith(testAddress, testTxHash)).to.be.true;
    });

    it('should handle multiple transactions for same address', async () => {
      const secondTx = {
        ...testTransaction,
        hash: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
      } as Transaction;

      // First transaction
      mockStorage.getList.resolves(0);
      mockStorage.addToList.resolves({ ok: true, newValue: 1 } as AddToListResult);
      await transactionPoolService.saveTransaction(testAddress, testTransaction);

      // Second transaction
      mockStorage.getList.resolves(1);
      mockStorage.addToList.resolves({ ok: true, newValue: 2 } as AddToListResult);
      await transactionPoolService.saveTransaction(testAddress, secondTx);

      expect(mockStorage.addToList.calledTwice).to.be.true;
      expect(mockStorage.addToList.firstCall.calledWith(testAddress, testTxHash)).to.be.true;
      expect(
        mockStorage.addToList.secondCall.calledWith(
          testAddress,
          '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
        ),
      ).to.be.true;
    });

    it('should handle pool reset during active transactions', async () => {
      // Setup with pending transactions
      mockStorage.getList.resolves(3);
      mockStorage.removeAll.resolves();

      const initialCount = await transactionPoolService.getPendingCount(testAddress);
      expect(initialCount).to.equal(3);

      await transactionPoolService.resetState();

      expect(mockStorage.removeAll.calledOnce).to.be.true;
    });

    it('should handle consensus events during transaction lifecycle', async () => {
      // Setup with multiple pending transactions
      mockStorage.getList.resolves(2);
      mockStorage.addToList.resolves({ ok: true, newValue: 3 } as AddToListResult);
      mockStorage.removeFromList.resolves(2); // One transaction remains after removal

      // Add new transaction
      await transactionPoolService.saveTransaction(testAddress, testTransaction);

      // Process consensus result for one transaction
      const payload = createTestEventPayload();
      await transactionPoolService.onConsensusResult(payload);

      // Verify the transaction was removed via consensus
      expect(mockStorage.removeFromList.calledOnceWith(testAddress, testTxHash)).to.be.true;
    });

    it('should handle multiple consensus results for different addresses', async () => {
      const address1 = '0x1111111111111111111111111111111111111111';
      const address2 = '0x2222222222222222222222222222222222222222';
      const hash1 = '0xaaaa1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
      const hash2 = '0xbbbb1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';

      mockStorage.removeFromList.resolves(0);

      // Process consensus results for different addresses
      const payload1 = createTestEventPayload({
        originalCallerAddress: address1,
        transactionHash: hash1,
      });
      const payload2 = createTestEventPayload({
        originalCallerAddress: address2,
        transactionHash: hash2,
      });

      await transactionPoolService.onConsensusResult(payload1);
      await transactionPoolService.onConsensusResult(payload2);

      expect(mockStorage.removeFromList.calledTwice).to.be.true;
      expect(mockStorage.removeFromList.firstCall.calledWith(address1, hash1)).to.be.true;
      expect(mockStorage.removeFromList.secondCall.calledWith(address2, hash2)).to.be.true;
    });
  });
});
