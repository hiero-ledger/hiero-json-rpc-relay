// SPDX-License-Identifier: Apache-2.0

export const WS_CONSTANTS = {
  BATCH_REQUEST_METHOD_NAME: 'batch_request',
  METHODS: {
    ETH_UNSUBSCRIBE: 'eth_unsubscribe',
    ETH_SUBSCRIBE: 'eth_subscribe',
  },
  // Caps concurrent Mirror Node lookups per batch when validating a multi-address eth_subscribe logs filter.
  SUBSCRIBE_LOGS_ADDRESS_BATCH_SIZE: 25,
};
