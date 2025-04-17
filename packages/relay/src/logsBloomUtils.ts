// SPDX-License-Identifier: Apache-2.0
import { keccak256 } from 'ethers';

import { prepend0x, strip0x } from './formatters';
import constants from './lib/constants';
export class LogsBloomUtils {
  public static readonly BYTE_SIZE = 256;
  public static readonly MASK = 0x7ff;

  /**
   * Generate logs bloom for synthetic transaction
   * @param address
   * @param topics
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
      const item = Buffer.alloc(32, strip0x(keccak256(items[k])), 'hex');
      for (let i = 0; i < 3; i++) {
        const first2bytes = new DataView(item.buffer).getUint16(i * 2);
        const loc = this.MASK & first2bytes;
        const byteLoc = loc >> 3;
        const bitLoc = 1 << loc % 8;
        bitvector[this.BYTE_SIZE - byteLoc - 1] |= bitLoc;
      }
    }

    return prepend0x(Buffer.from(bitvector).toString('hex'));
  }
}
