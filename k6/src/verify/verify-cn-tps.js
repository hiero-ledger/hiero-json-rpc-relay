// SPDX-License-Identifier: Apache-2.0

/**
 * Post-run CN TPS Verifier
 *
 * Queries Mirror Node to count ethereumtransaction records that reached the
 * Consensus Node during the k6 benchmark window, then asserts the measured
 * TPS meets the target.
 *
 * Usage:
 *   node src/verify/verify-cn-tps.js \
 *     --start 2024-01-01T00:00:00Z \
 *     --end 2024-01-01T00:03:00Z \
 *     [--mirror-url http://localhost:5551] \
 *     [--target-tps 100] \
 *     [--relay-prom-url http://localhost:9090]
 *
 *   Or via npm (reads .env for MIRROR_BASE_URL):
 *     npm run verify-cn-tps -- --start ... --end ...
 *
 * Flags:
 *   --start           ISO-8601 timestamp: beginning of the measurement window
 *   --end             ISO-8601 timestamp: end of the measurement window
 *   --mirror-url      Mirror Node base URL (default: MIRROR_BASE_URL env, else http://localhost:5551)
 *   --target-tps      Minimum TPS required to pass (default: 100)
 *   --relay-prom-url  Relay Prometheus base URL (optional, for diagnostic counter print)
 *   --drain-buffer    Seconds added past totalEndTime when reading from the state file (default: 120).
 *                     USE_ASYNC_TX_PROCESSING=true causes the relay to submit transactions to HAPI
 *                     after returning 200 to k6; this buffer captures that async backlog.
 *
 * Exit codes:
 *   0  TPS target met (or --dry-run mode)
 *   1  TPS target not met, or fatal error
 */

const args = parseArgs(process.argv.slice(2));

const MIRROR_URL = args['mirror-url'] || process.env['MIRROR_BASE_URL'] || 'http://localhost:5551';
const TARGET_TPS = parseInt(args['target-tps'] || '100', 10);
const RELAY_PROM_URL = args['relay-prom-url'] || null;

// Automated state discovery
const STATE_FILE = 'cn-benchmark-state.json';

/**
 * Extra seconds appended to totalEndTime when deriving the Mirror Node query window from
 * the state file. With USE_ASYNC_TX_PROCESSING=true the relay submits transactions to HAPI
 * after returning the hash to k6; this buffer ensures those late-arriving transactions are
 * included in the count.
 */
const DRAIN_BUFFER_SECS = parseInt(args['drain-buffer'] || '120', 10);

let startArg = args['start'];
let endArg = args['end'];

/**
 * Stable-phase duration in seconds used as the TPS denominator when the state file is
 * available. Null causes the verifier to fall back to the query-window duration, which
 * is correct for manual --start/--end invocations.
 *
 * @type {number | null}
 */
let measureWindowSecs = null;

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

main().catch((err) => {
  console.error('[verify-cn-tps] Fatal error:', err.message);
  process.exit(1);
});

async function main() {
  // CONFIGURATION RESOLUTION
  if (!startArg || !endArg) {
    try {
      const { readFileSync } = await import('fs');
      const state = JSON.parse(readFileSync(STATE_FILE, 'utf8'));

      // Use the full run window (ramp-up through ramp-down + drain buffer) as the
      // query range. With USE_ASYNC_TX_PROCESSING=true, the relay submits transactions
      // to HAPI after returning 200 to k6, so confirmed transactions can appear in the
      // Mirror Node well after the stable phase ends. The drain buffer captures that
      // async backlog without widening the TPS denominator.
      startArg = state.totalStartTime || state.startTime;
      const totalEndMs = Date.parse(state.totalEndTime || state.endTime);
      endArg = new Date(totalEndMs + DRAIN_BUFFER_SECS * 1000).toISOString();

      // TPS is calculated against the stable phase duration, not the wider query window,
      // so the denominator reflects the intended submission-rate window.
      measureWindowSecs = state.stableMs ? state.stableMs / 1000 : null;

      console.log(`[verify-cn-tps] AUTO-DISCOVERY: Synchronized with ${STATE_FILE}`);
      console.log(`[verify-cn-tps] DRAIN BUFFER:     +${DRAIN_BUFFER_SECS}s after totalEndTime`);
      console.log(`[verify-cn-tps] CLOCK OFFSET:     ${state.driftOffsetMs || 0}ms (Apply to Consensus)`);
    } catch {
      console.error(`[verify-cn-tps] ERROR: Missing valid timestamps in ${STATE_FILE} or --start/--end.`);
      process.exit(1);
    }
  }

  const startTs = toEpochTimestamp(startArg);
  const endTs = toEpochTimestamp(endArg);
  const windowSecs = endTs - startTs;

  // When state file is available, divide confirmed transactions by the stable-phase
  // duration rather than the wider query window; the wider window exists only to
  // capture async relay submissions, not to change the TPS denominator.
  const tpsWindowSecs = measureWindowSecs ?? windowSecs;

  if (windowSecs <= 0) {
    console.error(`[verify-cn-tps] ERROR: Measurement window is zero or negative (${windowSecs.toFixed(3)}s)`);
    process.exit(1);
  }

  console.log(`[verify-cn-tps] QUERY WINDOW:     ${startArg} → ${endArg} (${windowSecs.toFixed(3)}s)`);
  console.log(`[verify-cn-tps] TPS WINDOW:       ${tpsWindowSecs.toFixed(3)}s (stable phase)`);
  console.log(`[verify-cn-tps] MIRROR ENDPOINT:  ${MIRROR_URL}`);
  console.log(`[verify-cn-tps] TARGET TPS:       ${TARGET_TPS}`);

  // CORE DATA RETRIEVAL
  console.log('[verify-cn-tps] Fetching records...');
  const { totalSuccessful, errors } = await countEthereumTransactions(MIRROR_URL, startTs, endTs);
  const totalProcessed = totalSuccessful + errors.length;
  const measuredTps = totalProcessed / tpsWindowSecs;

  // DIAGNOSTIC REPORTING
  console.log();
  console.log(`[verify-cn-tps] --- AGGREGATED METRICS ---`);
  console.log(`[verify-cn-tps] SUCCESSFUL TXS:    ${totalSuccessful}`);

  if (errors.length > 0) {
    const errorDistribution = errors.reduce((acc, curr) => {
      acc[curr] = (acc[curr] || 0) + 1;
      return acc;
    }, {});
    console.log(`[verify-cn-tps] FAILED TXS:        ${errors.length}`);
    Object.entries(errorDistribution).forEach(([err, count]) => {
      console.log(`[verify-cn-tps]   - ${err}: ${count}`);
    });
  }

  console.log(`[verify-cn-tps] TOTAL REACHED CN:  ${totalProcessed}`);
  console.log(`[verify-cn-tps] TPS WINDOW:        ${tpsWindowSecs.toFixed(3)}s`);
  console.log(`[verify-cn-tps] MEASURED TPS:      ${measuredTps.toFixed(2)}`);
  console.log(`[verify-cn-tps] TARGET TPS:        ${TARGET_TPS}`);

  // PROMETHEUS INTEGRATION
  if (RELAY_PROM_URL) {
    await printPrometheusCounter(RELAY_PROM_URL);
  }

  // ASSERTION & FINAL DIAGNOSIS
  console.log();
  if (measuredTps >= TARGET_TPS) {
    console.log(`[verify-cn-tps] STATUS: PASS — Sustained ${measuredTps.toFixed(2)} TPS success verified.`);
    process.exit(0);
  } else {
    console.error(`[verify-cn-tps] STATUS: FAIL — Insufficient throughput verified.`);

    if (totalProcessed === 0 && errors.length === 0) {
      console.error('[verify-cn-tps] DIAGNOSIS: No transactions recorded. Verify Relay process and HAPI connectivity.');
    } else if (errors.length > totalProcessed) {
      console.error(
        '[verify-cn-tps] DIAGNOSIS: Critical failure rate. Most common error likely saturated the Relay or throttled at HAPI.',
      );
    } else {
      console.error(
        '[verify-cn-tps] DIAGNOSIS: Throughput plateau. Consider increasing WALLETS_AMOUNT or enabling ASYNC submission.',
      );
    }
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Mirror Node Data Ingestion
// ---------------------------------------------------------------------------

/**
 * Orchestrates Mirror Node pagination with strict time-window boundaries.
 *
 * @param {string} mirrorUrl
 * @param {number} startTs
 * @param {number} endTs
 * @returns {Promise<{ totalSuccessful: number, errors: string[] }>} Aggregated counts.
 */
async function countEthereumTransactions(mirrorUrl, startTs, endTs) {
  const baseApiUrl = `${mirrorUrl}/api/v1`;

  // We use exclusive 'gt' and 'lt' filters in the URL to prevent double-counting edge records.
  let url =
    `${baseApiUrl}/transactions` +
    `?transactiontype=ethereumtransaction` +
    `&order=asc` +
    `&timestamp=gt:${startTs}` +
    `&timestamp=lt:${endTs}` +
    `&limit=100`;

  let totalSuccessful = 0;
  const errors = [];
  let page = 0;

  while (url) {
    page++;
    const data = await fetchJson(url);
    const transactions = data.transactions || [];

    for (const tx of transactions) {
      if (tx.result === 'SUCCESS') {
        totalSuccessful++;
      } else {
        errors.push(tx.result);
      }
    }

    const nextUrl = data.links?.next;
    if (nextUrl && transactions.length > 0) {
      url = nextUrl.startsWith('http') ? nextUrl : `${mirrorUrl}${nextUrl}`;
    } else {
      url = null;
    }

    if (page % 5 === 0) {
      process.stdout.write(`[verify-cn-tps]   In-Flight: ${totalSuccessful} success, ${errors.length} failed...\n`);
    }
  }

  return { totalSuccessful, errors };
}

// ---------------------------------------------------------------------------
// Prometheus (optional diagnostic)
// ---------------------------------------------------------------------------

/**
 * Fetches Prometheus /metrics and prints the rpc_relay_eth_executions_total
 * counter so the user can compare Relay submissions vs CN confirmations.
 */
async function printPrometheusCounter(promUrl) {
  try {
    const text = await fetchText(`${promUrl}/metrics`);
    const lines = text.split('\n');
    const relevant = lines.filter((l) => l.startsWith('rpc_relay_eth_executions') && !l.startsWith('#'));
    if (relevant.length > 0) {
      console.log('[verify-cn-tps] Relay Prometheus eth_executions counters:');
      relevant.forEach((l) => console.log(`  ${l}`));
    } else {
      console.log('[verify-cn-tps] No rpc_relay_eth_executions metrics found at Prometheus endpoint.');
    }
  } catch (err) {
    console.warn(`[verify-cn-tps] Could not fetch Prometheus metrics from ${promUrl}: ${err.message}`);
  }
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} fetching ${url}`);
  }
  return res.json();
}

async function fetchText(url) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} fetching ${url}`);
  }
  return res.text();
}

/**
 * Converts an ISO-8601 timestamp string to a fractional Unix epoch timestamp.
 *
 * Returns a decimal number (e.g., 1741826032.999) suitable for Mirror Node API
 * query parameters (`timestamp=gt:X`). Preserving millisecond precision avoids
 * silently shifting the query boundary by up to 999 ms — at 100+ TPS that error
 * can miscount 100 or more transactions at window edges.
 *
 * @param {string} isoString - ISO-8601 timestamp, e.g. "2024-01-01T00:00:00.999Z".
 * @returns {number} Fractional Unix epoch seconds with millisecond precision.
 * @throws {Error} If the string cannot be parsed as a valid ISO-8601 timestamp.
 */
function toEpochTimestamp(isoString) {
  const ms = Date.parse(isoString);
  if (isNaN(ms)) {
    throw new Error(`Invalid timestamp: "${isoString}". Use ISO-8601 format, e.g. 2024-01-01T00:00:00Z`);
  }
  return ms / 1000;
}

/**
 * Minimal CLI arg parser: --key value or --key=value → { key: value }
 */
function parseArgs(argv) {
  const result = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const eq = arg.indexOf('=');
      if (eq !== -1) {
        result[arg.slice(2, eq)] = arg.slice(eq + 1);
      } else if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
        result[arg.slice(2)] = argv[++i];
      } else {
        result[arg.slice(2)] = 'true';
      }
    }
  }
  return result;
}
