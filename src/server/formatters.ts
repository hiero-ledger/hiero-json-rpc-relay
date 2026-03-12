// SPDX-License-Identifier: Apache-2.0

/**
 * Format message prefix for logger.
 */
const formatRequestIdMessage = (requestId?: string): string => {
  return requestId ? `[Request ID: ${requestId}]` : '';
};

export { formatRequestIdMessage };
