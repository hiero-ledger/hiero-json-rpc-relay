// SPDX-License-Identifier: Apache-2.0
import { keccak_256 } from '@noble/hashes/sha3';

import { prepend0x, strip0x } from './formatters';
import constants from './lib/constants';
export class LogsBloomUtils {
  public static readonly BYTE_SIZE = 256;
  public static readonly MASK = 0x7ff;

  /**
   * Generate logs bloom for synthetic transaction
   * @param address - The contract address
   * @param topics - The log topics
   * @returns The 256-byte bloom filter as a hex string
   */
  public static buildLogsBloom(address: string, topics: string[]): string {
    if (!address?.length) {
      return constants.EMPTY_BLOOM;
    }
    if (!topics?.length) {
      return constants.EMPTY_BLOOM;
    }

    const items = [address, ...topics];
    const bitvector = new Uint8Array(this.BYTE_SIZE);
    for (let k = 0; k < items.length; k++) {
      const hash = keccak_256(Buffer.from(strip0x(items[k]), 'hex'));
      const item = Buffer.from(hash);
      for (let i = 0; i < 3; i++) {
        const first2bytes = new DataView(item.buffer, item.byteOffset, item.byteLength).getUint16(i * 2);
        const loc = this.MASK & first2bytes;
        const byteLoc = loc >> 3;
        const bitLoc = 1 << loc % 8;
        bitvector[this.BYTE_SIZE - byteLoc - 1] |= bitLoc;
      }
    }

    return prepend0x(Buffer.from(bitvector).toString('hex'));
  }
}
