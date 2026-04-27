// SPDX-License-Identifier: Apache-2.0

import { GlobalConfig } from './globalConfig';

export class ValidationService {
  /**
   * Validate mandatory fields on start-up
   * @param envs
   */
  static startUp(envs: NodeJS.Dict<string>): void {
    // validate mandatory fields and their types
    Object.entries(GlobalConfig.ENTRIES).forEach(([entryName, entryInfo]) => {
      if (entryInfo.required) {
        if (!Object.prototype.hasOwnProperty.call(envs, entryName)) {
          throw new Error(`Configuration error: ${entryName} is a mandatory configuration for relay operation.`);
        }

        if (entryInfo.type === 'number' && isNaN(Number(envs[entryName]))) {
          throw new Error(`Configuration error: ${entryName} must be a valid number.`);
        }

        if ((entryInfo.type === 'strArray' || entryInfo.type === 'numArray') && envs[entryName]) {
          try {
            const parsed = JSON.parse(envs[entryName] as string);

            if (!Array.isArray(parsed)) {
              throw new Error(`Configuration error: ${entryName} must be a valid JSON array.`);
            }

            const isCorrectType =
              entryInfo.type === 'numArray'
                ? parsed.every((item) => typeof item === 'number')
                : parsed.every((item) => typeof item === 'string');

            if (!isCorrectType) {
              const expectedType = entryInfo.type === 'numArray' ? 'numbers' : 'strings';
              throw new Error(`Configuration error: ${entryName} must contain only ${expectedType}.`);
            }
          } catch (e) {
            if (e instanceof SyntaxError) {
              throw new Error(`Configuration error: ${entryName} must be a valid JSON string.`);
            }
            throw e;
          }
        }
      }
    });
  }

  /**
   * Transform string environment variables to their proper types based on GlobalConfig.ENTRIES.
   * For each entry:
   * - If the env var is missing but has a default value, use the default
   * - For 'number' type, converts to Number
   * - For 'boolean' type, converts 'true' string to true boolean
   * - For 'numArray' or 'strArray' types, parses JSON string to array
   * - For 'string' type, keeps as string
   *
   * @param envs - Dictionary of environment variables and their string values
   * @returns Dictionary with environment variables cast to their proper types
   */
  static typeCasting(envs: NodeJS.Dict<string>): NodeJS.Dict<any> {
    const typeCastedEnvs: NodeJS.Dict<any> = {};

    Object.entries(GlobalConfig.ENTRIES).forEach(([entryName, entryInfo]) => {
      if (!Object.prototype.hasOwnProperty.call(envs, entryName)) {
        if (entryInfo.defaultValue != null) {
          typeCastedEnvs[entryName] = entryInfo.defaultValue;
        }
        return;
      }

      switch (entryInfo.type) {
        case 'number':
          typeCastedEnvs[entryName] = Number(envs[entryName]);
          break;
        case 'boolean':
          typeCastedEnvs[entryName] = envs[entryName] === 'true';
          break;
        case 'numArray':
        case 'strArray':
          typeCastedEnvs[entryName] = JSON.parse(envs[entryName] || '[]');
          break;
        default:
          // handle "string" type
          typeCastedEnvs[entryName] = envs[entryName];
      }
    });

    return typeCastedEnvs;
  }
}
