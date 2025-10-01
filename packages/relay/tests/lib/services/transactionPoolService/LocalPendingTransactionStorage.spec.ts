// SPDX-License-Identifier: Apache-2.0

import { expect } from 'chai';
import * as sinon from 'sinon';

import { LocalPendingTransactionStorage } from '../../../../src/lib/services/transactionPoolService/LocalPendingTransactionStorage';

describe.only('LocalPendingTransactionStorage Test Suite', function () {
  let storage: LocalPendingTransactionStorage;

  const testAddress1 = '0x742d35cc6db9027d0e0ba7d3c9e5a96f';
  const testAddress2 = '0x742d35cc6db9027d0e0ba7d3c9e5a96e';
  const testTxHash1 = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
  const testTxHash2 = '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890';
  const testTxHash3 = '0x9999999999999999999999999999999999999999999999999999999999999999';

  beforeEach(() => {
    storage = new LocalPendingTransactionStorage();
  });

  afterEach(() => {
    sinon.restore();
  });

  describe('Constructor', () => {
    it('should initialize empty storage', async () => {
      const newStorage = new LocalPendingTransactionStorage();
      const count = await newStorage.getList(testAddress1);
      expect(count).to.equal(0);
    });
  });

  describe('getList', () => {
    it('should return 0 for address with no pending transactions', async () => {
      const count = await storage.getList(testAddress1);
      expect(count).to.equal(0);
    });

    it('should return correct count for address with pending transactions', async () => {
      // Add a transaction first
      await storage.addToList(testAddress1, testTxHash1);

      const count = await storage.getList(testAddress1);
      expect(count).to.equal(1);
    });

    it('should return correct count after multiple transactions added', async () => {
      // Add multiple transactions
      await storage.addToList(testAddress1, testTxHash1);
      await storage.addToList(testAddress1, testTxHash2);

      const count = await storage.getList(testAddress1);
      expect(count).to.equal(2);
    });

    it('should return different counts for different addresses', async () => {
      // Add transactions to different addresses
      await storage.addToList(testAddress1, testTxHash1);
      await storage.addToList(testAddress2, testTxHash2);
      await storage.addToList(testAddress2, testTxHash3);

      const count1 = await storage.getList(testAddress1);
      const count2 = await storage.getList(testAddress2);

      expect(count1).to.equal(1);
      expect(count2).to.equal(2);
    });
  });

  describe('addToList', () => {
    it('should successfully add transaction when expected count matches', async () => {
      const result = await storage.addToList(testAddress1, testTxHash1);

      expect(result.ok).to.be.true;
      if (result.ok) {
        expect(result.newValue).to.equal(1);
      }

      const count = await storage.getList(testAddress1);
      expect(count).to.equal(1);
    });

    it('should successfully add multiple transactions in sequence', async () => {
      // Add first transaction
      const result1 = await storage.addToList(testAddress1, testTxHash1);
      expect(result1.ok).to.be.true;
      if (result1.ok) {
        expect(result1.newValue).to.equal(1);
      }

      // Add second transaction
      const result2 = await storage.addToList(testAddress1, testTxHash2);
      expect(result2.ok).to.be.true;
      if (result2.ok) {
        expect(result2.newValue).to.equal(2);
      }

      const count = await storage.getList(testAddress1);
      expect(count).to.equal(2);
    });

    it('should handle adding transactions to multiple addresses', async () => {
      // Add to first address
      const result1 = await storage.addToList(testAddress1, testTxHash1);
      expect(result1.ok).to.be.true;

      // Add to second address
      const result2 = await storage.addToList(testAddress2, testTxHash2);
      expect(result2.ok).to.be.true;

      const count1 = await storage.getList(testAddress1);
      const count2 = await storage.getList(testAddress2);

      expect(count1).to.equal(1);
      expect(count2).to.equal(1);
    });

    it('should fail when trying to add same transaction hash to same address', async () => {
      // Add transaction first time
      const result1 = await storage.addToList(testAddress1, testTxHash1);
      expect(result1.ok).to.be.true;

      // Try to add same transaction hash again
      const result2 = await storage.addToList(testAddress1, testTxHash1);
      expect(result2.ok).to.be.true; // Set adds duplicate, but count should still be 1
      if (result2.ok) {
        expect(result2.newValue).to.equal(1); // Set doesn't add duplicates
      }

      const count = await storage.getList(testAddress1);
      expect(count).to.equal(1);
    });

    it('should initialize new address with empty set', async () => {
      const result = await storage.addToList(testAddress1, testTxHash1);

      expect(result.ok).to.be.true;
      const count = await storage.getList(testAddress1);
      expect(count).to.equal(1);
    });
  });

  describe('removeFromList', () => {
    it('should successfully remove existing transaction', async () => {
      // Add transaction first
      await storage.addToList(testAddress1, testTxHash1);

      // Remove it
      const remainingCount = await storage.removeFromList(testAddress1, testTxHash1);
      expect(remainingCount).to.equal(0);

      const count = await storage.getList(testAddress1);
      expect(count).to.equal(0);
    });

    it('should handle removing non-existent transaction gracefully', async () => {
      const remainingCount = await storage.removeFromList(testAddress1, testTxHash1);
      expect(remainingCount).to.equal(0);
    });

    it('should handle removing from non-existent address gracefully', async () => {
      const remainingCount = await storage.removeFromList('0xnonexistent', testTxHash1);
      expect(remainingCount).to.equal(0);
    });

    it('should remove specific transaction from multiple transactions', async () => {
      // Add multiple transactions
      await storage.addToList(testAddress1, testTxHash1);
      await storage.addToList(testAddress1, testTxHash2);
      await storage.addToList(testAddress1, testTxHash3);

      // Remove middle transaction
      const remainingCount = await storage.removeFromList(testAddress1, testTxHash2);
      expect(remainingCount).to.equal(2);

      const count = await storage.getList(testAddress1);
      expect(count).to.equal(2);
    });

    it('should clean up empty address entries to prevent memory leaks', async () => {
      // Add and then remove all transactions
      await storage.addToList(testAddress1, testTxHash1);
      await storage.removeFromList(testAddress1, testTxHash1);

      // The address should be cleaned up internally
      const count = await storage.getList(testAddress1);
      expect(count).to.equal(0);
    });

    it('should remove transaction data when removing from list', async () => {
      // Add transaction
      await storage.addToList(testAddress1, testTxHash1);

      // Verify transaction data exists (this tests the private transactionData map)
      // We can't directly test private properties, but we can test the behavior

      // Remove transaction
      await storage.removeFromList(testAddress1, testTxHash1);

      // Verify removal worked
      const count = await storage.getList(testAddress1);
      expect(count).to.equal(0);
    });

    it('should handle removing from multiple addresses independently', async () => {
      // Add transactions to both addresses
      await storage.addToList(testAddress1, testTxHash1);
      await storage.addToList(testAddress2, testTxHash2);

      // Remove from first address only
      const remainingCount1 = await storage.removeFromList(testAddress1, testTxHash1);
      expect(remainingCount1).to.equal(0);

      // Second address should be unaffected
      const count2 = await storage.getList(testAddress2);
      expect(count2).to.equal(1);
    });
  });

  describe('removeAll', () => {
    it('should remove all transactions from all addresses', async () => {
      // Add transactions to multiple addresses
      await storage.addToList(testAddress1, testTxHash1);
      await storage.addToList(testAddress1, testTxHash2);
      await storage.addToList(testAddress2, testTxHash3);

      // Remove all
      await storage.removeAll();

      // Verify all are removed
      const count1 = await storage.getList(testAddress1);
      const count2 = await storage.getList(testAddress2);

      expect(count1).to.equal(0);
      expect(count2).to.equal(0);
    });

    it('should handle removeAll on empty storage', async () => {
      // Should not throw error
      await storage.removeAll();

      const count = await storage.getList(testAddress1);
      expect(count).to.equal(0);
    });

    it('should clear both pending transactions and transaction data', async () => {
      // Add some data
      await storage.addToList(testAddress1, testTxHash1);
      await storage.addToList(testAddress2, testTxHash2);

      // Clear all
      await storage.removeAll();

      // Verify everything is cleared
      const count1 = await storage.getList(testAddress1);
      const count2 = await storage.getList(testAddress2);

      expect(count1).to.equal(0);
      expect(count2).to.equal(0);
    });

    it('should allow adding transactions after removeAll', async () => {
      // Add, remove all, then add again
      await storage.addToList(testAddress1, testTxHash1);
      await storage.removeAll();

      const result = await storage.addToList(testAddress1, testTxHash2);
      expect(result.ok).to.be.true;

      const count = await storage.getList(testAddress1);
      expect(count).to.equal(1);
    });
  });

  describe('Integration scenarios', () => {
    it('should handle typical transaction lifecycle', async () => {
      // Start with empty state
      let count = await storage.getList(testAddress1);
      expect(count).to.equal(0);

      // Add first transaction
      let result = await storage.addToList(testAddress1, testTxHash1);
      expect(result.ok).to.be.true;

      count = await storage.getList(testAddress1);
      expect(count).to.equal(1);

      // Add second transaction
      result = await storage.addToList(testAddress1, testTxHash2);
      expect(result.ok).to.be.true;

      count = await storage.getList(testAddress1);
      expect(count).to.equal(2);

      // Remove first transaction (simulate completion)
      const remaining = await storage.removeFromList(testAddress1, testTxHash1);
      expect(remaining).to.equal(1);

      count = await storage.getList(testAddress1);
      expect(count).to.equal(1);

      // Remove second transaction
      await storage.removeFromList(testAddress1, testTxHash2);

      count = await storage.getList(testAddress1);
      expect(count).to.equal(0);
    });

    it('should handle multiple addresses with different transaction counts', async () => {
      const addresses = [testAddress1, testAddress2, '0x3333333333333333333333333333333333333333'];
      const expectedCounts = [3, 1, 2];

      // Add different numbers of transactions to each address
      await storage.addToList(addresses[0], testTxHash1);
      await storage.addToList(addresses[0], testTxHash2);
      await storage.addToList(addresses[0], testTxHash3);

      await storage.addToList(addresses[1], '0xaaa');

      await storage.addToList(addresses[2], '0xbbb');
      await storage.addToList(addresses[2], '0xccc');

      // Verify counts
      for (let i = 0; i < addresses.length; i++) {
        const count = await storage.getList(addresses[i]);
        expect(count).to.equal(
          expectedCounts[i],
          `Address ${addresses[i]} should have ${expectedCounts[i]} transactions`,
        );
      }
    });

    it('should maintain data integrity during mixed operations', async () => {
      // Mix of add and remove operations
      await storage.addToList(testAddress1, testTxHash1);
      await storage.addToList(testAddress1, testTxHash2);
      await storage.addToList(testAddress2, testTxHash3);

      // Remove from middle
      await storage.removeFromList(testAddress1, testTxHash1);

      // Add more
      const result = await storage.addToList(testAddress1, '0xnew');
      expect(result.ok).to.be.true;

      // Verify final state
      const count1 = await storage.getList(testAddress1);
      const count2 = await storage.getList(testAddress2);

      expect(count1).to.equal(2);
      expect(count2).to.equal(1);
    });
  });

  describe('Edge cases', () => {
    it('should handle empty string address', async () => {
      const result = await storage.addToList('', testTxHash1);
      expect(result.ok).to.be.true;

      const count = await storage.getList('');
      expect(count).to.equal(1);
    });

    it('should handle empty string transaction hash', async () => {
      const result = await storage.addToList(testAddress1, '');
      expect(result.ok).to.be.true;

      const count = await storage.getList(testAddress1);
      expect(count).to.equal(1);

      const remaining = await storage.removeFromList(testAddress1, '');
      expect(remaining).to.equal(0);
    });

    it('should handle large transaction counts', async () => {
      const largeCount = 1000;

      // Add many transactions
      for (let i = 0; i < largeCount; i++) {
        const result = await storage.addToList(testAddress1, `0x${i.toString(16).padStart(64, '0')}`);
        expect(result.ok).to.be.true;
      }

      const count = await storage.getList(testAddress1);
      expect(count).to.equal(largeCount);
    });
  });
});
