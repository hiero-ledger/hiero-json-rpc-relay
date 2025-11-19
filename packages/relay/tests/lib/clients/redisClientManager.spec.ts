// SPDX-License-Identifier: Apache-2.0

import chai, { expect } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { pino } from 'pino';

import { RedisClientManager } from '../../../src/lib/clients/redisClientManager';
import { useInMemoryRedisServer } from '../../helpers';

chai.use(chaiAsPromised);

describe('RedisClientManager Test Suite', async function () {
  this.timeout(10000);

  const logger = pino({ level: 'silent' });

  // Use a dedicated port to avoid conflicts with other suites
  useInMemoryRedisServer(logger, 6380);

  this.beforeAll(async () => {
    await RedisClientManager.getClient(logger);
  });

  this.afterAll(async () => {
    if (await RedisClientManager.isConnected()) {
      await RedisClientManager.disconnect();
    }
  });

  describe('Connect Test Suite', () => {
    it('should connect to the Redis server', async () => {
      await expect(RedisClientManager.isConnected()).to.be.true;
    });

    it('should throw an error when the client is already connected', async () => {
      await expect(RedisClientManager.connect()).to.eventually.be.rejectedWith('Socket already opened');
      await expect(RedisClientManager.isConnected()).to.be.true;
    });
  });

  describe('Is Connected Test Suite', () => {
    it('should return true when connected', async () => {
      await expect(RedisClientManager.isConnected()).to.be.true;
    });

    it('should return false when disconnected', async () => {
      await RedisClientManager.disconnect();
      await expect(RedisClientManager.isConnected()).to.be.false;
    });
  });

  describe('Number of Connections Test Suite', () => {
    it('should return 1 when connected', async () => {
      if (!(await RedisClientManager.isConnected())) {
        await RedisClientManager.connect();
      }
      await expect(RedisClientManager.getNumberOfConnections()).to.eventually.equal(1);
    });

    it('should throw an error when the client is closed', async () => {
      await RedisClientManager.disconnect();
      await expect(RedisClientManager.getNumberOfConnections()).to.eventually.be.rejectedWith('The client is closed');
    });
  });

  describe('Disconnect Test Suite', () => {
    it('should disconnect from Redis', async () => {
      await RedisClientManager.connect();
      await RedisClientManager.disconnect();
      await expect(RedisClientManager.isConnected()).to.be.false;
    });

    it('should throw when disconnecting an already disconnected client', async () => {
      await expect(RedisClientManager.disconnect()).to.eventually.be.rejectedWith('The client is closed');
      await expect(RedisClientManager.isConnected()).to.be.false;
    });
  });
});
