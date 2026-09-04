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

    it('should fail fast if a numeric env has an invalid number format', async () => {
      expect(() =>
        ValidationService.startUp({
          ...mandatoryStartUpFields,
          SERVER_PORT: 'lorem_ipsum',
        }),
      ).to.throw('Configuration error: SERVER_PORT must be a valid number.');
    });

    it('should not reject a numeric env that was left empty', async () => {
      // `typeCasting` falls back to the declared default, so there is nothing to type-check
      expect(() =>
        ValidationService.startUp({
          ...mandatoryStartUpFields,
          SERVER_PORT: '',
        }),
      ).to.not.throw();
    });

    it('should validate string array type', async () => {
      expect(() =>
        ValidationService.startUp({
          ...mandatoryStartUpFields,
          BATCH_REQUESTS_DISALLOWED_METHODS: 'not-an-array',
        }),
      ).to.throw('Configuration error: BATCH_REQUESTS_DISALLOWED_METHODS must be a valid JSON string.');
    });

    it('should validate number array type', async () => {
      expect(() =>
        ValidationService.startUp({
          ...mandatoryStartUpFields,
          HAPI_CLIENT_ERROR_RESET: 'not-an-array',
        }),
      ).to.throw('Configuration error: HAPI_CLIENT_ERROR_RESET must be a valid JSON string.');
    });

    it('should correctly detect if a string is valid JSON but not a valid JSON array', async () => {
      expect(() =>
        ValidationService.startUp({
          ...mandatoryStartUpFields,
          BATCH_REQUESTS_DISALLOWED_METHODS: '{"foo": "bar"}',
        }),
      ).to.throw('Configuration error: BATCH_REQUESTS_DISALLOWED_METHODS must be a valid JSON array.');
    });

    it('should validate string array content', async () => {
      expect(() =>
        ValidationService.startUp({
          ...mandatoryStartUpFields,
          BATCH_REQUESTS_DISALLOWED_METHODS: '["test", 123]',
        }),
      ).to.throw('Configuration error: BATCH_REQUESTS_DISALLOWED_METHODS must contain only strings.');
    });

    it('should validate number array content', async () => {
      expect(() =>
        ValidationService.startUp({
          ...mandatoryStartUpFields,
          HAPI_CLIENT_ERROR_RESET: '["method1", 456]',
        }),
      ).to.throw('Configuration error: HAPI_CLIENT_ERROR_RESET must contain only numbers.');
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

  describe('validate how rules are applied', () => {
    // Each case passes its own entry metadata, so these never touch GlobalConfig and stay valid
    // however the shipped rules change.
    const entry = (validation: NonNullable<ConfigProperty['validation']>): ConfigProperty => ({
      type: 'number',
      required: false,
      defaultValue: null,
      validation,
    });

    it('should accept the defaults of every entry that declares a rule', async () => {
      expect(() => ValidationService.validate(ValidationService.typeCasting({}))).to.not.throw();
    });

    it('should accept the value when the rule returns true', async () => {
      expect(() => ValidationService.validate({ A: 1000 }, { A: entry((value: number) => value > 0) })).to.not.throw();
    });

    it('should throw the rule message when the rule returns a string', async () => {
      expect(() => ValidationService.validate({ A: 0 }, { A: entry(() => 'A must be greater than zero') })).to.throw(
        'Configuration error: A must be greater than zero',
      );
    });

    it('should throw a generic message naming the entry when the rule returns false', async () => {
      expect(() => ValidationService.validate({ A: 0 }, { A: entry(() => false) })).to.throw(
        'Configuration error: A failed validation.',
      );
    });

    it('should pass the casted value to the rule rather than the raw string', async () => {
      let received: unknown;
      const casted = ValidationService.typeCasting({ CACHE_MAX: '250' });

      ValidationService.validate(casted, {
        CACHE_MAX: entry((value: number) => {
          received = value;
          return true;
        }),
      });

      expect(received).to.equal(250);
    });

    it('should skip entries that resolved to no value', async () => {
      expect(() => ValidationService.validate({}, { A: entry(() => 'this rule must never run') })).to.not.throw();
    });

    it('should validate the default value when the env var is absent', async () => {
      // typeCasting fills CACHE_MAX in from its declared default of 1000, and the rule below rejects
      // exactly that, so reaching the throw proves defaults are validated and not just skipped
      expect(() =>
        ValidationService.validate(ValidationService.typeCasting({}), {
          CACHE_MAX: entry((value: number) => value !== 1000 || 'the default was validated'),
        }),
      ).to.throw('Configuration error: the default was validated');
    });

    it('should expose every casted entry so a rule can constrain against another entry', async () => {
      const entries = {
        MIN: entry((value: number, envs) => value <= envs.MAX || 'MIN must not exceed MAX'),
      };

      expect(() => ValidationService.validate({ MIN: 10, MAX: 4 }, entries)).to.throw(
        'Configuration error: MIN must not exceed MAX',
      );

      // the accepting case is what catches a misspelled key inside the rule: with a typo the
      // comparison runs against undefined and this valid pair would be rejected as well
      expect(() => ValidationService.validate({ MIN: 2, MAX: 4 }, entries)).to.not.throw();
    });

    it('should fail fast without evaluating later rules', async () => {
      let laterRuleRan = false;
      const entries = {
        FIRST: entry(() => 'the first rejection'),
        SECOND: entry(() => {
          laterRuleRan = true;
          return true;
        }),
      };

      expect(() => ValidationService.validate({ FIRST: 0, SECOND: 10 }, entries)).to.throw(
        'Configuration error: the first rejection',
      );
      expect(laterRuleRan).to.be.false;
    });
  });

  describe('validate rules declared in GlobalConfig', () => {
    const CASES: ReadonlyArray<{
      key: ConfigKey;
      accept: readonly number[];
      reject: readonly number[];
    }> = [
      {
        key: 'INPUT_SIZE_LIMIT',
        accept: [0.5, 1, 128],
        reject: [0, -1, NaN],
      },
      {
        key: 'WS_INPUT_SIZE_LIMIT',
        accept: [-1, 1, 5, 1024],
        reject: [0, -2, -0.5, NaN],
      },
      {
        key: 'MIRROR_NODE_TIMESTAMP_SLICING_MAX_LOGS_PER_SLICE',
        accept: [1, 100, 5000],
        reject: [0, -5, NaN],
      },
      {
        key: 'MIRROR_NODE_HTTP_MAX_SOCKETS',
        accept: [1, 300],
        reject: [0, -1, 1.5, NaN],
      },
    ];

    CASES.forEach(({ key, accept, reject }) => {
      it(`should accept and reject the documented values for ${key}`, async () => {
        accept.forEach((value) =>
          expect(
            () => ValidationService.validate({ [key]: value }),
            `${key}=${value} should be accepted`,
          ).to.not.throw(),
        );

        reject.forEach((value) =>
          expect(() => ValidationService.validate({ [key]: value }), `${key}=${value} should be rejected`).to.throw(
            `Configuration error: ${key}`,
          ),
        );
      });
    });

    it('should cover every entry that declares a validation', async () => {
      const covered = new Set<string>(CASES.map(({ key }) => key));
      const uncovered = (Object.keys(GlobalConfig.ENTRIES) as ConfigKey[]).filter(
        (key) => GlobalConfig.ENTRIES[key].validation != null && !covered.has(key),
      );

      expect(uncovered, 'entries declaring a validation with no row in CASES').to.deep.equal([]);
    });
  });
});
