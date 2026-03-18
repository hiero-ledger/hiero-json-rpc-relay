         /\      Grafana   /‾‾/
    /\  /  \     |\  __   /  /

/ \/ \ | |/ / / ‾‾\
 / \ | ( | (‾) |
/ ****\_\_**** \ |\_|\_\ \_\_\_\_\_/

     execution: local
        script: src/scenarios/cn-benchmark.js
        output: -

     scenarios: (100.00%) 1 scenario, 10 max VUs, 40s max duration (incl. graceful stop):
              * cn_benchmark: 120.00 iterations/s for 10s (maxVUs: 10, gracefulStop: 30s)

WARN[0000] Insufficient VUs, reached 10 active VUs and cannot initialize more executor=constant-arrival-rate scenario=cn_benchmark
✓ status 200
✓ no error field

      checks.........................: 100.00% ✓ 938       ✗ 0
      data_received..................: 181 kB  18 kB/s
      data_sent......................: 317 kB  31 kB/s
      dropped_iterations.............: 731     71.386196/s
      http_req_blocked...............: avg=10.25µs  min=1µs     med=3µs      max=786µs    p(90)=5.8µs    p(95)=7µs
      http_req_connecting............: avg=5.62µs   min=0s      med=0s       max=475µs    p(90)=0s       p(95)=0s
      http_req_duration..............: avg=204.35ms min=2.11ms  med=196.42ms max=451.03ms p(90)=283.97ms p(95)=312.82ms
        { expected_response:true }...: avg=204.35ms min=2.11ms  med=196.42ms max=451.03ms p(90)=283.97ms p(95)=312.82ms
      ✓ { scenario:cn_benchmark }....: avg=206.06ms min=30.84ms med=196.64ms max=451.03ms p(90)=284.01ms p(95)=313.19ms
      http_req_failed................: 0.00%   ✓ 0         ✗ 473
      ✓ { scenario:cn_benchmark }....: 0.00%   ✓ 0         ✗ 469
      http_req_receiving.............: avg=35.35µs  min=14µs    med=31µs     max=200µs    p(90)=55µs     p(95)=69µs
      http_req_sending...............: avg=14.86µs  min=5µs     med=13µs     max=217µs    p(90)=22µs     p(95)=24.39µs
      http_req_tls_handshaking.......: avg=0s       min=0s      med=0s       max=0s       p(90)=0s       p(95)=0s
      http_req_waiting...............: avg=204.3ms  min=2.09ms  med=196.38ms max=450.99ms p(90)=283.91ms p(95)=312.78ms
      http_reqs......................: 473     46.191068/s
      iteration_duration.............: avg=206.23ms min=31.31ms med=197.06ms max=451.34ms p(90)=284.25ms p(95)=313.36ms
      iterations.....................: 469     45.800446/s
      vus............................: 10      min=9       max=10

running (10.2s), 00/10 VUs, 469 complete and 0 interrupted iterations
cn_benchmark ✓ [======================================] 00/10 VUs 10s 120.00 iters/s

> hedera-rpc-relay-k6-perf-test@0.1.0 verify-cn-tps
> env-cmd node src/verify/verify-cn-tps.js

[verify-cn-tps] WALLETS: 10
[verify-cn-tps] DURATION: 10s
[verify-cn-tps] MIRROR ENDPOINT: http://127.0.0.1:8081
[verify-cn-tps] TARGET TPS: 100
[verify-cn-tps] CONCURRENCY: 10
[verify-cn-tps] Fetching contract results from Mirror Node...
[verify-cn-tps] Progress: 10/10 wallets (469 success, 0 failed)

[verify-cn-tps] --- RESULTS ---
[verify-cn-tps] SUCCESSFUL TXS: 469
[verify-cn-tps] TOTAL REACHED CN: 469
[verify-cn-tps] DURATION: 10s
[verify-cn-tps] MEASURED TPS: 46.90
[verify-cn-tps] TARGET TPS: 100

[verify-cn-tps] STATUS: FAIL — 46.90 TPS below target 100.
