#!/usr/bin/env node

// SPDX-License-Identifier: Apache-2.0

const fs = require('fs');
const yargs = require('yargs');
const dotenv = require('dotenv');
const { hideBin } = require('yargs/helpers');
const { spawn } = require('child_process');
const { CliHelper } = require('./cli-helper');

/**
 * This script is the entry point for the Hiero JSON-RPC Relay CLI.
 */
let childProcess;
let parser;
try {
  parser = yargs(hideBin(process.argv))
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
              ...CliHelper.MANDATORY_ENV_OVERRIDES
            },
            shell: true
          });

          return;
        }

        const readOnlyEnvs = CliHelper.populateEnvBaseOnReadOnlyOption(argv);
        const networkEnvs = CliHelper.populateEnvBasedOnNetwork(argv.network);
        const stdIoInfo = CliHelper.getStdio(argv['logging-path']);

        childProcess = spawn('node', ['.standalone/dist/index.js'], {
          stdio: stdIoInfo.stdio,
          env: {
            ...process.env,
            ...CliHelper.MANDATORY_ENV_OVERRIDES,
            ...readOnlyEnvs,
            ...networkEnvs,
            ...(argv['chain-id'] ? { CHAIN_ID: argv['chain-id'] } : {}),
            ...(argv['mirror-node-rest-url'] ? { MIRROR_NODE_URL: argv['mirror-node-rest-url'] } : {}),
            ...(argv['mirror-node-web3-url'] ? { MIRROR_NODE_URL_WEB3: argv['mirror-node-web3-url'] } : {}),
            ...(argv['logging'] ? { LOG_LEVEL: argv['logging'] } : {}),
            ...(argv.hasOwnProperty('json-pretty-print-enabled') ? { PRETTY_LOGS_ENABLED: argv['json-pretty-print-enabled'] } : {}),
            ...(argv.hasOwnProperty('rpc-http-enabled') ? { RPC_HTTP_ENABLED: argv['rpc-http-enabled'] } : {}),
            ...(argv.hasOwnProperty('rpc-ws-enabled') ? { RPC_WS_ENABLED: argv['rpc-ws-enabled'] } : {}),
          },
          shell: true
        });


        if (stdIoInfo.overrideStd) {
          const logStream = fs.createWriteStream(argv['logging-path'], { flags: 'a' });

          childProcess.stdout.on('data', (data) => {
            logStream.write(data);
          });

          childProcess.stderr.on('data', (err) => {
            logStream.write(err);
          });

          console.log(`All logs are redirected to ${argv['logging-path']}`);
        }
      }
    )
    .option('n', {
      alias: 'network',
      demandOption: false,
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
    .option('logging-path', {
      demandOption: false,
      describe: 'Specify the logging path.',
      type: 'string'
    })
    .option('json-pretty-print-enabled', {
      default: true,
      demandOption: false,
      describe: 'Choose whether to enable a basic ndjson formatter to be used in development.',
      type: 'boolean'
    })
    .option('rpc-http-enabled', {
      default: true,
      demandOption: false,
      describe: 'Choose whether to start the http server.',
      type: 'boolean'
    })
    .option('rpc-ws-enabled', {
      default: false,
      demandOption: false,
      describe: 'Choose whether to start the ws server',
      type: 'boolean'
    })
    .check((argv) => {
      if (!argv.c && !argv.network) {
        throw new Error('You must specify --network (-n) when --config-file (-c) is not provided.');
      }
      return true;
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
    );
  parser.parse();
} catch (e) {
  parser.showHelp();
  console.log(`\n${e.message}`);
}

process.on('SIGINT', async () => {
  CliHelper.gracefulStop(childProcess, spawn);
});

process.on('SIGTERM', async () => {
  CliHelper.gracefulStop(childProcess, spawn);
});
