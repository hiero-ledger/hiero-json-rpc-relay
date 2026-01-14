# K6 Performance Test Results 

JSON-RPC-RELAY URL:  https://testnet.hashio.io/api

Timestamp: 2026-01-14T11:04:22.967Z 

Duration: 2s 

Test Type: performance 

Virtual Users (VUs): 1 
Duration: 2s 

| Scenario | VUS | Reqs | Pass % | RPS (1/s) | Pass RPS (1/s) | Avg. Req Duration (ms) | Median (ms) | Min (ms) | Max (ms) | P(90) (ms) | P(95) (ms) | Comment |
|----------|-----|------|--------|-----|----------|-------------------|-------|-----|-----|-------|-------|---------|
| eth_getBlockByHash_withManySyntheticTxs | 1 | 212 | 100.00 | 3.50 | 3.50 | 243.89 | 220.77 | 196.01 | 674.22 | 327.10 | 341.93 | |
| eth_getBlockByNumber | 1 | 10 | 100.00 | 4.69 | 4.69 | 183.28 | 173.20 | 166.41 | 255.82 | 205.61 | 230.71 | |
| eth_getBlockByNumber_withManySyntheticTxs | 1 | 218 | 100.00 | 3.63 | 3.63 | 235.03 | 220.06 | 194.77 | 528.62 | 301.03 | 311.12 | |
