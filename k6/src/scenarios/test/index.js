// SPDX-License-Identifier: Apache-2.0

import { getSequentialTestScenarios } from '../../lib/common.js';

// import test modules
import * as eth_accounts from './eth_accounts.js';
import * as eth_blockNumber from './eth_blockNumber.js';
import * as eth_call from './eth_call.js';
import * as eth_chainId from './eth_chainId.js';
import * as eth_coinbase from './eth_coinbase.js';
import * as eth_estimateGas from './eth_estimateGas.js';
import * as eth_feeHistory from './eth_feeHistory.js';
import * as eth_gasPrice from './eth_gasPrice.js';
import * as eth_getBalance from './eth_getBalance.js';
import * as eth_getBlockByHash from './eth_getBlockByHash.js';
import * as eth_getBlockByNumber from './eth_getBlockByNumber.js';
import * as eth_getBlockTransactionCountByHash from './eth_getBlockTransactionCountByHash.js';
import * as eth_getBlockTransactionCountByNumber from './eth_getBlockTransactionCountByNumber.js';
import * as eth_getCode from './eth_getCode.js';
import * as eth_getLogs from './eth_getLogs.js';
import * as eth_getStorageAt from './eth_getStorageAt.js';
import * as eth_getTransactionByBlockHashAndIndex from './eth_getTransactionByBlockHashAndIndex.js';
import * as eth_getTransactionByBlockNumberAndIndex from './eth_getTransactionByBlockNumberAndIndex.js';
import * as eth_getTransactionByHash from './eth_getTransactionByHash.js';
import * as eth_getTransactionCount from './eth_getTransactionCount.js';
import * as eth_getTransactionReceipt from './eth_getTransactionReceipt.js';
import * as eth_getUncleByBlockHashAndIndex from './eth_getUncleByBlockHashAndIndex.js';
import * as eth_getUncleByBlockNumberAndIndex from './eth_getUncleByBlockNumberAndIndex.js';
import * as eth_getUncleCountByBlockHash from './eth_getUncleCountByBlockHash.js';
import * as eth_getUncleCountByBlockNumber from './eth_getUncleCountByBlockNumber.js';
import * as eth_getWork from './eth_getWork.js';
import * as eth_hashrate from './eth_hashrate.js';
import * as eth_mining from './eth_mining.js';
import * as eth_protocolVersion from './eth_protocolVersion.js';
import * as eth_sendRawTransaction from './eth_sendRawTransaction.js';
import * as eth_sendTransaction from './eth_sendTransaction.js';
import * as eth_sign from './eth_sign.js';
import * as eth_signTransaction from './eth_signTransaction.js';
import * as eth_submitHashrate from './eth_submitHashrate.js';
import * as eth_submitWork from './eth_submitWork.js';
import * as eth_syncing from './eth_syncing.js';
import * as net_listening from './net_listening.js';
import * as net_version from './net_version.js';
import * as web3_clientVersion from './web3_clientVersion.js';

// add test modules here
const tests = {
  eth_accounts,
  eth_blockNumber,
  eth_call,
  eth_chainId,
  eth_coinbase,
  eth_estimateGas,
  eth_feeHistory,
  eth_gasPrice,
  eth_getBalance,
  eth_getBlockByHash,
  eth_getBlockByNumber,
  eth_getBlockTransactionCountByHash,
  eth_getBlockTransactionCountByNumber,
  eth_getCode,
  eth_getLogs,
  eth_getStorageAt,
  eth_getTransactionByBlockHashAndIndex,
  eth_getTransactionByBlockNumberAndIndex,
  eth_getTransactionByHash,
  eth_getTransactionCount,
  eth_getTransactionReceipt,
  eth_getUncleByBlockHashAndIndex,
  eth_getUncleByBlockNumberAndIndex,
  eth_getUncleCountByBlockHash,
  eth_getUncleCountByBlockNumber,
  eth_getWork,
  eth_hashrate,
  eth_mining,
  eth_protocolVersion,
  eth_sendRawTransaction,
  eth_sendTransaction,
  eth_sign,
  eth_signTransaction,
  eth_submitHashrate,
  eth_submitWork,
  eth_syncing,
  net_listening,
  net_version,
  web3_clientVersion,
};

const { funcs, options, scenarioDurationGauge } = getSequentialTestScenarios(tests);

export { funcs, options, scenarioDurationGauge };
