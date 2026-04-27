// SPDX-License-Identifier: Apache-2.0
import { keccak256 } from 'ethers/crypto';

import { prepend0x, strip0x } from './formatters';
import constants from './lib/constants';
import { Log } from './lib/model';

export class LogsBloomUtils {
  public static readonly BYTE_SIZE = 256;
  public static readonly MASK = 0x7ff;

  /**
   * Adds bloom filter bits for a log's address and topics.
   *
   * @param bitvector - 256-byte bloom filter buffer that is updated in-place
   * @param address
   * @param topics
   */
  private static addLogItems(bitvector: Uint8Array, address: string, topics: string[]) {
    const items = [address, ...topics];
    for (let k = 0; k < items.length; k++) {
      const item = Buffer.alloc(32, strip0x(keccak256(items[k])), 'hex');
      for (let i = 0; i < 3; i++) {
        const first2bytes = new DataView(item.buffer).getUint16(i * 2);
        const loc = this.MASK & first2bytes;
        const byteLoc = loc >> 3;
        const bitLoc = 1 << (loc % 8);
        bitvector[this.BYTE_SIZE - byteLoc - 1] |= bitLoc;
      }
    }
  }

  /**
   * Builds the logs bloom for a transaction receipt.
   *
   * Logs without an address are ignored.
   *
   * Before using this function, make sure that logs without topics do not need
   * to be preserved in your case.
   *
   * @param logs - Array of logs emitted by the transaction
   * @returns Hex-encoded 2048-bit (256 hex) bloom filter (0x-prefixed)
   */
  public static buildLogsBloom(logs: Log[]): string {
    logs = logs.filter((log) => log.address?.length);
    if (!logs.length) return constants.EMPTY_BLOOM;

    const bitvector = new Uint8Array(this.BYTE_SIZE);
    for (const log of logs) {
      LogsBloomUtils.addLogItems(bitvector, log.address!, log.topics ?? []);
    }

    return prepend0x(Buffer.from(bitvector).toString('hex'));
  }
}
