import { exec } from 'child_process';

// Override console methods to include timestamp
const originalLog = console.log;
const originalError = console.error;

function getTimestamp() {
  return new Date().toISOString().replace('T', ' ').substring(0, 19);
}

console.log = (message?: any, ...optionalParams: any[]) => {
  originalLog(`[${getTimestamp()}]`, message, ...optionalParams);
};

console.error = (message?: any, ...optionalParams: any[]) => {
  originalError(`[${getTimestamp()}]`, message, ...optionalParams);
};

const RELAY_ENDPOINT = process.env.RELAY_ENDPOINT || 'http://localhost:7546';
const HEALTH_CHECK_INTERVAL = 10000; // 10 seconds
const HEALTH_CHECK_TIMEOUT = 5000; // 5 seconds

const requests = [
  { method: 'eth_getBlockByNumber', params: ["0x392ef1b", true], txCount: 11399 },
  { method: 'eth_getBlockByNumber', params: ["0x392ef1c", true], txCount: 6019 },
  { method: 'eth_getBlockByNumber', params: ["0x392ef1d", true], txCount: 3933 },
  { method: 'eth_getBlockByHash', params: ["0xec6c5c228d72222b28d6b5f93e0d78ee10560b7e2a126a693ed28f735d64c4c5", true], txCount: 11399 },
  { method: 'eth_getBlockByHash', params: ["0x096fab12b07b1dfddeb4adde2033d2af69aaada7964cfb85ed8d49576be467dc", true], txCount: 6019 },
  { method: 'eth_getBlockByHash', params: ["0x5d997123d3b7b094ebba1dbb1928c5f0efa8813cd42d0049c2b5a94de6d42974", true], txCount: 3933 },
  { method: 'eth_getBlockReceipts', params: ["0x392ef1b"], txCount: 11399 },
  { method: 'eth_getBlockReceipts', params: ["0x392ef1c"], txCount: 6019 },
  { method: 'eth_getBlockReceipts', params: ["0x392ef1d"], txCount: 3933 },
  { method: 'eth_getLogs', params: [{"blockHash":"0xec6c5c228d72222b28d6b5f93e0d78ee10560b7e2a126a693ed28f735d64c4c5"}], txCount: 11399 },
  { method: 'eth_getLogs', params: [{"fromBlock":"0x392ef1b", "toBlock": "0x392ef1d"}], txCount: 21351 }
];

function isServerRunning(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    exec(`lsof -t -i:${port}`, (error, stdout) => {
      if (stdout && stdout.trim().length > 0) {
        resolve(true);
      } else {
        resolve(false);
      }
    });
  });
}

async function killServer() {
  console.error('Health check timed out! Killing server on port 7546...');
  return new Promise<void>((resolve, reject) => {
    exec('lsof -t -i:7546', (error, stdout, stderr) => {
      if (error) {
        console.error(`Error finding process: ${error.message}`);
        return resolve();
      }
      const pid = stdout.trim();
      if (pid) {
        exec(`kill -9 ${pid}`, async (killError, killStdout, killStderr) => {
          if (killError) {
            console.error(`Error killing process ${pid}: ${killError.message}`);
          } else {
            console.log(`Process ${pid} killed.`);
          }
          
          // Verify server is not running
          const running = await isServerRunning(7546);
          if (!running) {
            console.log('Verified: Server at port 7546 is no longer running.');
          } else {
            console.error('Warning: Server at port 7546 is STILL running after kill attempt.');
          }
          resolve();
        });
      } else {
        console.log('No process found on port 7546.');
        resolve();
      }
    });
  });
}

async function checkHealth(endpoint: string) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), HEALTH_CHECK_TIMEOUT);
  const start = Date.now();

  try {
    const response = await fetch(`${RELAY_ENDPOINT}${endpoint}`, {
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    const duration = Date.now() - start;

    if (!response.ok) {
      throw new Error(`Health check failed: ${response.statusText}`);
    }
    console.log(`Health check ${endpoint} passed in ${duration}ms.`);
  } catch (error: any) {
    clearTimeout(timeoutId);
    const duration = Date.now() - start;

    if (error.name === 'AbortError') {
      console.error(`Health check ${endpoint} timed out after ${duration}ms.`);
      await killServer();
      process.exit(1);
    } else {
      console.error(`Health check ${endpoint} error: ${error.message} (took ${duration}ms)`);
    }
  }
}

async function runHealthChecks() {
  while (true) {
    await Promise.all([
      checkHealth('/health/liveness'),
      checkHealth('/health/readiness')
    ]);
    await new Promise(resolve => setTimeout(resolve, HEALTH_CHECK_INTERVAL));
  }
}

async function makeRpcCall(method: string, params: any[], id: number, txCount: number) {
  const body = JSON.stringify({
    jsonrpc: '2.0',
    method,
    params,
    id
  });

  console.log(`Sending request ${id}: ${method} with params ${JSON.stringify(params)} (Expected Tx Count: ${txCount})`);
  const start = Date.now();

  try {
    const response = await fetch(RELAY_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body
    });
    const data = await response.json();
    const duration = Date.now() - start;
    console.log(`Request ${id} (${method}) completed in ${duration}ms`);
    return data;
  } catch (error: any) {
    console.error(`Request ${id} (${method}) failed: ${error.message}`);
    return { error: error.message };
  }
}

async function main() {
  console.log(`Starting load test against ${RELAY_ENDPOINT}`);
  
  // Start health checks in background
  runHealthChecks();

  const startTime = Date.now();

  // Run requests concurrently
  const promises = requests.map((req, index) => makeRpcCall(req.method, req.params, index + 1, req.txCount));
  
  try {
    await Promise.all(promises);
    const endTime = Date.now();
    const duration = endTime - startTime;
    console.log(`All requests completed in ${duration}ms.`);

    // Verify server is still running
    const running = await isServerRunning(7546);
    if (running) {
      console.log('Verified: Server at port 7546 is still running.');
    } else {
      console.error('Error: Server at port 7546 is NOT running after tests completed.');
    }

    process.exit(0);
  } catch (error) {
    console.error('Error running requests:', error);
    process.exit(1);
  }
}

main();
