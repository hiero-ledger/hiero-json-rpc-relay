// SPDX-License-Identifier: Apache-2.0

import axios from 'axios';

import { ConfigService } from '../../config-service/services';
import { type Admin, predefined } from '../index';
import { Utils } from '../utils';
import type { ICacheClient } from './clients/cache/ICacheClient';
import constants from './constants';
import { rpcMethod } from './decorators';
import { TransactionTracingService } from './services';
import { type TransactionTraceRecord } from './types';
import { rpcParamValidationRules } from './validators';

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

  private readonly transactionTracingService: TransactionTracingService;

  public static readonly config = 'admin_config';

  constructor(cacheService: ICacheClient, transactionTracingService: TransactionTracingService) {
    this.cacheService = cacheService;
    this.transactionTracingService = transactionTracingService;
  }

  /**
   * Guards the trace admin methods. Re-applies DISABLE_ADMIN_NAMESPACE here since the dispatch path does
   * not (it only gates the REST /config route).
   *
   * @throws {JsonRpcError} UNSUPPORTED_METHOD when the admin namespace is disabled or tracing is off.
   */
  private static requireTxStatusTracingEnabled(): void {
    if (ConfigService.get('DISABLE_ADMIN_NAMESPACE') || !TransactionTracingService.isEnabled()) {
      throw predefined.UNSUPPORTED_METHOD;
    }
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

  /**
   * Returns the traced lifecycle record for a transaction hash, or null if none exists.
   *
   * @param hash - The transaction's keccak256 hash.
   * @returns The trace record, or null if none exists.
   * @throws {JsonRpcError} UNSUPPORTED_METHOD when tracing is off or the admin namespace is disabled.
   */
  @rpcMethod
  @rpcParamValidationRules({
    0: { type: 'transactionHash', required: true },
  })
  public async getTransactionTraceByHash(hash: string): Promise<TransactionTraceRecord | null> {
    AdminImpl.requireTxStatusTracingEnabled();
    return this.transactionTracingService.getByHash(hash);
  }
}
