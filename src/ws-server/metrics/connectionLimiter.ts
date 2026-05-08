// SPDX-License-Identifier: Apache-2.0

import { type Logger } from 'pino';
import { Counter, Gauge, type Registry } from 'prom-client';

import { ConfigService } from '../../config-service/services';
import { WebSocketError } from '../../relay';
import { methodConfiguration } from '../../relay/lib/config/methodConfiguration';
import { type IPRateLimiterService } from '../../relay/lib/services';
import { WS_CONSTANTS } from '../utils/constants';

type IpCounter = {
  [key: string]: number;
};

const { CONNECTION_IP_LIMIT_EXCEEDED, TTL_EXPIRED, CONNECTION_LIMIT_EXCEEDED } = WebSocketError;

export default class ConnectionLimiter {
  private connectedClients: number;
  private clientIps: IpCounter;
  private logger: Logger;
  private activeConnectionsGauge: Gauge;
  private activeConnectionsGaugeByIP: Gauge;
  private ipConnectionLimitCounter: Counter;
  private connectionLimitCounter: Counter;
  private inactivityTTLCounter: Counter;
  private register: Registry;
  private rateLimiter: IPRateLimiterService;

  constructor(logger: Logger, register: Registry, rateLimiter: IPRateLimiterService) {
    this.logger = logger;
    this.register = register;
    this.connectedClients = 0;
    this.clientIps = {};
    this.rateLimiter = rateLimiter;

    this.register.removeSingleMetric(WS_CONSTANTS.connLimiter.activeConnectionsMetric.name);
    this.activeConnectionsGauge = new Gauge({
      name: WS_CONSTANTS.connLimiter.activeConnectionsMetric.name,
      help: WS_CONSTANTS.connLimiter.activeConnectionsMetric.help,
      registers: [register],
    });

    this.register.removeSingleMetric(WS_CONSTANTS.connLimiter.ipConnectionsMetric.name);
    this.activeConnectionsGaugeByIP = new Gauge({
      name: WS_CONSTANTS.connLimiter.ipConnectionsMetric.name,
      help: WS_CONSTANTS.connLimiter.ipConnectionsMetric.help,
      labelNames: WS_CONSTANTS.connLimiter.ipConnectionsMetric.labelNames,
      registers: [register],
    });

    this.register.removeSingleMetric(WS_CONSTANTS.connLimiter.connectionLimitMetric.name);
    this.connectionLimitCounter = new Counter({
      name: WS_CONSTANTS.connLimiter.connectionLimitMetric.name,
      help: WS_CONSTANTS.connLimiter.connectionLimitMetric.help,
      registers: [register],
    });

    this.register.removeSingleMetric(WS_CONSTANTS.connLimiter.ipConnectionLimitMetric.name);
    this.ipConnectionLimitCounter = new Counter({
      name: WS_CONSTANTS.connLimiter.ipConnectionLimitMetric.name,
      help: WS_CONSTANTS.connLimiter.ipConnectionLimitMetric.help,
      labelNames: WS_CONSTANTS.connLimiter.ipConnectionLimitMetric.labelNames,
      registers: [register],
    });

    this.register.removeSingleMetric(WS_CONSTANTS.connLimiter.inactivityTTLLimitMetric.name);
    this.inactivityTTLCounter = new Counter({
      name: WS_CONSTANTS.connLimiter.inactivityTTLLimitMetric.name,
      help: WS_CONSTANTS.connLimiter.inactivityTTLLimitMetric.help,
      registers: [register],
    });
  }

  public incrementCounters(ctx): void {
    const { ip } = ctx.request;

    this.connectedClients = ctx.app.server._connections;

    if (!this.clientIps[ip]) {
      this.clientIps[ip] = 1;
    } else {
      this.clientIps[ip]++;
    }
    ctx.websocket.ipCounted = true;

    ctx.websocket.subscriptions = 0;

    this.activeConnectionsGauge.set(this.connectedClients);
    this.activeConnectionsGaugeByIP.labels(ip).set(this.clientIps[ip]);
  }

  public decrementCounters(ctx): void {
    if (ctx.websocket.ipCounted) {
      const { ip } = ctx.request;
      this.clientIps[ip]--;
      this.activeConnectionsGaugeByIP.labels(ip).set(this.clientIps[ip]);
      if (this.clientIps[ip] === 0) delete this.clientIps[ip];
    }
    this.connectedClients--;
    this.activeConnectionsGauge.set(this.connectedClients);
  }

  public applyLimits(ctx): void {
    // Limit total connections
    const MAX_CONNECTION_LIMIT = ConfigService.get('WS_CONNECTION_LIMIT');
    if (this.connectedClients > MAX_CONNECTION_LIMIT) {
      this.logger.info(
        `Closing connection %s due to exceeded maximum connections (max_con=%s)`,
        ctx.websocket.id,
        MAX_CONNECTION_LIMIT,
      );
      this.connectionLimitCounter.inc();
      ctx.websocket.send(
        JSON.stringify({
          jsonrpc: '2.0',
          error: {
            code: CONNECTION_LIMIT_EXCEEDED.code,
            message: CONNECTION_LIMIT_EXCEEDED.message,
            data: {
              message: CONNECTION_LIMIT_EXCEEDED.message,
              max_connection: MAX_CONNECTION_LIMIT,
            },
          },
          id: '1',
        }),
      );
      ctx.websocket.close(CONNECTION_LIMIT_EXCEEDED.code, CONNECTION_LIMIT_EXCEEDED.message);
      return;
    }

    // Limit connections from a single IP address
    const { ip } = ctx.request;
    const MAX_CONNECTION_LIMIT_PER_IP = ConfigService.get('WS_CONNECTION_LIMIT_PER_IP');
    if (this.clientIps[ip] && this.clientIps[ip] > MAX_CONNECTION_LIMIT_PER_IP) {
      this.logger.info(
        `Closing connection %s due to exceeded maximum connections from a single IP: address %s - %s connections. (max_con=%s)`,
        ctx.websocket.id,
        ip,
        this.clientIps[ip],
        MAX_CONNECTION_LIMIT_PER_IP,
      );
      this.ipConnectionLimitCounter.labels(ip).inc();
      ctx.websocket.send(
        JSON.stringify({
          jsonrpc: '2.0',
          error: {
            code: CONNECTION_IP_LIMIT_EXCEEDED.code,
            message: CONNECTION_IP_LIMIT_EXCEEDED.message,
            data: {
              message: CONNECTION_IP_LIMIT_EXCEEDED.message,
              max_connection: MAX_CONNECTION_LIMIT_PER_IP,
            },
          },
          id: '1',
        }),
      );
      ctx.websocket.close(CONNECTION_IP_LIMIT_EXCEEDED.code, CONNECTION_IP_LIMIT_EXCEEDED.message);
      return;
    }

    // Limit connection TTL and close connection when it is reached
    this.startInactivityTTLTimer(ctx.websocket);
  }

  public incrementSubs(ctx): void {
    ctx.websocket.subscriptions++;
  }

  public decrementSubs(ctx, amount = 1): void {
    ctx.websocket.subscriptions -= amount;
  }

  public validateSubscriptionLimit(ctx): boolean {
    return ctx.websocket.subscriptions < ConfigService.get('WS_SUBSCRIPTION_LIMIT');
  }

  // Starts a timeout timer that closes the connection
  private startInactivityTTLTimer(websocket): void {
    const maxInactivityTTL = ConfigService.get('WS_MAX_INACTIVITY_TTL');
    websocket.inactivityTTL = setTimeout(() => {
      if (websocket.readyState !== 3) {
        // 3 = CLOSED, Avoid closing already closed connections
        this.logger.debug(`Closing connection %s due to reaching TTL (%sms)`, websocket.id, maxInactivityTTL);
        try {
          this.inactivityTTLCounter.inc();
          websocket.send(
            JSON.stringify({
              jsonrpc: '2.0',
              error: {
                code: TTL_EXPIRED.code,
                message: TTL_EXPIRED.message,
                data: {
                  message: TTL_EXPIRED.message,
                  max_inactivity_TTL: maxInactivityTTL,
                },
              },
              id: '1',
            }),
          );
          websocket.close(TTL_EXPIRED.code, TTL_EXPIRED.message);
        } catch (e) {
          this.logger.error(`%s: %s`, websocket.id, e);
        }
      }
    }, maxInactivityTTL);
  }

  // Resets the inactivity TTL timer
  public resetInactivityTTLTimer(websocket): void {
    if (websocket?.inactivityTTL) {
      clearTimeout(websocket.inactivityTTL);
    }

    this.startInactivityTTLTimer(websocket);
  }

  public async shouldRateLimitOnMethod(ip, methodName, requestDetails): Promise<boolean> {
    // subcription limits are already covered in this.validateSubscriptionLimit()
    if (methodName === WS_CONSTANTS.METHODS.ETH_SUBSCRIBE || methodName === WS_CONSTANTS.METHODS.ETH_UNSUBSCRIBE)
      return false;

    const methodTotalLimit = methodConfiguration[methodName].total;
    return await this.rateLimiter.shouldRateLimit(ip, methodName, methodTotalLimit, requestDetails);
  }
}
