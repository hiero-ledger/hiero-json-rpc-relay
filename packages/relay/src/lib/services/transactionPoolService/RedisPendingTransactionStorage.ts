// SPDX-License-Identifier: Apache-2.0
import { RedisClientType } from 'redis';

import { AddToListResult, PendingTransactionStorage } from '../../types/transactionPool';

export class RedisPendingTransactionStorage implements PendingTransactionStorage {
  private readonly keyPrefix = 'pending:';
  constructor(private readonly redisClient: RedisClientType) {}
  private keyFor(addr: string): string {
    return `${this.keyPrefix}${addr}`;
  }
  async addToList(addr: string, txHash: string): Promise<AddToListResult> {
    const key = this.keyFor(addr);
    const newLen = await this.redisClient.rPush(key, txHash);
    return { ok: true, newValue: newLen };
  }
  async removeFromList(address: string, txHash: string): Promise<number> {
    const key = this.keyFor(address);
    await this.redisClient.lRem(key, 0, txHash);
    const newLen = await this.redisClient.lLen(key);
    return newLen;
  }
  async removeAll(): Promise<void> {
    let pipeline = this.redisClient.multi();
    let batched = 0;
    for await (const key of this.redisClient.scanIterator({ MATCH: `${this.keyPrefix}*`, COUNT: 500 })) {
      pipeline.del(key);
      batched++;
      if (batched % 100 === 0) {
        await pipeline.execAsPipeline();
        pipeline = this.redisClient.multi();
      }
    }
    await pipeline.execAsPipeline();
  }

  async getList(addr: string): Promise<number> {
    const key = this.keyFor(addr);
    const len = await this.redisClient.lLen(key);
    return len;
  }
}
