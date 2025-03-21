// SPDX-License-Identifier: Apache-2.0

import { ConfigService } from '@hashgraph/json-rpc-config-service/dist/services';
import axios from 'axios';

import { Hedera } from '../index';
import constants from './constants';
import { CacheService } from './services/cacheService/cacheService';
import { RequestDetails } from './types';

interface IHederaRelayConfig {
  version: string;
  config: { [k: string]: any };
}

interface IHederaUpstreamDependency {
  service: string;
  version?: string;
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
   * Get the consensus node version
   */
  private async getConsensusNodeVersion(): Promise<string> {
    try {
      const response: any = await axios.get('https://status.hedera.com/api/v2/summary.json');
      const currentNetwork: URL = new URL(ConfigService.get('MIRROR_NODE_URL'));
      const targetNetwork: string = currentNetwork.hostname.split('.')[0].toLowerCase();
      const networkInfo: any = response.data.components.filter(
        (it) => it.name.endsWith(' | Network Uptime') && it.name.toLowerCase().indexOf(targetNetwork) > -1,
      );

      const networkName: string = networkInfo[0].name;
      return networkName.substring(networkName.indexOf('(') + 2, networkName.indexOf(')'));
    } catch (e) {
      return 'local';
    }
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
            version: await this.getConsensusNodeVersion(),
            config: {
              ...Object.fromEntries(Object.entries(maskedEnvs).filter((it) => it[0].startsWith('SDK_'))),
            },
          },
          {
            service: 'mirrorNode',
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
