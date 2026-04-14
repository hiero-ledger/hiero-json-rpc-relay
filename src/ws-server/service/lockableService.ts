// SPDX-License-Identifier: Apache-2.0

import { Logger } from 'pino';

export interface ILockableResource {
  locked?: boolean;
}

export abstract class AbstractLockableService {
  protected readonly logger?: Logger;

  /**
   * Locks the given resource.
   *
   * @param {ILockableResource} resource
   *
   * @return {boolean} true if the lock was acquired, false otherwise
   */
  public lock = (resource: ILockableResource): boolean => {
    if (resource.locked) {
      this.logger?.trace('Previous polling attempt took too long so the current one is skipped.');
      return false;
    }
    resource.locked = true;
    return true;
  };

  /**
   * Releases the lock on the given resource.
   *
   * @param {ILockableResource} resource
   */
  public release = (resource: ILockableResource) => {
    resource.locked = false;
  };
}
