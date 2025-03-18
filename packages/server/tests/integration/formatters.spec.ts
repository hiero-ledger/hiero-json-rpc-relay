// SPDX-License-Identifier: Apache-2.0

import { formatRequestIdMessage } from '@hashgraph/json-rpc-relay/dist/formatters';
import { expect } from 'chai';

import { withOverriddenEnvsInMochaTest } from '../../../relay/tests/helpers';
import { getConsensusNodeVersion, getMirrorNodeVersion } from '../../dist/formatters';

describe.only('Formatters', () => {
  it('should be able get requestId via formatRequestIdMessage with a valid param', () => {
    const id = 'valid-id';
    const requestId = formatRequestIdMessage(id);
    expect(requestId).to.equal(`[Request ID: ${id}]`);
  });

  it('should return empty string on formatRequestIdMessage with missing param', () => {
    const requestId = formatRequestIdMessage();
    expect(requestId).to.equal('');
  });

  withOverriddenEnvsInMochaTest({ MIRROR_NODE_URL: 'https://testnet.mirrornode.hedera.com' }, () => {
    it('should set server timeout to default value when environment variable is not set', () => {
      it('should return local for version tag on getConsensusNodeVersion against local MN setup', async () => {
        const version = await getConsensusNodeVersion();
        expect(version).to.not.equal('local');
      });
    });
  });

  withOverriddenEnvsInMochaTest({ MIRROR_NODE_URL: 'https://testnet.mirrornode.hedera.com' }, () => {
    it('should return local for version tag on getConsensusNodeVersion against local MN setup', async () => {
      const version = await getMirrorNodeVersion();
      expect(version).to.not.equal('local');
    });
  });

  withOverriddenEnvsInMochaTest({ MIRROR_NODE_URL: 'http://127.0.0.1:5551' }, () => {
    it('should set server timeout to default value when environment variable is not set', () => {
      it('should return local for version tag on getConsensusNodeVersion against local MN setup', async () => {
        const version = await getConsensusNodeVersion();
        expect(version).to.equal('local');
      });
    });
  });

  withOverriddenEnvsInMochaTest({ MIRROR_NODE_URL: 'http://127.0.0.1:5551' }, () => {
    it('should return local for version tag on getConsensusNodeVersion against local MN setup', async () => {
      const version = await getMirrorNodeVersion();
      expect(version).to.equal('local');
    });
  });
});
