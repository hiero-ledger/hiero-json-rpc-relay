// SPDX-License-Identifier: Apache-2.0

/**
 * Consensus Node (CN) Throughput Benchmark
 *
 * Purpose: Prove the Relay can sustain ≥100 TPS to the Consensus Node under
 * memory-constrained pod conditions (≤104Mi). Measures raw submission throughput
 * for eth_sendRawTransaction only.
 *
 * Strategy:
 *  - ramping-arrival-rate executor: ramps to CN_BENCH_TARGET_RPS (default 130),
 *    holds for STABLE_DURATION, then ramps down.
 *  - 80 wallets (WALLETS_AMOUNT), each pre-signed with SIGNED_TXS txs via prep.js.
 *  - One VU per wallet (preAllocatedVUs = maxVUs = WALLETS_AMOUNT) so each VU owns
 *    its wallet exclusively — no nonce conflicts.
 *  - Monotonic tx index (iterationInScenario) with exhaustion guard: fails loudly if
 *    SIGNED_TXS was set too low rather than silently replaying stale nonces.
 *
 * Measurement: k6 summary shows Relay-side success rate. Post-test, run
 * `npm run verify-cn-tps` to count Mirror Node ethereumtransaction records for CN TPS.
 *
 * Usage:
 *   npm run prep-cn         # prepare wallets (WALLETS_AMOUNT=80 SIGNED_TXS=300)
 *   npm run cn-benchmark    # run this scenario (reads .env for overrides)
 *   npm run verify-cn-tps   # assert ≥100 TPS reached CN
 *
 *   Or combined: npm run prep-and-cn
 *
 * Key env vars (with defaults shown):
 *   CN_BENCH_TARGET_RPS   = 130    RPS sent to Relay (expects ~100 to reach CN)
 *   WALLETS_AMOUNT        = 80     VU count; must match what prep.js used
 *   RAMP_UP_DURATION      = 2m     (override to 1m for quick local runs)
 *   STABLE_DURATION       = 20m    (override to 1m for quick local runs)
 *   RAMP_DOWN_DURATION    = 1m     (override to 30s for quick local runs)
 *   RELAY_BASE_URL        = http://localhost:7546
 */

import http from 'k6/http';
import exec from 'k6/execution';
import { textSummary } from 'https://jslib.k6.io/k6-summary/0.0.2/index.js';

import { setDefaultValuesForEnvParameters } from '../lib/parameters.js';
import { getPayLoad, httpParams, isNonErrorResponse } from './test/common.js';
import { check } from 'k6';

// ---------------------------------------------------------------------------
// Globals and State Tracking
// ---------------------------------------------------------------------------

const STATE_FILE = 'cn-benchmark-state.json';

// Capture initialization time. This is stable across VUs within the same process.
const runStartTime = Date.now();

/**
 * Parses a duration string (e.g., "1m", "30s") into milliseconds.
 *
 * @param {string} duration
 * @returns {number}
 */
function parseDuration(duration) {
  const match = duration.match(/^(\d+)([smh])$/);
  if (!match) return 0;
  const value = parseInt(match[1], 10);
  const unit = match[2];
  const multipliers = { s: 1000, m: 60000, h: 3600000 };
  return value * multipliers[unit];
}

// ---------------------------------------------------------------------------
// Configuration — resolved once at init time
// ---------------------------------------------------------------------------

setDefaultValuesForEnvParameters();

const TARGET_RPS = parseInt(__ENV['CN_BENCH_TARGET_RPS'], 10);
const WALLETS_AMOUNT = parseInt(__ENV['WALLETS_AMOUNT'], 10);
const RAMP_UP = __ENV['RAMP_UP_DURATION'];
const STABLE = __ENV['STABLE_DURATION'];
const RAMP_DOWN = __ENV['RAMP_DOWN_DURATION'];
const PASS_RATE = parseFloat(__ENV['DEFAULT_PASS_RATE']);
const RELAY_URL = __ENV['RELAY_BASE_URL'];

const METHOD = 'eth_sendRawTransaction';

/**
 * Identify the peak (stable) window for post-test verification.
 * We calculate these based on the initialization time of the script.
 * Since all VUs and the summary run in the same process but different isolates,
 * they will all see this same initial 'runStartTime'.
 */
const peakStartTime = new Date(runStartTime + parseDuration(RAMP_UP)).toISOString();
const peakEndTime = new Date(runStartTime + parseDuration(RAMP_UP) + parseDuration(STABLE)).toISOString();

// ---------------------------------------------------------------------------
// k6 options
// ---------------------------------------------------------------------------

export const options = {
  scenarios: {
    cn_benchmark: {
      executor: 'ramping-arrival-rate',
      startRate: 0,
      timeUnit: '1s',
      stages: [
        { target: TARGET_RPS, duration: RAMP_UP },
        { target: TARGET_RPS, duration: STABLE },
        { target: 0, duration: RAMP_DOWN },
      ],
      preAllocatedVUs: WALLETS_AMOUNT,
      maxVUs: WALLETS_AMOUNT,
    },
  },
  thresholds: {
    [`http_req_failed{scenario:cn_benchmark}`]: [{ threshold: `rate<${1 - PASS_RATE}`, abortOnFail: false }],
    [`http_req_duration{scenario:cn_benchmark}`]: [{ threshold: 'p(95)<10000', abortOnFail: false }],
  },
};

// ---------------------------------------------------------------------------
// Setup — loads wallets from smartContractParams.json via bootstrapEnvParameters
// ---------------------------------------------------------------------------

export { setupTestParameters as setup } from '../lib/bootstrapEnvParameters.js';

// ---------------------------------------------------------------------------
// Default function — one iteration per VU, monotonic tx index
// ---------------------------------------------------------------------------

export default function (testParameters) {
  const vuIndex = exec.vu.idInInstance - 1; // 0-based
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
// Summary — printed to stdout at end of run; pipe to file with k6 --summary-export
// ---------------------------------------------------------------------------

export function handleSummary(data) {
  const state = {
    startTime: peakStartTime,
    endTime: peakEndTime,
    totalStartTime: new Date(runStartTime).toISOString(),
    totalEndTime: new Date().toISOString(),
    targetRPS: TARGET_RPS,
    wallets: WALLETS_AMOUNT,
  };

  // k6 saves this to the [STATE_FILE] key in the returned object
  const stateBlock = JSON.stringify(state, null, 2);

  return {
    stdout: textSummary(data, { indent: '  ', enableColors: true }),
    [STATE_FILE]: stateBlock,
  };
}
