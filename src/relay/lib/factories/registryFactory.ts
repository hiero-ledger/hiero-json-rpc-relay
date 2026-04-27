// SPDX-License-Identifier: Apache-2.0

import { Registry } from 'prom-client';

export class RegistryFactory {
  /**
   * Holds the singleton Registry instance.
   */
  private static instance: Registry;

  /**
   * If the registry has not yet been created, it initializes a new one.
   *
   * @returns The globally shared `Registry` instance.
   */
  static getInstance(forceCreate: boolean = false): Registry {
    if (!this.instance || forceCreate) this.instance = new Registry();

    return this.instance;
  }
}
