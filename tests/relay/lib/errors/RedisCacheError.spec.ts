// SPDX-License-Identifier: Apache-2.0

import { expect } from 'chai';

import { redactUrlCredentials, RedisCacheError } from '../../../../src/relay/lib/errors/RedisCacheError';

describe('RedisCacheError', () => {
  describe('redactUrlCredentials', () => {
    it('redacts a standard user:pass@ credential segment', () => {
      expect(redactUrlCredentials('redis://user:pass@host:6379')).to.equal('redis://***@host:6379');
    });

    it('redacts the full credential when the password itself contains "@"', () => {
      expect(redactUrlCredentials('redis://user:p@ss@host:6379')).to.equal('redis://***@host:6379');
    });

    it('redacts a password-only credential (no username)', () => {
      expect(redactUrlCredentials('redis://:supersecret@host:6379')).to.equal('redis://***@host:6379');
    });

    it('redacts a username-only credential', () => {
      expect(redactUrlCredentials('redis://user@host:6379')).to.equal('redis://***@host:6379');
    });

    it('leaves a URL without embedded credentials unchanged', () => {
      expect(redactUrlCredentials('redis://host:6379')).to.equal('redis://host:6379');
    });

    it('does not treat an "@" in a path as a credential', () => {
      expect(redactUrlCredentials('https://example.com/@handle')).to.equal('https://example.com/@handle');
    });

    it('does not treat an "@" in a query as a credential', () => {
      expect(redactUrlCredentials('https://api.example.com/users?email=a@b.com')).to.equal(
        'https://api.example.com/users?email=a@b.com',
      );
    });

    it('does not leak any part of the original credential', () => {
      const out = redactUrlCredentials('Failed to connect to redis://admin:top@secret@10.0.0.5:6379');
      expect(out).to.not.contain('admin');
      expect(out).to.not.contain('secret');
    });
  });

  describe('constructor (masked surface that gets logged)', () => {
    it('redacts credentials from the message', () => {
      const err: any = new Error('AUTH failed for redis://admin:topsecret@10.0.0.5:6379');
      const wrapped = new RedisCacheError(err);

      expect(wrapped.message).to.equal('AUTH failed for redis://***@10.0.0.5:6379');
      expect(wrapped.message).to.not.contain('topsecret');
    });

    it('redacts credentials from the stack without dropping it', () => {
      const err: any = new Error('AUTH failed for redis://admin:topsecret@10.0.0.5:6379');
      const wrapped = new RedisCacheError(err);

      expect(wrapped.stack).to.be.a('string').that.is.not.empty;
      expect(wrapped.stack).to.not.contain('topsecret');
    });

    it('does not retain the raw upstream error object', () => {
      const wrapped = new RedisCacheError(new Error('boom'));
      expect((wrapped as any).fullError).to.be.undefined;
    });

    it('preserves the error type and isSocketClosed()', () => {
      const err: any = new Error('socket closed');
      err.type = RedisCacheError.ErrorMessages.SOCKET_CLOSED;
      const wrapped = new RedisCacheError(err);

      expect(wrapped.type).to.equal(RedisCacheError.ErrorMessages.SOCKET_CLOSED);
      expect(wrapped.isSocketClosed()).to.be.true;
    });
  });
});
