// SPDX-License-Identifier: Apache-2.0

import { ConfigService } from '@hashgraph/json-rpc-config-service/dist/services';
import fetch from 'node-fetch';
import { parse } from 'yaml';

/**
 * Format message prefix for logger.
 */
const formatRequestIdMessage = (requestId?: string): string => {
  return requestId ? `[Request ID: ${requestId}]` : '';
};

/**
 * Get the consensus node version
 */
const getConsensusNodeVersion = async (): Promise<string> => {
  try {
    const response = await (await fetch('https://status.hedera.com/api/v2/summary.json')).json();
    const currentNetwork = new URL(ConfigService.get('MIRROR_NODE_URL'));
    const targetNetwork = currentNetwork.hostname.split('.')[0].toLowerCase();
    const networkInfo = response.components.filter(
      (it) => it.name.endsWith(' | Network Uptime') && it.name.toLowerCase().indexOf(targetNetwork) > -1,
    );

    const networkName = networkInfo[0].name;
    return networkName.substring(networkName.indexOf('(') + 2, networkName.indexOf(')'));
  } catch (e) {
    return 'local';
  }
};

/**
 * Get the mirror node version
 */
const getMirrorNodeVersion = async (): Promise<string> => {
  try {
    const response = await fetch(ConfigService.get('MIRROR_NODE_URL') + '/api/v1/docs/openapi.yml');
    return parse(await response.text()).info.version;
  } catch (e) {
    return 'local';
  }
};

export { formatRequestIdMessage, getConsensusNodeVersion, getMirrorNodeVersion };
