// SPDX-License-Identifier: Apache-2.0

import { expect } from 'chai';

// chai's `to.exist` does not narrow, so wrap it in an assertion signature.
export function assertExists<T>(value: T | null | undefined): asserts value is T {
  expect(value).to.exist;
}
