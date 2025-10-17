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

  let redisClientManager: RedisClientManager;

  // Use a dedicated port to avoid conflicts with other suites
  useInMemoryRedisServer(logger, 6380);

  this.beforeAll(async () => {
    redisClientManager = new RedisClientManager(logger, 'redis://127.0.0.1:6380', 1000);
    await redisClientManager.connect();
  });

  //   this.beforeEach(async () => {
  //     if (!(await redisClientManager.isConnected())) {
  //       await redisClientManager.connect();
  //     }
  //   });

  this.afterAll(async () => {
    if (await redisClientManager.isConnected()) {
      await redisClientManager.disconnect();
    }
  });

  describe('Connect Test Suite', () => {
    it('should connect to the Redis server', async () => {
      await expect(redisClientManager.isConnected()).to.be.true;
    });

    it('should throw an error when the client is already connected', async () => {
      await expect(redisClientManager.connect()).to.eventually.be.rejectedWith('Socket already opened');
      await expect(redisClientManager.isConnected()).to.be.true;
    });
  });

  describe('Is Connected Test Suite', () => {
    it('should return true when connected', async () => {
      await expect(redisClientManager.isConnected()).to.be.true;
    });

    it('should return false when disconnected', async () => {
      await redisClientManager.disconnect();
      await expect(redisClientManager.isConnected()).to.be.false;
    });
  });

  describe('Number of Connections Test Suite', () => {
    it('should return 1 when connected', async () => {
      if (!(await redisClientManager.isConnected())) {
        await redisClientManager.connect();
      }
      await expect(redisClientManager.getNumberOfConnections()).to.eventually.equal(1);
    });

    it('should throw an error when the client is closed', async () => {
      await redisClientManager.disconnect();
      await expect(redisClientManager.getNumberOfConnections()).to.eventually.be.rejectedWith('The client is closed');
    });
  });

  describe('Disconnect Test Suite', () => {
    it('should disconnect from Redis', async () => {
      await redisClientManager.connect();
      await redisClientManager.disconnect();
      await expect(redisClientManager.isConnected()).to.be.false;
    });

    it('should throw when disconnecting an already disconnected client', async () => {
      await expect(redisClientManager.disconnect()).to.eventually.be.rejectedWith('The client is closed');
      await expect(redisClientManager.isConnected()).to.be.false;
    });
  });
});
