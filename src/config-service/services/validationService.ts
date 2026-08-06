// SPDX-License-Identifier: Apache-2.0

import { type ConfigProperty, GlobalConfig } from './globalConfig';

export class ValidationService {
  /**
   * Validate mandatory fields on start-up, and the declared type of every entry the operator
   * actually set a value for.
   * @param envs
   */
  static startUp(envs: NodeJS.Dict<string>): void {
    Object.entries(GlobalConfig.ENTRIES).forEach(([entryName, entryInfo]) => {
      if (entryInfo.required && !Object.prototype.hasOwnProperty.call(envs, entryName)) {
        throw new Error(`Configuration error: ${entryName} is a mandatory configuration for relay operation.`);
      }

      const rawValue = envs[entryName];

      if (rawValue == null || rawValue === '') {
        return;
      }

      if (entryInfo.type === 'number' && isNaN(Number(rawValue))) {
        throw new Error(`Configuration error: ${entryName} must be a valid number.`);
      }

      if (entryInfo.type === 'strArray' || entryInfo.type === 'numArray') {
        try {
          const parsed = JSON.parse(rawValue);

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
            throw new Error(`Configuration error: ${entryName} must be a valid JSON string.`, { cause: e });
          }
          throw e;
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

  /**
   * Apply every entry's optional `validation` rule from GlobalConfig.ENTRIES.
   *
   * Runs on already-casted values, so a rule for a 'number' entry receives a number. Entries that
   * resolved to no value at all are skipped because there is nothing to constrain. Fails on the first
   * rejection rather than collecting all of them, matching the fail-fast behaviour of `startUp`.
   *
   * @param castedEnvs - environment variables already cast to their declared types
   * @param entries - entry metadata to read rules from; defaults to the full GlobalConfig set and is
   *                  overridable so callers can supply their own without mutating the shared one
   * @throws Error on the first entry whose rule rejects its value
   */
  static validate(castedEnvs: NodeJS.Dict<any>, entries: Record<string, ConfigProperty> = GlobalConfig.ENTRIES): void {
    Object.entries(entries).forEach(([entryName, entryInfo]) => {
      const value = castedEnvs[entryName];

      if (entryInfo.validation == null || value == null) {
        return;
      }

      const result = entryInfo.validation(value, castedEnvs);

      if (result !== true) {
        const reason = typeof result === 'string' && result.length > 0 ? result : `${entryName} failed validation.`;
        throw new Error(`Configuration error: ${reason}`);
      }
    });
  }
}
