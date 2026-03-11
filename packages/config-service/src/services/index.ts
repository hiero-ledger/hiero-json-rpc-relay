// SPDX-License-Identifier: Apache-2.0

import dotenv from 'dotenv';
import findConfig from 'find-config';
import pino from 'pino';

import type { ConfigKey, GetTypeOfConfigKey } from './globalConfig';
import { GlobalConfig } from './globalConfig';
import { LoggerService } from './loggerService';
import { ValidationService } from './validationService';

const mainLogger = pino({
  name: 'hedera-json-rpc-relay',
  transport: {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: true,
    },
  },
});
const logger = mainLogger.child({ name: 'config-service' });

export class ConfigService {
  /**
   * @private
   */
  private static readonly envFileName: string = '.env';

  /**
   * The singleton instance
   * @public
   */
  private static instance: ConfigService;

  /**
   * Copied envs from process.env
   * @private
   */
  private readonly envs: NodeJS.ReadOnlyDict<string>;

  /**
   * Fetches all envs from process.env and pushes them into the envs property
   * @private
   */
  private constructor() {
    const configPath = findConfig(ConfigService.envFileName);

    if (configPath) {
      dotenv.config({ path: configPath });
    } else {
      logger.warn('No .env file is found. The relay cannot operate without valid .env.');
    }

    // validate mandatory fields
    ValidationService.startUp(process.env);

    // transform string representations of env vars into proper types
    this.envs = ValidationService.typeCasting(process.env);

    // printing current env variables, masking up sensitive information
    for (const name in this.envs) {
      logger.info(LoggerService.maskUpEnv(name, this.envs[name]));
    }

    this.validateReadOnlyMode();

    this.validatePaymasterAccounts();

    // note: temporary bandage solution
    // should be replaced after https://github.com/hiero-ledger/hiero-json-rpc-relay/issues/4840 is implemented
    if (this.get('MIRROR_NODE_TIMESTAMP_SLICING_MAX_LOGS_PER_SLICE') === 0) {
      throw new Error('MIRROR_NODE_TIMESTAMP_SLICING_MAX_LOGS_PER_SLICE cannot be zero.');
    }
  }

  /**
   * Get the singleton instance of the current service
   * @public
   */
  private static getInstance(): ConfigService {
    if (this.instance == null) {
      this.instance = new ConfigService();
    }

    return this.instance;
  }

  /**
   * Retrieves the value of a specified configuration property using its key name.
   *
   * The method incorporates validation to ensure required configuration values are provided.
   *
   * **Note:** The validations in this method, in addition to the `ValidationService.startUp(process.env)` in the constructor, are crucial
   * as this method is frequently invoked in testing environments where configuration values might be dynamically
   * overridden. Additionally, since this method is the most exposed method across different packages, serving as the
   * main gateway for accessing configurations, these validations help strengthen security and prevent undefined
   * behavior in both production and testing scenarios.
   *
   * For the CHAIN_ID key, the value is converted to a hexadecimal format prefixed with '0x'.
   *
   * @param name - The configuration key to retrieve.
   * @typeParam K - The specific type parameter representing the ConfigKey.
   * @returns The value associated with the specified key, or the default value from its GlobalConfig entry, properly typed based on the key's configuration.
   * @throws Error if a required configuration value is missing.
   */
  public static get<K extends ConfigKey>(name: K): GetTypeOfConfigKey<K> {
    return this.getInstance().get(name);
  }

  /**
   * Retrieves all environment variables and masks the sensitive ones.
   *
   * @returns Dict<string>
   */
  public static getAllMasked(): NodeJS.Dict<string> {
    const maskedEnvs: NodeJS.Dict<string> = {};
    for (const name in this.getInstance().envs) {
      const maskedAsText = LoggerService.maskUpEnv(name, this.getInstance().envs[name]);
      const parsedEnv = maskedAsText.split(' = ');
      maskedEnvs[parsedEnv[0]] = parsedEnv[1];
    }

    return maskedEnvs;
  }

  private validateReadOnlyMode() {
    const vars = ['OPERATOR_ID_MAIN', 'OPERATOR_KEY_MAIN'] as const;
    if (this.get('READ_ONLY')) {
      logger.info('Relay is in READ_ONLY mode. It will not send transactions.');
      vars.forEach((varName) => {
        if (this.get(varName)) {
          logger.warn(
            `Relay is in READ_ONLY mode, but ${varName} is set. The Relay will not be able to send transactions.`,
          );
        }
      });
    } else {
      vars.forEach((varName) => {
        if (!this.get(varName)) {
          throw new Error(`Configuration error: ${varName} is mandatory for Relay operations in Read-Write mode.`);
        }
      });
    }
  }

  private validatePaymasterAccounts() {
    const paymasterAccounts = this.get('PAYMASTER_ACCOUNTS');
    if (!paymasterAccounts.length) {
      return;
    }

    // regex for realm.shard.num
    const accountIdRegex: RegExp = /^\d+\.\d+\.\d+$/;
    // regex for 32 bytes 0x prefixed private key
    const hexKeyRegex: RegExp = /^0x[a-fA-F0-9]{64}$/;
    // regex for DER encoded private keys handling both:
    // - ECDSA (50 bytes) - curve OID + ec private key structure + optional public key
    // - Ed25519 (48 bytes) - simpler ASN.1, no curve parameters
    const derKeyRegex = /^(?:[a-fA-F0-9]{96}|[a-fA-F0-9]{100})$/;
    paymasterAccounts.forEach((entry, i) => {
      if (!Array.isArray(entry) || entry.length !== 4) {
        throw new Error(`PAYMASTER_ACCOUNTS: Entry ${i} must be an array of 4 elements`);
      }
      const [accountId, keyType, privateKey, allowanceInHBAR] = entry;

      // account id in format realm.shard.num
      if (!accountIdRegex.test(accountId)) {
        throw new Error(
          `PAYMASTER_ACCOUNTS: Entry ${i}: invalid account id format, required format is realm.shard.num`,
        );
      }

      // key type
      if (!['HEX_ECDSA', 'HEX_ED25519'].includes(keyType)) {
        throw new Error(`PAYMASTER_ACCOUNTS: Entry ${i}: key type must be HEX_ECDSA or HEX_ED25519`);
      }

      // 0x prefixed hex or der private key
      if (!hexKeyRegex.test(privateKey) && !derKeyRegex.test(privateKey)) {
        throw new Error(
          `PAYMASTER_ACCOUNTS: Entry ${i}: invalid private key format, it must be 0x prefixed hex or der encoded (48 or 50 bytes)`,
        );
      }

      // allowanceInHBAR as integer
      const w = Number(allowanceInHBAR);
      if (!Number.isInteger(w) || w < 1) {
        throw new Error(`PAYMASTER_ACCOUNTS: Entry ${i}: allowanceInHBAR must be an integer >= 1`);
      }
    });
  }

  private get<K extends ConfigKey>(name: K): GetTypeOfConfigKey<K> {
    const configEntry = GlobalConfig.ENTRIES[name];
    let value = this.envs[name] == undefined ? configEntry?.defaultValue : this.envs[name];

    if (value == undefined && configEntry?.required) {
      throw new Error(`Configuration error: ${name} is a mandatory configuration for relay operation.`);
    }

    if (name === 'CHAIN_ID' && value !== undefined) {
      value = `0x${Number(value).toString(16)}`;
    }

    return value as GetTypeOfConfigKey<K>;
  }
}
