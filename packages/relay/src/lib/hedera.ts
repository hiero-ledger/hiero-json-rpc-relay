// SPDX-License-Identifier: Apache-2.0

import { ConfigService } from '@hashgraph/json-rpc-config-service/dist/services';

import { Hedera } from '../index';
import { Utils } from '../utils';
import constants from './constants';
import { CacheService } from './services/cacheService/cacheService';
import { RequestDetails } from './types';

interface IHederaRelayConfig {
  version: string;
  config: { [k: string]: any };
}

interface IHederaUpstreamDependency {
  service: string;
  version: string;
  config: { [k: string]: any };
}

export interface IHederaConfig {
  relay: IHederaRelayConfig;
  upstreamDependencies: IHederaUpstreamDependency[];
}

export class HederaImpl implements Hedera {
  private readonly cacheService: CacheService;

  public static readonly config = 'hedera_config';

  constructor(cacheService: CacheService) {
    this.cacheService = cacheService;
  }

  /**
   * Returns list of all config envs
   */
  async config(requestDetails: RequestDetails): Promise<IHederaConfig> {
    const cacheKey = `${constants.CACHE_KEY.HEDERA_CONFIG}`;

    let info: IHederaConfig = await this.cacheService.getAsync(cacheKey, HederaImpl.config, requestDetails);
    if (!info) {
      const maskedEnvs = ConfigService.getAllMasked();
      info = {
        relay: {
          version: ConfigService.get('npm_package_version'),
          config: {
            ...Object.fromEntries(
              Object.entries(maskedEnvs).filter((it) => !it[0].startsWith('SDK_') && !it[0].startsWith('MIRROR_NODE_')),
            ),
          },
        },
        upstreamDependencies: [
          {
            service: 'consensusNode',
            version: await Utils.getConsensusNodeVersion(),
            config: {
              ...Object.fromEntries(Object.entries(maskedEnvs).filter((it) => it[0].startsWith('SDK_'))),
            },
          },
          {
            service: 'mirrorNode',
            version: await Utils.getMirrorNodeVersion(),
            config: {
              ...Object.fromEntries(Object.entries(maskedEnvs).filter((it) => it[0].startsWith('MIRROR_NODE_'))),
            },
          },
        ],
      };

      await this.cacheService.set(cacheKey, info, HederaImpl.config, requestDetails);
    }

    return info;
  }
}
