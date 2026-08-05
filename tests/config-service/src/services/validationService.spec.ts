// SPDX-License-Identifier: Apache-2.0

import chai, { expect } from 'chai';
import chaiAsPromised from 'chai-as-promised';

import type { ConfigKey, ConfigProperty } from '../../../../src/config-service/services/globalConfig';
import { GlobalConfig } from '../../../../src/config-service/services/globalConfig';
import { ValidationService } from '../../../../src/config-service/services/validationService';
import { overrideEnvsInMochaDescribe } from '../../../relay/helpers';

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
      expect(castedEnvs).to.haveOwnProperty('E2E_RELAY_HOST');
      expect(castedEnvs['E2E_RELAY_HOST']).to.equal(GlobalConfig.ENTRIES.E2E_RELAY_HOST.defaultValue);
    });

    it('should skip adding value if it is missing and there is no default value set', async () => {
      const castedEnvs = ValidationService.typeCasting({});
      expect(castedEnvs).to.not.haveOwnProperty('GH_ACCESS_TOKEN');
      expect(castedEnvs['GH_ACCESS_TOKEN']).to.be.undefined;
    });

    it('should to cast string type', async () => {
      const castedEnvs = ValidationService.typeCasting({
        CHAIN_ID: '0x160c',
      });

      expect(castedEnvs['CHAIN_ID']).to.equal('0x160c');
      expect(GlobalConfig.ENTRIES.CHAIN_ID.type).to.equal('string');
    });

    it('should to cast numeric type', async () => {
      const castedEnvs = ValidationService.typeCasting({
        BATCH_REQUESTS_MAX_SIZE: '5644',
      });

      expect(castedEnvs['BATCH_REQUESTS_MAX_SIZE']).to.equal(5644);
      expect(GlobalConfig.ENTRIES.BATCH_REQUESTS_MAX_SIZE.type).to.equal('number');
    });

    it('should to cast boolean type', async () => {
      const castedEnvs = ValidationService.typeCasting({
        BATCH_REQUESTS_ENABLED: 'true',
      });

      expect(castedEnvs['BATCH_REQUESTS_ENABLED']).to.be.true;
      expect(GlobalConfig.ENTRIES.BATCH_REQUESTS_ENABLED.type).to.equal('boolean');
    });

    it('should cast string array type', async () => {
      const castedEnvs = ValidationService.typeCasting({
        BATCH_REQUESTS_DISALLOWED_METHODS: '["method1", "method2"]',
      });

      expect(castedEnvs['BATCH_REQUESTS_DISALLOWED_METHODS']).to.deep.equal(['method1', 'method2']);
      expect(GlobalConfig.ENTRIES.BATCH_REQUESTS_DISALLOWED_METHODS.type).to.equal('strArray');
    });

    it('should cast number array type', async () => {
      const castedEnvs = ValidationService.typeCasting({
        HAPI_CLIENT_ERROR_RESET: '[21, 50]',
      });

      expect(castedEnvs['HAPI_CLIENT_ERROR_RESET']).to.deep.equal([21, 50]);
      expect(GlobalConfig.ENTRIES.HAPI_CLIENT_ERROR_RESET.type).to.equal('numArray');
    });

    it('should handle empty arrays', async () => {
      const castedEnvs = ValidationService.typeCasting({
        ETH_CALL_ACCEPTED_ERRORS: '[]',
      });

      expect(castedEnvs['ETH_CALL_ACCEPTED_ERRORS']).to.deep.equal([]);
      expect(GlobalConfig.ENTRIES.ETH_CALL_ACCEPTED_ERRORS.type).to.equal('numArray');
    });

    it('should use default value for missing array', async () => {
      const castedEnvs = ValidationService.typeCasting({});

      expect(castedEnvs['BATCH_REQUESTS_DISALLOWED_METHODS']).to.deep.equal(
        GlobalConfig.ENTRIES.BATCH_REQUESTS_DISALLOWED_METHODS.defaultValue,
      );
    });
  });

  describe('validate', () => {
    const attached: ConfigKey[] = [];

    const setValidation = (name: ConfigKey, fn: NonNullable<ConfigProperty['validation']>): void => {
      GlobalConfig.ENTRIES[name].validation = fn;
      attached.push(name);
    };

    // rules are attached to the shared GlobalConfig singleton, so always detach them - otherwise a
    // failed assertion leaks a rule into every later test, including other spec files
    afterEach(() => {
      for (const name of attached) {
        delete GlobalConfig.ENTRIES[name].validation;
      }
      attached.length = 0;
    });

    it('should not throw when no entry declares a validation', async () => {
      expect(() => ValidationService.validate(ValidationService.typeCasting({}))).to.not.throw();
    });

    it('should accept the value when the rule returns true', async () => {
      setValidation('CACHE_MAX', (value: number) => value > 0);

      expect(() => ValidationService.validate({ CACHE_MAX: 1000 })).to.not.throw();
    });

    it('should throw the rule message when the rule returns a string', async () => {
      setValidation('CACHE_MAX', () => 'CACHE_MAX must be greater than zero');

      expect(() => ValidationService.validate({ CACHE_MAX: 0 })).to.throw(
        'Configuration error: CACHE_MAX must be greater than zero',
      );
    });

    it('should throw a generic message when the rule returns false', async () => {
      setValidation('CACHE_MAX', () => false);

      expect(() => ValidationService.validate({ CACHE_MAX: 0 })).to.throw(
        'Configuration error: CACHE_MAX failed validation.',
      );
    });

    it('should pass the casted value to the rule rather than the raw string', async () => {
      let received: unknown;
      setValidation('CACHE_MAX', (value: number) => {
        received = value;
        return true;
      });

      ValidationService.validate(ValidationService.typeCasting({ CACHE_MAX: '250' }));

      expect(received).to.equal(250);
    });

    it('should skip entries that resolved to no value', async () => {
      // GH_ACCESS_TOKEN is optional with no default, so it is absent from the casted envs
      setValidation('GH_ACCESS_TOKEN', () => 'this rule must never run');

      expect(() => ValidationService.validate(ValidationService.typeCasting({}))).to.not.throw();
    });

    it('should validate the default value when the env var is absent', async () => {
      setValidation('CACHE_MAX', (value: number) => value !== 1000 || 'the default was validated');

      expect(() => ValidationService.validate(ValidationService.typeCasting({}))).to.throw(
        'Configuration error: the default was validated',
      );
    });

    it('should expose every casted entry so a rule can constrain against another entry', async () => {
      setValidation(
        'WORKERS_POOL_MIN_THREADS',
        (value: number, envs) => value <= envs.WORKERS_POOL_MAX_THREADS || 'min threads must not exceed max threads',
      );

      expect(() => ValidationService.validate({ WORKERS_POOL_MIN_THREADS: 10, WORKERS_POOL_MAX_THREADS: 4 })).to.throw(
        'Configuration error: min threads must not exceed max threads',
      );

      // the accepting case is what catches a misspelled key inside the rule: with a typo the
      // comparison runs against undefined and this valid pair would be rejected as well
      expect(() =>
        ValidationService.validate({ WORKERS_POOL_MIN_THREADS: 2, WORKERS_POOL_MAX_THREADS: 4 }),
      ).to.not.throw();
    });

    it('should fail fast without evaluating later rules', async () => {
      // GlobalConfig.ENTRIES is iterated in declaration order, where CACHE_MAX precedes
      // WS_SUBSCRIPTION_LIMIT, so the first rule below is reached first
      let laterRuleRan = false;
      setValidation('CACHE_MAX', () => 'the first rejection');
      setValidation('WS_SUBSCRIPTION_LIMIT', () => {
        laterRuleRan = true;
        return true;
      });

      expect(() => ValidationService.validate({ CACHE_MAX: 0, WS_SUBSCRIPTION_LIMIT: 10 })).to.throw(
        'Configuration error: the first rejection',
      );
      expect(laterRuleRan).to.be.false;
    });
  });
});
