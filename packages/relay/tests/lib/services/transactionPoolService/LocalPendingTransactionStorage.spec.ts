// SPDX-License-Identifier: Apache-2.0

import { expect } from 'chai';
import * as sinon from 'sinon';

import { LocalPendingTransactionStorage } from '../../../../src/lib/services/transactionPoolService/LocalPendingTransactionStorage';

describe('LocalPendingTransactionStorage Test Suite', function () {
  let storage: LocalPendingTransactionStorage;

  const testAddress1 = '0x742d35cc6db9027d0e0ba7d3c9e5a96f';
  const testAddress2 = '0x742d35cc6db9027d0e0ba7d3c9e5a96e';
  const testTxHash1 = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
  const testTxHash2 = '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890';
  const testTxHash3 = '0x9999999999999999999999999999999999999999999999999999999999999999';
  const testRlp1 = '0xf86c018502540be400825208947742d35cc6629c0532c262d2d73f4c8e1a1b7b7b780801ca0';
  const testRlp2 = '0xf86c028502540be400825208947742d35cc6629c0532c262d2d73f4c8e1a1b7b7b780801ca0';
  const testRlp3 = '0xf86c038502540be400825208947742d35cc6629c0532c262d2d73f4c8e1a1b7b7b780801ca0';

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
      await storage.addToList(testAddress1, testRlp1);

      const count = await storage.getList(testAddress1);
      expect(count).to.equal(1);
    });

    it('should return correct count after multiple transactions added', async () => {
      // Add multiple transactions
      await storage.addToList(testAddress1, testRlp1);
      await storage.addToList(testAddress1, testRlp2);

      const count = await storage.getList(testAddress1);
      expect(count).to.equal(2);
    });

    it('should return different counts for different addresses', async () => {
      // Add transactions to different addresses
      await storage.addToList(testAddress1, testRlp1);
      await storage.addToList(testAddress2, testRlp2);
      await storage.addToList(testAddress2, testRlp3);

      const count1 = await storage.getList(testAddress1);
      const count2 = await storage.getList(testAddress2);

      expect(count1).to.equal(1);
      expect(count2).to.equal(2);
    });
  });

  describe('addToList', () => {
    it('should successfully add transaction and return new count', async () => {
      await storage.addToList(testAddress1, testRlp1);
      const count = await storage.getList(testAddress1);

      expect(count).to.equal(1);
    });

    it('should successfully add multiple transactions in sequence', async () => {
      // Add first transaction
      await storage.addToList(testAddress1, testRlp1);
      const count1 = await storage.getList(testAddress1);
      expect(count1).to.equal(1);

      // Add second transaction
      await storage.addToList(testAddress1, testRlp2);

      const count = await storage.getList(testAddress1);
      expect(count).to.equal(2);
    });

    it('should handle adding transactions to multiple addresses', async () => {
      // Add to first address
      await storage.addToList(testAddress1, testRlp1);
      await storage.addToList(testAddress2, testRlp2);

      const count1 = await storage.getList(testAddress1);
      const count2 = await storage.getList(testAddress2);

      expect(count1).to.equal(1);
      expect(count2).to.equal(1);
    });

    it('should handle adding same transaction to same address idempotently', async () => {
      // Add transaction first time
      await storage.addToList(testAddress1, testRlp1);

      // Try to add same transaction again
      await storage.addToList(testAddress1, testRlp1);

      const count = await storage.getList(testAddress1);
      expect(count).to.equal(1);
    });

    it('should initialize new address with empty set', async () => {
      await storage.addToList(testAddress1, testRlp1);
      const count = await storage.getList(testAddress1);

      expect(count).to.equal(1);
    });
  });

  describe('removeFromList', () => {
    it('should successfully remove existing transaction', async () => {
      // Add transaction first
      await storage.addToList(testAddress1, testRlp1);
      // Remove it
      await storage.removeFromList(testAddress1, testRlp1);

      const count = await storage.getList(testAddress1);
      expect(count).to.equal(0);
    });

    it('should handle removing non-existent transaction gracefully', async () => {
      await storage.removeFromList(testAddress1, testRlp1);
      const count = await storage.getList(testAddress1);
      expect(count).to.equal(0);
    });

    it('should handle removing from non-existent address gracefully', async () => {
      await storage.removeFromList('0xnonexistent', testRlp1);
      const count = await storage.getList('0xnonexistent');
      expect(count).to.equal(0);
    });

    it('should remove specific transaction from multiple transactions', async () => {
      // Add multiple transactions
      await storage.addToList(testAddress1, testRlp1);
      await storage.addToList(testAddress1, testRlp2);
      await storage.addToList(testAddress1, testRlp3);

      // Remove middle transaction
      await storage.removeFromList(testAddress1, testRlp2);

      const count = await storage.getList(testAddress1);
      expect(count).to.equal(2);
    });

    it('should clean up empty address entries to prevent memory leaks', async () => {
      // Add and then remove all transactions
      await storage.addToList(testAddress1, testRlp1);
      await storage.removeFromList(testAddress1, testRlp1);

      // The address should be cleaned up internally
      const count = await storage.getList(testAddress1);
      expect(count).to.equal(0);
    });

    it('should remove transaction data when removing from list', async () => {
      // Add transaction
      await storage.addToList(testAddress1, testRlp1);

      // Verify transaction data exists
      // We can't directly test private properties, but we can test the behavior

      // Remove transaction
      await storage.removeFromList(testAddress1, testRlp1);

      // Verify removal worked
      const count = await storage.getList(testAddress1);
      expect(count).to.equal(0);
    });

    it('should handle removing from multiple addresses independently', async () => {
      // Add transactions to both addresses
      await storage.addToList(testAddress1, testRlp1);
      await storage.addToList(testAddress2, testRlp2);

      // Remove from first address only
      await storage.removeFromList(testAddress1, testRlp1);

      // Second address should be unaffected
      const count2 = await storage.getList(testAddress2);
      expect(count2).to.equal(1);
    });
  });

  describe('removeAll', () => {
    it('should remove all transactions from all addresses', async () => {
      // Add transactions to multiple addresses
      await storage.addToList(testAddress1, testRlp1);
      await storage.addToList(testAddress1, testRlp2);
      await storage.addToList(testAddress2, testRlp3);

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
      await storage.addToList(testAddress1, testRlp1);
      await storage.addToList(testAddress2, testRlp2);

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
      await storage.addToList(testAddress1, testRlp1);
      await storage.removeAll();

      await storage.addToList(testAddress1, testRlp2);

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
      await storage.addToList(testAddress1, testRlp1);

      count = await storage.getList(testAddress1);
      expect(count).to.equal(1);

      // Add second transaction
      await storage.addToList(testAddress1, testRlp2);

      count = await storage.getList(testAddress1);
      expect(count).to.equal(2);

      // Remove first transaction (simulate completion)
      await storage.removeFromList(testAddress1, testRlp1);

      count = await storage.getList(testAddress1);
      expect(count).to.equal(1);

      // Remove second transaction
      await storage.removeFromList(testAddress1, testRlp2);

      count = await storage.getList(testAddress1);
      expect(count).to.equal(0);
    });

    it('should handle multiple addresses with different transaction counts', async () => {
      const addresses = [testAddress1, testAddress2, '0x3333333333333333333333333333333333333333'];
      const expectedCounts = [3, 1, 2];

      // Add different numbers of transactions to each address
      await storage.addToList(addresses[0], testRlp1);
      await storage.addToList(addresses[0], testRlp2);
      await storage.addToList(addresses[0], testRlp3);

      await storage.addToList(addresses[1], testRlp1);

      await storage.addToList(addresses[2], testRlp1);
      await storage.addToList(addresses[2], testRlp2);

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
      await storage.addToList(testAddress1, testRlp1);
      await storage.addToList(testAddress1, testRlp2);
      await storage.addToList(testAddress2, testRlp3);

      // Remove from middle
      await storage.removeFromList(testAddress1, testRlp1);

      // Add more
      await storage.addToList(testAddress1, testRlp1);

      // Verify final state
      const count1 = await storage.getList(testAddress1);
      const count2 = await storage.getList(testAddress2);

      expect(count1).to.equal(2);
      expect(count2).to.equal(1);
    });
  });

  describe('Edge cases', () => {
    it('should handle large transaction counts', async () => {
      const largeCount = 1000;

      // Add many transactions (using different RLP values by modifying nonce)
      for (let i = 0; i < largeCount; i++) {
        const rlp = `0xf86c${i.toString(16).padStart(2, '0')}8502540be400825208947742d35cc6629c0532c262d2d73f4c8e1a1b7b7b780801ca0`;
        await storage.addToList(testAddress1, rlp);
      }

      const count = await storage.getList(testAddress1);
      expect(count).to.equal(largeCount);
    });
  });

  describe('Payload retrieval', () => {
    it('should save and retrieve payload atomically', async () => {
      await storage.addToList(testAddress1, testRlp1);

      const count = await storage.getList(testAddress1);
      expect(count).to.equal(1);

      const payloads = await storage.getTransactionPayloads(testAddress1);
      expect(payloads).to.have.lengthOf(1);
      expect(payloads).to.include(testRlp1);

      const allPayloads = await storage.getAllTransactionPayloads();
      expect(allPayloads).to.include(testRlp1);
    });

    it('should retrieve payloads for address', async () => {
      await storage.addToList(testAddress1, testRlp1);

      const count = await storage.getList(testAddress1);
      expect(count).to.equal(1);

      const payloads = await storage.getTransactionPayloads(testAddress1);
      expect(payloads).to.have.lengthOf(1);
      expect(payloads[0]).to.equal(testRlp1);
    });

    it('should remove payload when removed from list', async () => {
      await storage.addToList(testAddress1, testRlp1);

      await storage.removeFromList(testAddress1, testRlp1);

      const count = await storage.getList(testAddress1);
      expect(count).to.equal(0);

      const payloads = await storage.getTransactionPayloads(testAddress1);
      expect(payloads).to.be.empty;

      const allPayloads = await storage.getAllTransactionPayloads();
      expect(allPayloads).to.not.include(testRlp1);
    });

    it('should handle multiple transactions with payloads', async () => {
      await storage.addToList(testAddress1, testRlp1);
      await storage.addToList(testAddress1, testRlp2);
      await storage.addToList(testAddress2, testRlp3);

      const count1 = await storage.getList(testAddress1);
      const count2 = await storage.getList(testAddress2);
      expect(count1).to.equal(2);
      expect(count2).to.equal(1);

      const payloads1 = await storage.getTransactionPayloads(testAddress1);
      const payloads2 = await storage.getTransactionPayloads(testAddress2);
      expect(payloads1).to.have.lengthOf(2);
      expect(payloads1).to.include.members([testRlp1, testRlp2]);
      expect(payloads2).to.have.lengthOf(1);
      expect(payloads2[0]).to.equal(testRlp3);
    });

    it('should retrieve payloads for specific address only', async () => {
      await storage.addToList(testAddress1, testRlp1);
      await storage.addToList(testAddress1, testRlp2);
      await storage.addToList(testAddress2, testRlp3);

      const payloads = await storage.getTransactionPayloads(testAddress1);
      expect(payloads).to.have.lengthOf(2);
      expect(payloads).to.include.members([testRlp1, testRlp2]);
      expect(payloads).to.not.include(testRlp3);
    });

    it('should return empty array for address with no transactions', async () => {
      const payloads = await storage.getTransactionPayloads(testAddress1);
      expect(payloads).to.be.an('array');
      expect(payloads).to.be.empty;
    });

    it('should get all transaction payloads across addresses', async () => {
      await storage.addToList(testAddress1, testRlp1);
      await storage.addToList(testAddress2, testRlp2);

      const allPayloads = await storage.getAllTransactionPayloads();
      expect(allPayloads).to.have.lengthOf(2);
      expect(allPayloads).to.include.members([testRlp1, testRlp2]);
    });

    it('should clear all payloads when removeAll is called', async () => {
      await storage.addToList(testAddress1, testRlp1);
      await storage.addToList(testAddress2, testRlp2);

      await storage.removeAll();

      const payloads1 = await storage.getTransactionPayloads(testAddress1);
      const payloads2 = await storage.getTransactionPayloads(testAddress2);
      expect(payloads1).to.be.empty;
      expect(payloads2).to.be.empty;

      const allPayloads = await storage.getAllTransactionPayloads();
      expect(allPayloads).to.be.empty;
    });
  });
});
