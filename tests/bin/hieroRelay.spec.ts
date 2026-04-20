// SPDX-License-Identifier: Apache-2.0

import { expect } from 'chai';
import sinon from 'sinon';

import { run } from '../../bin/hiero-relay.js';

describe('CLI run()', () => {
  let fsStub, spawnStub, cliHelperStub, consoleStub, processStub, dotenvStub;

  beforeEach(() => {
    fsStub = {
      existsSync: sinon.stub().returns(true),
      createWriteStream: sinon.stub().returns({
        write: sinon.stub(),
        end: sinon.stub(),
      }),
    };

    spawnStub = sinon.stub().returns({
      stdout: { on: sinon.stub() },
      stderr: { on: sinon.stub() },
      on: sinon.stub(),
    });

    cliHelperStub = {
      populateEnvBaseOnReadOnlyOption: sinon.stub().returns({
        READ_ONLY: false,
        OPERATOR_ID_MAIN: '0.0.123',
        OPERATOR_KEY_MAIN: 'key',
        OPERATOR_KEY_FORMAT: 'HEX_ECDSA',
      }),
      populateEnvBasedOnNetwork: sinon.stub().returns({
        CHAIN_ID: '0x128',
      }),
      getStdio: sinon.stub().returns({
        stdio: 'inherit',
        overrideStd: false,
      }),
      gracefulStop: sinon.stub(),
    };

    dotenvStub = {
      config: sinon.stub().returns({}),
    };

    consoleStub = { log: sinon.stub() };

    processStub = {
      env: {},
      exit: sinon.stub(),
      on: sinon.stub(),
    };
  });

  afterEach(() => sinon.restore());

  it('should be able to pass operator-id, operator-key, operator-key-format into env', () => {
    run(
      [
        'node',
        'cli',
        '-n',
        'testnet',
        '--operator-id',
        '0.0.999',
        '--operator-key',
        'my-key',
        '--operator-key-format',
        'DER',
      ],
      {
        fsDep: fsStub,
        spawnDep: spawnStub,
        CliHelperDep: cliHelperStub,
        processDep: processStub,
      },
    );

    const env = spawnStub.getCall(0).args[2].env;
    expect(env.OPERATOR_ID_MAIN).to.equal('0.0.123');
    expect(env.OPERATOR_KEY_MAIN).to.equal('key');
    expect(env.OPERATOR_KEY_FORMAT).to.equal('HEX_ECDSA');
  });

  it('should be able to pass chain-id into env', () => {
    run(['node', 'cli', '-n', 'testnet', '--chain-id', '0x127'], {
      fsDep: fsStub,
      spawnDep: spawnStub,
      CliHelperDep: cliHelperStub,
      processDep: processStub,
    });

    const env = spawnStub.getCall(0).args[2].env;
    expect(env.CHAIN_ID).to.equal('0x127');
  });

  it('should be able to pass mirror-node-rest-url and web3-url', () => {
    run(
      [
        'node',
        'cli',
        '-n',
        'testnet',
        '--mirror-node-rest-url',
        'https://mainnet-custom-rest.mirrornode.hedera.com',
        '--mirror-node-web3-url',
        'https://mainnet-custom-web3.mirrornode.hedera.com',
      ],
      {
        fsDep: fsStub,
        spawnDep: spawnStub,
        CliHelperDep: cliHelperStub,
        processDep: processStub,
      },
    );

    const env = spawnStub.getCall(0).args[2].env;
    expect(env.MIRROR_NODE_URL).to.equal('https://mainnet-custom-rest.mirrornode.hedera.com');
    expect(env.MIRROR_NODE_URL_WEB3).to.equal('https://mainnet-custom-web3.mirrornode.hedera.com');
  });

  it('should be able to pass logging level into env', () => {
    run(['node', 'cli', '-n', 'testnet', '--logging', 'debug'], {
      fsDep: fsStub,
      spawnDep: spawnStub,
      CliHelperDep: cliHelperStub,
      processDep: processStub,
    });

    const env = spawnStub.getCall(0).args[2].env;
    expect(env.LOG_LEVEL).to.equal('debug');
  });

  it('should be able to set json pretty print flag', () => {
    run(['node', 'cli', '-n', 'testnet'], {
      fsDep: fsStub,
      spawnDep: spawnStub,
      CliHelperDep: cliHelperStub,
      processDep: processStub,
    });

    const env = spawnStub.getCall(0).args[2].env;
    expect(env.PRETTY_LOGS_ENABLED).to.equal(true);
  });

  it('should be able to serialize rpc-http-api array', () => {
    run(['node', 'cli', '-n', 'testnet', '--rpc-http-api', 'eth', '--rpc-http-api', 'debug'], {
      fsDep: fsStub,
      spawnDep: spawnStub,
      CliHelperDep: cliHelperStub,
      processDep: processStub,
    });

    const env = spawnStub.getCall(0).args[2].env;
    expect(env.RPC_HTTP_API).to.equal(JSON.stringify(['eth', 'debug']));
  });

  it('should be able to serialize rpc-ws-api array', () => {
    run(['node', 'cli', '-n', 'testnet', '--rpc-ws-api', 'eth', '--rpc-ws-api', 'net'], {
      fsDep: fsStub,
      spawnDep: spawnStub,
      CliHelperDep: cliHelperStub,
      processDep: processStub,
    });

    const env = spawnStub.getCall(0).args[2].env;
    expect(env.RPC_WS_API).to.equal(JSON.stringify(['eth', 'net']));
  });

  it('should be able to use config-file mode and skip network flow', () => {
    run(['node', 'cli', '--config-file', '.env'], {
      fsDep: fsStub,
      spawnDep: spawnStub,
      dotenvDep: dotenvStub,
      processDep: processStub,
      consoleDep: consoleStub,
    });

    expect(dotenvStub.config.calledWith({ path: '.env' })).to.be.true;
    expect(spawnStub.called).to.be.true;
  });

  it('should fail when network missing (strict check)', () => {
    run(['node', 'cli'], {
      fsDep: fsStub,
      spawnDep: spawnStub,
      processDep: processStub,
      consoleDep: consoleStub,
    });

    expect(consoleStub.log.calledWithMatch('You must specify')).to.be.true;
  });
});
