// SPDX-License-Identifier: Apache-2.0

import chai, { expect } from 'chai';
import chaiAsPromised from 'chai-as-promised';

import { overrideEnvsInMochaDescribe } from '../../../../relay/tests/helpers';
import { GlobalConfig } from '../../../dist/services/globalConfig';
import { ValidationService } from '../../../dist/services/validationService';

chai.use(chaiAsPromised);

describe('ValidationService tests', async function () {
  describe('startUp', () => {
    const mandatoryStartUpFields = {
      CHAIN_ID: '0x12a',
      HEDERA_NETWORK: '{"127.0.0.1:50211":"0.0.3"}',
      MIRROR_NODE_URL: 'http://127.0.0.1:5551',
      npm_package_version: '1.0.0',
      OPERATOR_ID_MAIN: '0.0.1002',
      OPERATOR_KEY_MAIN:
        '302000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
      SERVER_PORT: '7546',
    };

    it('should fail fast if mandatory env is not passed', async () => {
      expect(() => ValidationService.startUp({})).to.throw(
        'Configuration error: CHAIN_ID is a mandatory configuration for relay operation.',
      );
    });

    it('should fail fast if mandatory env is invalid number format', async () => {
      GlobalConfig.ENTRIES.SERVER_PORT.required = true;
      expect(() =>
        ValidationService.startUp({
          ...mandatoryStartUpFields,
          SERVER_PORT: 'lorem_ipsum',
        }),
      ).to.throw('SERVER_PORT must be a valid number.');
      GlobalConfig.ENTRIES.SERVER_PORT.required = false;
    });

    it('should validate string array type', async () => {
      GlobalConfig.ENTRIES.BATCH_REQUESTS_DISALLOWED_METHODS.required = true;
      expect(() =>
        ValidationService.startUp({
          ...mandatoryStartUpFields,
          BATCH_REQUESTS_DISALLOWED_METHODS: 'not-an-array',
        }),
      ).to.throw('Configuration error: BATCH_REQUESTS_DISALLOWED_METHODS must be a valid JSON string.');
      GlobalConfig.ENTRIES.BATCH_REQUESTS_DISALLOWED_METHODS.required = false;
    });

    it('should validate number array type', async () => {
      GlobalConfig.ENTRIES.HAPI_CLIENT_ERROR_RESET.required = true;
      expect(() =>
        ValidationService.startUp({
          ...mandatoryStartUpFields,
          HAPI_CLIENT_ERROR_RESET: 'not-an-array',
        }),
      ).to.throw('Configuration error: HAPI_CLIENT_ERROR_RESET must be a valid JSON string.');
    });

    it('should correctly detect if a string is valid JSON but not a valid JSON array', async () => {
      GlobalConfig.ENTRIES.BATCH_REQUESTS_DISALLOWED_METHODS.required = true;
      expect(() =>
        ValidationService.startUp({
          ...mandatoryStartUpFields,
          BATCH_REQUESTS_DISALLOWED_METHODS: '{"foo": "bar"}',
        }),
      ).to.throw('Configuration error: BATCH_REQUESTS_DISALLOWED_METHODS must be a valid JSON array.');
      GlobalConfig.ENTRIES.BATCH_REQUESTS_DISALLOWED_METHODS.required = false;
    });

    it('should validate string array content', async () => {
      GlobalConfig.ENTRIES.BATCH_REQUESTS_DISALLOWED_METHODS.required = true;
      expect(() =>
        ValidationService.startUp({
          ...mandatoryStartUpFields,
          BATCH_REQUESTS_DISALLOWED_METHODS: '["test", 123]',
        }),
      ).to.throw('Configuration error: BATCH_REQUESTS_DISALLOWED_METHODS must contain only strings.');
      GlobalConfig.ENTRIES.BATCH_REQUESTS_DISALLOWED_METHODS.required = false;
    });

    it('should validate number array content', async () => {
      GlobalConfig.ENTRIES.HAPI_CLIENT_ERROR_RESET.required = true;
      expect(() =>
        ValidationService.startUp({
          ...mandatoryStartUpFields,
          HAPI_CLIENT_ERROR_RESET: '["method1", 456]',
        }),
      ).to.throw('Configuration error: HAPI_CLIENT_ERROR_RESET must contain only numbers.');
      GlobalConfig.ENTRIES.HAPI_CLIENT_ERROR_RESET.required = false;
    });
  });

  describe('package-version', () => {
    overrideEnvsInMochaDescribe({
      npm_package_version: undefined,
    });

    const mandatoryStartUpFields = {
      CHAIN_ID: '0x12a',
      HEDERA_NETWORK: '{"127.0.0.1:50211":"0.0.3"}',
      MIRROR_NODE_URL: 'http://127.0.0.1:5551',
      OPERATOR_ID_MAIN: '0.0.1002',
      OPERATOR_KEY_MAIN:
        '302000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
      SERVER_PORT: '7546',
    };

    it('should fail fast if npm_package_version is not set', async () => {
      expect(() =>
        ValidationService.startUp({
          ...mandatoryStartUpFields,
        }),
      ).to.throw('Configuration error: npm_package_version is a mandatory configuration for relay operation.');
    });
  });

  describe('typeCasting', () => {
    it('should be able to use default value for missing env if default value is set', async () => {
      const castedEnvs = ValidationService.typeCasting({});
      expect(castedEnvs).to.haveOwnProperty(GlobalConfig.ENTRIES.E2E_RELAY_HOST.envName);
      expect(castedEnvs[GlobalConfig.ENTRIES.E2E_RELAY_HOST.envName]).to.equal(
        GlobalConfig.ENTRIES.E2E_RELAY_HOST.defaultValue,
      );
    });

    it('should skip adding value if it is missing and there is no default value set', async () => {
      const castedEnvs = ValidationService.typeCasting({});
      expect(castedEnvs).to.not.haveOwnProperty(GlobalConfig.ENTRIES.GH_ACCESS_TOKEN.envName);
      expect(castedEnvs[GlobalConfig.ENTRIES.GH_ACCESS_TOKEN.envName]).to.be.undefined;
    });

    it('should to cast string type', async () => {
      const castedEnvs = ValidationService.typeCasting({
        [GlobalConfig.ENTRIES.CHAIN_ID.envName]: '0x160c',
      });

      expect(castedEnvs[GlobalConfig.ENTRIES.CHAIN_ID.envName]).to.equal('0x160c');
      expect(GlobalConfig.ENTRIES.CHAIN_ID.type).to.equal('string');
    });

    it('should to cast numeric type', async () => {
      const castedEnvs = ValidationService.typeCasting({
        [GlobalConfig.ENTRIES.BATCH_REQUESTS_MAX_SIZE.envName]: '5644',
      });

      expect(castedEnvs[GlobalConfig.ENTRIES.BATCH_REQUESTS_MAX_SIZE.envName]).to.equal(5644);
      expect(GlobalConfig.ENTRIES.BATCH_REQUESTS_MAX_SIZE.type).to.equal('number');
    });

    it('should to cast boolean type', async () => {
      const castedEnvs = ValidationService.typeCasting({
        [GlobalConfig.ENTRIES.BATCH_REQUESTS_ENABLED.envName]: 'true',
      });

      expect(castedEnvs[GlobalConfig.ENTRIES.BATCH_REQUESTS_ENABLED.envName]).to.be.true;
      expect(GlobalConfig.ENTRIES.BATCH_REQUESTS_ENABLED.type).to.equal('boolean');
    });

    it('should cast string array type', async () => {
      const castedEnvs = ValidationService.typeCasting({
        [GlobalConfig.ENTRIES.BATCH_REQUESTS_DISALLOWED_METHODS.envName]: '["method1", "method2"]',
      });

      expect(castedEnvs[GlobalConfig.ENTRIES.BATCH_REQUESTS_DISALLOWED_METHODS.envName]).to.deep.equal([
        'method1',
        'method2',
      ]);
      expect(GlobalConfig.ENTRIES.BATCH_REQUESTS_DISALLOWED_METHODS.type).to.equal('strArray');
    });

    it('should cast number array type', async () => {
      const castedEnvs = ValidationService.typeCasting({
        [GlobalConfig.ENTRIES.HAPI_CLIENT_ERROR_RESET.envName]: '[21, 50]',
      });

      expect(castedEnvs[GlobalConfig.ENTRIES.HAPI_CLIENT_ERROR_RESET.envName]).to.deep.equal([21, 50]);
      expect(GlobalConfig.ENTRIES.HAPI_CLIENT_ERROR_RESET.type).to.equal('numArray');
    });

    it('should handle empty arrays', async () => {
      const castedEnvs = ValidationService.typeCasting({
        [GlobalConfig.ENTRIES.ETH_CALL_ACCEPTED_ERRORS.envName]: '[]',
      });

      expect(castedEnvs[GlobalConfig.ENTRIES.ETH_CALL_ACCEPTED_ERRORS.envName]).to.deep.equal([]);
      expect(GlobalConfig.ENTRIES.ETH_CALL_ACCEPTED_ERRORS.type).to.equal('numArray');
    });

    it('should use default value for missing array', async () => {
      const castedEnvs = ValidationService.typeCasting({});

      expect(castedEnvs[GlobalConfig.ENTRIES.BATCH_REQUESTS_DISALLOWED_METHODS.envName]).to.deep.equal(
        GlobalConfig.ENTRIES.BATCH_REQUESTS_DISALLOWED_METHODS.defaultValue,
      );
    });
  });
});
