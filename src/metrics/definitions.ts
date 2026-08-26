// SPDX-License-Identifier: Apache-2.0

export type MetricKind = 'counter' | 'gauge' | 'histogram';

export interface MetricDefinition<K extends MetricKind = MetricKind> {
  readonly kind: K;
  readonly name: string;
  readonly help: string;
  readonly labelNames?: readonly string[];
  readonly buckets?: readonly number[];
}

export type CounterDefinition = MetricDefinition<'counter'>;
export type GaugeDefinition = MetricDefinition<'gauge'>;
export type HistogramDefinition = MetricDefinition<'histogram'>;

const counter = (definition: Omit<CounterDefinition, 'kind' | 'buckets'>): CounterDefinition => ({
  kind: 'counter',
  ...definition,
});

const gauge = (definition: Omit<GaugeDefinition, 'kind' | 'buckets'>): GaugeDefinition => ({
  kind: 'gauge',
  ...definition,
});

const histogram = (definition: Omit<HistogramDefinition, 'kind'>): HistogramDefinition => ({
  kind: 'histogram',
  ...definition,
});

/**
 * Latency buckets in milliseconds, shared by the JSON-RPC and WebSocket request timers.
 */
const RPC_LATENCY_MS_BUCKETS = [
  5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 20000, 30000, 40000, 50000, 60000,
] as const;

/** Latency buckets in milliseconds for Mirror Node calls. */
const MIRROR_NODE_LATENCY_MS_BUCKETS = [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 20000, 30000] as const;

/** Duration buckets in seconds for lock waits and holds. */
const LOCK_DURATION_SECONDS_BUCKETS = [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30] as const;

/** Duration buckets in seconds for worker task execution. */
const WORKER_TASK_DURATION_SECONDS_BUCKETS = [
  0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 15, 20, 25, 30, 35, 40, 50, 60, 90, 120,
] as const;

/** Duration buckets in milliseconds for time spent queued ahead of a worker thread. */
const WORKER_QUEUE_WAIT_MS_BUCKETS = [
  5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 15000, 20000, 25000, 30000, 35000, 40000, 50000, 60000,
] as const;

/** Duration buckets in seconds for WebSocket connection lifetimes. */
const WS_CONNECTION_DURATION_SECONDS_BUCKETS = [
  1, 5, 10, 30, 60, 300, 600, 1800, 3600, 7200, 18000, 43200, 86400,
] as const;

/** Duration buckets in seconds for WebSocket subscription lifetimes. */
const WS_SUBSCRIPTION_DURATION_SECONDS_BUCKETS = [
  0.05, // fraction of a second
  1, // one second
  10, // 10 seconds
  60, // 1 minute
  120, // 2 minute
  300, // 5 minutes
  1200, // 20 minutes
  3600, // 1 hour
  86400, // 24 hours
] as const;

/**
 * Every metric exported by the relay, grouped by the subsystem that observes it.
 *
 * Names, help text, labels and buckets here are the values scraped from `/metrics`, so changing one
 * is a breaking change for any dashboard or alert built on it.
 */
export const METRICS = {
  /** Cost and error metrics for interactions with the Consensus Node. */
  consensusNode: {
    responseCost: histogram({
      name: 'rpc_relay_consensusnode_response',
      help: 'Relay consensusnode mode type status cost histogram',
      labelNames: ['mode', 'type', 'status'],
    }),
    gasFee: histogram({
      name: 'rpc_relay_consensusnode_gasfee',
      help: 'Relay consensusnode mode type status gas fee histogram',
      labelNames: ['mode', 'type', 'status'],
    }),
    errors: counter({
      name: 'rpc_relay_consensus_node_errors_total',
      help: 'Counter for calls to methods of CacheService separated by CallingMethod and CacheType',
      labelNames: ['status_name'],
    }),
    clientResets: counter({
      name: 'rpc_relay_client_service',
      help: 'Relay Client Service',
      labelNames: ['transactions', 'errors'],
    }),
  },

  /** Metrics covering the `eth_*` namespace and transaction submission. */
  eth: {
    executions: counter({
      name: 'rpc_relay_eth_executions',
      help: 'Relay rpc_relay_eth_executions function',
      labelNames: ['method'],
    }),
    wrongNonceErrors: counter({
      name: 'rpc_relay_wrong_nonce_errors_total',
      help: 'Wrong nonce errors counter',
      labelNames: ['strategy'],
    }),
  },

  /** Cache layer metrics. */
  cache: {
    lruSize: gauge({
      name: 'rpc_relay_cache',
      help: 'Relay LRU cache gauge',
    }),
    serviceMethods: counter({
      name: 'rpc_cache_service_methods_counter',
      help: 'Counter for calls to methods of CacheService separated by CallingMethod and CacheType',
      labelNames: ['callingMethod', 'cacheType', 'method'],
    }),
  },

  /** Mirror Node client metrics. */
  mirrorNode: {
    responseLatency: histogram({
      name: 'rpc_relay_mirror_response',
      help: 'Mirror node response method statusCode latency histogram',
      labelNames: ['method', 'statusCode'],
      buckets: MIRROR_NODE_LATENCY_MS_BUCKETS,
    }),
    httpErrorCodes: counter({
      name: 'rpc_relay_mirror_node_http_error_code_count',
      help: 'Count of errors returned from Mirror Node by HTTP status code and error type',
      labelNames: ['method', 'statusCode'],
    }),
  },

  /** Operator account metrics. */
  operator: {
    balance: gauge({
      name: 'rpc_relay_operator_balance',
      help: 'Relay operator balance gauge',
      labelNames: ['mode', 'type', 'accountId'],
    }),
  },

  /** HBAR rate limiter metrics. */
  hbarLimiter: {
    limitCounter: counter({
      name: 'rpc_relay_hbar_rate_limit',
      help: 'Relay Hbar limit counter',
      labelNames: ['mode', 'methodName'],
    }),
    remainingBudget: gauge({
      name: 'rpc_relay_hbar_rate_remaining',
      help: 'Relay Hbar rate limit remaining budget',
    }),
    totalLimit: gauge({
      name: 'rpc_relay_hbar_rate_total_limit',
      help: 'Total configured HBAR rate limit',
    }),

    /**
     * Per-tier counter of spending plans.
     *
     * @param tier - The subscription tier the counter tracks.
     */
    uniqueSpendingPlans: (tier: string): CounterDefinition =>
      counter({
        name: `unique_spending_plans_counter_${tier.toLowerCase()}`,
        help: `Tracks the number of unique ${tier} spending plans used during the limit duration`,
      }),

    /**
     * Per-tier gauge of the mean tinybar spend across that tier's plans.
     *
     * @param tier - The subscription tier the gauge tracks.
     */
    averageSpendingPlanAmountSpent: (tier: string): GaugeDefinition =>
      gauge({
        name: `average_spending_plan_amount_spent_gauge_${tier.toLowerCase()}`,
        help: `Tracks the average amount of tinybars spent by ${tier} spending plans`,
      }),
  },

  /** Nonce-ordering lock metrics. */
  lock: {
    waitTime: histogram({
      name: 'rpc_relay_lock_wait_time_seconds',
      help: 'Time waiting in queue to acquire a lock. High values indicate contention.',
      labelNames: ['strategy'],
      buckets: LOCK_DURATION_SECONDS_BUCKETS,
    }),
    holdDuration: histogram({
      name: 'rpc_relay_lock_hold_duration_seconds',
      help: 'Time a lock is held from acquisition to release. Should be well under 30s.',
      labelNames: ['strategy'],
      buckets: LOCK_DURATION_SECONDS_BUCKETS,
    }),
    waitingTxns: gauge({
      name: 'rpc_relay_lock_waiting_txns',
      help: 'Current number of transactions waiting in lock queues (sum across all addresses).',
      labelNames: ['strategy'],
    }),
    acquisitions: counter({
      name: 'rpc_relay_lock_acquisitions_total',
      help: 'Lock acquisition attempts. Status: success, fail.',
      labelNames: ['strategy', 'status'],
    }),
    timeoutReleases: counter({
      name: 'rpc_relay_lock_timeout_releases_total',
      help: 'Locks released due to max hold time (30s). Indicates hung transactions.',
      labelNames: ['strategy'],
    }),
    zombieCleanups: counter({
      name: 'rpc_relay_lock_zombie_cleanups_total',
      help: 'Zombie queue entries removed (crashed waiters detected via missing heartbeat). Only applicable to Redis strategy.',
    }),
    activeCount: gauge({
      name: 'rpc_relay_lock_active_count',
      help: 'Currently held locks.',
      labelNames: ['strategy'],
    }),
    redisErrors: counter({
      name: 'rpc_relay_lock_redis_errors_total',
      help: 'Redis Lock Service errors',
      labelNames: ['operation'],
    }),
    queueRejoins: counter({
      name: 'rpc_relay_lock_queue_rejoins_total',
      help: 'Times a waiter found itself missing from the lock queue and rejoined. Non-zero indicates Redis resets, failovers, evictions, or event-loop stalls causing zombie cleanup of live waiters.',
      labelNames: ['strategy'],
    }),
  },

  /** Rate limiting metrics. */
  rateLimiter: {
    ipRateLimit: counter({
      name: 'rpc_relay_ip_rate_limit',
      help: 'Relay IP rate limit counter',
      labelNames: ['methodName', 'storeType'],
    }),
    storeFailures: counter({
      name: 'rpc_relay_rate_limit_store_failures',
      help: 'Rate limit store failure counter',
      labelNames: ['storeType', 'operation'],
    }),
  },

  /** Pending transaction pool metrics. */
  transactionPool: {
    pendingCount: gauge({
      name: 'rpc_relay_txpool_pending_count',
      help: 'Current total pending transactions across all addresses.',
    }),
    operations: counter({
      name: 'rpc_relay_txpool_operations_total',
      help: 'Pool operations. Operation: add, remove.',
      labelNames: ['operation'],
    }),
    storageErrors: counter({
      name: 'rpc_relay_txpool_storage_errors_total',
      help: 'Storage operation failures. Backend: local, redis. Operation: add, remove, get.',
      labelNames: ['operation', 'backend'],
    }),
    activeAddresses: gauge({
      name: 'rpc_relay_txpool_active_addresses',
      help: 'All current unique addresses having transactions in the pending pool',
    }),
  },

  /** Worker thread pool metrics. */
  workers: {
    taskDuration: histogram({
      name: 'rpc_relay_worker_task_duration_seconds',
      help: 'Tracks how long each task takes to execute (in seconds).',
      labelNames: ['function'],
      buckets: WORKER_TASK_DURATION_SECONDS_BUCKETS,
    }),
    tasksCompleted: counter({
      name: 'rpc_relay_worker_tasks_completed_total',
      help: 'Counts total tasks by type.',
      labelNames: ['function'],
    }),
    taskFailures: counter({
      name: 'rpc_relay_worker_task_failures_total',
      help: 'Counts total failures by task type.',
      labelNames: ['function', 'error_type'],
    }),
    queueWaitTime: histogram({
      name: 'rpc_relay_worker_queue_wait_time_milliseconds',
      help: 'Time tasks have spent waiting in queue.',
      buckets: WORKER_QUEUE_WAIT_MS_BUCKETS,
    }),
    poolUtilization: gauge({
      name: 'rpc_relay_worker_pool_utilization',
      help: 'Ratio (0-1) of how busy workers are.',
    }),
    poolActiveThreads: gauge({
      name: 'rpc_relay_worker_pool_active_threads',
      help: 'Current number of worker threads.',
    }),
    poolQueueSize: gauge({
      name: 'rpc_relay_worker_pool_queue_size',
      help: 'The current number of tasks waiting to be assigned.',
    }),
  },

  /** HTTP JSON-RPC server metrics. */
  server: {
    /** Latency of the whole HTTP request, observed by the Koa middleware. */
    methodResponse: histogram({
      name: 'rpc_relay_method_response',
      help: 'JSON RPC method statusCode latency histogram',
      labelNames: ['method', 'statusCode'],
      buckets: RPC_LATENCY_MS_BUCKETS,
    }),
    /** Latency of an individual JSON-RPC call, which may be one entry of a batch. */
    methodResult: histogram({
      name: 'rpc_relay_method_result',
      help: 'JSON RPC method statusCode latency histogram',
      labelNames: ['method', 'statusCode', 'isPartOfBatch'],
      buckets: RPC_LATENCY_MS_BUCKETS,
    }),
  },

  /**
   * WebSocket server metrics.
   */
  ws: {
    methodsCounter: counter({
      name: 'rpc_websocket_method_counter',
      help: 'Relay websocket total methods called received through websocket',
      labelNames: ['method'],
    }),
    methodsCounterByIp: counter({
      name: 'rpc_websocket_method_by_ip_counter',
      help: 'Relay websocket methods called by ip received through websocket',
      labelNames: ['ip', 'method'],
    }),
    totalMessageCounter: counter({
      name: 'rpc_websocket_messages_received_total',
      help: 'Total number of messages received by the WebSocket server',
    }),
    totalOpenedConnections: counter({
      name: 'rpc_websocket_connections_established_total',
      help: 'Total number of WebSocket connections established',
    }),
    totalClosedConnections: counter({
      name: 'rpc_websocket_connections_closed_total',
      help: 'Total number of WebSocket connections closed',
    }),
    connectionDuration: histogram({
      name: 'rpc_websocket_connection_duration_seconds',
      help: 'Histogram of WebSocket connection duration in seconds',
      buckets: WS_CONNECTION_DURATION_SECONDS_BUCKETS,
    }),
    messageDuration: histogram({
      name: 'rpc_websocket_message_duration_miliseconds',
      help: 'Histogram of message sent to websocket in miliseconds',
      labelNames: ['method'],
      buckets: RPC_LATENCY_MS_BUCKETS,
    }),

    /** Connection and inactivity limits enforced by ConnectionLimiter. */
    connLimiter: {
      activeConnections: gauge({
        name: 'rpc_websocket_active_connections',
        help: 'Relay websocket active connections',
      }),
      activeConnectionsByIp: gauge({
        name: 'rpc_websocket_active_connections_per_ip',
        help: 'Relay websocket active connections by ip',
        labelNames: ['ip'],
      }),
      connectionLimitEnforced: counter({
        name: 'rpc_websocket_total_connection_limit_enforced',
        help: 'Relay websocket total connection limits enforced',
      }),
      ipConnectionLimitEnforced: counter({
        name: 'rpc_websocket_total_connection_limit_by_ip_enforced',
        help: 'Relay websocket total connection limits by ip enforced',
        labelNames: ['ip'],
      }),
      inactivityTtlEnforced: counter({
        name: 'rpc_websocket_total_connection_limit_by_ttl_enforced',
        help: 'Relay websocket total connection ttl limits enforced',
      }),
    },

    /** Poll metrics. */
    poller: {
      activePolls: gauge({
        name: 'rpc_websocket_active_polls',
        help: 'Relay websocket active polls count',
      }),
      activeNewHeadsPolls: gauge({
        name: 'rpc_websocket_active_newheads_polls',
        help: 'Relay websocket active newHeads polls count',
      }),
    },

    /** Subscription metrics. */
    subscription: {
      activeSubscriptionTimes: histogram({
        name: 'rpc_websocket_subscription_times',
        help: 'Relay websocket active subscription timer',
        buckets: WS_SUBSCRIPTION_DURATION_SECONDS_BUCKETS,
      }),
      resultsSentToSubscribers: counter({
        name: 'rpc_websocket_poll_received_results',
        help: 'Relay websocket counter for the unique results sent to subscribers',
        labelNames: ['subId', 'tag'],
      }),
    },
  },
} as const;
