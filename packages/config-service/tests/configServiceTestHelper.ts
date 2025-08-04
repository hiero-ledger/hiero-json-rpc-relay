// SPDX-License-Identifier: Apache-2.0

import dotenv from 'dotenv';

import { ConfigService } from '../dist/services';

/**
 * There are many tests, both integration and acceptance that
 * change the environment variables during their runtime. We added this helper
 * in order to keep the main env provider as clean as possible but at the same
 * time, we will be able to override, delete, or append environment variables.
 */
export class ConfigServiceTestHelper {
  /**
   * Override an env variable, used in test cases only
   * @param name string
   * @param value string
   * @returns void
   */
  public static dynamicOverride(name: string, value: string | string[] | number | boolean | null | undefined): void {
    // @ts-ignore
    ConfigService.getInstance().envs[name] = value;
  }

  /**
   * Delete an env variable, used in test cases only
   * @param name string
   * @returns void
   */
  public static remove(name: string): void {
    // @ts-ignore
    delete ConfigService.getInstance().envs[name];
  }

  /**
   * Hot reload a new instance into the current one, used in test cases only
   * @param configPath string
   * @returns void
   */
  public static appendEnvsFromPath(configPath: string): void {
    dotenv.config({ path: configPath, override: true });
    Object.entries(process.env).forEach(([key, value]) => {
      this.dynamicOverride(key, value);
    });
  }
}
