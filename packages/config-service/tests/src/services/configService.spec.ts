// SPDX-License-Identifier: Apache-2.0

import chai, { expect } from 'chai';
import chaiAsPromised from 'chai-as-promised';

import { LoggerService } from '../../../dist/services/loggerService';
import { ConfigService } from '../../../src/services';
import { type ConfigKey, GlobalConfig } from '../../../src/services/globalConfig';

chai.use(chaiAsPromised);

describe('ConfigService tests', async function () {
  it('should log warning when .env is missing', async () => {
    // save current env
    const envBefore = process.env;
    process.env = {};

    // fake invalid env file
    // @ts-expect-error: The operand of a 'delete' operator must be optional
    delete ConfigService.instance;
    // @ts-expect-error: Property 'envFileName' is private and only accessible within class 'ConfigService'
    ConfigService.envFileName = 'invalid';

    // @ts-expect-error: Property 'getInstance' is private and only accessible within class 'ConfigService'
    expect(() => ConfigService.getInstance()).to.throw(
      /Configuration error: [A-Z_]+ is a mandatory configuration for relay operation./,
    );

    // reset normal behaviour
    // @ts-expect-error: The operand of a 'delete' operator must be optional
    delete ConfigService.instance;
    // @ts-expect-error: Property 'envFileName' is private and only accessible within class 'ConfigService'
    ConfigService.envFileName = '.env';

    process.env = envBefore;
  });

  [
    { OPERATOR_ID_MAIN: undefined, OPERATOR_KEY_MAIN: '0x1234567890' },
    { OPERATOR_ID_MAIN: '0.0.123', OPERATOR_KEY_MAIN: undefined },
  ].forEach((env) => {
    const key = env.OPERATOR_ID_MAIN === undefined ? 'OPERATOR_ID_MAIN' : 'OPERATOR_KEY_MAIN';
    it(`should prevent the Relay from starting when \`${key}\` is missing in Read-Write mode`, async () => {
      const envBefore = process.env;
      process.env = { ...process.env, READ_ONLY: 'false', ...env };

      // @ts-expect-error: The operand of a 'delete' operator must be optional
      delete ConfigService.instance;

      expect(() => ConfigService.get(undefined as unknown as ConfigKey)).to.throw(
        `Configuration error: ${key} is mandatory for Relay operations in Read-Write mode.`,
      );

      // @ts-expect-error: The operand of a 'delete' operator must be optional
      delete ConfigService.instance;
      process.env = envBefore;
    });

    it(`should start the Relay even when \`${key}\` is missing in Read-Only mode`, async () => {
      const envBefore = process.env;
      process.env = { ...process.env, READ_ONLY: 'true', ...env };

      // @ts-expect-error: The operand of a 'delete' operator must be optional
      delete ConfigService.instance;

      expect(ConfigService.get('READ_ONLY')).to.be.true;

      // @ts-expect-error: The operand of a 'delete' operator must be optional
      delete ConfigService.instance;
      process.env = envBefore;
    });
  });

  it('should be able to get existing env var', async () => {
    const res = ConfigService.get('CHAIN_ID');
    expect(res).to.equal('0x12a');
  });

  it('should return undefined for non-existing variable', async () => {
    const res = ConfigService.get('NON_EXISTING_VAR' as ConfigKey);
    expect(res).to.equal(undefined);
  });

  it('should return the default value for configurations not set in process.env', async () => {
    const targetKey = 'FILE_APPEND_MAX_CHUNKS';
    const envValue = process.env[targetKey];

    // ensure the key is not listed in env
    expect(envValue).to.be.undefined;

    const expectedDefaultValue = GlobalConfig.ENTRIES[targetKey].defaultValue;

    const res = ConfigService.get(targetKey);
    expect(res).to.equal(expectedDefaultValue);
  });

  it('should infer the explicit type for configuration which is either required or has a valid defaultValue', () => {
    const targetKeys = [
      'FILE_APPEND_MAX_CHUNKS',
      'GET_RECORD_DEFAULT_TO_CONSENSUS_NODE',
      'E2E_RELAY_HOST',
      'ETH_CALL_ACCEPTED_ERRORS',
    ] as const;

    targetKeys.forEach((targetKey) => {
      const result = ConfigService.get(targetKey);
      const expectedTypeString = GlobalConfig.ENTRIES[targetKey].type;

      switch (expectedTypeString) {
        case 'number':
          expect(typeof result === 'number').to.be.true;
          break;
        case 'boolean':
          expect(typeof result === 'boolean').to.be.true;
          break;
        case 'string':
          expect(typeof result === 'string').to.be.true;
          break;
      }
    });
  });

  it('Should always convert CHAIN_ID to a hexadecimal string, regardless of input value type.', async () => {
    const originalEnv = process.env;

    const testChainId = (input: string, expected: string) => {
      process.env = { ...originalEnv, CHAIN_ID: input };
      // Reset the ConfigService singleton instance to force a new initialization
      // This is necessary because ConfigService caches the env values when first instantiated,
      // so we need to clear that cache to test with our new CHAIN_ID value
      // @ts-expect-error: The operand of a 'delete' operator must be optional
      delete ConfigService.instance;
      expect(ConfigService.get('CHAIN_ID')).to.equal(expected);
    };

    try {
      // Test cases
      testChainId('298', '0x12a'); // decimal number
      testChainId('0x12a', '0x12a'); // hexadecimal with prefix
      testChainId('1000000', '0xf4240'); // larger number
      testChainId('0xhedera', '0xNaN'); // invalid number
    } finally {
      process.env = originalEnv;
      // @ts-expect-error: The operand of a 'delete' operator must be optional
      delete ConfigService.instance;
    }
  });

  it('should be able to execute getAllMasked', async () => {
    const envs = ConfigService.getAllMasked();
    expect(envs).to.not.be.empty;

    for (const sensitiveField of LoggerService.SENSITIVE_FIELDS) {
      if (envs[sensitiveField]) {
        expect(envs[sensitiveField]).to.equal('**********');
      }
    }
  });
});
