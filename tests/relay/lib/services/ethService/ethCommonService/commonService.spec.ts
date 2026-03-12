// SPDX-License-Identifier: Apache-2.0

import { expect } from 'chai';
import sinon from 'sinon';

import { prepend0x } from '../../../../../../dist/relay/formatters';
import { CommonService } from '../../../../../../dist/relay/lib/services';
import { ConfigService } from '../../../../../../src/config-service/services';

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
});
