// SPDX-License-Identifier: Apache-2.0

import { expect } from 'chai';
import { keccak256, ZeroAddress } from 'ethers';

import { strip0x } from '../../src/formatters';
import constants from '../../src/lib/constants';
import { Log } from '../../src/lib/model';
import { LogsBloomUtils } from '../../src/logsBloomUtils';

/**
 * Helper function to create the Logs array
 * @param address
 * @param topics
 */
const toLogs = (address: string, topics?: string[] | null) => [{ address, topics }] as Log[];

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
        const bitLoc = 1 << (loc % 8);
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
      const res = LogsBloomUtils.buildLogsBloom(toLogs(undefined, topics));
      expect(emptyBloom).to.equal(res);
    });

    it('should be able to generate emptyBloom if passed address is null', () => {
      // @ts-ignore
      const res = LogsBloomUtils.buildLogsBloom(toLogs(null, topics));
      expect(emptyBloom).to.equal(res);
    });

    [
      { label: 'undefined', value: undefined },
      { label: 'null', value: null },
      { label: 'empty array', value: [] },
    ].forEach(({ label, value }) => {
      it(`should be able to generate a bloom if passed topics value is ${label}`, () => {
        const res = LogsBloomUtils.buildLogsBloom(toLogs(address, value));
        expect(res).to.not.equal(emptyBloom);
        const bytes = res.slice(2).match(/.{2}/g)!;
        expect([bytes[132], bytes[159], bytes[195]]).to.deep.equal(['04', '01', '01']);
      });
    });

    it('should be able to generate a bloom if passed topics value is null', () => {
      // @ts-ignore
      const res = LogsBloomUtils.buildLogsBloom(toLogs(address, null));
      expect(res).to.not.equal(emptyBloom);
    });

    it('should be able to generate a emptyBloom if there are no logs', () => {
      const res = LogsBloomUtils.buildLogsBloom(toLogs(address, []));
      expect(res).to.not.equal(emptyBloom);
    });

    it('should be able to generate emptyBloom if address is empty', () => {
      const res = LogsBloomUtils.buildLogsBloom(toLogs('', topics));
      expect(res).to.equal(emptyBloom);
    });

    it('should be able to generate logsBloom of transfer event', () => {
      const res = LogsBloomUtils.buildLogsBloom(toLogs(address, topics));
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

    it('should be able to generate a bloom for multiple logs', () => {
      // Test fixture was taken from an Ethereum mainnet transaction receipt (logs + logsBloom)
      // and trimmed to only the fields needed for bloom calculation.
      // Source: https://etherscan.io/tx/0x3766f3eccfdd6c8ad9fde50f6496dcc15a0988063e5493651d6f4fdbe7590aa5
      const transactionReceipt = {
        logs: [
          {
            address: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
            topics: [
              '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
              '0x000000000000000000000000cdf330ffe8b2233c96576a61813d6ecd9c3ff700',
              '0x00000000000000000000000088e6a0c2ddd26feeb64f039a2c41296fcb3f5640',
            ],
          },
          {
            address: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
            topics: [
              '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
              '0x000000000000000000000000cdf330ffe8b2233c96576a61813d6ecd9c3ff700',
              '0x00000000000000000000000088e6a0c2ddd26feeb64f039a2c41296fcb3f5640',
            ],
          },
          {
            address: '0x88e6a0c2ddd26feeb64f039a2c41296fcb3f5640',
            topics: [
              '0x7a53080ba414158be7ec69b987b5fb7d07dee101fe85488f0853ae16239d0bde',
              '0x000000000000000000000000c36442b4a4522e871399cd717abdd847ab11fe88',
              '0x000000000000000000000000000000000000000000000000000000000002fdfa',
              '0x0000000000000000000000000000000000000000000000000000000000030052',
            ],
          },
          {
            address: '0xc36442b4a4522e871399cd717abdd847ab11fe88',
            topics: [
              '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
              '0x0000000000000000000000000000000000000000000000000000000000000000',
              '0x000000000000000000000000cdf330ffe8b2233c96576a61813d6ecd9c3ff700',
              '0x000000000000000000000000cdf330ffe8b2233c96576a61813d6ecd9c3ff700',
            ],
          },
          {
            address: '0xc36442b4a4522e871399cd717abdd847ab11fe88',
            topics: [
              '0x3067048beee31b25b2f1681f88dac838c8bba36af25bfb2b7cf7473a5847e35f',
              '0x0000000000000000000000000000000000000000000000000000000000035cbf',
            ],
          },
        ],
        logsBloom:
          '0x00800000010000000000100000000000000000000000000000000000840000000000000400000000000008000000' +
          '00000201000008000000840000000000000000000000200080000800001800000000400000800000000000080800' +
          '00000000000000000200000000001000000008000000000008000000000000100000000000000000080000000000' +
          '00000000000000000000010000000000000000000000000000000000200000000000000000000000000000200000' +
          '00200000000808004000000200000008000008000000000000000000004000000000000000002000000020000000' +
          '0000000010000000000000000000000000000000000000000800',
      };

      const res = LogsBloomUtils.buildLogsBloom(transactionReceipt.logs as Log[]);
      expect(res).to.equal(transactionReceipt.logsBloom);
    });

    it('should be able to generate a bloom for a transaction that has logs without any topics', () => {
      // Test fixture was taken from an Ethereum mainnet transaction receipt (logs + logsBloom)
      // and trimmed to only the fields needed for bloom calculation.
      // Source: https://etherscan.io/tx/0x694fba43f1f876e8680833014addae58ee1e2ddb8cd4936c001434983c4a6c53
      const transactionReceipt = {
        logs: [
          {
            address: '0xdac17f958d2ee523a2206206994597c13d831ec7',
            topics: [
              '0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925',
              '0x0000000000000000000000001f2f10d1c40777ae1da742455c65828ff36df387',
              '0x0000000000000000000000009995855c00494d039ab6792f18e368e530dff931',
            ],
          },
          {
            address: '0xe0e0e08a6a4b9dc7bd67bcb7aade5cf48157d444',
            topics: [],
          },
          {
            address: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
            topics: [
              '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
              '0x000000000000000000000000e0e0e08a6a4b9dc7bd67bcb7aade5cf48157d444',
              '0x0000000000000000000000001f2f10d1c40777ae1da742455c65828ff36df387',
            ],
          },
          {
            address: '0xdac17f958d2ee523a2206206994597c13d831ec7',
            topics: [
              '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
              '0x0000000000000000000000001f2f10d1c40777ae1da742455c65828ff36df387',
              '0x000000000000000000000000e0e0e08a6a4b9dc7bd67bcb7aade5cf48157d444',
            ],
          },
          {
            address: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
            topics: [
              '0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925',
              '0x0000000000000000000000001f2f10d1c40777ae1da742455c65828ff36df387',
              '0x000000000000000000000000a37cc341634afd9e0919d334606e676dbab63e17',
            ],
          },
          {
            address: '0xa37cc341634afd9e0919d334606e676dbab63e17',
            topics: [
              '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
              '0x0000000000000000000000000000000000000000000000000000000000000000',
              '0x0000000000000000000000001f2f10d1c40777ae1da742455c65828ff36df387',
              '0x00000000000000000000000000000000fbc3c0275fc8236af5e02c727be25f16',
            ],
          },
          {
            address: '0xe0e0e08a6a4b9dc7bd67bcb7aade5cf48157d444',
            topics: ['0xa2d4008be4187c63684f323788e131e1370dbc2205499befe2834005a00c792c'],
          },
          {
            address: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
            topics: [
              '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
              '0x0000000000000000000000001f2f10d1c40777ae1da742455c65828ff36df387',
              '0x000000000000000000000000e0e0e08a6a4b9dc7bd67bcb7aade5cf48157d444',
            ],
          },
        ],
        logsBloom:
          '0x00000000000000000000000200000000000000000100000000000000000000000000000000000000000000001000' +
          '01000000000000008000000000000020000000000000000000000a00000800000000000000000000000000000006' +
          '00000000200000000200000000000000000008100000000000000000000000100000000000000000000000000000' +
          '00000008000000000000010020000000000000100000060000000000200000000080000004000008000000000000' +
          '00000000000000000000000200080000000000000000200000000000000800000408000000002000001020600000' +
          '0000000000002020000000000000000000000000000000000000',
      };

      const res = LogsBloomUtils.buildLogsBloom(transactionReceipt.logs as Log[]);
      expect(res).to.equal(transactionReceipt.logsBloom);
    });
  });
});
