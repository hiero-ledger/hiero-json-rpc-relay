// SPDX-License-Identifier: Apache-2.0

import { expect } from 'chai';

import { ALL_PROTOCOL_CLIENTS } from '../helpers/protocolClient';

describe('@release @protocol-acceptance eth_feeHistory', async function () {
  const METHOD_NAME = 'eth_feeHistory';

  after(async () => {
    if (global && global.socketServer) {
      expect(global.socketServer._connections).to.eq(0);
    }
  });

  for (const client of ALL_PROTOCOL_CLIENTS) {
    describe(client.label, () => {
      it('should return fee history with correct structure for a single block', async () => {
        const blockCount = 1;
        const result = await client.call(METHOD_NAME, [`0x${blockCount.toString(16)}`, 'latest', []]);

        expect(result.baseFeePerGas, 'baseFeePerGas should be an Array').to.be.an('Array');
        expect(result.gasUsedRatio, 'gasUsedRatio should be an Array').to.be.an('Array');
        expect(result.oldestBlock, 'oldestBlock should exist').to.exist;
        // baseFeePerGas has blockCount + 1 entries (includes next block estimate)
        expect(result.baseFeePerGas.length).to.equal(blockCount + 1);
        expect(result.gasUsedRatio.length).to.equal(blockCount);
        expect(result.oldestBlock).to.match(/^0x/);
      });

      it('should return no reward field when rewardPercentiles is empty', async () => {
        const result = await client.call(METHOD_NAME, ['0x1', 'latest', []]);

        expect(result.reward).to.not.exist;
      });

      it('should return reward field when rewardPercentiles are provided', async () => {
        const blockCount = 2;
        const result = await client.call(METHOD_NAME, [`0x${blockCount.toString(16)}`, 'latest', [25, 75]]);

        expect(result.reward, 'reward should be an Array').to.be.an('Array');
        expect(result.reward.length).to.equal(blockCount);
      });
    });
  }
});
