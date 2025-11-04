// SPDX-License-Identifier: Apache-2.0

import chai, { expect } from 'chai';
import chaiAsPromised from 'chai-as-promised';

import { LocalPendingTransactionStorage } from '../../../../src/lib/services/transactionPoolService/LocalPendingTransactionStorage';
import { PendingTransactionStorageFactory } from '../../../../src/lib/services/transactionPoolService/PendingTransactionStorageFactory';
import { RedisPendingTransactionStorage } from '../../../../src/lib/services/transactionPoolService/RedisPendingTransactionStorage';

chai.use(chaiAsPromised);

describe('PendingTransactionStorageFactory', () => {
  describe('create', () => {
    it('should return LocalPendingTransactionStorage when redisClient is not provided', () => {
      const storage = PendingTransactionStorageFactory.create();

      expect(storage).to.be.instanceOf(LocalPendingTransactionStorage);
    });

    it('should return LocalPendingTransactionStorage when redisClient is undefined', () => {
      const storage = PendingTransactionStorageFactory.create(undefined);

      expect(storage).to.be.instanceOf(LocalPendingTransactionStorage);
    });

    it('should return RedisPendingTransactionStorage when redisClient is provided', () => {
      // Mock Redis client - just needs to be a truthy object for the factory logic
      const mockRedisClient = {} as any;

      const storage = PendingTransactionStorageFactory.create(mockRedisClient);

      expect(storage).to.be.instanceOf(RedisPendingTransactionStorage);
    });

    it('should create different storage instances on multiple calls', () => {
      const storage1 = PendingTransactionStorageFactory.create();
      const storage2 = PendingTransactionStorageFactory.create();

      expect(storage1).to.not.equal(storage2);
      expect(storage1).to.be.instanceOf(LocalPendingTransactionStorage);
      expect(storage2).to.be.instanceOf(LocalPendingTransactionStorage);
    });
  });
});
