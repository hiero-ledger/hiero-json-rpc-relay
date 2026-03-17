// SPDX-License-Identifier: Apache-2.0

/**
 * Consensus Node (CN) Throughput Benchmark
 *
 * Proves the Relay can sustain ≥100 TPS to the Consensus Node under
 * memory-constrained pod conditions (≤104Mi). Uses a constant-arrival-rate
 * executor to maintain steady-state load for the configured duration.
 *
 * Each VU owns a dedicated wallet with pre-signed transactions generated
 * by prep-cn. Monotonic indexing ensures each VU consumes transactions
 * sequentially, preventing nonce conflicts.
 *
 * Usage:
 *   npm run prep-cn         # prepare wallets (WALLETS_AMOUNT=80 SIGNED_TXS=300)
 *   npm run cn-benchmark    # run this scenario (reads .env for overrides)
 *   npm run verify-cn-tps   # assert ≥100 TPS reached CN
 *
 * Key env vars (with defaults):
 *   CN_BENCH_TARGET_RPS   = 130    Constant RPS sent to Relay
 *   WALLETS_AMOUNT        = 80     VU count; must match prep-cn output
 *   DEFAULT_DURATION      = 20m    Total benchmark duration
 *   RELAY_BASE_URL        = http://localhost:7546
 */

import { textSummary } from 'https://jslib.k6.io/k6-summary/0.0.2/index.js';
import { check } from 'k6';
import exec from 'k6/execution';
import http from 'k6/http';

import { setupTestParameters } from '../lib/bootstrapEnvParameters.js';
import { setDefaultValuesForEnvParameters } from '../lib/parameters.js';
import { getPayLoad, httpParams, isNonErrorResponse } from './test/common.js';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

setDefaultValuesForEnvParameters();

const TARGET_RPS = parseInt(__ENV['CN_BENCH_TARGET_RPS'], 10);
const WALLETS_AMOUNT = parseInt(__ENV['WALLETS_AMOUNT'], 10);
const DURATION = __ENV['DEFAULT_DURATION'];
const PASS_RATE = parseFloat(__ENV['DEFAULT_PASS_RATE']);
const RELAY_URL = __ENV['RELAY_BASE_URL'];

const METHOD = 'eth_sendRawTransaction';

// ---------------------------------------------------------------------------
// k6 options
// ---------------------------------------------------------------------------

export const options = {
  scenarios: {
    cn_benchmark: {
      executor: 'constant-arrival-rate',
      rate: TARGET_RPS,
      timeUnit: '1s',
      duration: DURATION,
      preAllocatedVUs: WALLETS_AMOUNT,
      maxVUs: WALLETS_AMOUNT,
    },
  },
  thresholds: {
    [`http_req_failed{scenario:cn_benchmark}`]: [{ threshold: `rate<${1 - PASS_RATE}`, abortOnFail: false }],
    [`http_req_duration{scenario:cn_benchmark}`]: [{ threshold: 'p(95)<100000', abortOnFail: false }],
  },
};

/**
 * Loads test parameters including pre-signed wallets from .smartContractParams.json.
 *
 * @returns {Object} Test parameters with wallets array for VU consumption.
 */
export function setup() {
  return setupTestParameters();
}

// ---------------------------------------------------------------------------
// Default function — one iteration per VU, monotonic tx index
// ---------------------------------------------------------------------------

export default function (testParameters) {
  const vuIndex = exec.vu.idInInstance - 1;
  const wallets = testParameters.wallets;

  if (!wallets || wallets.length === 0) {
    throw new Error('No wallets in testParameters. Did you run prep-cn first?');
  }

  const wallet = wallets[vuIndex % wallets.length];

  // Monotonic index: each iteration within this VU uses the next pre-signed tx.
  // Using iterationInScenario ensures uniqueness across restarts within a single run.
  const txIndex = exec.vu.iterationInScenario;

  if (txIndex >= wallet.signedTxs.length) {
    // Fail loudly — silent nonce reuse would corrupt CN state
    throw new Error(
      `Signed tx pool exhausted for VU ${exec.vu.idInInstance} (wallet index ${vuIndex % wallets.length}). ` +
        `txIndex=${txIndex} >= signedTxs.length=${wallet.signedTxs.length}. ` +
        `Increase SIGNED_TXS and re-run prep-cn.`,
    );
  }

  const signedTx = wallet.signedTxs[txIndex];
  const res = http.post(RELAY_URL, getPayLoad(METHOD, [signedTx]), httpParams);

  check(res, {
    'status 200': (r) => r.status === 200,
    'no error field': (r) => isNonErrorResponse(r),
  });
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

/**
 * Outputs the standard k6 text summary to stdout.
 *
 * @param {Object} data - k6 summary data.
 * @returns {Object} Output target map for k6.
 */
export function handleSummary(data) {
  return {
    stdout: textSummary(data, { indent: '  ', enableColors: true }),
  };
}
