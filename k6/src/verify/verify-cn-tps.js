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
let startArg = args['start'];
let endArg = args['end'];

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

main().catch((err) => {
  console.error('[verify-cn-tps] Fatal error:', err.message);
  process.exit(1);
});

async function main() {
  // Try to load from state file if arguments are missing
  if (!startArg || !endArg) {
    try {
      const { readFileSync } = await import('fs');
      const state = JSON.parse(readFileSync(STATE_FILE, 'utf8'));
      startArg = state.startTime;
      endArg = state.endTime;
      console.log(`[verify-cn-tps] Auto-discovered timestamps for PEAK (Stable) window from ${STATE_FILE}`);
    } catch (e) {
      console.error('[verify-cn-tps] Could not auto-discover timestamps and no --start/--end provided.');
      process.exit(1);
    }
  }

  const startTs = toEpochSeconds(startArg);
  const endTs = toEpochSeconds(endArg);
  const windowSecs = endTs - startTs;

  if (windowSecs <= 0) {
    console.error(`[verify-cn-tps] --end must be after --start (window=${windowSecs}s)`);
    process.exit(1);
  }

  console.log(`[verify-cn-tps] Measurement window: ${startArg} → ${endArg} (${windowSecs}s)`);
  console.log(`[verify-cn-tps] Mirror Node:         ${MIRROR_URL}`);
  console.log(`[verify-cn-tps] Target TPS:          ${TARGET_TPS}`);

  // --- Mirror Node: count ethereumtransaction records in window ---
  const txCount = await countEthereumTransactions(MIRROR_URL, startTs, endTs);
  const measuredTps = txCount / windowSecs;

  console.log();
  console.log(`[verify-cn-tps] Ethereum transactions at CN: ${txCount}`);
  console.log(`[verify-cn-tps] Measured TPS:                ${measuredTps.toFixed(2)}`);
  console.log(`[verify-cn-tps] Target TPS:                  ${TARGET_TPS}`);

  // --- Prometheus: optional diagnostic counter ---
  if (RELAY_PROM_URL) {
    await printPrometheusCounter(RELAY_PROM_URL);
  }

  // --- Assert ---
  console.log();
  if (measuredTps >= TARGET_TPS) {
    console.log(`[verify-cn-tps] PASS — ${measuredTps.toFixed(2)} TPS ≥ ${TARGET_TPS} TPS target`);
    process.exit(0);
  } else {
    console.error(
      `[verify-cn-tps] FAIL — ${measuredTps.toFixed(2)} TPS < ${TARGET_TPS} TPS target` +
        ` (${txCount} txs / ${windowSecs}s)`,
    );
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Mirror Node pagination
// ---------------------------------------------------------------------------

/**
 * Pages through Mirror Node /api/v1/transactions and counts every
 * ethereumtransaction that has result=SUCCESS within [startTs, endTs].
 * Uses timestamp filter on the API to bound the page range.
 */
async function countEthereumTransactions(mirrorUrl, startTs, endTs) {
  const baseApiUrl = `${mirrorUrl}/api/v1`;

  // Mirror Node uses nanosecond-precision string timestamps for filtering.
  // Convert epoch seconds to "seconds.nanos" string form (nanos = 0).
  const tsGte = `${startTs}.000000000`;
  const tsLte = `${endTs}.000000000`;

  let url =
    `${baseApiUrl}/transactions` +
    `?transactiontype=ethereumtransaction` +
    `&result=success` +
    `&order=asc` +
    `&timestamp=gte:${tsGte}` +
    `&timestamp=lte:${tsLte}` +
    `&limit=100`;

  let total = 0;
  let page = 0;

  while (url) {
    page++;
    const data = await fetchJson(url);

    const transactions = data.transactions || [];
    total += transactions.length;

    // Follow pagination cursor if more pages exist
    const nextUrl = data.links?.next;
    if (nextUrl && transactions.length > 0) {
      // Mirror Node returns relative paths like "/api/v1/transactions?..."
      url = nextUrl.startsWith('http') ? nextUrl : `${mirrorUrl}${nextUrl}`;
    } else {
      url = null;
    }

    if (page % 10 === 0) {
      process.stdout.write(`[verify-cn-tps]   ... paged ${page} pages, ${total} txs so far\n`);
    }
  }

  return total;
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
 * Parse ISO-8601 string into Unix epoch seconds (integer).
 */
function toEpochSeconds(isoString) {
  const ms = Date.parse(isoString);
  if (isNaN(ms)) {
    throw new Error(`Invalid timestamp: "${isoString}". Use ISO-8601 format, e.g. 2024-01-01T00:00:00Z`);
  }
  return Math.floor(ms / 1000);
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
