// SPDX-License-Identifier: Apache-2.0

import { expect } from 'chai';
import { keccak256, ZeroAddress } from 'ethers';

import { strip0x } from '../../src/formatters';
import constants from '../../src/lib/constants';
import { LogsBloomUtils } from '../../src/logsBloomUtils';

describe('LogsBloomUtils', () => {
  describe('buildLogsBloom', () => {
    /**
     * Check whether an item exists in the hex encoded logs bloom bitvector
     * @param item
     * @param bitvector
     */
    const checkInLogsBloom = (item: string, bitvector: string) => {
      const bitvectorUint8Arr = Uint8Array.from(Buffer.from(strip0x(bitvector), 'hex'));
      const itemBuf = Buffer.alloc(32, strip0x(keccak256(item)), 'hex');

      let match: boolean = true;
      for (let i = 0; i < 3 && match; i++) {
        const first2bytes = new DataView(itemBuf.buffer).getUint16(i * 2);
        const loc = LogsBloomUtils.MASK & first2bytes;
        const byteLoc = loc >> 3;
        const bitLoc = 1 << loc % 8;
        match = (bitvectorUint8Arr[LogsBloomUtils.BYTE_SIZE - byteLoc - 1] & bitLoc) !== 0;
      }

      return match;
    };

    const address = '0x000000000000000000000000000000000000040c';
    const topics = [
      '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
      '0x00000000000000000000000000000000000000000000000000000000000003f5',
      '0x00000000000000000000000000000000000000000000000000000000000003f6',
    ];
    const expectedLogsBloom =
      '0x0000000000000000000000000000000000000000000000000000000000000000000000000000000000000' +
      '000000000000000000000000000000000000000000000000001000000000000000800000000000000000000000000000000000000000000' +
      '000000000000000000000000000000000000000000000000001000000000000000000400000000000000000000000000000000000000000' +
      '000000000000100000000000000000000000000000000000000000000000000000400000000000000000300000000040000000000000000' +
      '0000000000000000000000080000000000001000000000000000000000000000000000000000000000000001000000';

    const emptyBloom = constants.EMPTY_BLOOM;

    it('should be able to generate emptyBloom if passed address is undefined', () => {
      // @ts-ignore
      const res = LogsBloomUtils.buildLogsBloom(undefined, topics);
      expect(emptyBloom).to.equal(res);
    });

    it('should be able to generate emptyBloom if passed address is null', () => {
      // @ts-ignore
      const res = LogsBloomUtils.buildLogsBloom(null, topics);
      expect(emptyBloom).to.equal(res);
    });

    it('should be able to generate emptyBloom if passed topics value is undefined', () => {
      // @ts-ignore
      const res = LogsBloomUtils.buildLogsBloom(address, undefined);
      expect(emptyBloom).to.equal(res);
    });

    it('should be able to generate emptyBloom if passed topics value is null', () => {
      // @ts-ignore
      const res = LogsBloomUtils.buildLogsBloom(address, null);
      expect(emptyBloom).to.equal(res);
    });

    it('should be able to generate emptyBloom if address is empty', () => {
      const res = LogsBloomUtils.buildLogsBloom('', topics);
      expect(emptyBloom).to.equal(res);
    });

    it('should be able to generate emptyBloom if there are no logs', () => {
      const res = LogsBloomUtils.buildLogsBloom(address, []);
      expect(emptyBloom).to.equal(res);
    });

    it('should be able to generate logsBloom of transfer event', () => {
      const res = LogsBloomUtils.buildLogsBloom(address, topics);
      expect(expectedLogsBloom).to.equal(res);
    });

    it('should be able to validate address and topics in generated logsBloom', () => {
      expect(checkInLogsBloom(address, expectedLogsBloom)).to.be.true;
      expect(checkInLogsBloom(topics[0], expectedLogsBloom)).to.be.true;
      expect(checkInLogsBloom(topics[1], expectedLogsBloom)).to.be.true;
      expect(checkInLogsBloom(topics[2], expectedLogsBloom)).to.be.true;
    });

    it('should be able to validate non-existing address and topic in generated logsBloom', () => {
      expect(checkInLogsBloom(ZeroAddress, expectedLogsBloom)).to.equal(false);
      expect(checkInLogsBloom('0xD865b78906938EfDD065Cb443Be31440bE08a7CE', expectedLogsBloom)).to.equal(false);
      expect(
        checkInLogsBloom('0x0000000000000000000000C70c3C06A4db619B7879d060B9215d528F584FcC', expectedLogsBloom),
      ).to.equal(false);
    });
  });
});
