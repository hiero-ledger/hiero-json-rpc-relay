// SPDX-License-Identifier: Apache-2.0

import { expect } from 'chai';
import { type Logger } from 'pino';
import { Writable } from 'stream';

import {
  createLogger,
  logContext,
  ROOT_LOGGER_NAME,
  runWithLogMethod,
  runWithRequestLogContext,
  setLogMethod,
} from '../../src/logger';

describe('Logger factory', () => {
  let lines: string[];
  let logger: Logger;

  beforeEach(() => {
    lines = [];
    const destination = new Writable({
      write(chunk, _encoding, callback): void {
        lines.push(...chunk.toString().trim().split('\n'));
        callback();
      },
    });
    logger = createLogger({ level: 'info', prettyLogsEnabled: false }, destination);
  });

  const lastLine = (): Record<string, unknown> => JSON.parse(lines[lines.length - 1]);

  /** Counts how many times `"key":` appears in the raw line, i.e. duplicates a JSON parser would collapse. */
  const occurrences = (line: string, key: string): number => line.split(`"${key}":`).length - 1;

  describe('JSON mode', () => {
    it('writes the level as text', () => {
      logger.info('hello');
      logger.warn('careful');

      expect(JSON.parse(lines[0]).level).to.equal('info');
      expect(JSON.parse(lines[1]).level).to.equal('warn');
    });

    it('honours the level', () => {
      logger.debug('hidden');
      logger.info('shown');

      expect(lines).to.have.lengthOf(1);
      expect(lastLine().msg).to.equal('shown');
    });

    it('writes the root name once and the child module under `module`', () => {
      logger.child({ module: 'relay' }).info('hello');

      expect(occurrences(lines[0], 'name')).to.equal(1);
      expect(lastLine()).to.include({ name: ROOT_LOGGER_NAME, module: 'relay' });
    });

    it('writes `module` once for nested children, keeping the innermost', () => {
      logger.child({ module: 'rpc-server' }).child({ module: 'relay' }).child({ module: 'mirror-node' }).info('x');

      expect(occurrences(lines[0], 'module')).to.equal(1);
      expect(lastLine().module).to.equal('mirror-node');
    });

    it('dedupes bindings for children created with options', () => {
      const child = logger.child({ module: 'consensus-node' }).child({ module: 'sdk-client' }, { level: 'warn' });
      child.info('hidden');
      child.warn('shown');

      expect(lines).to.have.lengthOf(1);
      expect(occurrences(lines[0], 'module')).to.equal(1);
      expect(lastLine()).to.include({ module: 'sdk-client', level: 'warn' });
    });

    it('keeps other bindings of nested children', () => {
      logger.child({ module: 'a', pool: 'p1' }).child({ module: 'b' }).info('x');

      expect(lastLine()).to.include({ module: 'b', pool: 'p1', name: ROOT_LOGGER_NAME });
    });
  });

  describe('request mixin', () => {
    it('adds nothing outside a request', () => {
      logger.info('x');

      expect(lastLine()).to.not.have.any.keys('requestId', 'connectionId', 'method');
    });

    it('adds the request ID and connection ID inside a request', () => {
      logContext.run({ requestId: 'req-1', connectionId: 'conn-1' }, () => logger.info('x'));

      expect(lastLine()).to.include({
        requestId: '[Request ID: req-1] ',
        connectionId: '[Connection ID: conn-1] ',
      });
      expect(lastLine()).to.not.have.property('method');
    });

    it('adds the method once it is set on the request', () => {
      logContext.run({ requestId: 'req-1' }, () => {
        logger.info('before');
        setLogMethod('eth_call');
        logger.info('after');
      });

      expect(JSON.parse(lines[0])).to.not.have.property('method');
      expect(JSON.parse(lines[1])).to.include({ requestId: '[Request ID: req-1] ', method: 'eth_call' });
    });

    it('ignores a method that is not a string', () => {
      logContext.run({ requestId: 'req-1' }, () => {
        setLogMethod({ not: 'a method' });
        logger.info('x');
      });

      expect(lastLine()).to.not.have.property('method');
    });

    it('scopes runWithLogMethod to its callback, one method per batch item', async () => {
      await logContext.run({ requestId: 'req-1' }, async () => {
        await Promise.all([
          runWithLogMethod('eth_chainId', async () => logger.info('a')),
          runWithLogMethod('eth_blockNumber', async () => logger.info('b')),
        ]);
        logger.info('batch');
      });

      const byMsg = Object.fromEntries(lines.map((line) => JSON.parse(line)).map((l) => [l.msg, l]));
      expect(byMsg.a).to.include({ requestId: '[Request ID: req-1] ', method: 'eth_chainId' });
      expect(byMsg.b).to.include({ requestId: '[Request ID: req-1] ', method: 'eth_blockNumber' });
      expect(byMsg.batch).to.not.have.property('method');
    });

    it('runs runWithLogMethod as is outside a request', () => {
      const result = runWithLogMethod('eth_call', () => {
        logger.info('x');
        return 42;
      });

      expect(result).to.equal(42);
      expect(lastLine()).to.not.have.property('method');
    });
  });

  describe('runWithRequestLogContext', () => {
    it('sets the request context when there is none', () => {
      runWithRequestLogContext({ requestId: 'req-2', connectionId: 'conn-2' }, () => logger.info('x'));

      expect(lastLine()).to.include({
        requestId: '[Request ID: req-2] ',
        connectionId: '[Connection ID: conn-2] ',
      });
    });

    it('keeps the active request context', () => {
      logContext.run({ requestId: 'outer', method: 'eth_getLogs' }, () =>
        runWithRequestLogContext({ requestId: 'inner' }, () => logger.info('x')),
      );

      expect(lastLine()).to.include({ requestId: '[Request ID: outer] ', method: 'eth_getLogs' });
    });

    it('sets nothing without a request ID', () => {
      runWithRequestLogContext(undefined, () => logger.info('x'));

      expect(lastLine()).to.not.have.property('requestId');
    });
  });
});
