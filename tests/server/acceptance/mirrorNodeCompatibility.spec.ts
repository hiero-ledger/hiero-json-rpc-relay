// SPDX-License-Identifier: Apache-2.0

import axios from 'axios';
import { expect } from 'chai';

import { ConfigService } from '../../../src/config-service/services';
import { MirrorNodeClient } from '../../../src/relay/lib/clients/mirrorNodeClient';
import { Utils } from '../../../src/relay/utils';

describe('@mirror-node-compatiblity Mirror Node compatibility', function () {
  it('@release should run against Mirror Node >= v0.151.0 to support hbar=false on contract result endpoints', async function () {
    // MIRROR_NODE_URL may or may not have a trailing slash
    const mirrorNodeUrl = ConfigService.get('MIRROR_NODE_URL').replace(/\/$/, '');
    const specUrl = `${mirrorNodeUrl}/api/v1/docs/openapi.yml`;

    const response = await axios.get<string>(specUrl, { responseType: 'text' });
    const version = MirrorNodeClient.parseVersionFromOpenApiYaml(response.data);

    expect(version, 'Mirror Node OpenAPI spec must include info.version').to.not.be.undefined;
    expect(
      Utils.isVersionAtLeast(version!, MirrorNodeClient.MIRROR_NODE_HBAR_MIN_VERSION),
      `Mirror Node version ${version} must be >= ${MirrorNodeClient.MIRROR_NODE_HBAR_MIN_VERSION}`,
    ).to.be.true;
  });
});
