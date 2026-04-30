// SPDX-License-Identifier: Apache-2.0

import { expect } from 'chai';

import type MirrorClient from '../server/clients/mirrorClient';
import { ALL_PROTOCOL_CLIENTS } from './helpers/protocolClient';

describe('@release @protocol-acceptance eth_blockNumber', async () => {
  const METHOD_NAME = 'eth_blockNumber';
  // @ts-ignore
  const { mirrorNode }: { mirrorNode: MirrorClient } = global;

  after(async () => {
    if (global?.socketServer) {
      expect(global.socketServer._connections).to.eq(0);
    }
  });

  for (const client of ALL_PROTOCOL_CLIENTS) {
    describe(client.label, () => {
      it('should return a non-negative hex block number', async () => {
        const result = (await client.call(METHOD_NAME, [])) as string;
        expect(result.startsWith('0x')).to.be.true;
        expect(Number(result)).to.be.gte(0);
      });

      it('Should execute eth_blockNumber requests with undefined params and receive expected result', async () => {
        const response = await client.callRaw(METHOD_NAME, undefined);
        expect(response.error).to.not.exist;
        expect(response.result).to.be.a('string');
        expect((response.result as string).startsWith('0x')).to.be.true;
      });

      it('@release should execute "eth_blockNumber"', async () => {
        const mirrorBlocks = await mirrorNode.get('blocks');
        expect(mirrorBlocks).to.have.property('blocks');
        expect(mirrorBlocks.blocks.length).to.gt(0);
        const mirrorBlockNumber: number = mirrorBlocks.blocks[0].number;

        const res = (await client.call(METHOD_NAME, [])) as string;
        const blockNumber = Number(res);
        // In rare cases the relay block may be mirror + 1 because the mirror
        // block advances between the mirror read and the relay call.
        expect(blockNumber).to.be.oneOf([mirrorBlockNumber, mirrorBlockNumber + 1]);
      });
    });
  }
});
