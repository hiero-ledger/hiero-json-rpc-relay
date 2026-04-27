// SPDX-License-Identifier: Apache-2.0

import { expect } from 'chai';

import { formatRequestIdMessage } from '../../../src/server/formatters';

describe('Formatters', () => {
  it('should be able get requestId via formatRequestIdMessage with a valid param', () => {
    const id = 'valid-id';
    const requestId = formatRequestIdMessage(id);
    expect(requestId).to.equal(`[Request ID: ${id}]`);
  });

  it('should return empty string on formatRequestIdMessage with missing param', () => {
    const requestId = formatRequestIdMessage();
    expect(requestId).to.equal('');
  });
});
