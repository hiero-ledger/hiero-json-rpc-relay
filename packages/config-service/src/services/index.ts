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
    const configEntry = GlobalConfig.ENTRIES[name];
    let value = this.getInstance().envs[name] == undefined ? configEntry?.defaultValue : this.getInstance().envs[name];

    if (value == undefined && configEntry?.required) {
      throw new Error(`Configuration error: ${name} is a mandatory configuration for relay operation.`);
    }

    if (name === 'CHAIN_ID' && value !== undefined) {
      value = `0x${Number(value).toString(16)}`;
    }

    return value as GetTypeOfConfigKey<K>;
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
}
