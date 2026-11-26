// SPDX-License-Identifier: Apache-2.0

import { expect } from 'chai';
import http from 'http';
import { type AddressInfo } from 'net';
import pino from 'pino';
import { type MetricObjectWithValues, type MetricValue, Registry } from 'prom-client';

import { MirrorNodeClient } from '../../../../src/relay/lib/clients';
import { attemptTimingsOf } from '../../../../src/relay/lib/clients/mirrorNodeHttpTimings';
import { CacheClientFactory } from '../../../../src/relay/lib/factories/cacheClientFactory';
import { RequestDetails } from '../../../../src/relay/lib/types';
import { withOverriddenEnvsInMochaTest } from '../../helpers';

describe('MirrorNodeClient HTTP phase metrics', function () {
  this.timeout(10000);

  const logger = pino({ level: 'silent' });
  const requestDetails = new RequestDetails({ requestId: 'phaseMetricsTest', ipAddress: '0.0.0.0' });
  const pathLabel = 'network/fees';

  let server: http.Server;
  let baseUrl: string;
  /** Milliseconds the server waits before answering. */
  let responseDelayMs: number;
  /** How many of the next requests the server drops without answering, to make axios-retry retry them. */
  let dropNext: number;
  let requestsSeen: number;

  before(async () => {
    server = http.createServer((req, res) => {
      requestsSeen++;
      if (dropNext > 0) {
        dropNext--;
        req.socket.destroy();
        return;
      }
      setTimeout(() => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ fees: [{ gas: 1 }], timestamp: '1.2' }));
      }, responseDelayMs);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });

  beforeEach(() => {
    responseDelayMs = 0;
    dropNext = 0;
    requestsSeen = 0;
  });

  const newClient = (registry: Registry): MirrorNodeClient =>
    new MirrorNodeClient(baseUrl, logger, registry, CacheClientFactory.create(logger, registry));

  const metric = async (registry: Registry, name: string): Promise<MetricObjectWithValues<MetricValue<string>>> =>
    registry.getSingleMetric(name)!.get();

  /** Sum and count of `rpc_relay_mirror_node_phase_duration` per phase. */
  const phases = async (registry: Registry): Promise<Record<string, { sum: number; count: number }>> => {
    const { values } = await metric(registry, 'rpc_relay_mirror_node_phase_duration');
    const byPhase: Record<string, { sum: number; count: number }> = {};
    for (const value of values) {
      const phase = value.labels.phase as string;
      byPhase[phase] ??= { sum: 0, count: 0 };
      if (value.metricName?.endsWith('_sum')) byPhase[phase].sum += value.value;
      if (value.metricName?.endsWith('_count')) byPhase[phase].count += value.value;
    }
    return byPhase;
  };

  const attempts = async (registry: Registry): Promise<Record<string, number>> => {
    const { values } = await metric(registry, 'rpc_relay_mirror_node_attempt_count');
    return Object.fromEntries(values.map((value) => [value.labels.socket as string, value.value]));
  };

  const responseSum = async (registry: Registry): Promise<number> => {
    const { values } = await metric(registry, 'rpc_relay_mirror_response');
    return values.filter((value) => value.metricName?.endsWith('_sum')).reduce((sum, value) => sum + value.value, 0);
  };

  /** Sum and count of `rpc_relay_mirror_node_upstream_duration`. */
  const upstream = async (registry: Registry): Promise<{ sum: number; count: number }> => {
    const { values } = await metric(registry, 'rpc_relay_mirror_node_upstream_duration');
    const valueOf = (suffix: string): number =>
      values.filter((value) => value.metricName?.endsWith(suffix)).reduce((sum, value) => sum + value.value, 0);
    return { sum: valueOf('_sum'), count: valueOf('_count') };
  };

  it('splits a call on a new socket into connect, ttfb, download, parse and other', async () => {
    const registry = new Registry();
    responseDelayMs = 50;

    const result = await newClient(registry).get<{ fees: unknown[] }>('network/fees', pathLabel, requestDetails);

    expect(result?.fees).to.have.length(1);
    const byPhase = await phases(registry);
    // 127.0.0.1 needs no DNS lookup; plain HTTP has no TLS handshake
    expect(byPhase).to.have.keys('pool_wait', 'connect', 'ttfb', 'download', 'parse', 'other');
    expect(byPhase.ttfb.sum).to.be.at.least(45);
    expect(byPhase.pool_wait.sum).to.be.below(45);
    expect(await attempts(registry)).to.deep.equal({ new: 1 });

    // the phases add up to the call's total, within the rounding of the response histogram's Date.now() timer
    const phaseTotal = Object.values(byPhase).reduce((sum, phase) => sum + phase.sum, 0);
    expect(phaseTotal).to.be.closeTo(await responseSum(registry), 2);

    // the upstream latency is the attempt's ttfb plus download, without connect, parse or other
    expect(await upstream(registry)).to.deep.equal({ sum: byPhase.ttfb.sum + byPhase.download.sum, count: 1 });
  });

  it('reports a kept-alive socket as reused, without connect', async () => {
    const registry = new Registry();
    const client = newClient(registry);

    await client.get('network/fees', pathLabel, requestDetails);
    await client.get('network/fees', pathLabel, requestDetails);

    expect(await attempts(registry)).to.deep.equal({ new: 1, reused: 1 });
    const byPhase = await phases(registry);
    expect(byPhase.connect.count).to.equal(1);
    expect(byPhase.ttfb.count).to.equal(2);
  });

  withOverriddenEnvsInMochaTest({ MIRROR_NODE_HTTP_MAX_SOCKETS: 1 }, () => {
    it('reports the wait for a free socket as pool_wait, and the queued request in the agent gauge', async () => {
      const registry = new Registry();
      const client = newClient(registry);
      responseDelayMs = 100;

      const calls = [
        client.get('network/fees', pathLabel, requestDetails),
        client.get('network/fees', pathLabel, requestDetails),
      ];
      await new Promise((resolve) => setTimeout(resolve, 30));

      const { values: sockets } = await metric(registry, 'rpc_relay_mirror_node_agent_sockets');
      const restSockets = Object.fromEntries(
        sockets.filter((value) => value.labels.client === 'rest').map((value) => [value.labels.state, value.value]),
      );
      expect(restSockets).to.deep.equal({ active: 1, free: 0, queued: 1 });
      const { values: inFlight } = await metric(registry, 'rpc_relay_mirror_node_in_flight_requests');
      expect(inFlight[0].value).to.equal(2);

      await Promise.all(calls);

      const { values: inFlightAfter } = await metric(registry, 'rpc_relay_mirror_node_in_flight_requests');
      expect(inFlightAfter[0].value).to.equal(0);
      // the second call waited for the first one's socket
      const byPhase = await phases(registry);
      expect(byPhase.pool_wait.sum).to.be.at.least(90);
      expect(await attempts(registry)).to.deep.equal({ new: 1, reused: 1 });
      // the wait for a socket is relay-side, so it is in the call's total but not in the upstream latency
      const { sum: upstreamSum, count: upstreamCount } = await upstream(registry);
      expect(upstreamCount).to.equal(2);
      expect(upstreamSum).to.be.closeTo(byPhase.ttfb.sum + byPhase.download.sum, 0.001);
      expect(await responseSum(registry)).to.be.at.least(upstreamSum + 90);
    });
  });

  withOverriddenEnvsInMochaTest({ MIRROR_NODE_HTTP_MAX_SOCKETS: 1, MIRROR_NODE_TIMEOUT: 150 }, () => {
    it('attributes a timeout to the phase the request was stuck in', async () => {
      const registry = new Registry();
      const client = newClient(registry);
      responseDelayMs = 400;

      const results = await Promise.allSettled([
        client.get('network/fees', pathLabel, requestDetails),
        client.get('network/fees', pathLabel, requestDetails),
      ]);

      expect(results.map((result) => result.status)).to.deep.equal(['rejected', 'rejected']);
      const byPhase = await phases(registry);
      // MIRROR_NODE_TIMEOUT starts once a request has a socket: the second call first waited for the first one's
      // socket, which closed when the first call timed out, and then timed out waiting for its own response headers
      expect(byPhase.pool_wait.sum).to.be.at.least(140);
      expect(byPhase.ttfb.sum).to.be.at.least(290);
      expect(await upstream(registry)).to.deep.equal({ sum: byPhase.ttfb.sum, count: 2 });
    });
  });

  withOverriddenEnvsInMochaTest({ MIRROR_NODE_RETRY_DELAY: 20 }, () => {
    it('includes retried attempts, and puts the retry delay in other', async () => {
      const registry = new Registry();
      dropNext = 1;

      await newClient(registry).get('network/fees', pathLabel, requestDetails, 1);

      expect(requestsSeen).to.equal(2);
      expect(await attempts(registry)).to.deep.equal({ new: 2 });
      const byPhase = await phases(registry);
      expect(byPhase.connect.count).to.equal(2);
      expect(byPhase.other.sum).to.be.at.least(15);
      // the dropped attempt got no response, so it is in the upstream latency by its ttfb only
      expect((await upstream(registry)).count).to.equal(2);
    });
  });

  it('observes a burst of calls and new sockets started in one event-loop iteration', async () => {
    const registry = new Registry();
    const client = newClient(registry);
    responseDelayMs = 20;

    await Promise.all(Array.from({ length: 5 }, () => client.get('network/fees', pathLabel, requestDetails)));

    const { values } = await metric(registry, 'rpc_relay_mirror_node_tick_burst');
    const sumOf = (kind: string): number =>
      values.find((value) => value.labels.kind === kind && value.metricName?.endsWith('_sum'))!.value;
    const countOf = (kind: string): number =>
      values.find((value) => value.labels.kind === kind && value.metricName?.endsWith('_count'))!.value;
    expect([sumOf('requests'), countOf('requests')]).to.deep.equal([5, 1]);
    expect([sumOf('new_sockets'), countOf('new_sockets')]).to.deep.equal([5, 1]);
  });

  it('reports the in-flight peak since the previous scrape', async () => {
    const registry = new Registry();
    const client = newClient(registry);

    await Promise.all(Array.from({ length: 3 }, () => client.get('network/fees', pathLabel, requestDetails)));

    expect((await metric(registry, 'rpc_relay_mirror_node_in_flight_requests_peak')).values[0].value).to.equal(3);
    expect((await metric(registry, 'rpc_relay_mirror_node_in_flight_requests_peak')).values[0].value).to.equal(0);
  });

  it('reports the response size, and counts json-bigint parses', async () => {
    const registry = new Registry();

    await newClient(registry).get('network/fees', pathLabel, requestDetails);

    const { values } = await metric(registry, 'rpc_relay_mirror_node_response_size_bytes');
    const body = JSON.stringify({ fees: [{ gas: 1 }], timestamp: '1.2' });
    expect(values.find((value) => value.metricName?.endsWith('_sum'))!.value).to.equal(body.length);
    expect((await metric(registry, 'rpc_relay_mirror_node_json_bigint_parse_count')).values).to.be.empty;
  });

  it('does not time requests sent through other agents', async () => {
    newClient(new Registry());

    const request = http.get(`${baseUrl}/api/v1/network/fees`);
    await new Promise<void>((resolve, reject) =>
      request.on('response', (res) => res.resume().on('end', resolve)).on('error', reject),
    );

    expect(attemptTimingsOf(request)).to.be.undefined;
  });
});
