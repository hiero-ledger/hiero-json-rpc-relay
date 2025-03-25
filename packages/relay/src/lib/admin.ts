// SPDX-License-Identifier: Apache-2.0

import { ConfigService } from '@hashgraph/json-rpc-config-service/dist/services';
import axios from 'axios';

import { Admin } from '../index';
import constants from './constants';
import { CacheService } from './services/cacheService/cacheService';
import { RequestDetails } from './types';
import { Utils } from '../utils';

interface IAdminRelayConfig {
  version: string;
  config: { [k: string]: any };
}

interface IAdminUpstreamDependency {
  service: string;
  version?: string;
  config: { [k: string]: any };
}

export interface IAdminConfig {
  relay: IAdminRelayConfig;
  upstreamDependencies: IAdminUpstreamDependency[];
}

export class AdminImpl implements Admin {
  private readonly cacheService: CacheService;

  public static readonly config = 'admin_config';

  constructor(cacheService: CacheService) {
    this.cacheService = cacheService;
  }

  /**
   * Get the consensus node version
   */
  private async getConsensusNodeVersion(): Promise<string> {
    try {
      const targetNetwork: string = Utils.getNetworkNameByChainId();
      const response: any = await axios.get('https://status.hedera.com/api/v2/summary.json');
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
  public async config(requestDetails: RequestDetails): Promise<IAdminConfig> {
    const cacheKey = `${constants.CACHE_KEY.ADMIN_CONFIG}`;

    let info: IAdminConfig = await this.cacheService.getAsync(cacheKey, AdminImpl.config, requestDetails);
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

      await this.cacheService.set(cacheKey, info, AdminImpl.config, requestDetails);
    }

    return info;
  }
}
