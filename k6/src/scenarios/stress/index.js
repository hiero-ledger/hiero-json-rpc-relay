// SPDX-License-Identifier: Apache-2.0

import { getStressTestScenarios } from '../../lib/common.js';
// Import all test modules (same as current test/index.js)
import * as debug_traceBlockByNumber from '../test/debug_traceBlockByNumber.js';
import * as debug_traceTransaction from '../test/debug_traceTransaction.js';
import * as eth_accounts from '../test/eth_accounts.js';
import * as eth_blobBaseFee from '../test/eth_blobBaseFee.js';
import * as eth_blockNumber from '../test/eth_blockNumber.js';
import * as eth_call from '../test/eth_call.js';
import * as eth_chainId from '../test/eth_chainId.js';
import * as eth_coinbase from '../test/eth_coinbase.js';
import * as eth_createAccessList from '../test/eth_createAccessList.js';
import * as eth_estimateGas from '../test/eth_estimateGas.js';
import * as eth_feeHistory from '../test/eth_feeHistory.js';
import * as eth_gasPrice from '../test/eth_gasPrice.js';
import * as eth_getBalance from '../test/eth_getBalance.js';
import * as eth_getBlockByHash from '../test/eth_getBlockByHash.js';
import * as eth_getBlockByNumber from '../test/eth_getBlockByNumber.js';
import * as eth_getBlockReceipts from '../test/eth_getBlockReceipts.js';
import * as eth_getBlockTransactionCountByHash from '../test/eth_getBlockTransactionCountByHash.js';
import * as eth_getBlockTransactionCountByNumber from '../test/eth_getBlockTransactionCountByNumber.js';
import * as eth_getCode from '../test/eth_getCode.js';
import * as eth_getFilterChanges from '../test/eth_getFilterChanges.js';
import * as eth_getFilterLogs from '../test/eth_getFilterLogs.js';
import * as eth_getLogs from '../test/eth_getLogs.js';
import * as eth_getProof from '../test/eth_getProof.js';
import * as eth_getStorageAt from '../test/eth_getStorageAt.js';
import * as eth_getTransactionByBlockHashAndIndex from '../test/eth_getTransactionByBlockHashAndIndex.js';
import * as eth_getTransactionByBlockNumberAndIndex from '../test/eth_getTransactionByBlockNumberAndIndex.js';
import * as eth_getTransactionByHash from '../test/eth_getTransactionByHash.js';
import * as eth_getTransactionCount from '../test/eth_getTransactionCount.js';
import * as eth_getTransactionReceipt from '../test/eth_getTransactionReceipt.js';
import * as eth_getUncleByBlockHashAndIndex from '../test/eth_getUncleByBlockHashAndIndex.js';
import * as eth_getUncleByBlockNumberAndIndex from '../test/eth_getUncleByBlockNumberAndIndex.js';
import * as eth_getUncleCountByBlockHash from '../test/eth_getUncleCountByBlockHash.js';
import * as eth_getUncleCountByBlockNumber from '../test/eth_getUncleCountByBlockNumber.js';
import * as eth_getWork from '../test/eth_getWork.js';
import * as eth_hashrate from '../test/eth_hashrate.js';
import * as eth_maxPriorityFeePerGas from '../test/eth_maxPriorityFeePerGas.js';
import * as eth_mining from '../test/eth_mining.js';
import * as eth_newBlockFilter from '../test/eth_newBlockFilter.js';
import * as eth_newFilter from '../test/eth_newFilter.js';
import * as eth_newPendingTransactionFilter from '../test/eth_newPendingTransactionFilter.js';
import * as eth_protocolVersion from '../test/eth_protocolVersion.js';
import * as eth_sendRawTransaction from '../test/eth_sendRawTransaction.js';
import * as eth_sendTransaction from '../test/eth_sendTransaction.js';
import * as eth_sign from '../test/eth_sign.js';
import * as eth_signTransaction from '../test/eth_signTransaction.js';
import * as eth_submitHashrate from '../test/eth_submitHashrate.js';
import * as eth_submitWork from '../test/eth_submitWork.js';
import * as eth_syncing from '../test/eth_syncing.js';
import * as eth_uninstallFilter from '../test/eth_uninstallFilter.js';
import * as net_listening from '../test/net_listening.js';
import * as net_peerCount from '../test/net_peerCount.js';
import * as net_version from '../test/net_version.js';
import * as web3_clientVersion from '../test/web3_clientVersion.js';
import * as web3_sha3 from '../test/web3_sha3.js';

// Add test modules here (same structure as current test/index.js)
const tests = {
  debug_traceBlockByNumber,
  debug_traceTransaction,
  eth_accounts,
  eth_blobBaseFee,
  eth_blockNumber,
  eth_call,
  eth_chainId,
  eth_coinbase,
  eth_createAccessList,
  eth_estimateGas,
  eth_feeHistory,
  eth_gasPrice,
  eth_getBalance,
  eth_getBlockByHash,
  eth_getBlockByNumber,
  eth_getBlockTransactionCountByHash,
  eth_getBlockTransactionCountByNumber,
  eth_getBlockReceipts,
  eth_getCode,
  eth_getFilterChanges,
  eth_getFilterLogs,
  eth_getLogs,
  eth_getProof,
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
  eth_maxPriorityFeePerGas,
  eth_mining,
  eth_newBlockFilter,
  eth_newFilter,
  eth_newPendingTransactionFilter,
  eth_protocolVersion,
  eth_sendRawTransaction,
  eth_sendTransaction,
  eth_sign,
  eth_signTransaction,
  eth_submitHashrate,
  eth_submitWork,
  eth_syncing,
  eth_uninstallFilter,
  net_listening,
  net_peerCount,
  net_version,
  web3_clientVersion,
  web3_sha3,
};

const { funcs, options, scenarioDurationGauge } = getStressTestScenarios(tests);

export { funcs, options, scenarioDurationGauge };
