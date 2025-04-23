// SPDX-License-Identifier: Apache-2.0

import { ContractId } from '@hashgraph/sdk';
import { expect, use } from 'chai';
import chaiAsPromised from 'chai-as-promised';

import { JsonRpcError, predefined } from '../../../src';
import { EthImpl } from '../../../src/lib/eth';
import { RequestDetails } from '../../../src/lib/types';
import { overrideEnvsInMochaDescribe } from '../../helpers';
import {
  CONTRACT_ADDRESS_1,
  DEFAULT_CONTRACT,
  DEFAULT_HTS_TOKEN,
  DEFAULT_NETWORK_FEES,
  HTS_TOKEN_ADDRESS,
  MIRROR_NODE_DEPLOYED_BYTECODE,
  NO_TRANSACTIONS,
} from './eth-config';
import { generateEthTestEnv } from './eth-helpers';

use(chaiAsPromised);

describe('@ethGetCode using MirrorNode', async function () {
  this.timeout(10000);
  const { restMock, ethImpl, cacheService } = generateEthTestEnv();
  const earlyBlockParams = ['0x0', '0x369ABF', 'earliest'];
  const otherValidBlockParams = [null, 'latest', 'pending', 'finalized', 'safe'];
  const invalidBlockParam = ['hedera', 'ethereum', '0xhbar', '0x369ABF369ABF369ABF'];

  const requestDetails = new RequestDetails({ requestId: 'eth_getCodeTest', ipAddress: '0.0.0.0' });

  overrideEnvsInMochaDescribe({ ETH_GET_TRANSACTION_COUNT_MAX_BLOCK_RANGE: 1 });

  this.beforeEach(async () => {
    // reset cache and restMock
    await cacheService.clear(requestDetails);
    restMock.reset();

    restMock.onGet('network/fees').reply(200, JSON.stringify(DEFAULT_NETWORK_FEES));

    restMock.onGet(`accounts/${CONTRACT_ADDRESS_1}?limit=100`).reply(404, null);
    restMock.onGet(`tokens/0.0.${parseInt(CONTRACT_ADDRESS_1, 16)}`).reply(404, null);
    restMock.onGet(`contracts/${CONTRACT_ADDRESS_1}`).reply(200, JSON.stringify(DEFAULT_CONTRACT));
    restMock.onGet(`blocks?limit=1&order=desc`).reply(
      200,
      JSON.stringify({
        blocks: [
          {
            number: '0x555555',
            timestamp: {
              from: '1718000000',
              to: '1718000000',
            },
          },
        ],
      }),
    );
  });

  this.afterEach(() => {
    restMock.resetHandlers();
  });

  describe('eth_getCode', async function () {
    it('should return non cached value for not found contract', async () => {
      restMock.onGet(`contracts/${CONTRACT_ADDRESS_1}`).reply(404, JSON.stringify(DEFAULT_CONTRACT));
      const resNoCache = await ethImpl.getCode(CONTRACT_ADDRESS_1, null, requestDetails);
      const resCached = await ethImpl.getCode(CONTRACT_ADDRESS_1, null, requestDetails);
      expect(resNoCache).to.equal(EthImpl.emptyHex);
      expect(resCached).to.equal(EthImpl.emptyHex);
    });

    it('should return the runtime_bytecode from the mirror node', async () => {
      const res = await ethImpl.getCode(CONTRACT_ADDRESS_1, null, requestDetails);
      expect(res).to.equal(MIRROR_NODE_DEPLOYED_BYTECODE);
    });

    it('should return empty bytecode if Mirror Node returns 404', async () => {
      restMock.onGet(`contracts/${CONTRACT_ADDRESS_1}`).reply(404, JSON.stringify(DEFAULT_CONTRACT));
      const res = await ethImpl.getCode(CONTRACT_ADDRESS_1, null, requestDetails);
      expect(res).to.equal(EthImpl.emptyHex);
    });

    it('should return empty bytecode if Mirror Node returns empty runtime_bytecode', async () => {
      restMock.onGet(`contracts/${CONTRACT_ADDRESS_1}`).reply(200, {
        ...DEFAULT_CONTRACT,
        runtime_bytecode: EthImpl.emptyHex,
      });
      const res = await ethImpl.getCode(CONTRACT_ADDRESS_1, null, requestDetails);
      expect(res).to.equal(EthImpl.emptyHex);
    });

    it('should return redirect bytecode for HTS token', async () => {
      restMock.onGet(`contracts/${HTS_TOKEN_ADDRESS}`).reply(404, JSON.stringify(null));
      restMock.onGet(`accounts/${HTS_TOKEN_ADDRESS}?limit=100`).reply(404, JSON.stringify(null));
      restMock.onGet(`tokens/0.0.${parseInt(HTS_TOKEN_ADDRESS, 16)}`).reply(200, JSON.stringify(DEFAULT_HTS_TOKEN));
      const redirectBytecode = `6080604052348015600f57600080fd5b506000610167905077618dc65e${HTS_TOKEN_ADDRESS.slice(
        2,
      )}600052366000602037600080366018016008845af43d806000803e8160008114605857816000f35b816000fdfea2646970667358221220d8378feed472ba49a0005514ef7087017f707b45fb9bf56bb81bb93ff19a238b64736f6c634300080b0033`;
      const res = await ethImpl.getCode(HTS_TOKEN_ADDRESS, null, requestDetails);
      expect(res).to.equal(redirectBytecode);
    });

    it('should return the static bytecode for address(0x167) call', async () => {
      restMock.onGet(`contracts/${EthImpl.iHTSAddress}`).reply(200, JSON.stringify(DEFAULT_CONTRACT));
      restMock.onGet(`accounts/${EthImpl.iHTSAddress}${NO_TRANSACTIONS}`).reply(404, JSON.stringify(null));

      const res = await ethImpl.getCode(EthImpl.iHTSAddress, null, requestDetails);
      expect(res).to.equal(EthImpl.invalidEVMInstruction);
    });

    earlyBlockParams.forEach((blockParam) => {
      it(`should return empty bytecode for early block param ${blockParam}`, async () => {
        const paramAsInt = blockParam === 'earliest' ? 0 : parseInt(blockParam, 16);
        restMock.onGet(`blocks/${paramAsInt}`).reply(
          200,
          JSON.stringify({
            timestamp: { to: '1532175203.847228000' },
          }),
        );
        const res = await ethImpl.getCode(CONTRACT_ADDRESS_1, blockParam, requestDetails);
        expect(res).to.equal(EthImpl.emptyHex);
      });
    });

    otherValidBlockParams.forEach((blockParam) => {
      it(`should return deployed bytecode for block param ${blockParam}`, async () => {
        const res = await ethImpl.getCode(CONTRACT_ADDRESS_1, blockParam, requestDetails);
        expect(res).to.equal(MIRROR_NODE_DEPLOYED_BYTECODE);
      });
    });

    invalidBlockParam.forEach((blockParam) => {
      it(`should throw INVALID_PARAMETER JsonRpcError with invalid blockParam=${blockParam}`, async () => {
        try {
          await ethImpl.getCode(EthImpl.iHTSAddress, blockParam, requestDetails);
          expect(true).to.eq(false);
        } catch (error: any) {
          const expectedError = predefined.UNKNOWN_BLOCK(
            `The value passed is not a valid blockHash/blockNumber/blockTag value: ${blockParam}`,
          );

          expect(error).to.exist;
          expect(error instanceof JsonRpcError);
          expect(error.code).to.eq(expectedError.code);
          expect(error.message).to.eq(expectedError.message);
        }
      });
    });

    it('should return empty bytecode for HTS token before creation block', async () => {
      const blockNumberBeforeCreation = '0x152a4aa';
      const blockToTimestamp = '1632175203.847228000';

      restMock.onGet(`tokens/0.0.${parseInt(HTS_TOKEN_ADDRESS, 16)}`).reply(
        200,
        JSON.stringify({
          ...DEFAULT_HTS_TOKEN,
          created_timestamp: '1632175205.855270000',
        }),
      );
      restMock.onGet(`blocks/${parseInt(blockNumberBeforeCreation, 16)}`).reply(
        200,
        JSON.stringify({
          timestamp: { to: blockToTimestamp },
        }),
      );

      const res = await ethImpl.getCode(HTS_TOKEN_ADDRESS, blockNumberBeforeCreation, requestDetails);
      expect(res).to.equal(EthImpl.emptyHex);
    });

    it('should return empty bytecode for contract before creation block', async () => {
      const blockNumberBeforeCreation = '0x152a4aa';
      const blockToTimestamp = '1632175203.847228000';
      const contractId = ContractId.fromEvmAddress(0, 0, CONTRACT_ADDRESS_1);

      restMock.onGet(`contracts/${contractId.toString()}`).reply(
        200,
        JSON.stringify({
          ...DEFAULT_CONTRACT,
          created_timestamp: '1632175205.855270000',
        }),
      );
      restMock.onGet(`blocks/${parseInt(blockNumberBeforeCreation, 16)}`).reply(
        200,
        JSON.stringify({
          timestamp: { to: blockToTimestamp },
        }),
      );

      const res = await ethImpl.getCode(CONTRACT_ADDRESS_1, blockNumberBeforeCreation, requestDetails);
      expect(res).to.equal(EthImpl.emptyHex);
    });

    it('should return redirect bytecode for HTS token after creation block', async () => {
      const blockNumberAfterCreation = '0x152a4ab';
      const blockToTimestamp = '1632175206.000000000';

      restMock.onGet(`tokens/0.0.${parseInt(HTS_TOKEN_ADDRESS, 16)}`).reply(
        200,
        JSON.stringify({
          ...DEFAULT_HTS_TOKEN,
          created_timestamp: '1632175205.855270000',
        }),
      );

      restMock.onGet(`blocks/${parseInt(blockNumberAfterCreation, 16)}`).reply(
        200,
        JSON.stringify({
          timestamp: { to: blockToTimestamp },
        }),
      );

      const res = await ethImpl.getCode(HTS_TOKEN_ADDRESS, blockNumberAfterCreation, requestDetails);
      const expectedRedirectBytecode = `6080604052348015600f57600080fd5b506000610167905077618dc65e${HTS_TOKEN_ADDRESS.slice(
        2,
      )}600052366000602037600080366018016008845af43d806000803e8160008114605857816000f35b816000fdfea2646970667358221220d8378feed472ba49a0005514ef7087017f707b45fb9bf56bb81bb93ff19a238b64736f6c634300080b0033`;
      expect(res).to.equal(expectedRedirectBytecode);
    });

    it('should throw error for invalid block number', async () => {
      const invalidBlockNumber = '0xinvalid';

      await expect(
        ethImpl.getCode(HTS_TOKEN_ADDRESS, invalidBlockNumber, requestDetails),
      ).to.eventually.be.rejectedWith(
        `The value passed is not a valid blockHash/blockNumber/blockTag value: ${invalidBlockNumber}`,
      );
    });

    it('should return empty hex when block does not exist', async () => {
      const futureBlockNumber = '0x1000000';
      restMock.onGet(`contracts/${HTS_TOKEN_ADDRESS}`).reply(404, null);
      restMock.onGet(`accounts/${HTS_TOKEN_ADDRESS}?limit=100`).reply(404, null);
      restMock.onGet(`tokens/0.0.${parseInt(HTS_TOKEN_ADDRESS, 16)}`).reply(200, JSON.stringify(DEFAULT_HTS_TOKEN));
      restMock.onGet(`blocks/${parseInt(futureBlockNumber, 16)}`).reply(404, null);

      const res = await ethImpl.getCode(HTS_TOKEN_ADDRESS, futureBlockNumber, requestDetails);
      expect(res).to.equal(EthImpl.emptyHex);
    });

    it('should return empty bytecode for contract when earliest block is queried', async () => {
      const blockToTimestamp = '1632175203.847228000';
      const contractId = ContractId.fromEvmAddress(0, 0, CONTRACT_ADDRESS_1);

      restMock.onGet(`contracts/${contractId.toString()}`).reply(
        200,
        JSON.stringify({
          ...DEFAULT_CONTRACT,
          created_timestamp: '1632175205.855270000',
        }),
      );
      restMock.onGet('blocks/0').reply(
        200,
        JSON.stringify({
          timestamp: { to: blockToTimestamp },
        }),
      );

      const res = await ethImpl.getCode(CONTRACT_ADDRESS_1, 'earliest', requestDetails);
      expect(res).to.equal(EthImpl.emptyHex);
    });
  });
});
