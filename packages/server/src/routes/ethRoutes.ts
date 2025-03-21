// SPDX-License-Identifier: Apache-2.0

import { Relay } from '@hashgraph/json-rpc-relay';
import pino from 'pino';

import KoaJsonRpc from '../koaJsonRpc';
import { logAndHandleResponse } from '../utils';

const defineEthRoutes = function (app: KoaJsonRpc, relay: Relay, logger: pino.Logger) {
  /**
   * Returns the latest block numbe
   *
   * @returns hex
   */
  app.useRpc('eth_blockNumber', async () => {
    return logAndHandleResponse(
      'eth_blockNumber',
      [],
      (requestDetails) => relay.eth().blockNumber(requestDetails),
      app,
      logger,
    );
  });

  /**
   * Returns an estimation of gas for a given transaction.
   *
   * @param transaction object
   * @param block number
   * @returns hex
   */
  app.useRpc('eth_estimateGas', async (params: any) => {
    // HotFix for Metamask sending `0x` on data param
    if (params?.[0]?.data === '0x') {
      delete params[0].data;
    }

    return logAndHandleResponse(
      'eth_estimateGas',
      params,
      (requestDetails) => relay.eth().estimateGas(params?.[0], params?.[1], requestDetails),
      app,
      logger,
    );
  });

  /**
   * Returns the balance of the account of given address.
   *
   * @param address
   * @param block number
   * @returns hex
   */
  app.useRpc('eth_getBalance', async (params: any) => {
    return logAndHandleResponse(
      'eth_getBalance',
      params,
      (requestDetails) => relay.eth().getBalance(params?.[0], params?.[1], requestDetails),
      app,
      logger,
    );
  });

  /**
   * Returns the compiled bytecode of a smart contract.
   *
   * @param address
   * @param block number
   * @returns hex
   */
  app.useRpc('eth_getCode', async (params: any) => {
    return logAndHandleResponse(
      'eth_getCode',
      params,
      (requestDetails) => relay.eth().getCode(params?.[0], params?.[1], requestDetails),
      app,
      logger,
    );
  });

  /**
   * Returns the current network ID, used to sign replay-protected transaction introduced in EIP-155.
   *
   * @returns hex
   */
  app.useRpc('eth_chainId', async () => {
    return logAndHandleResponse(
      'eth_chainId',
      [],
      (requestDetails) => relay.eth().chainId(requestDetails),
      app,
      logger,
    );
  });

  /**
   * Returns information of the block matching the given block number.
   *
   * @param block number
   * @param transactions details flag
   * @returns block object
   */
  app.useRpc('eth_getBlockByNumber', async (params: any) => {
    return logAndHandleResponse(
      'eth_getBlockByNumber',
      params,
      (requestDetails) => relay.eth().getBlockByNumber(params?.[0], Boolean(params?.[1]), requestDetails),
      app,
      logger,
    );
  });

  /**
   * Returns information of the block matching the given block hash.
   *
   * @param block hash
   * @param transactions details flag
   * @returns block object
   */
  app.useRpc('eth_getBlockByHash', async (params: any) => {
    return logAndHandleResponse(
      'eth_getBlockByHash',
      params,
      (requestDetails) => relay.eth().getBlockByHash(params?.[0], Boolean(params?.[1]), requestDetails),
      app,
      logger,
    );
  });

  /**
   * Returns the current gas price on the network.
   *
   * @returns hex
   */
  app.useRpc('eth_gasPrice', async () => {
    return logAndHandleResponse(
      'eth_gasPrice',
      [],
      (requestDetails) => relay.eth().gasPrice(requestDetails),
      app,
      logger,
    );
  });

  /**
   * Returns the number of transactions sent from an address.
   *
   * @param address
   * @param block number
   * @returns hex
   */
  app.useRpc('eth_getTransactionCount', async (params: any) => {
    return logAndHandleResponse(
      'eth_getTransactionCount',
      params,
      (requestDetails) => relay.eth().getTransactionCount(params?.[0], params?.[1], requestDetails),
      app,
      logger,
    );
  });

  /**
   * Executes a new message call immediately without creating a transaction on the block chain.
   *
   * @param transaction object
   * @param block number
   * @returns hex
   */
  app.useRpc('eth_call', async (params: any) => {
    return logAndHandleResponse(
      'eth_call',
      params,
      (requestDetails) => relay.eth().call(params?.[0], params?.[1], requestDetails),
      app,
      logger,
    );
  });

  /**
   * Creates new message call transaction or a contract creation for signed transactions.
   *
   * @param signed transaction
   * @returns hex
   */
  app.useRpc('eth_sendRawTransaction', async (params: any) => {
    return logAndHandleResponse(
      'eth_sendRawTransaction',
      params,
      (requestDetails) => relay.eth().sendRawTransaction(params?.[0], requestDetails),
      app,
      logger,
    );
  });

  /**
   * Returns the receipt of a transaction by transaction hash.
   *
   * @param hex
   * @returns transaction receipt object
   */
  app.useRpc('eth_getTransactionReceipt', async (params: any) => {
    return logAndHandleResponse(
      'eth_getTransactionReceipt',
      params,
      (requestDetails) => relay.eth().getTransactionReceipt(params?.[0], requestDetails),
      app,
      logger,
    );
  });

  /**
   * Returns an array of addresses owned by the client.
   *
   * @returns empty array
   */
  app.useRpc('eth_accounts', async () => {
    return logAndHandleResponse(
      'eth_accounts',
      [],
      (requestDetails) => relay.eth().accounts(requestDetails),
      app,
      logger,
    );
  });

  /**
   * Returns the information about a transaction from a transaction hash.
   *
   * @param hex
   * @returns transaction object
   */
  app.useRpc('eth_getTransactionByHash', async (params: any) => {
    return logAndHandleResponse(
      'eth_getTransactionByHash',
      params,
      (requestDetails) => relay.eth().getTransactionByHash(params[0], requestDetails),
      app,
      logger,
    );
  });

  /**
   * Returns the collection of historical gas information.
   *
   * @param block count - the number of blocks requested
   * @param newest block -the highest number block of the range
   * @param reward percentiles - list of percentiles used to sample from each block
   *
   * @returns baseFeePerGas - array of block base fees per gas
   * @returns gasUsedRatio - array of block gas used ratios
   * @returns oldestBlock - lowest number block in the range
   * @returns reward - array of effective priority fee per gas data
   */
  app.useRpc('eth_feeHistory', async (params: any) => {
    return logAndHandleResponse(
      'eth_feeHistory',
      params,
      (requestDetails) => relay.eth().feeHistory(Number(params?.[0]), params?.[1], params?.[2], requestDetails),
      app,
      logger,
    );
  });

  /**
   * Returns the number of transactions for the block matching the given block hash.
   *
   * @param hex
   * @returns hex
   */
  app.useRpc('eth_getBlockTransactionCountByHash', async (params: any) => {
    return logAndHandleResponse(
      'eth_getBlockTransactionCountByHash',
      params,
      (requestDetails) => relay.eth().getBlockTransactionCountByHash(params?.[0], requestDetails),
      app,
      logger,
    );
  });

  /**
   * Returns the transaction receipts for the block matching the given block hash/block number/tag.
   *
   * @param blockParam
   * @returns []
   */
  app.useRpc('eth_getBlockReceipts', async (params: any) => {
    return logAndHandleResponse(
      'eth_getBlockReceipts',
      params,
      (requestDetails) => relay.eth().getBlockReceipts(params?.[0], requestDetails),
      app,
      logger,
    );
  });

  /**
   * Returns the number of transactions for the block matching the given block number.
   *
   * @param hex
   * @returns hex
   */
  app.useRpc('eth_getBlockTransactionCountByNumber', async (params: any) => {
    return logAndHandleResponse(
      'eth_getBlockTransactionCountByNumber',
      params,
      (requestDetails) => relay.eth().getBlockTransactionCountByNumber(params?.[0], requestDetails),
      app,
      logger,
    );
  });

  /**
   * Returns an array of all logs matching a given filter object.
   *
   * @param filter object
   * @returns array of log objects
   */
  app.useRpc('eth_getLogs', async (params: any) => {
    const filter = params[0];

    return logAndHandleResponse(
      'eth_getLogs',
      params,
      (requestDetails) =>
        relay
          .eth()
          .getLogs(filter.blockHash, filter.fromBlock, filter.toBlock, filter.address, filter.topics, requestDetails),
      app,
      logger,
    );
  });

  /**
   * Returns the value from a storage position at a given address.
   *
   * @param address
   * @param position
   * @param block number
   * @returns hex
   */
  app.useRpc('eth_getStorageAt', async (params: any) => {
    return logAndHandleResponse(
      'eth_getStorageAt',
      params,
      (requestDetails) => relay.eth().getStorageAt(params?.[0], params?.[1], requestDetails, params?.[2]),
      app,
      logger,
    );
  });

  /**
   * Returns information about a transaction given a block hash and transaction index position.
   *
   * @param hex
   * @param hex
   * @returns transaction object
   */
  app.useRpc('eth_getTransactionByBlockHashAndIndex', async (params: any) => {
    return logAndHandleResponse(
      'eth_getTransactionByBlockHashAndIndex',
      params,
      (requestDetails) => relay.eth().getTransactionByBlockHashAndIndex(params?.[0], params?.[1], requestDetails),
      app,
      logger,
    );
  });

  /**
   * Returns information about a transaction given a block number and transaction index position.
   *
   * @param hex
   * @param hex
   * @returns transaction object
   */
  app.useRpc('eth_getTransactionByBlockNumberAndIndex', async (params: any) => {
    return logAndHandleResponse(
      'eth_getTransactionByBlockNumberAndIndex',
      params,
      (requestDetails) => relay.eth().getTransactionByBlockNumberAndIndex(params?.[0], params?.[1], requestDetails),
      app,
      logger,
    );
  });

  /**
   * Returns information about an uncle of a block by hash and uncle index position.
   * Since Hedera does not have an uncle concept, this method will return a static response.
   *
   * @param hex
   * @param hex
   * @returns null
   */
  app.useRpc('eth_getUncleByBlockHashAndIndex', async () => {
    return logAndHandleResponse(
      'eth_getUncleByBlockHashAndIndex',
      [],
      (requestDetails) => relay.eth().getUncleByBlockHashAndIndex(requestDetails),
      app,
      logger,
    );
  });

  /**
   * Returns information about an uncle of a block by number and uncle index position.
   * Since Hedera does not have an uncle concept, this method will return a static response.
   *
   * @param hex
   * @param hex
   * @returns null
   */
  app.useRpc('eth_getUncleByBlockNumberAndIndex', async () => {
    return logAndHandleResponse(
      'eth_getUncleByBlockNumberAndIndex',
      [],
      (requestDetails) => relay.eth().getUncleByBlockNumberAndIndex(requestDetails),
      app,
      logger,
    );
  });

  /**
   * Returns the number of uncles in a block matching the given block hash.
   * Since Hedera does not have an uncle concept, this method will return a static response.
   *
   * @param hex
   * @returns 0x0
   */
  app.useRpc('eth_getUncleCountByBlockHash', async () => {
    return logAndHandleResponse(
      'eth_getUncleCountByBlockHash',
      [],
      (requestDetails) => relay.eth().getUncleCountByBlockHash(requestDetails),
      app,
      logger,
    );
  });

  /**
   * Returns the number of uncles in a block matching the given block number.
   * Since Hedera does not have an uncle concept, this method will return a static response.
   *
   * @param hex
   * @returns 0x0
   */
  app.useRpc('eth_getUncleCountByBlockNumber', async () => {
    return logAndHandleResponse(
      'eth_getUncleCountByBlockNumber',
      [],
      (requestDetails) => relay.eth().getUncleCountByBlockNumber(requestDetails),
      app,
      logger,
    );
  });

  /**
   * Returns the hash of the current block, the seed hash, and the boundary condition to be met.
   * Since Hedera does not have this concept, this method will return a static response.
   *
   * @returns code -32000
   */
  app.useRpc('eth_getWork', async () => {
    return logAndHandleResponse(
      'eth_getWork',
      [],
      (requestDetails) => relay.eth().getWork(requestDetails),
      app,
      logger,
    );
  });

  /**
   * Returns the number of hashes per second that the node is mining with.
   * Since Hedera does not have this concept, this method will return a static response.
   *
   * @returns 0x0
   */
  app.useRpc('eth_hashrate', async () => {
    return logAndHandleResponse(
      'eth_hashrate',
      [],
      (requestDetails) => relay.eth().hashrate(requestDetails),
      app,
      logger,
    );
  });

  /**
   * Returns whether the client is mining.
   * Since Hedera does not have this concept, this method will return a static response.
   *
   * @returns false
   */
  app.useRpc('eth_mining', async () => {
    return logAndHandleResponse('eth_mining', [], (requestDetails) => relay.eth().mining(requestDetails), app, logger);
  });

  /**
   * Used for submitting a proof-of-work solution
   * Since Hedera does not have this concept, this method will return a static response.
   *
   * @returns false
   */
  app.useRpc('eth_submitWork', async () => {
    return logAndHandleResponse(
      'eth_submitWork',
      [],
      (requestDetails) => relay.eth().submitWork(requestDetails),
      app,
      logger,
    );
  });

  /**
   * Returns the sync status of the network.
   * Since Hedera does not have this concept, this method will return a static response.
   *
   * @returns false
   */
  app.useRpc('eth_syncing', async () => {
    return logAndHandleResponse(
      'eth_syncing',
      [],
      (requestDetails) => relay.eth().syncing(requestDetails),
      app,
      logger,
    );
  });

  /**
   * Get the priority fee needed to be included in a block.
   * Since Hedera does not have this concept, this method will return a static response.
   *
   * @returns 0x0
   */
  app.useRpc('eth_maxPriorityFeePerGas', async () => {
    return logAndHandleResponse(
      'eth_maxPriorityFeePerGas',
      [],
      (requestDetails) => relay.eth().maxPriorityFeePerGas(requestDetails),
      app,
      logger,
    );
  });

  /**
   * Creates a filter object, based on filter options, to notify when the state changes (logs).
   *
   * @param filter object
   * @returns id
   */
  app.useRpc('eth_newFilter', async (params: any) => {
    const filter = params[0];
    return logAndHandleResponse(
      'eth_newFilter',
      [],
      (requestDetails) =>
        relay
          .eth()
          .filterService()
          .newFilter(filter?.fromBlock, filter?.toBlock, requestDetails, filter?.address, filter?.topics),
      app,
      logger,
    );
  });

  /**
   * Returns an array of all logs matching filter with given id.
   *
   * @param filter id
   * @returns array of log objects
   */
  app.useRpc('eth_getFilterLogs', async (params: any) => {
    return logAndHandleResponse(
      'eth_getFilterLogs',
      params,
      (requestDetails) =>
        relay
          .eth()
          .filterService()
          .getFilterLogs(params?.[0], requestDetails),
      app,
      logger,
    );
  });

  /**
   * Polling method for a filter, which returns an array of events that have occurred since the last poll.
   *
   * @param filter id
   * @returns array of data depending on the filter type
   */
  app.useRpc('eth_getFilterChanges', async (params: any) => {
    const filterId = params[0];
    return logAndHandleResponse(
      'eth_getFilterChanges',
      [],
      (requestDetails) => relay.eth().filterService().getFilterChanges(filterId, requestDetails),
      app,
      logger,
    );
  });

  /**
   * Creates a filter in the node, to notify when a new block arrives.
   *
   * @returns filter id
   */
  app.useRpc('eth_newBlockFilter', async (params: any) => {
    return logAndHandleResponse(
      'eth_newBlockFilter',
      [],
      (requestDetails) => relay.eth().filterService().newBlockFilter(requestDetails),
      app,
      logger,
    );
  });

  /**
   * It uninstalls a filter with the given filter id.
   *
   * @param filter id
   * @returns boolean
   */
  app.useRpc('eth_uninstallFilter', async (params: any) => {
    return logAndHandleResponse(
      'eth_uninstallFilter',
      params,
      (requestDetails) =>
        relay
          .eth()
          .filterService()
          .uninstallFilter(params?.[0], requestDetails),
      app,
      logger,
    );
  });

  /**
   * Not supported.
   */
  app.useRpc('eth_newPendingTransactionFilter', async () => {
    return logAndHandleResponse(
      'eth_newPendingTransactionFilter',
      [],
      (requestDetails) => relay.eth().filterService().newPendingTransactionFilter(requestDetails),
      app,
      logger,
    );
  });

  /**
   * Not supported.
   */
  app.useRpc('eth_submitHashrate', async () => {
    return logAndHandleResponse(
      'eth_submitHashrate',
      [],
      (requestDetails) => relay.eth().submitHashrate(requestDetails),
      app,
      logger,
    );
  });

  /**
   * Not supported.
   */
  app.useRpc('eth_signTransaction', async () => {
    return logAndHandleResponse(
      'eth_signTransaction',
      [],
      (requestDetails) => relay.eth().signTransaction(requestDetails),
      app,
      logger,
    );
  });

  /**
   * Not supported.
   */
  app.useRpc('eth_sign', async () => {
    return logAndHandleResponse('eth_sign', [], (requestDetails) => relay.eth().sign(requestDetails), app, logger);
  });

  /**
   * Not supported.
   */
  app.useRpc('eth_sendTransaction', async () => {
    return logAndHandleResponse(
      'eth_sendTransaction',
      [],
      (requestDetails) => relay.eth().sendTransaction(requestDetails),
      app,
      logger,
    );
  });

  /**
   * Not supported.
   */
  app.useRpc('eth_protocolVersion', async () => {
    return logAndHandleResponse(
      'eth_protocolVersion',
      [],
      (requestDetails) => relay.eth().protocolVersion(requestDetails),
      app,
      logger,
    );
  });

  /**
   * Not supported.
   */
  app.useRpc('eth_coinbase', async () => {
    return logAndHandleResponse(
      'eth_coinbase',
      [],
      (requestDetails) => relay.eth().coinbase(requestDetails),
      app,
      logger,
    );
  });
};

export { defineEthRoutes };
