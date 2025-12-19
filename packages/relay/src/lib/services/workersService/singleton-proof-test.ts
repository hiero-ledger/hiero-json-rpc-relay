// SPDX-License-Identifier: Apache-2.0
// Quick proof that singletons don't share across worker threads
// Run with: npx ts-node packages/relay/src/lib/services/workersService/singleton-proof-test.ts

import { Counter, Registry } from 'prom-client';
import { isMainThread, parentPort, Worker } from 'worker_threads';

// Simulate a singleton registry
class RegistryFactory {
  private static instance: Registry;

  static getInstance(): Registry {
    if (!this.instance) {
      console.log(`[${isMainThread ? 'MAIN' : 'WORKER'}] Creating NEW Registry instance`);
      this.instance = new Registry();
    } else {
      console.log(`[${isMainThread ? 'MAIN' : 'WORKER'}] Reusing EXISTING Registry instance`);
    }
    return this.instance;
  }
}

if (isMainThread) {
  // ============ MAIN THREAD ============
  console.log('\n=== MAIN THREAD ===');

  // Get singleton and create a counter
  const registry = RegistryFactory.getInstance();
  const counter = new Counter({
    name: 'test_counter',
    help: 'Test counter',
    registers: [registry],
  });

  // Increment counter in main thread
  counter.inc(100);
  console.log('[MAIN] Counter incremented by 100');

  // Check the metrics in main thread
  registry.metrics().then((metrics) => {
    console.log('[MAIN] Metrics in main thread registry:');
    console.log(metrics);
  });

  // Spawn a worker using this same file
  const worker = new Worker(__filename);

  worker.on('message', (msg) => {
    console.log('\n=== RESULT ===');
    console.log(`[MAIN] Received from worker: ${msg}`);
    console.log('\n🔴 CONCLUSION: Worker created its own Registry instance!');
    console.log('   The singleton pattern does NOT share state across worker threads.\n');
    process.exit(0);
  });

  worker.on('error', (err) => {
    console.error('Worker error:', err);
    process.exit(1);
  });
} else {
  // ============ WORKER THREAD ============
  console.log('\n=== WORKER THREAD ===');

  // Try to get the "singleton" - will it be the same instance?
  const registry = RegistryFactory.getInstance();

  // Check if test_counter exists and what its value is
  registry.metrics().then((metrics) => {
    console.log('[WORKER] Metrics in worker registry:');
    console.log(metrics || '(empty - no metrics!)');

    // Check if counter exists
    const hasCounter = metrics.includes('test_counter');
    const result = hasCounter
      ? '✅ Counter EXISTS in worker (singleton shared)'
      : '❌ Counter MISSING in worker (singleton NOT shared)';

    parentPort?.postMessage(result);
  });
}
