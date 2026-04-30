// SPDX-License-Identifier: Apache-2.0

import { expect } from 'chai';
import { ethers } from 'ethers';

import { ConfigService } from '../../src/config-service/services';
import { predefined } from '../../src/relay';
import MirrorClient from '../server/clients/mirrorClient';
import ServicesClient from '../server/clients/servicesClient';
import Assertions from '../server/helpers/assertions';
import constants from '../server/helpers/constants';
import { ALL_PROTOCOL_CLIENTS } from './helpers/protocolClient';

describe('@release @protocol-acceptance eth_feeHistory', function () {
  this.timeout(240 * 1000);
  const METHOD_NAME = 'eth_feeHistory';
  const EXCHANGE_RATE_FILE_ID = '0.0.112';
  const EXCHANGE_RATE_FILE_CONTENT_DEFAULT = '0a1008b0ea0110f9bb1b1a0608f0cccf9306121008b0ea0110e9c81a1a060880e9cf9306';
  const FEE_SCHEDULE_FILE_ID = '0.0.111';
  const FEE_SCHEDULE_FILE_CONTENT_DEFAULT =
    '0a280a0a08541a061a04408888340a0a08061a061a0440889d2d0a0a08071a061a0440b0b63c120208011200';
  const FEE_SCHEDULE_FILE_CONTENT_UPDATED =
    '0a280a0a08541a061a0440a8953a0a0a08061a061a0440889d2d0a0a08071a061a0440b0b63c120208011200';

  // @ts-ignore
  const { servicesNode, mirrorNode }: { servicesNode: ServicesClient; mirrorNode: MirrorClient } = global;

  after(async () => {
    if (global?.socketServer) {
      expect(global.socketServer._connections).to.eq(0);
    }
  });

  for (const client of ALL_PROTOCOL_CLIENTS) {
    describe(client.label, () => {
      it('should call eth_feeHistory', async () => {
        const result = (await client.call(METHOD_NAME, ['0x1', 'latest'])) as any;

        expect(result.baseFeePerGas).to.exist.and.be.an('Array');
        expect(result.baseFeePerGas.length).to.be.gt(0);
        expect(result.gasUsedRatio).to.exist.and.be.an('Array');
        expect(result.gasUsedRatio.length).to.be.gt(0);
        expect(result.oldestBlock).to.exist;
        expect(Number(result.oldestBlock)).to.be.gt(0);
      });

      it('should return fee history with correct structure for a single block', async () => {
        const blockCount = 1;
        const result = (await client.call(METHOD_NAME, [`0x${blockCount.toString(16)}`, 'latest', []])) as any;

        expect(result.baseFeePerGas, 'baseFeePerGas should be an Array').to.be.an('Array');
        expect(result.gasUsedRatio, 'gasUsedRatio should be an Array').to.be.an('Array');
        expect(result.oldestBlock, 'oldestBlock should exist').to.exist;
        expect(result.baseFeePerGas.length).to.equal(blockCount + 1);
        expect(result.gasUsedRatio.length).to.equal(blockCount);
        expect(result.oldestBlock).to.match(/^0x/);
      });

      it('should return no reward field when rewardPercentiles is empty', async () => {
        const result = (await client.call(METHOD_NAME, ['0x1', 'latest', []])) as any;

        expect(result.reward).to.not.exist;
      });

      it('should call eth_feeHistory with valid rewardPercentiles whose size is less than 100', async () => {
        const result = (await client.call(METHOD_NAME, ['0x1', 'latest', [25, 75]])) as any;

        expect(result.reward).to.exist.and.be.an('Array');
        expect(result.reward.length).to.be.gt(0);
      });

      it('should return reward field when rewardPercentiles are provided', async () => {
        const blockCount = 2;
        const result = (await client.call(METHOD_NAME, [`0x${blockCount.toString(16)}`, 'latest', [25, 75]])) as any;

        expect(result.reward, 'reward should be an Array').to.be.an('Array');
        expect(result.reward.length).to.equal(blockCount);
      });

      it('should fail to call eth_feeHistory with invalid rewardPercentiles whose size is greater than 100', async () => {
        const invalidSize = 101;
        const expectedError = predefined.INVALID_PARAMETER(
          2,
          `Reward percentiles size ${invalidSize} is greater than the maximum allowed size ${constants.FEE_HISTORY_REWARD_PERCENTILES_MAX_SIZE}`,
        );

        const response = await client.callRaw(METHOD_NAME, [
          '0x1',
          'latest',
          Array.from({ length: invalidSize }, (_, i) => i),
        ]);

        expect(response.error).to.exist;
        expect(response.error!.code).to.eq(expectedError.code);
        expect(response.error!.message).to.contain(expectedError.message);
      });
    });
  }

  if (ConfigService.get('LOCAL_NODE')) {
    describe('local-node fee schedule updates', () => {
      let lastBlockBeforeUpdate: { number: number };
      let lastBlockAfterUpdate: { number: number };
      let feeScheduleContentAtStart: Buffer;
      let exchangeRateContentAtStart: Buffer;

      before(async () => {
        feeScheduleContentAtStart = await servicesNode.getFileContent(FEE_SCHEDULE_FILE_ID);
        exchangeRateContentAtStart = await servicesNode.getFileContent(EXCHANGE_RATE_FILE_ID);

        await servicesNode.updateFileContent(FEE_SCHEDULE_FILE_ID, FEE_SCHEDULE_FILE_CONTENT_DEFAULT);
        await servicesNode.updateFileContent(EXCHANGE_RATE_FILE_ID, EXCHANGE_RATE_FILE_CONTENT_DEFAULT);
        lastBlockBeforeUpdate = (await mirrorNode.get(`/blocks?limit=1&order=desc`)).blocks[0];
        await new Promise((resolve) => setTimeout(resolve, 4000));
        await servicesNode.updateFileContent(FEE_SCHEDULE_FILE_ID, FEE_SCHEDULE_FILE_CONTENT_UPDATED);
        await new Promise((resolve) => setTimeout(resolve, 4000));
        lastBlockAfterUpdate = (await mirrorNode.get(`/blocks?limit=1&order=desc`)).blocks[0];
      });

      after(async () => {
        await servicesNode.updateFileContent(FEE_SCHEDULE_FILE_ID, feeScheduleContentAtStart.toString('hex'));
        await servicesNode.updateFileContent(EXCHANGE_RATE_FILE_ID, exchangeRateContentAtStart.toString('hex'));
        await new Promise((resolve) => setTimeout(resolve, 4000));
      });

      for (const client of ALL_PROTOCOL_CLIENTS) {
        it('should call eth_feeHistory with updated fees', async function () {
          const blockCountNumber = lastBlockAfterUpdate.number - lastBlockBeforeUpdate.number;
          const blockCountHex = ethers.toQuantity(blockCountNumber);
          const defaultGasPriceHex = ethers.toQuantity(Assertions.defaultGasPrice);
          const newestBlockNumberHex = ethers.toQuantity(lastBlockAfterUpdate.number);
          const oldestBlockNumberHex = ethers.toQuantity(lastBlockAfterUpdate.number - blockCountNumber + 1);

          const result = (await client.call(METHOD_NAME, [blockCountHex, newestBlockNumberHex, [0]])) as any;

          Assertions.feeHistory(result, {
            resultCount: blockCountNumber,
            oldestBlock: oldestBlockNumberHex,
            checkReward: true,
          });
          expect(result.baseFeePerGas[1]).to.equal(defaultGasPriceHex);
          expect(result.baseFeePerGas[result.baseFeePerGas.length - 2]).to.equal(defaultGasPriceHex);
          expect(result.baseFeePerGas[result.baseFeePerGas.length - 1]).to.equal(defaultGasPriceHex);
        });

        it('should call eth_feeHistory with newest block > latest', async function () {
          const blocksAhead = 10;
          const latestBlock = (await mirrorNode.get(`/blocks?limit=1&order=desc`)).blocks[0];
          const newestBlockNumberHex = ethers.toQuantity(latestBlock.number + blocksAhead);
          const expectedError = predefined.REQUEST_BEYOND_HEAD_BLOCK(
            latestBlock.number + blocksAhead,
            latestBlock.number,
          );

          const response = await client.callRaw(METHOD_NAME, ['0x1', newestBlockNumberHex, null]);

          expect(response.error).to.exist;
          expect(response.error!.code).to.eq(expectedError.code);
          expect(response.error!.message).to.contain(expectedError.message);
        });

        it('should call eth_feeHistory with zero block count', async function () {
          const result = (await client.call(METHOD_NAME, ['0x0', 'latest', null] as unknown[])) as any;

          expect(result.reward).to.not.exist;
          expect(result.baseFeePerGas).to.not.exist;
          expect(result.gasUsedRatio).to.equal(null);
          expect(result.oldestBlock).to.equal('0x0');
        });
      }
    });
  }
});
