// SPDX-License-Identifier: Apache-2.0

import { ConfigService } from '@hashgraph/json-rpc-config-service/dist/services';
import axios from 'axios';

import type { Admin } from '../index';
import { Utils } from '../utils';
import type { ICacheClient } from './clients/cache/ICacheClient';
import constants from './constants';

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
  private readonly cacheService: ICacheClient;

  public static readonly config = 'admin_config';

  constructor(cacheService: ICacheClient) {
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
    } catch {
      return 'local';
    }
  }

  /**
   * Returns list of all config envs
   */
  public async config(): Promise<IAdminConfig> {
    const cacheKey = `${constants.CACHE_KEY.ADMIN_CONFIG}`;

    let info: IAdminConfig = await this.cacheService.getAsync(cacheKey, AdminImpl.config);
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

      await this.cacheService.set(cacheKey, info, AdminImpl.config);
    }

    return info;
  }
}
