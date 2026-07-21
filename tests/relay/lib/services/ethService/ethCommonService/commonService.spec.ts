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
import { getLogs as runGetLogsWorker } from '../../../../../../src/relay/lib/services/ethService/ethCommonService/commonWorker';
import { type IWorkerContext } from '../../../../../../src/relay/lib/services/workersService/workerContext';
import { WorkersPool } from '../../../../../../src/relay/lib/services/workersService/WorkersPool';
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

  describe('getLogs address cap', () => {
    const requestDetails = new RequestDetails({ requestId: 'test-request-id', ipAddress: '0.0.0.0' });

    let commonService: CommonService;

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
      commonService = new CommonService(mirrorNodeClient, logger, cacheService);
    });

    afterEach(() => {
      sinon.restore();
    });

    withOverriddenEnvsInMochaTest({ MAX_ADDRESSES_PER_REQUEST: 2 }, () => {
      it('rejects before any Mirror Node fan-out when the address count exceeds the cap', async () => {
        const workerRun = sinon.stub(WorkersPool, 'run');

        await expect(
          commonService.getLogs(null, '0x0', 'latest', ['0xa', '0xb', '0xc'], null, requestDetails),
        ).to.be.rejected.and.eventually.satisfy((err) => err.code === predefined.INVALID_PARAMETER('address', '').code);
        expect(workerRun.notCalled).to.equal(true, 'worker must not be dispatched once the cap is exceeded');
      });

      it('dispatches to the worker when the address count is at the cap', async () => {
        const workerRun = sinon.stub(WorkersPool, 'run').resolves([]);

        await commonService.getLogs(null, '0x0', 'latest', ['0xa', '0xb'], null, requestDetails);
        expect(workerRun.calledOnce).to.equal(true);
      });

      it('re-checks at the worker entry, before touching the common service', async () => {
        // Defense-in-depth: the worker is a second entry point, so the guard must fire before any commonService call.
        const validateBlockRange = sinon.stub();
        const ctx = {
          commonService: { validateBlockRangeAndAddTimestampToParams: validateBlockRange },
        } as unknown as IWorkerContext;

        await expect(
          runGetLogsWorker(ctx, null, '0x0', 'latest', ['0xa', '0xb', '0xc'], null, requestDetails),
        ).to.be.rejected.and.eventually.satisfy((err) => err.code === predefined.INVALID_PARAMETER('address', '').code);
        expect(validateBlockRange.notCalled).to.equal(
          true,
          'block-range validation must not run once the cap is exceeded',
        );
      });
    });
  });
});
