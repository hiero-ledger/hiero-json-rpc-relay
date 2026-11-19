// SPDX-License-Identifier: Apache-2.0

import { Status } from '@hiero-ledger/sdk';
import { expect } from 'chai';
import pino from 'pino';
import { Writable } from 'stream';

import { JsonRpcError, predefined } from '../../../../src/relay/lib/errors/JsonRpcError';
import { MirrorNodeClientError } from '../../../../src/relay/lib/errors/MirrorNodeClientError';
import { logRpcError, toJsonRpcError } from '../../../../src/relay/lib/errors/rpcErrorReporting';
import { SDKClientError } from '../../../../src/relay/lib/errors/SDKClientError';

describe('rpcErrorReporting', () => {
  describe('toJsonRpcError', () => {
    it('returns a JsonRpcError as is', () => {
      expect(toJsonRpcError(predefined.INVALID_PARAMETERS)).to.equal(predefined.INVALID_PARAMETERS);
    });

    it('maps a Mirror Node 503 to a server MIRROR_NODE_UPSTREAM_FAIL with the error as cause', () => {
      const error = new MirrorNodeClientError(new Error('Service unavailable'), 503);
      const result = toJsonRpcError(error);

      expect(result).to.include({ code: -32020, data: 503, isClientError: false });
      expect(result.cause).to.equal(error);
    });

    it('maps a Mirror Node 400 to a client MIRROR_NODE_UPSTREAM_FAIL', () => {
      expect(toJsonRpcError(new MirrorNodeClientError(new Error('Bad request'), 400)).isClientError).to.be.true;
    });

    it('maps a consensus node error by Hedera status', () => {
      const clientError = toJsonRpcError(new SDKClientError({ status: Status.InvalidSignature, message: 'x' }));
      const serverError = toJsonRpcError(new SDKClientError({ status: Status.Busy, message: 'x' }));

      expect(clientError).to.include({ code: -32000, isClientError: true });
      expect(serverError).to.include({ code: -32000, isClientError: false });
      expect(serverError.message).to.include('BUSY');
    });

    it('maps a gRPC timeout to REQUEST_TIMEOUT', () => {
      expect(toJsonRpcError(new SDKClientError({ status: Status.InvalidTransactionId, message: 'x' }))).to.equal(
        predefined.REQUEST_TIMEOUT,
      );
    });

    it('maps an unexpected exception to INTERNAL_ERROR with the error as cause', () => {
      const error = new TypeError('boom');
      const result = toJsonRpcError(error);

      expect(result).to.include({ code: -32603, message: 'Error invoking RPC: boom', isClientError: false });
      expect(result.cause).to.equal(error);
    });

    it('maps a thrown value without a message to INTERNAL_ERROR', () => {
      expect(toJsonRpcError('just a string').message).to.equal('Error invoking RPC: Unknown error');
    });
  });

  describe('logRpcError', () => {
    let lines: Record<string, unknown>[];
    let logger: pino.Logger;

    beforeEach(() => {
      lines = [];
      const destination = new Writable({
        write(chunk, _encoding, callback): void {
          lines.push(
            ...chunk
              .toString()
              .trim()
              .split('\n')
              .map((line: string) => JSON.parse(line)),
          );
          callback();
        },
      });
      logger = pino({ level: 'debug' }, destination);
    });

    it('logs a client error at debug with the full params', () => {
      const params = [{ to: '0x1', data: '0x' + 'ab'.repeat(100) }, 'latest'];

      expect(logRpcError(logger, 'eth_call', params, predefined.CONTRACT_REVERT('boom'))).to.equal('client');
      expect(lines).to.have.lengthOf(1);
      expect(lines[0]).to.deep.include({ level: 20, code: 3, params });
      expect(lines[0].msg).to.equal('Client error executing method eth_call: execution reverted: boom');
    });

    it('logs nothing at info or above for a client error', () => {
      logger.level = 'info';
      logRpcError(logger, 'eth_getFilterChanges', ['0x1'], predefined.FILTER_NOT_FOUND.asClientError());

      expect(lines).to.be.empty;
    });

    it('logs a Mirror Node 503 at error once, with the upstream status and the stack', () => {
      const error = new MirrorNodeClientError(new Error('Service unavailable'), 503);

      expect(logRpcError(logger, 'eth_getBalance', ['0x1', 'latest'], toJsonRpcError(error), error)).to.equal('server');
      expect(lines).to.have.lengthOf(1);
      expect(lines[0]).to.deep.include({ level: 50, code: -32020, upstreamStatus: 503, params: ['0x1', 'latest'] });
      expect(lines[0].err).to.deep.include({ type: 'MirrorNodeClientError', message: 'Service unavailable' });
      expect((lines[0].err as { stack: string }).stack)
        .to.be.a('string')
        .and.match(/Service unavailable\n\s+at /);
    });

    it('logs the Hedera status as the upstream status of a consensus node error', () => {
      const error = new SDKClientError({ status: Status.Busy, message: 'busy' });
      logRpcError(logger, 'eth_sendRawTransaction', [], toJsonRpcError(error), error);

      expect(lines[0]).to.include({ level: 50, upstreamStatus: 'BUSY' });
    });

    it('finds the upstream status in the cause of a wrapping error', () => {
      const error = new MirrorNodeClientError(new Error('Gateway timeout'), 504);
      logRpcError(logger, 'eth_call', [], predefined.COULD_NOT_SIMULATE_TRANSACTION('x', error));

      expect(lines[0]).to.include({ level: 50, upstreamStatus: 504 });
    });

    it('logs the original error as the cause when the mapped error has none', () => {
      const error = new SDKClientError({ status: Status.InvalidTransactionId, message: 'timeout' });
      logRpcError(logger, 'eth_sendRawTransaction', [], toJsonRpcError(error), error);

      expect(lines[0].err).to.deep.include({ type: 'SDKClientError' });
    });

    it('logs no call data or raw transaction at error', () => {
      const rawTransaction = '0x02' + 'cd'.repeat(300);
      const callData = '0x' + 'ab'.repeat(300);
      logRpcError(logger, 'eth_sendRawTransaction', [rawTransaction], predefined.INTERNAL_ERROR('x', new Error('x')));
      logRpcError(
        logger,
        'eth_call',
        [{ to: '0x1', data: callData }, 'latest'],
        predefined.INTERNAL_ERROR('x', new Error('x')),
      );

      const raw = JSON.stringify(lines);
      expect(raw).to.not.include('cdcd');
      expect(raw).to.not.include('abab');
      expect(lines[0].params).to.have.property('txHash');
      expect(lines[1].params).to.include({ dataSize: '300 bytes' });
    });

    it('logs a server JsonRpcError without a cause with its own stack', () => {
      logRpcError(logger, 'eth_getLogs', [], new JsonRpcError({ code: -32000, message: 'oops' }));

      expect(lines[0]).to.include({ level: 50, code: -32000 });
      expect(lines[0].err).to.deep.include({ type: 'JsonRpcError', message: 'oops' });
      expect(lines[0]).to.not.have.property('upstreamStatus');
    });
  });
});
