// SPDX-License-Identifier: Apache-2.0

export const WS_CONSTANTS = {
  BATCH_REQUEST_METHOD_NAME: 'batch_request',
  METHODS: {
    ETH_UNSUBSCRIBE: 'eth_unsubscribe',
    ETH_SUBSCRIBE: 'eth_subscribe',
  },
  // Caps concurrent Mirror Node lookups per batch when validating a multi-address eth_subscribe logs filter.
  SUBSCRIBE_LOGS_ADDRESS_BATCH_SIZE: 25,
  // Keeps each poll small while the WebSocket poller catches up on blocks it missed.
  POLLER_MAX_BLOCKS_PER_POLL: 10,
  // Caps the growing delay between retries of a failed WebSocket poll.
  POLLER_MAX_RETRY_DELAY_MS: 10_000,
};
