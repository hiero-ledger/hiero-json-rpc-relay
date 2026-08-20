// SPDX-License-Identifier: Apache-2.0

import MockAdapter from 'axios-mock-adapter';
import chai, { expect } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import pino from 'pino';
import { Registry } from 'prom-client';
import sinon from 'sinon';

chai.use(chaiAsPromised);

import { ConfigService } from '../../../../../../src/config-service/services';
import { prepend0x } from '../../../../../../src/relay/formatters';
import { MirrorNodeClient } from '../../../../../../src/relay/lib/clients';
import { predefined } from '../../../../../../src/relay/lib/errors/JsonRpcError';
import { CacheClientFactory } from '../../../../../../src/relay/lib/factories/cacheClientFactory';
import { CommonService } from '../../../../../../src/relay/lib/services';
import { RequestDetails } from '../../../../../../src/relay/lib/types';
import { withOverriddenEnvsInMochaTest } from '../../../../helpers';

describe('CommonService', () => {
  describe('getPaymasterIfTxCanBeSubsidized', async () => {
    let configStub: sinon.SinonStub;

    beforeEach(() => {
      // reset maps before each test
      (CommonService as any).PAYMASTER_ACCOUNTS_WHITELISTS_MAP = new Map();
      (CommonService as any).PAYMASTER_ACCOUNTS_MAP = new Map();

      configStub = sinon.stub(ConfigService, 'get');
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should return paymaster account when toAddress is whitelisted in PAYMASTER_ACCOUNTS_WHITELISTS_MAP', () => {
      const toAddress = '0x0000000000000000000000000000000000000000';
      const normalized = prepend0x(toAddress.toLowerCase());

      (CommonService as any).PAYMASTER_ACCOUNTS_WHITELISTS_MAP.set(normalized, '0.0.9303');
      (CommonService as any).PAYMASTER_ACCOUNTS_MAP.set('0.0.9303', ['0.0.9303', null, null, 100]);

      const result = CommonService.getPaymasterIfTxCanBeSubsidized(toAddress);

      expect(result).to.deep.equal({
        accountId: '0.0.9303',
        gasAllowance: 100,
      });
    });

    it('should return null when whitelisted accountId exists but PAYMASTER_ACCOUNTS_MAP has no entry', () => {
      const toAddress = '0x0000000000000000000000000000000000000000';
      const normalized = prepend0x(toAddress.toLowerCase());

      (CommonService as any).PAYMASTER_ACCOUNTS_WHITELISTS_MAP.set(normalized, '0.0.9303');

      configStub.withArgs('PAYMASTER_ENABLED').returns(false);

      const result = CommonService.getPaymasterIfTxCanBeSubsidized(toAddress);

      expect(result).to.equal(null);
    });

    it('should return default paymaster when PAYMASTER_ENABLED and whitelist contains *', () => {
      (CommonService as any).PAYMASTER_WHITELIST = ['*'];
      configStub.withArgs('PAYMASTER_ENABLED').returns(true);
      configStub.withArgs('OPERATOR_ID_MAIN').returns('0.0.1000');
      configStub.withArgs('MAX_GAS_ALLOWANCE_HBAR').returns(120);

      const result = CommonService.getPaymasterIfTxCanBeSubsidized('0xdef');

      expect(result).to.deep.equal({
        accountId: '0.0.1000',
        gasAllowance: 120,
      });
    });

    it('should return default paymaster when address is in PAYMASTER_WHITELIST', () => {
      const toAddress = '0x0000000000000000000000000000000000000000';
      const normalized = prepend0x(toAddress.toLowerCase());

      (CommonService as any).PAYMASTER_WHITELIST = [normalized];
      configStub.withArgs('PAYMASTER_ENABLED').returns(true);
      configStub.withArgs('OPERATOR_ID_MAIN').returns('0.0.1000');
      configStub.withArgs('MAX_GAS_ALLOWANCE_HBAR').returns(500);

      const result = CommonService.getPaymasterIfTxCanBeSubsidized(toAddress);

      expect(result).to.deep.equal({
        accountId: '0.0.1000',
        gasAllowance: 500,
      });
    });

    it('should return null when PAYMASTER_ENABLED is false and no whitelist match', () => {
      configStub.withArgs('PAYMASTER_ENABLED').returns(false);

      const result = CommonService.getPaymasterIfTxCanBeSubsidized('0x0000000000000000000000000000000000000000');

      expect(result).to.equal(null);
    });

    it('should return null when toAddress is null and default whitelist does not apply', () => {
      configStub.withArgs('PAYMASTER_ENABLED').returns(true);
      configStub.withArgs('PAYMASTER_WHITELIST').returns([]);
      configStub.withArgs('OPERATOR_ID_MAIN').returns('0.0.1000');
      configStub.withArgs('MAX_GAS_ALLOWANCE_HBAR').returns(500);

      const result = CommonService.getPaymasterIfTxCanBeSubsidized(null);

      expect(result).to.equal(null);
    });
  });

  describe('getHistoricalBlockResponse', () => {
    const requestDetails = new RequestDetails({ requestId: 'test-request-id', ipAddress: '0.0.0.0' });
    const LATEST_BLOCK_QUERY = 'blocks?limit=1&order=desc';

    let commonService: CommonService;
    let restMock: MockAdapter;

    beforeEach(() => {
      const logger = pino({ level: 'silent' });
      const registry = new Registry();
      const cacheService = CacheClientFactory.create(logger, registry);
      const mirrorNodeClient = new MirrorNodeClient(
        ConfigService.get('MIRROR_NODE_URL'),
        logger.child({ name: 'mirror-node' }),
        registry,
        cacheService,
      );
      restMock = new MockAdapter(mirrorNodeClient.getMirrorNodeRestInstance(), { onNoMatch: 'throwException' });
      commonService = new CommonService(mirrorNodeClient, logger, cacheService);
    });

    afterEach(() => {
      restMock.restore();
      sinon.restore();
    });

    it('throws COULD_NOT_RETRIEVE_LATEST_BLOCK when range check finds an empty blocks array', async () => {
      restMock.onGet(LATEST_BLOCK_QUERY).reply(200, JSON.stringify({ blocks: [] }));

      await expect(commonService.getHistoricalBlockResponse(requestDetails, '0x9d089', true)).to.be.rejectedWith(
        predefined.COULD_NOT_RETRIEVE_LATEST_BLOCK.message,
      );
    });

    it('throws COULD_NOT_RETRIEVE_LATEST_BLOCK when latest tag is requested and blocks array is empty', async () => {
      restMock.onGet(LATEST_BLOCK_QUERY).reply(200, JSON.stringify({ blocks: [] }));

      await expect(commonService.getHistoricalBlockResponse(requestDetails, 'latest', true)).to.be.rejectedWith(
        predefined.COULD_NOT_RETRIEVE_LATEST_BLOCK.message,
      );
    });
  });

  describe('getLatestBlockNumber', () => {
    const requestDetails = new RequestDetails({ requestId: 'test-request-id', ipAddress: '0.0.0.0' });
    const LATEST_BLOCK_QUERY = 'blocks?limit=1&order=desc';

    let commonService: CommonService;
    let restMock: MockAdapter;

    beforeEach(() => {
      const logger = pino({ level: 'silent' });
      const registry = new Registry();
      const cacheService = CacheClientFactory.create(logger, registry);
      const mirrorNodeClient = new MirrorNodeClient(
        ConfigService.get('MIRROR_NODE_URL'),
        logger.child({ name: 'mirror-node' }),
        registry,
        cacheService,
      );
      restMock = new MockAdapter(mirrorNodeClient.getMirrorNodeRestInstance(), { onNoMatch: 'throwException' });
      commonService = new CommonService(mirrorNodeClient, logger, cacheService);
    });

    afterEach(() => {
      restMock.restore();
      sinon.restore();
    });

    it('returns the latest block number in 0x form when the mirror node returns a block', async () => {
      restMock.onGet(LATEST_BLOCK_QUERY).reply(200, JSON.stringify({ blocks: [{ number: 643209 }] }));

      const result = await commonService.getLatestBlockNumber(requestDetails);

      expect(result).to.equal('0x9d089');
    });

    it('throws COULD_NOT_RETRIEVE_LATEST_BLOCK when the blocks array is empty', async () => {
      restMock.onGet(LATEST_BLOCK_QUERY).reply(200, JSON.stringify({ blocks: [] }));

      await expect(commonService.getLatestBlockNumber(requestDetails)).to.be.rejectedWith(
        predefined.COULD_NOT_RETRIEVE_LATEST_BLOCK.message,
      );
    });

    it('throws COULD_NOT_RETRIEVE_LATEST_BLOCK when the mirror node returns 404', async () => {
      restMock.onGet(LATEST_BLOCK_QUERY).reply(404, JSON.stringify({}));

      await expect(commonService.getLatestBlockNumber(requestDetails)).to.be.rejectedWith(
        predefined.COULD_NOT_RETRIEVE_LATEST_BLOCK.message,
      );
    });
  });

  describe('validateBlockRangeAndAddTimestampToParams slice count', () => {
    const requestDetails = new RequestDetails({ requestId: 'test-request-id', ipAddress: '0.0.0.0' });
    const LATEST_BLOCK_QUERY = 'blocks?limit=1&order=desc';
    const LATEST_BLOCK_NUMBER = 2000;
    const CONTRACT_ADDRESS = '0x0000000000000000000000000000000000000001';

    let commonService: CommonService;
    let restMock: MockAdapter;

    function block(number: number, count: number, secondsFromEpoch: number): Record<string, unknown> {
      return {
        number,
        count,
        timestamp: {
          from: `${1739000000 + secondsFromEpoch}.000000000`,
          to: `${1739000000 + secondsFromEpoch}.999999999`,
        },
      };
    }

    function rangeQuery(from: number, to: number): string {
      return `blocks?block.number=gte:${from}&block.number=lte:${to}&limit=100&order=asc`;
    }

    beforeEach(() => {
      const logger = pino({ level: 'silent' });
      const registry = new Registry();
      const cacheService = CacheClientFactory.create(logger, registry);
      const mirrorNodeClient = new MirrorNodeClient(
        ConfigService.get('MIRROR_NODE_URL'),
        logger.child({ name: 'mirror-node' }),
        registry,
        cacheService,
      );
      restMock = new MockAdapter(mirrorNodeClient.getMirrorNodeRestInstance(), { onNoMatch: 'throwException' });
      commonService = new CommonService(mirrorNodeClient, logger, cacheService);

      restMock.onGet(LATEST_BLOCK_QUERY).reply(200, JSON.stringify({ blocks: [block(LATEST_BLOCK_NUMBER, 1, 5000)] }));
    });

    afterEach(() => {
      restMock.restore();
      sinon.restore();
    });

    function mockEndpointBlocks(from: number, to: number, fromCount = 1, toCount = 1): void {
      restMock.onGet(`blocks/${from}`).reply(200, JSON.stringify(block(from, fromCount, 0)));
      restMock.onGet(`blocks/${to}`).reply(200, JSON.stringify(block(to, toCount, 100)));
    }

    async function resolveSliceCount(
      fromBlock: string,
      toBlock: string,
      address: string | null = null,
    ): Promise<number> {
      const params: any = {};
      const sliceCountWrapper = { value: CommonService.SEQUENTIAL_SLICE_COUNT };

      const result = await commonService.validateBlockRangeAndAddTimestampToParams(
        params,
        fromBlock,
        toBlock,
        requestDetails,
        address,
        sliceCountWrapper,
      );

      expect(result, 'the range must resolve for the slice count to be meaningful').to.be.true;
      return sliceCountWrapper.value;
    }

    it('sums the transaction count of every block in the range', async () => {
      mockEndpointBlocks(100, 102);
      restMock.onGet(rangeQuery(100, 102)).reply(
        200,
        JSON.stringify({
          blocks: [block(100, 200, 0), block(101, 150, 2), block(102, 100, 4)],
          links: { next: null },
        }),
      );

      expect(await resolveSliceCount('0x64', '0x66')).to.equal(5);
    });

    it('caps the slice count at MIRROR_NODE_TIMESTAMP_SLICING_MAX_SLICES', async () => {
      mockEndpointBlocks(100, 102);
      restMock
        .onGet(rangeQuery(100, 102))
        .reply(200, JSON.stringify({ blocks: [block(100, 1_000_000, 0)], links: { next: null } }));

      expect(await resolveSliceCount('0x64', '0x66')).to.equal(
        ConfigService.get('MIRROR_NODE_TIMESTAMP_SLICING_MAX_SLICES'),
      );
    });

    it('leaves the slice count sequential when the range exceeds the enumeration limit', async () => {
      const enumerationMaxBlocks = ConfigService.get('MIRROR_NODE_TIMESTAMP_SLICING_ENUMERATION_MAX_BLOCKS');
      const from = 1;
      const to = from + enumerationMaxBlocks;
      mockEndpointBlocks(from, to);

      expect(await resolveSliceCount(prepend0x(from.toString(16)), prepend0x(to.toString(16)))).to.equal(
        CommonService.SEQUENTIAL_SLICE_COUNT,
      );
    });

    withOverriddenEnvsInMochaTest({ MIRROR_NODE_TIMESTAMP_SLICING_ENUMERATION_MAX_BLOCKS: 5 }, () => {
      it('follows the configured enumeration limit', async () => {
        mockEndpointBlocks(100, 110);

        expect(await resolveSliceCount('0x64', '0x6e', CONTRACT_ADDRESS)).to.equal(
          CommonService.SEQUENTIAL_SLICE_COUNT,
        );
      });
    });

    it('leaves the slice count sequential when the block range fetch fails', async () => {
      mockEndpointBlocks(100, 102);
      restMock.onGet(rangeQuery(100, 102)).reply(500, JSON.stringify({ _status: { messages: [] } }));

      expect(await resolveSliceCount('0x64', '0x66')).to.equal(CommonService.SEQUENTIAL_SLICE_COUNT);
    });

    it('leaves the slice count sequential when the range holds no transactions', async () => {
      mockEndpointBlocks(100, 102, 0, 0);
      restMock
        .onGet(rangeQuery(100, 102))
        .reply(200, JSON.stringify({ blocks: [block(100, 0, 0), block(101, 0, 2)], links: { next: null } }));

      expect(await resolveSliceCount('0x64', '0x66')).to.equal(CommonService.SEQUENTIAL_SLICE_COUNT);
    });

    withOverriddenEnvsInMochaTest({ MIRROR_NODE_TIMESTAMP_SLICING_MAX_SLICES: 0 }, () => {
      it('leaves the slice count sequential when the slice ceiling is not positive', async () => {
        mockEndpointBlocks(100, 102);

        expect(await resolveSliceCount('0x64', '0x66')).to.equal(CommonService.SEQUENTIAL_SLICE_COUNT);
      });
    });

    withOverriddenEnvsInMochaTest({ MIRROR_NODE_TIMESTAMP_SLICING_ENUMERATION_MAX_BLOCKS: 0 }, () => {
      it('leaves the slice count sequential when the enumeration limit is not positive', async () => {
        mockEndpointBlocks(100, 102);

        expect(await resolveSliceCount('0x64', '0x66')).to.equal(CommonService.SEQUENTIAL_SLICE_COUNT);
      });
    });

    it('still reads the slice count off the block itself for a single-block range', async () => {
      restMock.onGet('blocks/100').reply(200, JSON.stringify(block(100, 250, 0)));

      expect(await resolveSliceCount('0x64', '0x64')).to.equal(3);
    });
  });
});
