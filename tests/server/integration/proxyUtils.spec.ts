// SPDX-License-Identifier: Apache-2.0

import { expect } from 'chai';
import type { IncomingMessage, ServerResponse } from 'http';
import Koa from 'koa';
import websockify from 'koa-websocket';
import { pino } from 'pino';
import sinon from 'sinon';

import { applyProxyMiddleware, parseForwardedHeader } from '../../../src/server/utils/proxyUtils';
import { withOverriddenEnvsInMochaTest } from '../../relay/helpers';

const logger = pino({ level: 'silent' });

describe('proxyUtils', () => {
  describe('parseForwardedHeader', () => {
    describe('returns null for invalid / edge-case inputs', () => {
      it('should return null when header exceeds 1000 characters', () => {
        const longHeader = `for=${'a'.repeat(1000)}`;
        expect(parseForwardedHeader(longHeader)).to.be.null;
      });

      it('should return null when first entry is empty (comma-only input)', () => {
        expect(parseForwardedHeader(',')).to.be.null;
      });

      it('should return null when there is no for= parameter', () => {
        expect(parseForwardedHeader('proto=https;by=10.0.0.1')).to.be.null;
      });

      it('should return null when for= has no value', () => {
        expect(parseForwardedHeader('for=')).to.be.null;
      });

      it('should return null when quoted value has no closing quote', () => {
        expect(parseForwardedHeader('for="192.168.1.1')).to.be.null;
      });

      it('should return null when bracketed IPv6 has no closing bracket', () => {
        expect(parseForwardedHeader('for=[2001:db8::1')).to.be.null;
      });

      it('should return null when extracted IP contains invalid characters', () => {
        expect(parseForwardedHeader('for=not-an-ip!')).to.be.null;
      });

      it('should return null when extracted IP exceeds 45 characters', () => {
        // 46 hex chars — too long for any valid IP
        const longIp = 'a'.repeat(46);
        expect(parseForwardedHeader(`for=${longIp}`)).to.be.null;
      });

      it('should return null for empty quoted value (for="")', () => {
        expect(parseForwardedHeader('for=""')).to.be.null;
      });
    });

    describe('unquoted IPv4', () => {
      it('should parse a plain unquoted IPv4 address', () => {
        expect(parseForwardedHeader('for=192.168.1.1')).to.equal('192.168.1.1');
      });

      it('should stop at semicolon delimiter', () => {
        expect(parseForwardedHeader('for=192.168.1.1;proto=https')).to.equal('192.168.1.1');
      });

      it('should stop at space delimiter', () => {
        expect(parseForwardedHeader('for=192.168.1.1 extra')).to.equal('192.168.1.1');
      });

      it('should stop at tab delimiter', () => {
        expect(parseForwardedHeader('for=192.168.1.1\textra')).to.equal('192.168.1.1');
      });

      it('should be case-insensitive for the for= key', () => {
        expect(parseForwardedHeader('FOR=192.168.1.1')).to.equal('192.168.1.1');
        expect(parseForwardedHeader('For=192.168.1.1')).to.equal('192.168.1.1');
      });
    });

    describe('quoted IPv4', () => {
      it('should parse a quoted IPv4 address', () => {
        expect(parseForwardedHeader('for="192.168.1.1"')).to.equal('192.168.1.1');
      });

      it('should parse a quoted IPv4 with additional parameters', () => {
        expect(parseForwardedHeader('for="192.168.1.1";by="10.0.0.1"')).to.equal('192.168.1.1');
      });
    });

    describe('bracketed IPv6', () => {
      it('should parse an unquoted bracketed IPv6 address', () => {
        expect(parseForwardedHeader('for=[2001:db8::1]')).to.equal('2001:db8::1');
      });
    });

    describe('quoted bracketed IPv6', () => {
      it('should parse a quoted bracketed IPv6 address', () => {
        expect(parseForwardedHeader('for="[2001:db8::1]"')).to.equal('2001:db8::1');
      });

      it('should parse a quoted non-bracketed IPv6 address', () => {
        // quoted but no brackets — treated as plain quoted value
        expect(parseForwardedHeader('for="2001:db8::1"')).to.equal('2001:db8::1');
      });
    });

    describe('multiple entries', () => {
      it('should use only the first entry when multiple comma-separated entries exist', () => {
        expect(parseForwardedHeader('for=192.168.1.1, for=10.0.0.1')).to.equal('192.168.1.1');
      });

      it('should use only the first entry with quoted IPs', () => {
        expect(parseForwardedHeader('for="192.168.1.1";by="10.0.0.1", for="203.0.113.1"')).to.equal('192.168.1.1');
      });
    });
  });

  describe('applyProxyMiddleware', () => {
    let app: Koa;

    beforeEach(() => {
      app = new Koa();
    });

    it('should set app.proxy to true', () => {
      expect(app.proxy).to.be.false;
      applyProxyMiddleware(app, logger);
      expect(app.proxy).to.be.true;
    });

    it('should set x-forwarded-for from Forwarded header when x-forwarded-for is absent', async () => {
      applyProxyMiddleware(app, logger);

      const ctx = {
        request: {
          headers: {
            forwarded: 'for=192.168.1.1',
          } as Record<string, string>,
        },
      } as unknown as Koa.Context;

      const next = sinon.stub().resolves();

      // Grab the middleware registered last
      const middleware = (app.middleware as Koa.Middleware[])[0];
      await middleware(ctx, next);

      expect(ctx.request.headers['x-forwarded-for']).to.equal('192.168.1.1');
      expect(next.calledOnce).to.be.true;
    });

    it('should not override x-forwarded-for when it is already present', async () => {
      applyProxyMiddleware(app, logger);

      const ctx = {
        request: {
          headers: {
            'x-forwarded-for': '10.0.0.1',
            forwarded: 'for=192.168.1.1',
          } as Record<string, string>,
        },
      } as unknown as Koa.Context;

      const next = sinon.stub().resolves();

      const middleware = (app.middleware as Koa.Middleware[])[0];
      await middleware(ctx, next);

      expect(ctx.request.headers['x-forwarded-for']).to.equal('10.0.0.1');
      expect(next.calledOnce).to.be.true;
    });

    it('should not set x-forwarded-for when Forwarded header is absent', async () => {
      applyProxyMiddleware(app, logger);

      const ctx = {
        request: {
          headers: {} as Record<string, string>,
        },
      } as unknown as Koa.Context;

      const next = sinon.stub().resolves();

      const middleware = (app.middleware as Koa.Middleware[])[0];
      await middleware(ctx, next);

      expect(ctx.request.headers['x-forwarded-for']).to.be.undefined;
      expect(next.calledOnce).to.be.true;
    });

    it('should not set x-forwarded-for when Forwarded header is malformed', async () => {
      applyProxyMiddleware(app, logger);

      const ctx = {
        request: {
          headers: {
            forwarded: 'invalid_format',
          } as Record<string, string>,
        },
      } as unknown as Koa.Context;

      const next = sinon.stub().resolves();

      const middleware = (app.middleware as Koa.Middleware[])[0];
      await middleware(ctx, next);

      expect(ctx.request.headers['x-forwarded-for']).to.be.undefined;
      expect(next.calledOnce).to.be.true;
    });

    it('should always call next regardless of header state', async () => {
      applyProxyMiddleware(app, logger);

      const ctx = {
        request: { headers: {} as Record<string, string> },
      } as unknown as Koa.Context;

      const next = sinon.stub().resolves();

      const middleware = (app.middleware as Koa.Middleware[])[0];
      await middleware(ctx, next);

      expect(next.calledOnce).to.be.true;
    });
  });

  describe('ctx.ip resolution', () => {
    it('ctx.ip is the socket address when app.proxy is false (baseline)', async () => {
      const app = new Koa();
      const ips: string[] = [];
      app.use(async (ctx) => {
        ips.push(ctx.ip);
        ctx.body = 'ok';
      });
      const server = app.listen(0, '127.0.0.1');
      await new Promise<void>((resolve) => server.once('listening', resolve));
      const port = (server.address() as { port: number }).port;
      await fetch(`http://127.0.0.1:${port}`, { headers: { 'x-forwarded-for': '10.0.0.1' } });
      await fetch(`http://127.0.0.1:${port}`, { headers: { 'x-forwarded-for': '10.0.0.2' } });
      server.close();
      expect(ips[0]).to.equal('127.0.0.1');
      expect(ips[1]).to.equal('127.0.0.1');
    });

    it('ctx.ip reads X-Forwarded-For per request when applyProxyMiddleware is applied', async () => {
      const app = new Koa();
      applyProxyMiddleware(app, logger);
      const ips: string[] = [];
      app.use(async (ctx) => {
        ips.push(ctx.ip);
        ctx.body = 'ok';
      });
      const server = app.listen(0, '127.0.0.1');
      await new Promise<void>((resolve) => server.once('listening', resolve));
      const port = (server.address() as { port: number }).port;
      await fetch(`http://127.0.0.1:${port}`, { headers: { 'x-forwarded-for': '10.0.0.1' } });
      await fetch(`http://127.0.0.1:${port}`, { headers: { 'x-forwarded-for': '10.0.0.2' } });
      server.close();
      expect(ips[0]).to.equal('10.0.0.1');
      expect(ips[1]).to.equal('10.0.0.2');
    });
  });

  describe('client IP per REAL_IP_ADDRESS_MODE', () => {
    const TRUSTED_PROXY = '10.0.0.5';
    const UNTRUSTED_PEER = '198.51.100.7';
    const CLIENT = '203.0.113.9';

    let app: Koa;

    // A real Koa context lets the test choose the TCP peer, which a local socket cannot.
    async function clientIpOf(peer: string, headers: Record<string, string> = {}): Promise<string> {
      const req = { headers, socket: { remoteAddress: peer } } as unknown as IncomingMessage;
      const ctx = app.createContext(req, {} as ServerResponse);
      for (const middleware of app.middleware) {
        await middleware(ctx, sinon.stub().resolves());
      }
      return ctx.ip;
    }

    function expectModeLoggedOnce(mode: string): void {
      const info = sinon.spy(logger, 'info');
      applyProxyMiddleware(new Koa(), logger);
      expect(info.calledOnce).to.be.true;
      expect(info.firstCall.args[0]).to.include(`REAL_IP_ADDRESS_MODE=${mode}`);
    }

    beforeEach(() => {
      app = new Koa();
    });

    afterEach(() => {
      sinon.restore();
    });

    withOverriddenEnvsInMochaTest({ REAL_IP_ADDRESS_MODE: undefined }, () => {
      it('should log the active mode once', () => expectModeLoggedOnce('X_FORWARDED_FOR'));
    });

    withOverriddenEnvsInMochaTest(
      { REAL_IP_ADDRESS_MODE: 'TRUSTED_PROXIES', TRUSTED_PROXY_IPS: [TRUSTED_PROXY] },
      () => {
        beforeEach(() => applyProxyMiddleware(app, logger));

        it('should use the client IP a trusted proxy appended to X-Forwarded-For', async () => {
          expect(await clientIpOf(TRUSTED_PROXY, { 'x-forwarded-for': `6.6.6.6, ${CLIENT}` })).to.equal(CLIENT);
        });

        it('should use the client IP a trusted proxy appended to Forwarded', async () => {
          expect(await clientIpOf(TRUSTED_PROXY, { forwarded: `for=6.6.6.6, for="${CLIENT}"` })).to.equal(CLIENT);
        });

        it('should prefer X-Forwarded-For when a trusted proxy sends both headers', async () => {
          const headers = { 'x-forwarded-for': CLIENT, forwarded: 'for=6.6.6.6' };
          expect(await clientIpOf(TRUSTED_PROXY, headers)).to.equal(CLIENT);
        });

        const spoofedHeaders: Record<string, string>[] = [
          { 'x-forwarded-for': '1.2.3.4' },
          { forwarded: 'for=1.2.3.4' },
        ];
        spoofedHeaders.forEach((headers) => {
          it(`should ignore ${Object.keys(headers)[0]} from an untrusted peer`, async () => {
            expect(await clientIpOf(UNTRUSTED_PEER, headers)).to.equal(UNTRUSTED_PEER);
          });
        });

        it('should match an IPv4-mapped peer against its IPv4 allowlist entry', async () => {
          expect(await clientIpOf(`::ffff:${TRUSTED_PROXY}`, { 'x-forwarded-for': CLIENT })).to.equal(CLIENT);
        });

        ['', 'unknown', `${CLIENT}:443`].forEach((xForwardedFor) => {
          it(`should fall back to the proxy IP when its X-Forwarded-For is "${xForwardedFor}"`, async () => {
            expect(await clientIpOf(TRUSTED_PROXY, { 'x-forwarded-for': xForwardedFor })).to.equal(TRUSTED_PROXY);
          });
        });

        it('should resolve the client IP on WS connections as well', async () => {
          const wsApp = websockify(new Koa());
          applyProxyMiddleware(wsApp, logger);

          expect(wsApp.ws.middleware).to.have.lengthOf(1);
          // Koa alone would report the proxy here, so getting the client proves the resolver ran on the WS connection.
          const req = { headers: { 'x-forwarded-for': CLIENT }, socket: { remoteAddress: TRUSTED_PROXY } };
          const ctx = wsApp.createContext(
            req as unknown as IncomingMessage,
            {} as ServerResponse,
          ) as websockify.MiddlewareContext<Koa.DefaultState>;
          await wsApp.ws.middleware[0](ctx, sinon.stub().resolves());
          expect(ctx.ip).to.equal(CLIENT);
        });

        it('should log the active mode once', () => expectModeLoggedOnce('TRUSTED_PROXIES'));
      },
    );

    withOverriddenEnvsInMochaTest({ REAL_IP_ADDRESS_MODE: 'DIRECT_PEER' }, () => {
      beforeEach(() => applyProxyMiddleware(app, logger));

      it('should ignore X-Forwarded-For and Forwarded', async () => {
        const headers = { 'x-forwarded-for': '1.2.3.4', forwarded: 'for=5.6.7.8' };
        expect(await clientIpOf(UNTRUSTED_PEER, headers)).to.equal(UNTRUSTED_PEER);
      });

      it('should report an IPv4-mapped peer as its IPv4 address', async () => {
        expect(await clientIpOf(`::ffff:${UNTRUSTED_PEER}`)).to.equal(UNTRUSTED_PEER);
      });

      it('should log the active mode once', () => expectModeLoggedOnce('DIRECT_PEER'));
    });
  });
});
