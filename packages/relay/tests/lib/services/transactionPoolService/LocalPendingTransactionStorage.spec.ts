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
    it('should successfully add transaction and return new count', async () => {
      await storage.addToList(testAddress1, testTxHash1);
      const count = await storage.getList(testAddress1);

      expect(count).to.equal(1);
    });

    it('should successfully add multiple transactions in sequence', async () => {
      // Add first transaction
      await storage.addToList(testAddress1, testTxHash1);
      const count1 = await storage.getList(testAddress1);
      expect(count1).to.equal(1);

      // Add second transaction
      await storage.addToList(testAddress1, testTxHash2);

      const count = await storage.getList(testAddress1);
      expect(count).to.equal(2);
    });

    it('should handle adding transactions to multiple addresses', async () => {
      // Add to first address
      await storage.addToList(testAddress1, testTxHash1);
      await storage.addToList(testAddress2, testTxHash2);

      const count1 = await storage.getList(testAddress1);
      const count2 = await storage.getList(testAddress2);

      expect(count1).to.equal(1);
      expect(count2).to.equal(1);
    });

    it('should handle adding same transaction hash to same address idempotently', async () => {
      // Add transaction first time
      await storage.addToList(testAddress1, testTxHash1);

      // Try to add same transaction hash again
      await storage.addToList(testAddress1, testTxHash1);

      const count = await storage.getList(testAddress1);
      expect(count).to.equal(1);
    });

    it('should initialize new address with empty set', async () => {
      await storage.addToList(testAddress1, testTxHash1);
      const count = await storage.getList(testAddress1);

      expect(count).to.equal(1);
    });
  });

  describe('removeFromList', () => {
    it('should successfully remove existing transaction', async () => {
      // Add transaction first
      await storage.addToList(testAddress1, testTxHash1);
      // Remove it
      await storage.removeFromList(testAddress1, testTxHash1);

      const count = await storage.getList(testAddress1);
      expect(count).to.equal(0);
    });

    it('should handle removing non-existent transaction gracefully', async () => {
      await storage.removeFromList(testAddress1, testTxHash1);
      const count = await storage.getList(testAddress1);
      expect(count).to.equal(0);
    });

    it('should handle removing from non-existent address gracefully', async () => {
      await storage.removeFromList('0xnonexistent', testTxHash1);
      const count = await storage.getList('0xnonexistent');
      expect(count).to.equal(0);
    });

    it('should remove specific transaction from multiple transactions', async () => {
      // Add multiple transactions
      await storage.addToList(testAddress1, testTxHash1);
      await storage.addToList(testAddress1, testTxHash2);
      await storage.addToList(testAddress1, testTxHash3);

      // Remove middle transaction
      await storage.removeFromList(testAddress1, testTxHash2);

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
      await storage.removeFromList(testAddress1, testTxHash1);

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

      await storage.addToList(testAddress1, testTxHash2);

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
      await storage.addToList(testAddress1, testTxHash1);

      count = await storage.getList(testAddress1);
      expect(count).to.equal(1);

      // Add second transaction
      await storage.addToList(testAddress1, testTxHash2);

      count = await storage.getList(testAddress1);
      expect(count).to.equal(2);

      // Remove first transaction (simulate completion)
      await storage.removeFromList(testAddress1, testTxHash1);

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
      await storage.addToList(testAddress1, '0xnew');

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

      // Add many transactions
      for (let i = 0; i < largeCount; i++) {
        await storage.addToList(testAddress1, `0x${i.toString(16).padStart(64, '0')}`);
      }

      const count = await storage.getList(testAddress1);
      expect(count).to.equal(largeCount);
    });
  });

  describe('Payload handling (new functionality)', () => {
    it('should save payload and index when RLP provided', async () => {
      await storage.addToList(testAddress1, testTxHash1, testRlp1);

      const count = await storage.getList(testAddress1);
      expect(count).to.equal(1);

      const payload = await storage.getTransactionPayload(testTxHash1);
      expect(payload).to.equal(testRlp1);

      const allHashes = await storage.getAllTransactionHashes();
      expect(allHashes).to.include(testTxHash1);
    });

    it('should save address index without payload when RLP not provided', async () => {
      await storage.addToList(testAddress1, testTxHash1);

      const count = await storage.getList(testAddress1);
      expect(count).to.equal(1);

      const payload = await storage.getTransactionPayload(testTxHash1);
      expect(payload).to.be.null;
    });

    it('should remove payload and indexes together', async () => {
      await storage.addToList(testAddress1, testTxHash1, testRlp1);

      await storage.removeFromList(testAddress1, testTxHash1);

      const count = await storage.getList(testAddress1);
      expect(count).to.equal(0);

      const payload = await storage.getTransactionPayload(testTxHash1);
      expect(payload).to.be.null;

      const allHashes = await storage.getAllTransactionHashes();
      expect(allHashes).to.not.include(testTxHash1);
    });

    it('should handle multiple transactions with payloads', async () => {
      await storage.addToList(testAddress1, testTxHash1, testRlp1);
      await storage.addToList(testAddress1, testTxHash2, testRlp2);
      await storage.addToList(testAddress2, testTxHash3, testRlp3);

      const count1 = await storage.getList(testAddress1);
      const count2 = await storage.getList(testAddress2);
      expect(count1).to.equal(2);
      expect(count2).to.equal(1);

      const payload1 = await storage.getTransactionPayload(testTxHash1);
      const payload2 = await storage.getTransactionPayload(testTxHash2);
      const payload3 = await storage.getTransactionPayload(testTxHash3);
      expect(payload1).to.equal(testRlp1);
      expect(payload2).to.equal(testRlp2);
      expect(payload3).to.equal(testRlp3);
    });

    it('should handle batch payload retrieval', async () => {
      await storage.addToList(testAddress1, testTxHash1, testRlp1);
      await storage.addToList(testAddress1, testTxHash2, testRlp2);
      await storage.addToList(testAddress2, testTxHash3, testRlp3);

      const payloads = await storage.getTransactionPayloads([testTxHash1, testTxHash2, testTxHash3]);
      expect(payloads).to.deep.equal([testRlp1, testRlp2, testRlp3]);
    });

    it('should handle batch retrieval with missing payloads', async () => {
      await storage.addToList(testAddress1, testTxHash1, testRlp1);
      await storage.addToList(testAddress1, testTxHash3, testRlp3);

      const payloads = await storage.getTransactionPayloads([testTxHash1, testTxHash2, testTxHash3]);
      expect(payloads[0]).to.equal(testRlp1);
      expect(payloads[1]).to.be.null;
      expect(payloads[2]).to.equal(testRlp3);
    });

    it('should get transaction hashes for address', async () => {
      await storage.addToList(testAddress1, testTxHash1, testRlp1);
      await storage.addToList(testAddress1, testTxHash2, testRlp2);

      const hashes = await storage.getTransactionHashes(testAddress1);
      expect(hashes).to.have.lengthOf(2);
      expect(hashes).to.include.members([testTxHash1, testTxHash2]);
    });

    it('should get all transaction hashes across addresses', async () => {
      await storage.addToList(testAddress1, testTxHash1, testRlp1);
      await storage.addToList(testAddress2, testTxHash2, testRlp2);

      const allHashes = await storage.getAllTransactionHashes();
      expect(allHashes).to.have.lengthOf(2);
      expect(allHashes).to.include.members([testTxHash1, testTxHash2]);
    });

    it('should clear payloads when removeAll is called', async () => {
      await storage.addToList(testAddress1, testTxHash1, testRlp1);
      await storage.addToList(testAddress2, testTxHash2, testRlp2);

      await storage.removeAll();

      const payload1 = await storage.getTransactionPayload(testTxHash1);
      const payload2 = await storage.getTransactionPayload(testTxHash2);
      expect(payload1).to.be.null;
      expect(payload2).to.be.null;

      const allHashes = await storage.getAllTransactionHashes();
      expect(allHashes).to.be.empty;
    });
  });
});
