import http from 'http';
import crypto from 'crypto';

// Simple simulated server for testing clinic tools
const PORT = process.env.PORT || 3001; // Use fixed port for easier testing

// Simulate some CPU-intensive work
function simulateCpuWork() {
  const iterations = Math.floor(Math.random() * 1000000) + 500000;
  let result = 0;
  for (let i = 0; i < iterations; i++) {
    result += Math.sqrt(i);
  }
  console.log(result);
  return result;
}

// Simulate async operations
async function simulateAsyncWork() {
  const delay = Math.floor(Math.random() * 100) + 10;
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve(`Async work completed after ${delay}ms`);
    }, delay);
  });
}

// Simulate database-like operations
function simulateDbOperation() {
  const data = [];
  for (let i = 0; i < 1000; i++) {
    data.push({
      id: i,
      hash: crypto.randomBytes(32).toString('hex'),
      timestamp: Date.now(),
      value: Math.random() * 1000,
    });
  }
  return data;
}

// Create HTTP server
const server = http.createServer(async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://localhost:${PORT}`);

  try {
    switch (url.pathname) {
      case '/health':
        res.writeHead(200);
        res.end(JSON.stringify({ status: 'healthy', timestamp: new Date().toISOString() }));
        break;

      case '/cpu':
        // CPU intensive endpoint
        const cpuResult = simulateCpuWork();
        res.writeHead(200);
        res.end(
          JSON.stringify({
            message: 'CPU work completed',
            result: cpuResult,
            timestamp: new Date().toISOString(),
          }),
        );
        break;

      case '/async':
        // Async operations endpoint
        const asyncResult = await simulateAsyncWork();
        const dbData = simulateDbOperation();
        res.writeHead(200);
        res.end(
          JSON.stringify({
            message: asyncResult,
            dataCount: dbData.length,
            timestamp: new Date().toISOString(),
          }),
        );
        break;

      case '/mixed':
        // Mixed CPU and async work
        const [mixedAsync, mixedCpu] = await Promise.all([simulateAsyncWork(), Promise.resolve(simulateCpuWork())]);
        const mixedDb = simulateDbOperation();
        res.writeHead(200);
        res.end(
          JSON.stringify({
            async: mixedAsync,
            cpu: mixedCpu,
            dataCount: mixedDb.length,
            timestamp: new Date().toISOString(),
          }),
        );
        break;

      case '/bad-memory':
        // Memory allocation test
        const largeArray = new Array(100000).fill(0).map((_, i) => ({
          index: i,
          data: crypto.randomBytes(100).toString('hex'),
          nested: {
            id: i,
            value: Math.random(),
            timestamp: Date.now(),
          },
        }));

        // Simulate some processing
        const processed = largeArray
          .filter((item) => item.index % 2 === 0)
          .slice(0, 1000)
          .map((item) => ({
            ...item,
            processed: true,
          }));

        res.writeHead(200);
        res.end(
          JSON.stringify({
            message: 'Memory operations completed',
            originalCount: largeArray.length,
            processedCount: processed.length,
            timestamp: new Date().toISOString(),
          }),
        );
        break;

      case '/good-memory':
        // Alternative: Controlled memory test with proper cleanup
        const CHUNK_SIZE = 1000; // Process in small chunks
        const TOTAL_ITEMS = 100000;

        let processedCount = 0;
        const results = [];

        try {
          // Process data in controlled chunks
          for (let chunk = 0; chunk < TOTAL_ITEMS; chunk += CHUNK_SIZE) {
            const chunkEnd = Math.min(chunk + CHUNK_SIZE, TOTAL_ITEMS);
            const chunkData = [];

            // Create one small chunk at a time
            for (let i = chunk; i < chunkEnd; i++) {
              if (i % 2 === 0 && results.length < 1000) {
                chunkData.push({
                  index: i,
                  data: 'sample_' + i, // Use simple string instead of crypto
                  processed: true,
                });
              }
            }

            // Filter and add to results
            results.push(...chunkData.slice(0, 1000 - results.length));

            // Clear chunk data immediately
            chunkData.length = 0;

            // Stop if we have enough
            if (results.length >= 1000) break;
          }

          const response = {
            message: 'Memory operations completed',
            originalCount: TOTAL_ITEMS,
            processedCount: results.length,
            timestamp: new Date().toISOString(),
          };

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(response));

          // Clear results
          results.length = 0;
        } catch (error) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Memory operation failed' }));
        }
        break;
      default:
        res.writeHead(404);
        res.end(
          JSON.stringify({
            error: 'Not found',
            availableEndpoints: ['/health', '/cpu', '/async', '/mixed', '/memory'],
            timestamp: new Date().toISOString(),
          }),
        );
    }
  } catch (error) {
    console.error('Server error:', error);
    res.writeHead(500);
    res.end(
      JSON.stringify({
        error: 'Internal server error',
        message: error.message,
        timestamp: new Date().toISOString(),
      }),
    );
  }
});

// Handle server shutdown gracefully
process.on('SIGINT', () => {
  console.log('\nReceived SIGINT, shutting down gracefully...');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

process.on('SIGTERM', () => {
  console.log('\nReceived SIGTERM, shutting down gracefully...');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

// Start server
server.listen(PORT, () => {
  console.log(`🚀 Test server running on http://localhost:${PORT}`);
  console.log('Available endpoints:');
  console.log('  GET /health  - Health check');
  console.log('  GET /cpu     - CPU intensive operations');
  console.log('  GET /async   - Async operations with simulated delays');
  console.log('  GET /mixed   - Mixed CPU and async operations');
  console.log('  GET /memory  - Memory allocation and processing');
  console.log('\nPress Ctrl+C to stop the server');
}); // Export server for potential testing
export default server;
