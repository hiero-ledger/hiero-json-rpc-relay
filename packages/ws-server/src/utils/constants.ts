// SPDX-License-Identifier: Apache-2.0

export const WS_CONSTANTS = {
  methodsCounter: {
    name: 'rpc_websocket_method_counter',
    help: 'Relay websocket total methods called received through websocket',
    labelNames: ['method'],
  },
  methodsCounterByIp: {
    name: 'rpc_websocket_method_by_ip_counter',
    help: 'Relay websocket methods called by ip received through websocket',
    labelNames: ['ip', 'method'],
  },
  cpuUsageGauge: {
    name: 'rpc_websocket_cpu_usage_percentage',
    help: 'CPU usage percentage of the WebSocket server',
    labelNames: ['cpu'],
  },
  memoryUsageGauge: {
    name: 'rpc_websocket_memory_usage_bytes',
    help: 'Memory usage of the WebSocket server in bytes',
    labelNames: ['memory'],
  },
  totalMessageCounter: {
    name: 'rpc_websocket_messages_received_total',
    help: 'Total number of messages received by the WebSocket server',
  },
  totalOpenedConnections: {
    name: 'rpc_websocket_connections_established_total',
    help: 'Total number of WebSocket connections established',
  },
  totalClosedConnections: {
    name: 'rpc_websocket_connections_closed_total',
    help: 'Total number of WebSocket connections closed',
  },
  connectionDuration: {
    name: 'rpc_websocket_connection_duration_seconds',
    help: 'Histogram of WebSocket connection duration in seconds',
    buckets: [1, 5, 10, 30, 60, 300, 600, 1800, 3600, 7200, 18000, 43200, 86400], // s (seconds)
  },
  messageDuration: {
    name: 'rpc_websocket_message_duration_miliseconds',
    help: 'Histogram of message sent to websocket in miliseconds',
    labelNames: ['method'],
    buckets: [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 20000, 30000, 40000, 50000, 60000], // ms (milliseconds)
  },
  connLimiter: {
    activeConnectionsMetric: {
      name: 'rpc_websocket_active_connections',
      help: 'Relay websocket active connections',
    },
    ipConnectionsMetric: {
      name: 'rpc_websocket_active_connections_per_ip',
      help: 'Relay websocket active connections by ip',
      labelNames: ['ip'],
    },
    connectionLimitMetric: {
      name: 'rpc_websocket_total_connection_limit_enforced',
      help: 'Relay websocket total connection limits enforced',
    },
    ipConnectionLimitMetric: {
      name: 'rpc_websocket_total_connection_limit_by_ip_enforced',
      help: 'Relay websocket total connection limits by ip enforced',
      labelNames: ['ip'],
    },
    inactivityTTLLimitMetric: {
      name: 'rpc_websocket_total_connection_limit_by_ttl_enforced',
      help: 'Relay websocket total connection ttl limits enforced',
    },
  },
  BATCH_REQUEST_METHOD_NAME: 'batch_request',
  METHODS: {
    ETH_CALL: 'eth_call',
    ETH_CHAINID: 'eth_chainId',
    ETH_GETLOGS: 'eth_getLogs',
    ETH_GETCODE: 'eth_getCode',
    ETH_GASPRICE: 'eth_gasPrice',
    ETH_SUBSCRIBE: 'eth_subscribe',
    ETH_NEWFILTER: 'eth_newFilter',
    ETH_GETBALANCE: 'eth_getBalance',
    ETH_UNSUBSCRIBE: 'eth_unsubscribe',
    ETH_BLOCKNUMBER: 'eth_blockNumber',
    ETH_ESTIMATEGAS: 'eth_estimateGas',
    ETH_GETSTORAGEAT: 'eth_getStorageAt',
    ETH_GETBLOCKBYHASH: 'eth_getBlockByHash',
    ETH_GETBLOCKBYNUMBER: 'eth_getBlockByNumber',
    ETH_SENDRAWTRANSACTION: 'eth_sendRawTransaction',
    ETH_GETTRANSACTIONCOUNT: 'eth_getTransactionCount',
    ETH_GETTRANSACTIONBYHASH: 'eth_getTransactionByHash',
    ETH_GETTRANSACTIONRECEIPT: 'eth_getTransactionReceipt',
    ETH_MAXPRIORITYFEEPERGAS: 'eth_maxPriorityFeePerGas',
    WEB3_CLIENTVERSION: 'web3_clientVersion',
    WEB3_SHA3: 'web3_sha3',
  },
};
