// SPDX-License-Identifier: Apache-2.0

/**
 * Post-run CN TPS Verifier
 *
 * Reads wallet addresses from the prep-generated .smartContractParams.json,
 * queries Mirror Node for all contract execution results sent by those
 * addresses, and asserts the measured TPS meets the target.
 *
 * Benchmark wallets are single-purpose (created fresh by prep-cn), so
 * counting all their contract results yields the exact CN throughput
 * without timestamp synchronization or clock-drift compensation.
 *
 * Usage:
 *   node src/verify/verify-cn-tps.js \
 *     [--duration 1200] \
 *     [--mirror-url http://localhost:5551] \
 *     [--target-tps 100] \
 *     [--params-file src/prepare/.smartContractParams.json] \
 *     [--concurrency 10]
 *
 *   Or via npm (reads .env for MIRROR_BASE_URL and DEFAULT_DURATION):
 *     npm run verify-cn-tps
 *
 * Flags:
 *   --duration         Benchmark duration in seconds or k6 duration string (e.g., "20m").
 *                      Falls back to DEFAULT_DURATION env var.
 *   --mirror-url       Mirror Node base URL (default: MIRROR_BASE_URL env, else http://localhost:5551)
 *   --target-tps       Minimum TPS required to pass (default: 100)
 *   --params-file      Path to .smartContractParams.json (default: src/prepare/.smartContractParams.json)
 *   --concurrency      Max parallel Mirror Node requests per batch (default: 10)
 *
 * Exit codes:
 *   0  TPS target met
 *   1  TPS target not met, or fatal error
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const args = parseArgs(process.argv.slice(2));

const MIRROR_URL = args['mirror-url'] || process.env['MIRROR_BASE_URL'] || 'http://localhost:5551';
const TARGET_TPS = parseInt(args['target-tps'] || '100', 10);
const PARAMS_FILE = args['params-file'] || 'src/prepare/.smartContractParams.json';
const CONCURRENCY = parseInt(args['concurrency'] || '10', 10);

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

main().catch((err) => {
  console.error('[verify-cn-tps] Fatal error:', err.message);
  process.exit(1);
});

async function main() {
  const durationSecs = resolveDuration(args['duration'] || process.env['DEFAULT_DURATION']);
  const addresses = loadWalletAddresses(PARAMS_FILE);

  console.log(`[verify-cn-tps] WALLETS:          ${addresses.length}`);
  console.log(`[verify-cn-tps] DURATION:         ${durationSecs}s`);
  console.log(`[verify-cn-tps] MIRROR ENDPOINT:  ${MIRROR_URL}`);
  console.log(`[verify-cn-tps] TARGET TPS:       ${TARGET_TPS}`);
  console.log(`[verify-cn-tps] CONCURRENCY:      ${CONCURRENCY}`);

  console.log('[verify-cn-tps] Fetching contract results from Mirror Node...');
  const { totalSuccessful, errors } = await countAllTransactions(MIRROR_URL, addresses, CONCURRENCY);
  const totalProcessed = totalSuccessful + errors.length;
  const measuredTps = totalProcessed / durationSecs;

  console.log();
  console.log('[verify-cn-tps] --- RESULTS ---');
  console.log(`[verify-cn-tps] SUCCESSFUL TXS:   ${totalSuccessful}`);

  if (errors.length > 0) {
    const errorDistribution = errors.reduce((acc, curr) => {
      acc[curr] = (acc[curr] || 0) + 1;
      return acc;
    }, {});
    console.log(`[verify-cn-tps] FAILED TXS:       ${errors.length}`);
    Object.entries(errorDistribution).forEach(([err, count]) => {
      console.log(`[verify-cn-tps]   - ${err}: ${count}`);
    });
  }

  console.log(`[verify-cn-tps] TOTAL REACHED CN: ${totalProcessed}`);
  console.log(`[verify-cn-tps] DURATION:         ${durationSecs}s`);
  console.log(`[verify-cn-tps] MEASURED TPS:     ${measuredTps.toFixed(2)}`);
  console.log(`[verify-cn-tps] TARGET TPS:       ${TARGET_TPS}`);

  console.log();
  if (measuredTps >= TARGET_TPS) {
    console.log(`[verify-cn-tps] STATUS: PASS — ${measuredTps.toFixed(2)} TPS verified.`);
    process.exit(0);
  } else {
    console.error(`[verify-cn-tps] STATUS: FAIL — ${measuredTps.toFixed(2)} TPS below target ${TARGET_TPS}.`);
    if (totalProcessed === 0) {
      console.error('[verify-cn-tps] DIAGNOSIS: No transactions recorded. Verify Relay and HAPI connectivity.');
    }
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Wallet Address Loading
// ---------------------------------------------------------------------------

/**
 * Reads wallet addresses from the prep-generated parameters file.
 *
 * @param {string} filePath - Relative or absolute path to .smartContractParams.json.
 * @returns {string[]} Lowercased EVM addresses.
 * @throws {Error} If the file is missing or contains no wallets.
 */
function loadWalletAddresses(filePath) {
  const resolvedPath = resolve(filePath);
  let raw;
  try {
    raw = readFileSync(resolvedPath, 'utf8');
  } catch (err) {
    throw new Error(`Cannot read params file at ${resolvedPath}: ${err.message}`);
  }

  const params = JSON.parse(raw);
  const wallets = params.wallets;

  if (!Array.isArray(wallets) || wallets.length === 0) {
    throw new Error(`No wallets found in ${filePath}`);
  }

  return wallets.map((w) => w.address.toLowerCase());
}

// ---------------------------------------------------------------------------
// Mirror Node Queries
// ---------------------------------------------------------------------------

/**
 * Aggregates contract execution results across all benchmark wallet addresses.
 * Processes wallets in parallel batches bounded by the concurrency limit.
 *
 * @param {string} mirrorUrl - Mirror Node base URL.
 * @param {string[]} addresses - Lowercased EVM addresses to query.
 * @param {number} concurrency - Maximum parallel Mirror Node requests per batch.
 * @returns {Promise<{ totalSuccessful: number, errors: string[] }>} Aggregated counts.
 */
async function countAllTransactions(mirrorUrl, addresses, concurrency) {
  let totalSuccessful = 0;
  const allErrors = [];

  for (let i = 0; i < addresses.length; i += concurrency) {
    const chunk = addresses.slice(i, i + concurrency);
    const results = await Promise.all(chunk.map((addr) => countTransactionsForAddress(mirrorUrl, addr)));

    for (const result of results) {
      totalSuccessful += result.successful;
      allErrors.push(...result.errors);
    }

    const scanned = Math.min(i + concurrency, addresses.length);
    process.stdout.write(
      `[verify-cn-tps]   Progress: ${scanned}/${addresses.length} wallets ` +
        `(${totalSuccessful} success, ${allErrors.length} failed)\n`,
    );
  }

  return { totalSuccessful, errors: allErrors };
}

/**
 * Paginates through all contract execution results for a single sender address
 * via the Mirror Node REST API.
 *
 * @param {string} mirrorUrl - Mirror Node base URL.
 * @param {string} address - Lowercased EVM address.
 * @returns {Promise<{ successful: number, errors: string[] }>} Per-address counts.
 */
async function countTransactionsForAddress(mirrorUrl, address) {
  let url = `${mirrorUrl}/api/v1/contracts/results?from=${address}&limit=100&order=asc`;
  let successful = 0;
  const errors = [];

  while (url) {
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} fetching ${url}`);
    }

    const data = await res.json();
    const results = data.results || [];

    for (const result of results) {
      if (result.result === 'SUCCESS') {
        successful++;
      } else {
        errors.push(result.result);
      }
    }

    const nextUrl = data.links?.next;
    if (nextUrl && results.length > 0) {
      url = nextUrl.startsWith('http') ? nextUrl : `${mirrorUrl}${nextUrl}`;
    } else {
      url = null;
    }
  }

  return { successful, errors };
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

/**
 * Resolves benchmark duration from a CLI flag or DEFAULT_DURATION env var.
 * Accepts plain seconds (e.g., "1200") or k6 duration strings (e.g., "20m", "1h").
 *
 * @param {string | undefined} input - Duration value from CLI or env.
 * @returns {number} Duration in seconds.
 * @throws {Error} If input is missing or unparseable.
 */
function resolveDuration(input) {
  if (!input) {
    throw new Error('Duration required. Use --duration <seconds|duration-string> or set DEFAULT_DURATION env var.');
  }

  if (/^\d+$/.test(input)) {
    return parseInt(input, 10);
  }

  const match = input.match(/^(\d+)([smh])$/);
  if (match) {
    const value = parseInt(match[1], 10);
    const multipliers = { s: 1, m: 60, h: 3600 };
    return value * multipliers[match[2]];
  }

  throw new Error(`Invalid duration: "${input}". Use seconds (e.g., 1200) or duration string (e.g., 20m).`);
}

/**
 * Parses CLI arguments into a key-value map.
 * Supports --key value and --key=value syntax.
 *
 * @param {string[]} argv - Process arguments after the script name.
 * @returns {Object<string, string>} Parsed key-value pairs.
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
