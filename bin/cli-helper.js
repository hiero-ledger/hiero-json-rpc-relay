// SPDX-License-Identifier: Apache-2.0

export class CliHelper {
  /**
   * Populates environment variables based on the specified network.
   *
   * @param {string} network - The network to configure. Accepted values are:
   *                           - 'mainnet'
   *                           - 'testnet'
   *                           - 'previewnet'
   * @returns {Object} An object containing the network-specific environment configuration:
   *                   - CHAIN_ID {string} - The hexadecimal chain ID for the network.
   *                   - HEDERA_NETWORK {string} - JSON string mapping Hedera nodes to account IDs.
   *                   - MIRROR_NODE_URL {string} - URL of the Hedera mirror node.
   *                   - MIRROR_NODE_URL_WEB3 {string} - URL of the Hedera mirror node for Web3 access.
   *
   * @throws {Error} Throws an error if an invalid network is provided.
   */
  static populateEnvBasedOnNetwork = (network) => {
    switch (network) {
      case 'mainnet': {
        return {
          CHAIN_ID: '0x127',
          HEDERA_NETWORK: '{"0.mainnet.hedera.com:50211":"0.0.3"}',
          MIRROR_NODE_URL: 'https://mainnet-public.mirrornode.hedera.com',
          MIRROR_NODE_URL_WEB3: 'https://mainnet-public.mirrornode.hedera.com'
        };
      }
      case 'testnet': {
        return {
          CHAIN_ID: '0x128',
          HEDERA_NETWORK: '{"0.testnet.hedera.com:50211":"0.0.3"}',
          MIRROR_NODE_URL: 'https://testnet.mirrornode.hedera.com',
          MIRROR_NODE_URL_WEB3: 'https://testnet.mirrornode.hedera.com'
        };
      }
      case 'previewnet': {
        return {
          CHAIN_ID: '0x129',
          HEDERA_NETWORK: '{"0.previewnet.hedera.com:50211":"0.0.3"}',
          MIRROR_NODE_URL_WEB3: 'https://previewnet.mirrornode.hedera.com',
          MIRROR_NODE_URL: 'https://previewnet.mirrornode.hedera.com'
        };
      }
      default: {
        throw new Error('Invalid network selection.');
      }
    }
  };

  /**
   * Populates environment variables based on read-only mode and operator credentials.
   *
   * @param {Object} argv - Command-line arguments object (typically from yargs or similar parser).
   * @param {boolean} argv['read-only'] - If true, enables read-only mode; operator credentials are optional.
   * @param {string} [argv['operator-id']] - Operator account ID (required if not in read-only mode).
   * @param {string} [argv['operator-key']] - Operator private key (required if not in read-only mode).
   * @param {string} [argv['operator-key-format']] - Format of the operator key (required if not in read-only mode).
   *                                                Accepted values: "HEX_ECDSA", "HEX_ED25519".
   *
   * @returns {Object} An object containing either:
   *                   - { READ_ONLY: true } if read-only mode is enabled.
   *                   - { READ_ONLY: false, OPERATOR_ID_MAIN, OPERATOR_KEY_MAIN, OPERATOR_KEY_FORMAT } with operator details.
   *
   * @throws {Error} Throws an error if required operator credentials are missing while read-only mode is disabled.
   */
  static populateEnvBaseOnReadOnlyOption = (argv) => {
    if (!argv['read-only']) {
      if (!argv['operator-id']) {
        throw new Error('Argument: --operator-id is required unless read-only mode is enabled.');
      }
      if (!argv['operator-key']) {
        throw new Error('Argument: --operator-key is required unless read-only mode is enabled.');
      }
      if (!argv['operator-key-format']) {
        throw new Error('Argument: --operator-key-format is required unless read-only mode is enabled. Possible choices are: "HEX_ECDSA" or "HEX_ED25519".');
      }

      return {
        READ_ONLY: false,
        OPERATOR_ID_MAIN: argv['operator-id'],
        OPERATOR_KEY_MAIN: argv['operator-key'],
        OPERATOR_KEY_FORMAT: argv['operator-key-format'],
      };
    }

    return {
      READ_ONLY: true
    };
  };

  /**
   * Cross-platform graceful stop
   *
   * @param child
   * @param spawn
   */
  static gracefulStop = (child, spawn) => {
    if (!child) {
      process.exit(0);
      return;
    }

    child.on('close', (code, signal) => {
      console.log('Caught interrupt signal. Shutting down gracefully...');
      process.exit(0);
    });

    const { pid } = child;
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', pid, '/T', '/F']);
    } else {
      child.kill('SIGTERM');
    }
  };

  /**
   * Determines the stdio configuration based on whether logging is enabled.
   *
   * @param {string | undefined | null} loggingPath - Path to the logging file. If falsy, stdio will inherit from the parent process.
   * @returns {{
   *   stdio: 'inherit' | ['ignore', 'pipe', 'pipe'],
   *   overrideStd: boolean
   * }}
   *
   * @property {'inherit' | ['ignore', 'pipe', 'pipe']} stdio - Defines how stdin, stdout, and stderr are handled.
   * @property {boolean} overrideStd - Indicates whether stdio should be overridden.
   */
  static getStdio = (loggingPath) => {
    if (!loggingPath) {
      return {
        stdio: 'inherit',
        overrideStd: false
      };
    }

    return {
      stdio: ['ignore', 'pipe', 'pipe'],
      overrideStd: true
    };
  };
}
