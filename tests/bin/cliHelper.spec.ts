// SPDX-License-Identifier: Apache-2.0

import { expect } from 'chai';
import sinon from 'sinon';

import { CliHelper } from '../../bin/cli-helper.js';

describe('CliHelper', () => {
  describe('populateEnvBasedOnNetwork', () => {
    it('should return correct config for mainnet', () => {
      const result = CliHelper.populateEnvBasedOnNetwork('mainnet');

      expect(result).to.deep.equal({
        CHAIN_ID: '0x127',
        HEDERA_NETWORK: '{"0.mainnet.hedera.com:50211":"0.0.3"}',
        MIRROR_NODE_URL: 'https://mainnet-public.mirrornode.hedera.com',
        MIRROR_NODE_URL_WEB3: 'https://mainnet-public.mirrornode.hedera.com',
      });
    });

    it('should return correct config for testnet', () => {
      const result = CliHelper.populateEnvBasedOnNetwork('testnet');

      expect(result).to.deep.equal({
        CHAIN_ID: '0x128',
        HEDERA_NETWORK: '{"0.testnet.hedera.com:50211":"0.0.3"}',
        MIRROR_NODE_URL: 'https://testnet.mirrornode.hedera.com',
        MIRROR_NODE_URL_WEB3: 'https://testnet.mirrornode.hedera.com',
      });
    });

    it('should return correct config for previewnet', () => {
      const result = CliHelper.populateEnvBasedOnNetwork('previewnet');

      expect(result).to.deep.equal({
        CHAIN_ID: '0x129',
        HEDERA_NETWORK: '{"0.previewnet.hedera.com:50211":"0.0.3"}',
        MIRROR_NODE_URL: 'https://previewnet.mirrornode.hedera.com',
        MIRROR_NODE_URL_WEB3: 'https://previewnet.mirrornode.hedera.com',
      });
    });

    it('should throw error for invalid network', () => {
      expect(() => CliHelper.populateEnvBasedOnNetwork('invalid')).to.throw('Invalid network selection.');
    });
  });

  describe('populateEnvBaseOnReadOnlyOption', () => {
    it('should return READ_ONLY true when read-only is enabled', () => {
      const result = CliHelper.populateEnvBaseOnReadOnlyOption({
        'read-only': true,
      });

      expect(result).to.deep.equal({ READ_ONLY: true });
    });

    it('should accept DER as a valid operator-key-format', () => {
      const argv = {
        'read-only': false,
        'operator-id': '0.0.456',
        'operator-key': 'der-key',
        'operator-key-format': 'DER',
      };

      const result = CliHelper.populateEnvBaseOnReadOnlyOption(argv);

      expect(result).to.deep.equal({
        READ_ONLY: false,
        OPERATOR_ID_MAIN: '0.0.456',
        OPERATOR_KEY_MAIN: 'der-key',
        OPERATOR_KEY_FORMAT: 'DER',
      });
    });

    it('should throw if operator-id is missing', () => {
      expect(() =>
        CliHelper.populateEnvBaseOnReadOnlyOption({
          'read-only': false,
          'operator-key': 'key',
          'operator-key-format': 'HEX_ECDSA',
        }),
      ).to.throw('Argument: --operator-id is required');
    });

    it('should throw if operator-key is missing', () => {
      expect(() =>
        CliHelper.populateEnvBaseOnReadOnlyOption({
          'read-only': false,
          'operator-id': '0.0.123',
          'operator-key-format': 'HEX_ECDSA',
        }),
      ).to.throw('Argument: --operator-key is required');
    });

    it('should throw if operator-key-format is missing', () => {
      expect(() =>
        CliHelper.populateEnvBaseOnReadOnlyOption({
          'read-only': false,
          'operator-id': '0.0.123',
          'operator-key': 'key',
        }),
      ).to.throw('Argument: --operator-key-format is required');
    });

    it('should return operator config when all args are provided', () => {
      const argv = {
        'read-only': false,
        'operator-id': '0.0.123',
        'operator-key': 'key',
        'operator-key-format': 'HEX_ECDSA',
      };

      const result = CliHelper.populateEnvBaseOnReadOnlyOption(argv);

      expect(result).to.deep.equal({
        READ_ONLY: false,
        OPERATOR_ID_MAIN: '0.0.123',
        OPERATOR_KEY_MAIN: 'key',
        OPERATOR_KEY_FORMAT: 'HEX_ECDSA',
      });
    });
  });

  describe('gracefulStop', () => {
    let exitStub;

    beforeEach(() => {
      exitStub = sinon.stub(process, 'exit');
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should exit immediately if no child', () => {
      CliHelper.gracefulStop(null);

      expect(exitStub.calledWith(0)).to.be.true;
    });

    it('should attach close handler and kill process on non-win32', () => {
      const child = {
        pid: 123,
        on: sinon.spy(),
        kill: sinon.spy(),
      };

      const originalPlatform = process.platform;
      Object.defineProperty(process, 'platform', { value: 'linux' });
      CliHelper.gracefulStop(child, sinon.spy(), process.pid);

      expect(child.on.calledWith('close')).to.be.true;
      expect(child.kill.calledWith('SIGTERM')).to.be.true;

      Object.defineProperty(process, 'platform', { value: originalPlatform });
    });

    it('should call spawn taskkill on win32', () => {
      const child = {
        pid: 456,
        on: sinon.spy(),
      };

      const spawn = sinon.spy();

      const originalPlatform = process.platform;
      Object.defineProperty(process, 'platform', { value: 'win32' });

      CliHelper.gracefulStop(child, spawn, process.pid);

      expect(spawn.calledWith('taskkill', ['/pid', 456, '/T', '/F'])).to.be.true;

      Object.defineProperty(process, 'platform', { value: originalPlatform });
    });
  });

  describe('getStdio', () => {
    it('should return inherit config when loggingPath is falsy', () => {
      const result = CliHelper.getStdio(null);

      expect(result).to.deep.equal({
        stdio: 'inherit',
        overrideStd: false,
      });
    });

    it('should return pipe config when loggingPath is provided', () => {
      const result = CliHelper.getStdio('/tmp/log.txt');

      expect(result).to.deep.equal({
        stdio: ['ignore', 'pipe', 'pipe'],
        overrideStd: true,
      });
    });
  });
});
