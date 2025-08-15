// SPDX-License-Identifier: Apache-2.0

import { ConfigService } from '@hashgraph/json-rpc-config-service/dist/services';
import v8 from 'v8';

import { setServerTimeout } from './koaJsonRpc/lib/utils'; // Import the 'setServerTimeout' function from the correct location
import app, { logger, relay } from './server';

async function main() {
  try {
    await relay.ensureOperatorHasBalance();
  } catch (error) {
    logger.fatal(error);
    process.exit(1);
  }

  const server = app.listen({ port: ConfigService.get('SERVER_PORT'), host: ConfigService.get('SERVER_HOST') });

  // set request timeout to ensure sockets are closed after specified time of inactivity
  setServerTimeout(server);

  // Handle graceful shutdown for clean termination
  const gracefulShutdown = (signal: string) => {
    logger.info(`Received ${signal}. Starting graceful shutdown...`);

    server.close(() => {
      logger.info('HTTP server closed.');
      process.exit(0);
    });
  };

  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

  // // Initial memory and CPU snapshot
  // let lastRSS = 0,
  //   lastHeapUsed = 0;
  // let lastCpuUsage = process.cpuUsage();
  // let lastTime = process.hrtime.bigint();

  // const logMemory = (label = 'MEMORY') => {
  //   const { rss, heapUsed, external } = process.memoryUsage();
  //   const { used_heap_size, heap_size_limit } = v8.getHeapStatistics();
  //   const currentCpuUsage = process.cpuUsage(lastCpuUsage);
  //   const currentTime = process.hrtime.bigint();
  //   const timeDiffMs = Number(currentTime - lastTime) / 1_000_000;

  //   const rssMB = (rss / 1024 / 1024).toFixed(2);
  //   const heapMB = (heapUsed / 1024 / 1024).toFixed(2);
  //   const extMB = (external / 1024 / 1024).toFixed(2);
  //   const v8MB = (used_heap_size / 1024 / 1024).toFixed(2);
  //   const limitMB = (heap_size_limit / 1024 / 1024).toFixed(2);

  //   const rssDiff = lastRSS ? `Δ${((rss - lastRSS) / 1024 / 1024).toFixed(2)}` : '';
  //   const heapDiff = lastHeapUsed ? `Δ${((heapUsed - lastHeapUsed) / 1024 / 1024).toFixed(2)}` : '';

  //   // CPU usage as percentage of time spent in user/system
  //   const userCpuPercent = timeDiffMs > 0 ? ((currentCpuUsage.user / 1000 / timeDiffMs) * 100).toFixed(2) : '0.00';
  //   const systemCpuPercent = timeDiffMs > 0 ? ((currentCpuUsage.system / 1000 / timeDiffMs) * 100).toFixed(2) : '0.00';
  //   const totalCpuPercent = (parseFloat(userCpuPercent) + parseFloat(systemCpuPercent)).toFixed(2);

  //   logger.info(
  //     `[${label}] RSS: ${rssMB}MB ${rssDiff} | Heap: ${heapMB}MB ${heapDiff} | Ext: ${extMB}MB | V8: ${v8MB}/${limitMB}MB | CPU: ${totalCpuPercent}% (usr:${userCpuPercent}% sys:${systemCpuPercent}%)`,
  //   );

  //   lastRSS = rss;
  //   lastHeapUsed = heapUsed;
  //   lastCpuUsage = process.cpuUsage();
  //   lastTime = currentTime;
  // };

  // logMemory('INIT');
  // setInterval(() => logMemory('MONITOR'), 2000);
}

main();
