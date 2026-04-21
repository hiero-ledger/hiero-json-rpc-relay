#!/usr/bin/env node

// SPDX-License-Identifier: Apache-2.0

const fs = require('fs');
const yargs = require('yargs');
const dotenv = require('dotenv');
const { hideBin } = require('yargs/helpers');
const { spawn } = require('child_process');
const pkg = require(`${__dirname}/../package.json`);
const { CliHelper } = require(`${__dirname}/cli-helper`);

const MANDATORY_ENV_OVERRIDES = {
  npm_package_version: pkg.version,
  REDIS_ENABLED: 'false'
};

const INDEX_PATH = `${__dirname}/../.standalone/dist/index.js`;

function run(argvInput = process.argv, deps = {}) {
  const {
    fsDep = fs,
    spawnDep = spawn,
    dotenvDep = dotenv,
    CliHelperDep = CliHelper,
    consoleDep = console,
    processDep = process
  } = deps;

  if (!fsDep.existsSync(INDEX_PATH)) {
    consoleDep.log(`Error: Artifact doesn't exist at ${INDEX_PATH}`);
    processDep.exit(1);
    return;
  }

  let childProcess;
  let parser;

  try {
    parser = yargs(hideBin(argvInput))
      .command(
        '$0',
        'Starts a local hiero-json-rpc relay.',
        () => {
        },
        (argv) => {
          if (argv.help || argv.version) return;

          if (argv['config-file']) {
            const res = dotenvDep.config({
              path: argv['config-file']
            });

            if (res.error) throw res.error;

            childProcess = spawnDep('node', [INDEX_PATH], {
              stdio: 'inherit',
              env: {
                ...processDep.env,
                ...MANDATORY_ENV_OVERRIDES
              }
            });

            return;
          }

          if (!argv['rpc-http-enabled'] && !argv['rpc-ws-enabled']) {
            throw new Error('Error: At least one transport must be enabled (--rpc-http-enabled or --rpc-ws-enabled)');
          }

          const readOnlyEnvs = CliHelperDep.populateEnvBaseOnReadOnlyOption(argv);
          const networkEnvs = CliHelperDep.populateEnvBasedOnNetwork(argv.network);
          const stdIoInfo = CliHelperDep.getStdio(argv['logging-path']);
          childProcess = spawnDep('node', [INDEX_PATH], {

            stdio: stdIoInfo.stdio,
            env: {
              ...processDep.env,
              ...MANDATORY_ENV_OVERRIDES,
              ...readOnlyEnvs,
              ...networkEnvs,
              ...(argv['chain-id'] && { CHAIN_ID: argv['chain-id'] }),
              ...(argv['mirror-node-rest-url'] && { MIRROR_NODE_URL: argv['mirror-node-rest-url'] }),
              ...(argv['mirror-node-web3-url'] && { MIRROR_NODE_URL_WEB3: argv['mirror-node-web3-url'] }),
              ...(argv['logging'] && { LOG_LEVEL: argv['logging'] }),
              ...({ PRETTY_LOGS_ENABLED: argv['json-pretty-print-enabled'] }),
              ...({ RPC_HTTP_ENABLED: argv['rpc-http-enabled'] }),
              ...({ RPC_WS_ENABLED: argv['rpc-ws-enabled'] }),
              ...(argv['rpc-http-api']?.length ? { RPC_HTTP_API: JSON.stringify(argv['rpc-http-api']) } : {}),
              ...(argv['rpc-ws-api']?.length ? { RPC_WS_API: JSON.stringify(argv['rpc-ws-api']) } : {})
            }
          }).on('error', (err) => {
            consoleDep.log(`Process failure: ${err}`);
          });

          if (stdIoInfo.overrideStd) {
            const logStream = fsDep.createWriteStream(argv['logging-path'], { flags: 'a' });

            childProcess.stdout.on('data', (data) => {
              logStream.write(data);
            });

            childProcess.stderr.on('data', (err) => {
              logStream.write(err);
            });

            childProcess.on('exit', () => {
              logStream.end();
            });

            consoleDep.log(`All logs are redirected to ${argv['logging-path']}`);
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
        choices: ['HEX_ED25519', 'HEX_ECDSA', 'DER']
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
      .option('rpc-http-api', {
        demandOption: false,
        describe: 'Choose which subdomain to activate for HTTP server',
        type: 'string',
        array: true,
        choices: ['eth', 'debug', 'net', 'web3', 'txpool', 'trace', 'admin']
      })
      .option('rpc-ws-api', {
        demandOption: false,
        describe: 'Choose which subdomain to activate for WS server',
        type: 'string',
        array: true,
        choices: ['eth', 'debug', 'net', 'web3', 'txpool', 'trace', 'admin']
      })
      .check((argv) => {
        if (!argv.c && !argv.network) {
          throw new Error('You must specify --network (-n) when --config-file (-c) is not provided.');
        }
        return true;
      })
      .strict()
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
    parser?.showHelp();
    consoleDep.log(`\n${e.message}`);
  }

  processDep.on('SIGINT', () => {
    CliHelperDep.gracefulStop(childProcess, spawnDep);
  });

  processDep.on('SIGTERM', () => {
    CliHelperDep.gracefulStop(childProcess, spawnDep);
  });
}

if (require.main === module) {
  run();
}

module.exports = { run };
