// SPDX-License-Identifier: Apache-2.0

/**
 * Extracts the type string associated with a specific key in the `_CONFIG` object.
 * If the key `K` exists in `_CONFIG`, it retrieves the 'type' property; otherwise, it resolves to `never`.
 *
 * Example:
 * - `'OPERATOR_ID_MAIN'` → `'string'` (if defined in `_CONFIG`)
 * - `'INVALID_KEY'` → `never`
 */
type ExtractTypeStringFromKey<K extends string> = K extends keyof typeof _CONFIG ? (typeof _CONFIG)[K]['type'] : never;

/**
 * Maps string representations of types (`'string'`, `'boolean'`, `'number'`, `'strArray'`, `'numArray'`) to their actual TypeScript types.
 *
 * Example:
 * - `'string'` → string
 * - `'boolean'` → boolean
 * - `'number'` → number
 * - `'strArray'` → string[]
 * - `'numArray'` → number[]
 */
type StringTypeToActualType<Tstr extends string> = Tstr extends 'string'
  ? string
  : Tstr extends 'boolean'
  ? boolean
  : Tstr extends 'number'
  ? number
  : Tstr extends 'strArray'
  ? string[]
  : Tstr extends 'numArray'
  ? number[]
  : never;

/**
 * Determines if a configuration value can be `undefined` based on two conditions:
 * - It must be optional (`required: false`)
 * - It must have no default value (`defaultValue: null`)
 *
 * Example:
 * - `'OPERATOR_ID_MAIN'` (`required: true`, `defaultValue: null`) → `false`
 * - `'WEB_SOCKET_PORT'` (`required: false`, `defaultValue: 8546`) → `false`
 * - `'GITHUB_PR_NUMBER'` (`required: false`, `defaultValue: null`) → `true`
 */
type CanBeUndefined<K extends string> = K extends keyof typeof _CONFIG
  ? (typeof _CONFIG)[K]['required'] extends true
    ? false
    : (typeof _CONFIG)[K]['defaultValue'] extends null
    ? true
    : false
  : never;

/**
 * Maps configuration keys to their corresponding TypeScript types,
 * including `undefined` when applicable based on the configuration.
 *
 * Example:
 * - `'OPERATOR_ID_MAIN'` (`type: 'string'`, `required: true`, `defaultValue: null`) → `string`
 * - `'WEB_SOCKET_PORT'` (`type: 'number'`, `required: false`, `defaultValue: 8546`) → `number`
 * - `'GITHUB_PR_NUMBER'` (`type: 'string'`, `required: false`, `defaultValue: null`) → `string | undefined`
 */
export type GetTypeOfConfigKey<K extends string> = CanBeUndefined<K> extends true
  ? StringTypeToActualType<ExtractTypeStringFromKey<K>> | undefined
  : StringTypeToActualType<ExtractTypeStringFromKey<K>>;

/**
 * Interface defining the structure of a configuration property.
 */
export interface ConfigProperty {
  envName: string; // Environment variable name
  type: 'string' | 'number' | 'boolean' | 'strArray' | 'numArray'; // Updated types
  required: boolean; // Whether the property is required
  defaultValue: string | number | boolean | readonly string[] | readonly number[] | null; // Default value (if any)
}

/**
 * Configuration object defining various properties and their metadata.
 * Each property is an object that contains information about the environment variable,
 * its type, whether it is required, and its default value.
 */
const _CONFIG = {
  BATCH_REQUESTS_DISALLOWED_METHODS: {
    envName: 'BATCH_REQUESTS_DISALLOWED_METHODS',
    type: 'strArray',
    required: false,
    defaultValue: [
      'debug_traceTransaction',
      'eth_newFilter',
      'eth_uninstallFilter',
      'eth_getFilterChanges',
      'eth_getFilterLogs',
      'eth_newBlockFilter',
      'eth_newPendingTransactionFilter',
    ],
  },
  BATCH_REQUESTS_ENABLED: {
    envName: 'BATCH_REQUESTS_ENABLED',
    type: 'boolean',
    required: false,
    defaultValue: true,
  },
  BATCH_REQUESTS_MAX_SIZE: {
    envName: 'BATCH_REQUESTS_MAX_SIZE',
    type: 'number',
    required: false,
    defaultValue: 100,
  },
  CACHE_MAX: {
    envName: 'CACHE_MAX',
    type: 'number',
    required: false,
    defaultValue: 1000,
  },
  CACHE_TTL: {
    envName: 'CACHE_TTL',
    type: 'number',
    required: false,
    defaultValue: 3600000,
  },
  CHAIN_ID: {
    envName: 'CHAIN_ID',
    type: 'string',
    required: true,
    defaultValue: '0x12a',
  },
  CLIENT_TRANSPORT_SECURITY: {
    envName: 'CLIENT_TRANSPORT_SECURITY',
    type: 'boolean',
    required: false,
    defaultValue: false,
  },
  CONSENSUS_MAX_EXECUTION_TIME: {
    envName: 'CONSENSUS_MAX_EXECUTION_TIME',
    type: 'number',
    required: false,
    defaultValue: 15000,
  },
  CONTRACT_CALL_GAS_LIMIT: {
    envName: 'CONTRACT_CALL_GAS_LIMIT',
    type: 'number',
    required: false,
    defaultValue: 50_000_000,
  },
  CONTRACT_QUERY_TIMEOUT_RETRIES: {
    envName: 'CONTRACT_QUERY_TIMEOUT_RETRIES',
    type: 'number',
    required: false,
    defaultValue: 3,
  },
  DEBUG_API_ENABLED: {
    envName: 'DEBUG_API_ENABLED',
    type: 'boolean',
    required: false,
    defaultValue: false,
  },
  DEFAULT_RATE_LIMIT: {
    envName: 'DEFAULT_RATE_LIMIT',
    type: 'number',
    required: false,
    defaultValue: 200,
  },
  DEV_MODE: {
    envName: 'DEV_MODE',
    type: 'boolean',
    required: false,
    defaultValue: false,
  },
  E2E_RELAY_HOST: {
    envName: 'E2E_RELAY_HOST',
    type: 'string',
    required: false,
    defaultValue: 'http://localhost:7546',
  },
  E2E_SERVER_PORT: {
    envName: 'E2E_SERVER_PORT',
    type: 'number',
    required: false,
    defaultValue: 7546,
  },
  ESTIMATE_GAS_THROWS: {
    envName: 'ESTIMATE_GAS_THROWS',
    type: 'boolean',
    required: false,
    defaultValue: true,
  },
  ETH_BLOCK_NUMBER_CACHE_TTL_MS: {
    envName: 'ETH_BLOCK_NUMBER_CACHE_TTL_MS',
    type: 'number',
    required: false,
    defaultValue: 1000,
  },
  ETH_CALL_ACCEPTED_ERRORS: {
    envName: 'ETH_CALL_ACCEPTED_ERRORS',
    type: 'numArray',
    required: false,
    defaultValue: [],
  },
  ETH_CALL_CACHE_TTL: {
    envName: 'ETH_CALL_CACHE_TTL',
    type: 'number',
    required: false,
    defaultValue: 200,
  },
  ETH_CALL_CONSENSUS_SELECTORS: {
    envName: 'ETH_CALL_CONSENSUS_SELECTORS',
    type: 'strArray',
    required: false,
    defaultValue: [],
  },
  ETH_CALL_DEFAULT_TO_CONSENSUS_NODE: {
    envName: 'ETH_CALL_DEFAULT_TO_CONSENSUS_NODE',
    type: 'boolean',
    required: false,
    defaultValue: false,
  },
  ETH_FEE_HISTORY_FIXED: {
    envName: 'ETH_FEE_HISTORY_FIXED',
    type: 'boolean',
    required: false,
    defaultValue: true,
  },
  ETH_GET_BALANCE_CACHE_TTL_MS: {
    envName: 'ETH_GET_BALANCE_CACHE_TTL_MS',
    type: 'number',
    required: false,
    defaultValue: 1000,
  },
  ETH_GET_GAS_PRICE_CACHE_TTL_MS: {
    envName: 'ETH_GET_GAS_PRICE_CACHE_TTL_MS',
    type: 'number',
    required: false,
    defaultValue: 1_800_000, // half an hour
  },
  ETH_GET_LOGS_BLOCK_RANGE_LIMIT: {
    envName: 'ETH_GET_LOGS_BLOCK_RANGE_LIMIT',
    type: 'number',
    required: false,
    defaultValue: 1000,
  },
  ETH_GET_TRANSACTION_COUNT_CACHE_TTL: {
    envName: 'ETH_GET_TRANSACTION_COUNT_CACHE_TTL',
    type: 'number',
    required: false,
    defaultValue: 500,
  },
  ETH_GET_TRANSACTION_COUNT_MAX_BLOCK_RANGE: {
    envName: 'ETH_GET_TRANSACTION_COUNT_MAX_BLOCK_RANGE',
    type: 'number',
    required: false,
    defaultValue: 1000,
  },
  HEDERA_SPECIFIC_REVERT_STATUSES: {
    envName: 'HEDERA_SPECIFIC_REVERT_STATUSES',
    type: 'strArray',
    required: false,
    defaultValue: ['WRONG_NONCE', 'INVALID_ACCOUNT_ID'],
  },
  FEE_HISTORY_MAX_RESULTS: {
    envName: 'FEE_HISTORY_MAX_RESULTS',
    type: 'number',
    required: false,
    defaultValue: 10,
  },
  FILE_APPEND_CHUNK_SIZE: {
    envName: 'FILE_APPEND_CHUNK_SIZE',
    type: 'number',
    required: false,
    defaultValue: 5120,
  },
  FILE_APPEND_MAX_CHUNKS: {
    envName: 'FILE_APPEND_MAX_CHUNKS',
    type: 'number',
    required: false,
    defaultValue: 20,
  },
  FILTER_API_ENABLED: {
    envName: 'FILTER_API_ENABLED',
    type: 'boolean',
    required: false,
    defaultValue: true,
  },
  FILTER_TTL: {
    envName: 'FILTER_TTL',
    type: 'number',
    required: false,
    defaultValue: 300000,
  },
  GAS_PRICE_PERCENTAGE_BUFFER: {
    envName: 'GAS_PRICE_PERCENTAGE_BUFFER',
    type: 'number',
    required: false,
    defaultValue: 0,
  },
  GAS_PRICE_TINY_BAR_BUFFER: {
    envName: 'GAS_PRICE_TINY_BAR_BUFFER',
    type: 'number',
    required: false,
    defaultValue: 10000000000,
  },
  GET_RECORD_DEFAULT_TO_CONSENSUS_NODE: {
    envName: 'GET_RECORD_DEFAULT_TO_CONSENSUS_NODE',
    type: 'boolean',
    required: false,
    defaultValue: false,
  },
  GH_ACCESS_TOKEN: {
    envName: 'GH_ACCESS_TOKEN',
    type: 'string',
    required: false,
    defaultValue: null,
  },
  GITHUB_PR_NUMBER: {
    envName: 'GITHUB_PR_NUMBER',
    type: 'string',
    required: false,
    defaultValue: null,
  },
  GITHUB_REPOSITORY: {
    envName: 'GITHUB_REPOSITORY',
    type: 'string',
    required: false,
    defaultValue: null,
  },
  GITHUB_TOKEN: {
    envName: 'GITHUB_TOKEN',
    type: 'string',
    required: false,
    defaultValue: null,
  },
  HAPI_CLIENT_DURATION_RESET: {
    envName: 'HAPI_CLIENT_DURATION_RESET',
    type: 'number',
    required: false,
    defaultValue: 3600000,
  },
  HAPI_CLIENT_ERROR_RESET: {
    envName: 'HAPI_CLIENT_ERROR_RESET',
    type: 'numArray',
    required: false,
    defaultValue: [21, 50],
  },
  HAPI_CLIENT_TRANSACTION_RESET: {
    envName: 'HAPI_CLIENT_TRANSACTION_RESET',
    type: 'number',
    required: false,
    defaultValue: 50,
  },
  HBAR_RATE_LIMIT_BASIC: {
    envName: 'HBAR_RATE_LIMIT_BASIC',
    type: 'number',
    required: false,
    defaultValue: 1_120_000_000, // 11.2 hbar
  },
  HBAR_RATE_LIMIT_EXTENDED: {
    envName: 'HBAR_RATE_LIMIT_EXTENDED',
    type: 'number',
    required: false,
    defaultValue: 3_200_000_000, // 32 hbar
  },
  HBAR_RATE_LIMIT_PRIVILEGED: {
    envName: 'HBAR_RATE_LIMIT_PRIVILEGED',
    type: 'number',
    required: false,
    defaultValue: 8_000_000_000, // 80 hbar
  },
  HBAR_RATE_LIMIT_DURATION: {
    envName: 'HBAR_RATE_LIMIT_DURATION',
    type: 'number',
    required: false,
    defaultValue: 86_400_000, // 24 hours
  },
  HBAR_RATE_LIMIT_TINYBAR: {
    envName: 'HBAR_RATE_LIMIT_TINYBAR',
    type: 'number',
    required: false,
    defaultValue: 800_000_000_000, // 8000 hbar
  },
  HEDERA_NETWORK: {
    envName: 'HEDERA_NETWORK',
    type: 'string',
    required: true,
    defaultValue: null,
  },
  HBAR_SPENDING_PLANS_CONFIG: {
    envName: 'HBAR_SPENDING_PLANS_CONFIG',
    type: 'string',
    required: false,
    defaultValue: 'spendingPlansConfig.json',
  },
  INITIAL_BALANCE: {
    envName: 'INITIAL_BALANCE',
    type: 'number',
    required: false,
    defaultValue: 5000000000,
  },
  INPUT_SIZE_LIMIT: {
    envName: 'INPUT_SIZE_LIMIT',
    type: 'number',
    required: false,
    defaultValue: 1,
  },
  LIMIT_DURATION: {
    envName: 'LIMIT_DURATION',
    type: 'number',
    required: false,
    defaultValue: 60000,
  },
  LOCAL_NODE: {
    envName: 'LOCAL_NODE',
    type: 'boolean',
    required: false,
    defaultValue: null,
  },
  LOG_LEVEL: {
    envName: 'LOG_LEVEL',
    type: 'string',
    required: false,
    defaultValue: 'trace',
  },
  MAX_BLOCK_RANGE: {
    envName: 'MAX_BLOCK_RANGE',
    type: 'number',
    required: false,
    defaultValue: 5,
  },
  MAX_TRANSACTION_FEE_THRESHOLD: {
    envName: 'MAX_TRANSACTION_FEE_THRESHOLD',
    type: 'number',
    required: false,
    defaultValue: 15_000_000,
  },
  MEMWATCH_ENABLED: {
    envName: 'MEMWATCH_ENABLED',
    type: 'boolean',
    required: false,
    defaultValue: null,
  },
  MIRROR_NODE_AGENT_CACHEABLE_DNS: {
    envName: 'MIRROR_NODE_AGENT_CACHEABLE_DNS',
    type: 'boolean',
    required: false,
    defaultValue: true,
  },
  MIRROR_NODE_CONTRACT_RESULTS_LOGS_PG_MAX: {
    envName: 'MIRROR_NODE_CONTRACT_RESULTS_LOGS_PG_MAX',
    type: 'number',
    required: false,
    defaultValue: 200,
  },
  MIRROR_NODE_CONTRACT_RESULTS_PG_MAX: {
    envName: 'MIRROR_NODE_CONTRACT_RESULTS_PG_MAX',
    type: 'number',
    required: false,
    defaultValue: 25,
  },
  MIRROR_NODE_HTTP_KEEP_ALIVE: {
    envName: 'MIRROR_NODE_HTTP_KEEP_ALIVE',
    type: 'boolean',
    required: false,
    defaultValue: true,
  },
  MIRROR_NODE_HTTP_KEEP_ALIVE_MSECS: {
    envName: 'MIRROR_NODE_HTTP_KEEP_ALIVE_MSECS',
    type: 'number',
    required: false,
    defaultValue: 1000,
  },
  MIRROR_NODE_HTTP_MAX_SOCKETS: {
    envName: 'MIRROR_NODE_HTTP_MAX_SOCKETS',
    type: 'number',
    required: false,
    defaultValue: 300,
  },
  MIRROR_NODE_HTTP_MAX_TOTAL_SOCKETS: {
    envName: 'MIRROR_NODE_HTTP_MAX_TOTAL_SOCKETS',
    type: 'number',
    required: false,
    defaultValue: 300,
  },
  MIRROR_NODE_HTTP_SOCKET_TIMEOUT: {
    envName: 'MIRROR_NODE_HTTP_SOCKET_TIMEOUT',
    type: 'number',
    required: false,
    defaultValue: 60000,
  },
  MIRROR_NODE_LIMIT_PARAM: {
    envName: 'MIRROR_NODE_LIMIT_PARAM',
    type: 'number',
    required: false,
    defaultValue: 100,
  },
  MIRROR_NODE_MAX_REDIRECTS: {
    envName: 'MIRROR_NODE_MAX_REDIRECTS',
    type: 'number',
    required: false,
    defaultValue: 5,
  },
  MIRROR_NODE_RETRIES: {
    envName: 'MIRROR_NODE_RETRIES',
    type: 'number',
    required: false,
    defaultValue: 0,
  },
  MIRROR_NODE_RETRIES_DEVMODE: {
    envName: 'MIRROR_NODE_RETRIES_DEVMODE',
    type: 'number',
    required: false,
    defaultValue: 5,
  },
  MIRROR_NODE_RETRY_CODES: {
    envName: 'MIRROR_NODE_RETRY_CODES',
    type: 'strArray',
    required: false,
    defaultValue: [],
  },
  MIRROR_NODE_RETRY_DELAY: {
    envName: 'MIRROR_NODE_RETRY_DELAY',
    type: 'number',
    required: false,
    defaultValue: 2000,
  },
  MIRROR_NODE_RETRY_DELAY_DEVMODE: {
    envName: 'MIRROR_NODE_RETRY_DELAY_DEVMODE',
    type: 'number',
    required: false,
    defaultValue: 200,
  },
  MIRROR_NODE_REQUEST_RETRY_COUNT: {
    envName: 'MIRROR_NODE_REQUEST_RETRY_COUNT',
    type: 'number',
    required: false,
    defaultValue: 10,
  },
  MIRROR_NODE_TIMEOUT: {
    envName: 'MIRROR_NODE_TIMEOUT',
    type: 'number',
    required: false,
    defaultValue: 10000,
  },
  MIRROR_NODE_URL: {
    envName: 'MIRROR_NODE_URL',
    type: 'string',
    required: true,
    defaultValue: null,
  },
  MIRROR_NODE_URL_HEADER_X_API_KEY: {
    envName: 'MIRROR_NODE_URL_HEADER_X_API_KEY',
    type: 'string',
    required: false,
    defaultValue: null,
  },
  MIRROR_NODE_URL_WEB3: {
    envName: 'MIRROR_NODE_URL_WEB3',
    type: 'string',
    required: false,
    defaultValue: null,
  },
  MULTI_SET: {
    envName: 'MULTI_SET',
    type: 'boolean',
    required: false,
    defaultValue: false,
  },
  // the actual env var in the node process is npm_package_version
  npm_package_version: {
    envName: 'npm_package_version',
    type: 'string',
    required: true,
    defaultValue: null,
  },
  OPERATOR_ID_ETH_SENDRAWTRANSACTION: {
    envName: 'OPERATOR_ID_ETH_SENDRAWTRANSACTION',
    type: 'string',
    required: false,
    defaultValue: null,
  },
  OPERATOR_ID_MAIN: {
    envName: 'OPERATOR_ID_MAIN',
    type: 'string',
    required: true,
    defaultValue: null,
  },
  OPERATOR_KEY_ETH_SENDRAWTRANSACTION: {
    envName: 'OPERATOR_KEY_ETH_SENDRAWTRANSACTION',
    type: 'string',
    required: false,
    defaultValue: null,
  },
  OPERATOR_KEY_FORMAT: {
    envName: 'OPERATOR_KEY_FORMAT',
    type: 'string',
    required: false,
    defaultValue: null,
  },
  OPERATOR_KEY_MAIN: {
    envName: 'OPERATOR_KEY_MAIN',
    type: 'string',
    required: true,
    defaultValue: null,
  },
  RATE_LIMIT_DISABLED: {
    envName: 'RATE_LIMIT_DISABLED',
    type: 'boolean',
    required: false,
    defaultValue: false,
  },
  REDIS_ENABLED: {
    envName: 'REDIS_ENABLED',
    type: 'boolean',
    required: false,
    defaultValue: true,
  },
  REDIS_RECONNECT_DELAY_MS: {
    envName: 'REDIS_RECONNECT_DELAY_MS',
    type: 'number',
    required: false,
    defaultValue: 1000,
  },
  REDIS_URL: {
    envName: 'REDIS_URL',
    type: 'string',
    required: false,
    defaultValue: 'redis://127.0.0.1:6379',
  },
  REQUEST_ID_IS_OPTIONAL: {
    envName: 'REQUEST_ID_IS_OPTIONAL',
    type: 'boolean',
    required: false,
    defaultValue: false,
  },
  SDK_REQUEST_TIMEOUT: {
    envName: 'SDK_REQUEST_TIMEOUT',
    type: 'number',
    required: false,
    defaultValue: 10000,
  },
  SEND_RAW_TRANSACTION_SIZE_LIMIT: {
    envName: 'SEND_RAW_TRANSACTION_SIZE_LIMIT',
    type: 'number',
    required: false,
    defaultValue: 131072,
  },
  SERVER_HOST: {
    envName: 'SERVER_HOST',
    type: 'string',
    required: false,
    defaultValue: null,
  },
  SERVER_PORT: {
    envName: 'SERVER_PORT',
    type: 'number',
    required: false,
    defaultValue: 7546,
  },
  SERVER_REQUEST_TIMEOUT_MS: {
    envName: 'SERVER_REQUEST_TIMEOUT_MS',
    type: 'number',
    required: false,
    defaultValue: 60000,
  },
  SUBSCRIPTIONS_ENABLED: {
    envName: 'SUBSCRIPTIONS_ENABLED',
    type: 'boolean',
    required: false,
    defaultValue: false,
  },
  TEST: {
    envName: 'TEST',
    type: 'boolean',
    required: false,
    defaultValue: null,
  },
  TEST_GAS_PRICE_DEVIATION: {
    envName: 'TEST_GAS_PRICE_DEVIATION',
    type: 'number',
    required: false,
    defaultValue: 0.2,
  },
  TEST_INITIAL_ACCOUNT_STARTING_BALANCE: {
    envName: 'TEST_INITIAL_ACCOUNT_STARTING_BALANCE',
    type: 'number',
    required: false,
    defaultValue: 2000,
  },
  TEST_TRANSACTION_RECORD_COST_TOLERANCE: {
    envName: 'TEST_TRANSACTION_RECORD_COST_TOLERANCE',
    type: 'number',
    required: false,
    defaultValue: 0.02,
  },
  TEST_WS_SERVER: {
    envName: 'TEST_WS_SERVER',
    type: 'boolean',
    required: false,
    defaultValue: false,
  },
  TIER_1_RATE_LIMIT: {
    envName: 'TIER_1_RATE_LIMIT',
    type: 'number',
    required: false,
    defaultValue: 100,
  },
  TIER_2_RATE_LIMIT: {
    envName: 'TIER_2_RATE_LIMIT',
    type: 'number',
    required: false,
    defaultValue: 800,
  },
  TIER_3_RATE_LIMIT: {
    envName: 'TIER_3_RATE_LIMIT',
    type: 'number',
    required: false,
    defaultValue: 1600,
  },
  TX_DEFAULT_GAS: {
    envName: 'TX_DEFAULT_GAS',
    type: 'number',
    required: false,
    defaultValue: null,
  },
  USE_ASYNC_TX_PROCESSING: {
    envName: 'USE_ASYNC_TX_PROCESSING',
    type: 'boolean',
    required: false,
    defaultValue: true,
  },
  WEB_SOCKET_HTTP_PORT: {
    envName: 'WEB_SOCKET_HTTP_PORT',
    type: 'number',
    required: false,
    defaultValue: 8547,
  },
  WEB_SOCKET_PORT: {
    envName: 'WEB_SOCKET_PORT',
    type: 'number',
    required: false,
    defaultValue: 8546,
  },
  WRITE_SNAPSHOT_ON_MEMORY_LEAK: {
    envName: 'WRITE_SNAPSHOT_ON_MEMORY_LEAK',
    type: 'boolean',
    required: false,
    defaultValue: null,
  },
  WS_BATCH_REQUESTS_ENABLED: {
    envName: 'WS_BATCH_REQUESTS_ENABLED',
    type: 'boolean',
    required: false,
    defaultValue: true,
  },
  WS_BATCH_REQUESTS_MAX_SIZE: {
    envName: 'WS_BATCH_REQUESTS_MAX_SIZE',
    type: 'number',
    required: false,
    defaultValue: 20,
  },
  WS_CACHE_TTL: {
    envName: 'WS_CACHE_TTL',
    type: 'number',
    required: false,
    defaultValue: 20000,
  },
  WS_CONNECTION_LIMIT: {
    envName: 'WS_CONNECTION_LIMIT',
    type: 'number',
    required: false,
    defaultValue: 10,
  },
  WS_CONNECTION_LIMIT_PER_IP: {
    envName: 'WS_CONNECTION_LIMIT_PER_IP',
    type: 'number',
    required: false,
    defaultValue: 10,
  },
  WS_MAX_INACTIVITY_TTL: {
    envName: 'WS_MAX_INACTIVITY_TTL',
    type: 'number',
    required: false,
    defaultValue: 300000,
  },
  WS_MULTIPLE_ADDRESSES_ENABLED: {
    envName: 'WS_MULTIPLE_ADDRESSES_ENABLED',
    type: 'boolean',
    required: false,
    defaultValue: false,
  },
  WS_NEW_HEADS_ENABLED: {
    envName: 'WS_NEW_HEADS_ENABLED',
    type: 'boolean',
    required: false,
    defaultValue: true,
  },
  WS_PING_INTERVAL: {
    envName: 'WS_PING_INTERVAL',
    type: 'number',
    required: false,
    defaultValue: 100000,
  },
  WS_POLLING_INTERVAL: {
    envName: 'WS_POLLING_INTERVAL',
    type: 'number',
    required: false,
    defaultValue: 500,
  },
  WS_RELAY_URL: {
    envName: 'WS_RELAY_URL',
    type: 'string',
    required: false,
    defaultValue: 'ws://127.0.0.1:8546',
  },
  WS_SAME_SUB_FOR_SAME_EVENT: {
    envName: 'WS_SAME_SUB_FOR_SAME_EVENT',
    type: 'boolean',
    required: false,
    defaultValue: true,
  },
  WS_SUBSCRIPTION_LIMIT: {
    envName: 'WS_SUBSCRIPTION_LIMIT',
    type: 'number',
    required: false,
    defaultValue: 10,
  },
} as const satisfies { [key: string]: ConfigProperty }; // Ensures _CONFIG is read-only and conforms to the ConfigProperty structure

export type ConfigKey = keyof typeof _CONFIG;

export class GlobalConfig {
  public static readonly ENTRIES: Record<ConfigKey, ConfigProperty> = _CONFIG;
}
