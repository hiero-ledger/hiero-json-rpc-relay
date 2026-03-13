// SPDX-License-Identifier: Apache-2.0

import { ConfigKey } from './globalConfig';

export class LoggerService {
  /**
   * Unified map of sensitive fields.
   *
   * Key: configuration field name.
   * Value:
   *   - `true` - entire value is sensitive
   *   - `number[]` - positions of sensitive fields in array values
   */
  public static readonly SENSITIVE_FIELDS_MAP: Map<ConfigKey, number[] | true> = new Map([
    // Fields where the whole value is sensitive
    ['OPERATOR_KEY_MAIN', true],
    ['GITHUB_TOKEN', true],
    ['GH_ACCESS_TOKEN', true],
    ['MIRROR_NODE_AUTH_HEADER', true],

    // Fields where only certain positions in arrays are sensitive
    ['PAYMASTER_ACCOUNTS', [2]],
  ] as [ConfigKey, true | number[]][]);

  /**
   * RegExp to detect GitHub-style secrets in string values.
   */
  public static readonly GITHUB_SECRET_PATTERN: RegExp =
    /^(gh[pousr]_[a-zA-Z0-9]{36,251}|github_pat_[a-zA-Z0-9]{22}_[a-zA-Z0-9]{59})$/;

  /**
   * Hide sensitive configuration values.
   *
   * @param envName - the configuration key
   * @param envValue - the value, either string or array of arrays of strings
   * @returns masked string representation of the environment variable
   */
  static maskUpEnv(envName: string, envValue: string | undefined | string[][]): string {
    // explicitly listed as sensitive
    const sensitiveInfo = this.SENSITIVE_FIELDS_MAP.get(envName as ConfigKey);
    if (sensitiveInfo === true) {
      return `${envName} = **********`;
    }

    // certain positions are sensitive in array values
    if (Array.isArray(sensitiveInfo) && sensitiveInfo.length) {
      return `${envName} = ${(envValue as string[][]).map(
        (a) => `[${a.map((v, k) => (sensitiveInfo.includes(k) ? `**********` : v))}]`,
      )}`;
    }

    // handle GitHub tokens
    if (typeof envValue === 'string' && !!this.GITHUB_SECRET_PATTERN.exec(envValue ?? '')) {
      return `${envName} = **********`;
    }

    // Not sensitive
    return `${envName} = ${envValue}`;
  }
}
