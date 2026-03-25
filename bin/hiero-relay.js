#!/usr/bin/env node

// SPDX-License-Identifier: Apache-2.0

const yargs = require('yargs');
const { hideBin } = require('yargs/helpers');
const { spawn } = require('child_process');
const dotenv = require('dotenv');

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
const populateEnvBasedOnNetwork = (network) => {
  switch (network) {
    case 'mainnet': {
      return {
        CHAIN_ID: '0x127',
        HEDERA_NETWORK: '{ "0.mainnet.hedera.com:50211": "0.0.3" }',
        MIRROR_NODE_URL: 'https://mainnet-public.mirrornode.hedera.com:443',
        MIRROR_NODE_URL_WEB3: 'https://mainnet-public.mirrornode.hedera.com:443'
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
const populateEnvBaseOnReadOnlyOption = (argv) => {
  if (!argv['read-only']) {
    if (!argv['operator-id']) {
      throw new Error('The "--operator-id" option is required unless read-only mode is enabled.');
    }
    if (!argv['operator-key']) {
      throw new Error('The "--operator-key" option is required unless read-only mode is enabled.');
    }
    if (!argv['operator-key-format']) {
      throw new Error('The "--operator-key-format" is required unless read-only mode is enabled. Possible choices are: "HEX_ECDSA" or "HEX_ED25519".');
    }

    return {
      READ_ONLY: false,
      OPERATOR_ID_MAIN: argv['operator-id'],
      OPERATOR_KEY_MAIN: argv['operator-key'],
      OPERATOR_KEY_FORMAT: argv['operator-key-format']
    };
  }

  return {
    READ_ONLY: true
  };
};

/**
 * Hardcoded env values
 */
const MANDATORY_ENV_OVERRIDES = {
  'npm_package_version': '1.0.0',
  'REDIS_ENABLED': 'false'
};

/**
 * Cross-platform graceful stop
 *
 * @param child
 */
const gracefulStop = (child) => {
  const { pid } = child;
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', pid, '/T', '/F']);
  } else {
    try {
      process.kill(-pid, 'SIGTERM');
    } catch (e) {
      try {
        process.kill(pid, 'SIGTERM');
      } catch {
      }
    }
  }

  console.log('\nCaught interrupt signal. Shutting down gracefully...\n');
  process.exit(0);
};


/**
 * This script is the entry point for the Hiero JSON-RPC Relay CLI.
 */
let childProcess;
yargs(hideBin(process.argv))
  .command(
    '$0',
    'Starts a local hiero-json-rpc relay.', () => {
    },
    (argv) => {
      if (argv.help || argv.version) return;

      if (argv['config-file']) {
        const res = dotenv.config({
          path: argv['config-file']
        });

        if (res.error) {
          throw new Error(res.error);
        }

        childProcess = spawn('node', ['.standalone/dist/index.js'], {
          stdio: 'inherit',
          env: {
            ...process.env,
            ...MANDATORY_ENV_OVERRIDES
          },
          shell: true
        });

        return;
      }

      const readOnlyEnvs = populateEnvBaseOnReadOnlyOption(argv);
      const networkEnvs = populateEnvBasedOnNetwork(argv.network);

      childProcess = spawn('node', ['.standalone/dist/index.js'], {
        stdio: 'inherit',
        env: {
          ...process.env,
          ...MANDATORY_ENV_OVERRIDES,
          ...readOnlyEnvs,
          ...networkEnvs,
          ...(argv['chain-id'] ? { CHAIN_ID: argv['chain-id'] } : {}),
          ...(argv['mirror-node-rest-url'] ? { MIRROR_NODE_URL: argv['mirror-node-rest-url'] } : {}),
          ...(argv['mirror-node-web3-url'] ? { MIRROR_NODE_URL_WEB3: argv['mirror-node-web3-url'] } : {}),
          ...(argv['logging'] ? { LOG_LEVEL: argv['logging'] } : {})
        },
        shell: true
      });
    }
  )
  .option('n', {
    alias: 'network',
    demandOption: true,
    describe: 'Select a network to run the relay against.',
    type: 'string',
    choices: ['mainnet', 'testnet', 'previewnet']
  })
  .option('r', {
    alias: 'read-only',
    default: false,
    demandOption: false,
    describe: 'Run the relay in read-only mode (no operator id and key required).',
    type: 'boolean'
  })
  .option('operator-id', {
    demandOption: false,
    describe: 'Operator id in a "<realm>.<shard>.<num>" format.',
    type: 'string'
  })
  .option('operator-key', {
    demandOption: false,
    describe: 'Operator key.',
    type: 'string'
  })
  .option('operator-key-format', {
    demandOption: false,
    describe: 'Operator key format.',
    type: 'string',
    choices: ['HEX_ED25519', 'HEX_ECDSA']
  })
  .option('chain-id', {
    demandOption: false,
    describe: 'Select a chain id.',
    type: 'string',
    choices: ['0x127', '0x128', '0x129']
  })
  .option('mirror-node-rest-url', {
    demandOption: false,
    describe: 'Select a mirror node REST url.',
    type: 'string'
  })
  .option('mirror-node-web3-url', {
    demandOption: false,
    describe: 'Select a mirror node WEB3 url.',
    type: 'string'
  })
  .option('c', {
    alias: 'config-file',
    demandOption: false,
    describe: 'Specify the config file location.',
    type: 'string'
  })
  .option('l', {
    alias: 'logging',
    demandOption: false,
    describe: 'Specify the logging level.',
    type: 'string',
    choices: ['trace', 'debug', 'info', 'warn', 'error', 'fatal']
  })
  .demandCommand()
  .strictCommands()
  .recommendCommands()
  .epilogue(
    `
    Requirements:
    - Node.js >= v22.13.0
        Node version check: node -v
    - NPM >= v10.9.2
        NPM version check: npm -v`
  )
  .parse();

process.on('SIGINT', async () => {
  gracefulStop(childProcess);
});

process.on('SIGTERM', async () => {
  gracefulStop(childProcess);
});
