// SPDX-License-Identifier: Apache-2.0

import { expect } from 'chai';
import type { IncomingMessage } from 'http';
import Koa from 'koa';

import { applyCorsMiddleware, resolveAllowedOrigin, verifyWsOrigin } from '../../../src/server/utils/corsUtils';
import { overrideEnvsInMochaDescribe, withOverriddenEnvsInMochaTest } from '../../relay/helpers';

describe('corsUtils', () => {
  describe('resolveAllowedOrigin', () => {
    describe('with CORS_ALLOWED_ORIGINS unset (restriction deactivated)', () => {
      it('should allow an arbitrary origin', () => {
        expect(resolveAllowedOrigin('https://attacker.example')).to.equal('*');
      });

      it('should allow the null origin', () => {
        expect(resolveAllowedOrigin('null')).to.equal('*');
      });

      it('should allow a request without an Origin header', () => {
        expect(resolveAllowedOrigin('')).to.equal('*');
      });
    });

    withOverriddenEnvsInMochaTest({ CORS_ALLOWED_ORIGINS: ['*'] }, () => {
      it('should allow any origin when the wildcard is listed explicitly', () => {
        expect(resolveAllowedOrigin('https://attacker.example')).to.equal('*');
      });
    });

    withOverriddenEnvsInMochaTest({ CORS_ALLOWED_ORIGINS: ['https://app.example.com', '*'] }, () => {
      it('should allow any origin when the wildcard is listed alongside a concrete origin', () => {
        expect(resolveAllowedOrigin('https://attacker.example')).to.equal('*');
      });
    });

    describe('with an allowlist configured', () => {
      overrideEnvsInMochaDescribe({
        CORS_ALLOWED_ORIGINS: ['https://app.example.com', 'http://localhost:3000'],
      });

      it('should echo back a listed origin', () => {
        expect(resolveAllowedOrigin('https://app.example.com')).to.equal('https://app.example.com');
        expect(resolveAllowedOrigin('http://localhost:3000')).to.equal('http://localhost:3000');
      });

      it('should reject an unlisted origin', () => {
        expect(resolveAllowedOrigin('https://attacker.example')).to.equal('');
      });

      it('should reject the null origin', () => {
        expect(resolveAllowedOrigin('null')).to.equal('');
      });

      it('should reject an origin that only differs by port or scheme', () => {
        expect(resolveAllowedOrigin('http://localhost:3001')).to.equal('');
        expect(resolveAllowedOrigin('http://app.example.com')).to.equal('');
      });

      it('should reject an origin that merely contains a listed one', () => {
        expect(resolveAllowedOrigin('https://app.example.com.attacker.example')).to.equal('');
        expect(resolveAllowedOrigin('https://notapp.example.com')).to.equal('');
      });

      it('should emit no CORS headers for a request without an Origin header', () => {
        expect(resolveAllowedOrigin('')).to.equal('');
      });

      it('should match case-insensitively', () => {
        expect(resolveAllowedOrigin('HTTPS://APP.EXAMPLE.COM')).to.equal('HTTPS://APP.EXAMPLE.COM');
      });
    });

    describe('with a null origin allowlisted', () => {
      overrideEnvsInMochaDescribe({ CORS_ALLOWED_ORIGINS: ['null'] });

      it('should echo back the null origin', () => {
        expect(resolveAllowedOrigin('null')).to.equal('null');
      });

      it('should still reject other origins', () => {
        expect(resolveAllowedOrigin('https://attacker.example')).to.equal('');
      });
    });

    describe('with allowlist entries needing normalization', () => {
      overrideEnvsInMochaDescribe({ CORS_ALLOWED_ORIGINS: ['  HTTPS://App.Example.com/  '] });

      it('should ignore case, surrounding whitespace and a trailing slash', () => {
        expect(resolveAllowedOrigin('https://app.example.com')).to.equal('https://app.example.com');
      });
    });
  });

  describe('verifyWsOrigin', () => {
    const verify = (origin: string | undefined): unknown[] => {
      let verdict: unknown[] = [];
      verifyWsOrigin({ origin: origin as string, secure: false, req: {} as IncomingMessage }, (...args) => {
        verdict = args;
      });
      return verdict;
    };

    it('should accept any origin when CORS_ALLOWED_ORIGINS is unset', () => {
      expect(verify('https://attacker.example')).to.deep.equal([true]);
      expect(verify('null')).to.deep.equal([true]);
    });

    describe('with an allowlist configured', () => {
      overrideEnvsInMochaDescribe({ CORS_ALLOWED_ORIGINS: ['https://app.example.com'] });

      it('should accept a listed origin', () => {
        expect(verify('https://app.example.com')).to.deep.equal([true]);
      });

      it('should reject an unlisted origin with 403', () => {
        expect(verify('https://attacker.example')).to.deep.equal([false, 403, 'Origin not allowed']);
      });

      it('should reject the null origin with 403', () => {
        expect(verify('null')).to.deep.equal([false, 403, 'Origin not allowed']);
      });

      it('should accept a handshake without an Origin header', () => {
        expect(verify(undefined)).to.deep.equal([true]);
      });
    });
  });

  describe('applyCorsMiddleware', () => {
    const startApp = async (): Promise<{ port: number; close: () => void }> => {
      const app = new Koa();
      applyCorsMiddleware(app);
      app.use(async (ctx) => {
        ctx.body = 'ok';
      });
      const server = app.listen(0, '127.0.0.1');
      await new Promise<void>((resolve) => server.once('listening', resolve));
      return { port: (server.address() as { port: number }).port, close: () => server.close() };
    };

    describe('with an allowlist configured', () => {
      overrideEnvsInMochaDescribe({ CORS_ALLOWED_ORIGINS: ['https://app.example.com'] });

      it('should set Access-Control-Allow-Origin only for a listed origin', async () => {
        const { port, close } = await startApp();

        const allowed = await fetch(`http://127.0.0.1:${port}`, { headers: { origin: 'https://app.example.com' } });
        const denied = await fetch(`http://127.0.0.1:${port}`, { headers: { origin: 'https://attacker.example' } });

        close();

        expect(allowed.headers.get('access-control-allow-origin')).to.equal('https://app.example.com');
        expect(denied.headers.get('access-control-allow-origin')).to.be.null;
        expect(denied.headers.get('vary')).to.contain('Origin');
      });

      it('should not answer a preflight from an unlisted origin with CORS headers', async () => {
        const { port, close } = await startApp();

        const response = await fetch(`http://127.0.0.1:${port}`, {
          method: 'OPTIONS',
          headers: { origin: 'https://attacker.example', 'access-control-request-method': 'POST' },
        });

        close();

        expect(response.headers.get('access-control-allow-origin')).to.be.null;
        expect(response.headers.get('access-control-allow-methods')).to.be.null;
      });

      it('should answer a preflight from a listed origin', async () => {
        const { port, close } = await startApp();

        const response = await fetch(`http://127.0.0.1:${port}`, {
          method: 'OPTIONS',
          headers: { origin: 'https://app.example.com', 'access-control-request-method': 'POST' },
        });

        close();

        expect(response.status).to.equal(204);
        expect(response.headers.get('access-control-allow-origin')).to.equal('https://app.example.com');
        expect(response.headers.get('access-control-allow-methods')).to.equal('GET,POST');
      });

      it('should never set Access-Control-Allow-Credentials', async () => {
        const { port, close } = await startApp();

        const response = await fetch(`http://127.0.0.1:${port}`, { headers: { origin: 'https://app.example.com' } });

        close();

        expect(response.headers.get('access-control-allow-credentials')).to.be.null;
      });
    });

    it('should fall back to the wildcard when CORS_ALLOWED_ORIGINS is unset', async () => {
      const { port, close } = await startApp();

      const response = await fetch(`http://127.0.0.1:${port}`, { headers: { origin: 'https://attacker.example' } });

      close();

      expect(response.headers.get('access-control-allow-origin')).to.equal('*');
    });
  });
});
