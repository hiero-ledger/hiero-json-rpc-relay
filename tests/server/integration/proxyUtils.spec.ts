// SPDX-License-Identifier: Apache-2.0

import { expect } from 'chai';
import Koa from 'koa';
import sinon from 'sinon';

import { applyProxyMiddleware, parseForwardedHeader } from '../../../src/server/utils/proxyUtils';

describe('proxyUtils', function () {
  describe('parseForwardedHeader', function () {
    describe('returns null for invalid / edge-case inputs', function () {
      it('should return null when header exceeds 1000 characters', function () {
        const longHeader = 'for=' + 'a'.repeat(1000);
        expect(parseForwardedHeader(longHeader)).to.be.null;
      });

      it('should return null when first entry is empty (comma-only input)', function () {
        expect(parseForwardedHeader(',')).to.be.null;
      });

      it('should return null when there is no for= parameter', function () {
        expect(parseForwardedHeader('proto=https;by=10.0.0.1')).to.be.null;
      });

      it('should return null when for= has no value', function () {
        expect(parseForwardedHeader('for=')).to.be.null;
      });

      it('should return null when quoted value has no closing quote', function () {
        expect(parseForwardedHeader('for="192.168.1.1')).to.be.null;
      });

      it('should return null when bracketed IPv6 has no closing bracket', function () {
        expect(parseForwardedHeader('for=[2001:db8::1')).to.be.null;
      });

      it('should return null when extracted IP contains invalid characters', function () {
        expect(parseForwardedHeader('for=not-an-ip!')).to.be.null;
      });

      it('should return null when extracted IP exceeds 45 characters', function () {
        // 46 hex chars — too long for any valid IP
        const longIp = 'a'.repeat(46);
        expect(parseForwardedHeader(`for=${longIp}`)).to.be.null;
      });

      it('should return null for empty quoted value (for="")', function () {
        expect(parseForwardedHeader('for=""')).to.be.null;
      });
    });

    describe('unquoted IPv4', function () {
      it('should parse a plain unquoted IPv4 address', function () {
        expect(parseForwardedHeader('for=192.168.1.1')).to.equal('192.168.1.1');
      });

      it('should stop at semicolon delimiter', function () {
        expect(parseForwardedHeader('for=192.168.1.1;proto=https')).to.equal('192.168.1.1');
      });

      it('should stop at space delimiter', function () {
        expect(parseForwardedHeader('for=192.168.1.1 extra')).to.equal('192.168.1.1');
      });

      it('should stop at tab delimiter', function () {
        expect(parseForwardedHeader('for=192.168.1.1\textra')).to.equal('192.168.1.1');
      });

      it('should be case-insensitive for the for= key', function () {
        expect(parseForwardedHeader('FOR=192.168.1.1')).to.equal('192.168.1.1');
        expect(parseForwardedHeader('For=192.168.1.1')).to.equal('192.168.1.1');
      });
    });

    describe('quoted IPv4', function () {
      it('should parse a quoted IPv4 address', function () {
        expect(parseForwardedHeader('for="192.168.1.1"')).to.equal('192.168.1.1');
      });

      it('should parse a quoted IPv4 with additional parameters', function () {
        expect(parseForwardedHeader('for="192.168.1.1";by="10.0.0.1"')).to.equal('192.168.1.1');
      });
    });

    describe('bracketed IPv6', function () {
      it('should parse an unquoted bracketed IPv6 address', function () {
        expect(parseForwardedHeader('for=[2001:db8::1]')).to.equal('2001:db8::1');
      });
    });

    describe('quoted bracketed IPv6', function () {
      it('should parse a quoted bracketed IPv6 address', function () {
        expect(parseForwardedHeader('for="[2001:db8::1]"')).to.equal('2001:db8::1');
      });

      it('should parse a quoted non-bracketed IPv6 address', function () {
        // quoted but no brackets — treated as plain quoted value
        expect(parseForwardedHeader('for="2001:db8::1"')).to.equal('2001:db8::1');
      });
    });

    describe('multiple entries', function () {
      it('should use only the first entry when multiple comma-separated entries exist', function () {
        expect(parseForwardedHeader('for=192.168.1.1, for=10.0.0.1')).to.equal('192.168.1.1');
      });

      it('should use only the first entry with quoted IPs', function () {
        expect(parseForwardedHeader('for="192.168.1.1";by="10.0.0.1", for="203.0.113.1"')).to.equal('192.168.1.1');
      });
    });
  });

  describe('applyProxyMiddleware', function () {
    let app: Koa;

    beforeEach(function () {
      app = new Koa();
    });

    it('should set app.proxy to true', function () {
      expect(app.proxy).to.be.false;
      applyProxyMiddleware(app);
      expect(app.proxy).to.be.true;
    });

    it('should set x-forwarded-for from Forwarded header when x-forwarded-for is absent', async function () {
      applyProxyMiddleware(app);

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

    it('should not override x-forwarded-for when it is already present', async function () {
      applyProxyMiddleware(app);

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

    it('should not set x-forwarded-for when Forwarded header is absent', async function () {
      applyProxyMiddleware(app);

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

    it('should not set x-forwarded-for when Forwarded header is malformed', async function () {
      applyProxyMiddleware(app);

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

    it('should always call next regardless of header state', async function () {
      applyProxyMiddleware(app);

      const ctx = {
        request: { headers: {} as Record<string, string> },
      } as unknown as Koa.Context;

      const next = sinon.stub().resolves();

      const middleware = (app.middleware as Koa.Middleware[])[0];
      await middleware(ctx, next);

      expect(next.calledOnce).to.be.true;
    });
  });

  describe('ctx.ip resolution', function () {
    it('ctx.ip is the socket address when app.proxy is false (baseline)', async function () {
      const app = new Koa();
      const ips: string[] = [];
      app.use(async (ctx) => {
        ips.push(ctx.ip);
        ctx.body = 'ok';
      });
      const server = app.listen(0);
      const port = (server.address() as { port: number }).port;
      await fetch(`http://127.0.0.1:${port}`, { headers: { 'x-forwarded-for': '10.0.0.1' } });
      await fetch(`http://127.0.0.1:${port}`, { headers: { 'x-forwarded-for': '10.0.0.2' } });
      server.close();
      expect(ips[0]).to.equal('127.0.0.1');
      expect(ips[1]).to.equal('127.0.0.1');
    });

    it('ctx.ip reads X-Forwarded-For per request when applyProxyMiddleware is applied', async function () {
      const app = new Koa();
      applyProxyMiddleware(app);
      const ips: string[] = [];
      app.use(async (ctx) => {
        ips.push(ctx.ip);
        ctx.body = 'ok';
      });
      const server = app.listen(0);
      const port = (server.address() as { port: number }).port;
      await fetch(`http://127.0.0.1:${port}`, { headers: { 'x-forwarded-for': '10.0.0.1' } });
      await fetch(`http://127.0.0.1:${port}`, { headers: { 'x-forwarded-for': '10.0.0.2' } });
      server.close();
      expect(ips[0]).to.equal('10.0.0.1');
      expect(ips[1]).to.equal('10.0.0.2');
    });
  });
});
