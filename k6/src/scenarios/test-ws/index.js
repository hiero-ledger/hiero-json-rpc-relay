// SPDX-License-Identifier: Apache-2.0

import { getSequentialTestScenarios } from '../../lib/common.js';

// import test modules
import * as eth_chainId from './eth_chainId.js';
import * as eth_subscribe_logs from './eth_subscribe_logs.js';
import * as eth_subscribe_newHeads from './eth_subscribe_newHeads.js';
import * as eth_subscribe_newPendingTransactions from './eth_subscribe_newPendingTransactions.js';

// add test modules here
const tests = {
  eth_chainId,
  eth_subscribe_logs,
  eth_subscribe_newHeads,
  eth_subscribe_newPendingTransactions,
};

const { funcs, options, scenarioDurationGauge } = getSequentialTestScenarios(tests);

export { funcs, options, scenarioDurationGauge };
