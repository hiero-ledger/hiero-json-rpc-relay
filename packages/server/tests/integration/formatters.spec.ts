// SPDX-License-Identifier: Apache-2.0

import { formatRequestIdMessage } from '@hashgraph/json-rpc-server/dist/formatters';
import { expect } from 'chai';

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
