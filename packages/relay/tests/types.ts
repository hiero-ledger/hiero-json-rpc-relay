// SPDX-License-Identifier: Apache-2.0

import type { SinonSpy, SinonStub } from 'sinon';

/**
 * A utility type that creates a Sinon stub for a specific method of an object.
 */
export type StubFor<T, P extends keyof T> = T[P] extends (...args: any) => any
  ? SinonStub<Parameters<T[P]>, ReturnType<T[P]>>
  : never;

/**
 * A utility type that creates a Sinon spy for a specific method of an object.
 */
export type SpyFor<T, P extends keyof T> = T[P] extends (...args: any) => any
  ? SinonSpy<Parameters<T[P]>, ReturnType<T[P]>>
  : never;
