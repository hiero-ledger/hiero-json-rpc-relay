# Solo Test Guide

This guide provides instructions on how to set up a local Hedera network using [Solo](https://github.com/hashgraph/hedera-solo) and run the XTS (Extended Test Suite) against it.

## 1. Deploy the Solo Network

Use the `one-shot` command to deploy a single-node Hedera network:

```bash
solo one-shot single deploy
```

## 2. Build Relay and Configure Environment Variables

### A. Build the Relay project

```
npm install -f && npm run build
```

### B. Configure Environment Variables

At the root of the Relay project, create or update a `.env` file in the project root with the following configuration:

```env
CHAIN_ID="0x12a"
MIRROR_NODE_URL="http://127.0.0.1:8081"
HEDERA_NETWORK='{"127.0.0.1:50211":"0.0.3"}'
OPERATOR_ID_MAIN=0.0.2
OPERATOR_KEY_MAIN=302e020100300506032b65700422042091132178e72057a1d7528025956fe39b0b847f200ab59b2fdd367017f3087137
REDIS_ENABLED=false
USE_ASYNC_TX_PROCESSING=false
E2E_RELAY_HOST=http://localhost:7546
SDK_LOG_LEVEL=trace
USE_INTERNAL_RELAY=false
```

## 3. Run XTS Test Suite (via HAProxy)

By default, Solo deployments use HAProxy as a load balancer/ingress. Run the tests using the following command:

```bash
npm run acceptancetest:xts
```

Since HAProxy has strict timeout configurations, some tests will fail with "unhealthy node" or timeout errors after initial tests pass.

## 4. Run XTS Test Suite (Bypassing HAProxy)

### A. Re-run the entire solo again for clean setup

```bash
# Delete only Solo-managed Kind clusters (names starting with "solo")                                                                                                                                           ─╯
kind get clusters | grep '^solo' | while read cluster; do
  kind delete cluster -n "$cluster"
done

# Remove Solo configuration and cache
rm -rf ~/.solo && solo one-shot single deploy
```

### B. Stop the local process on port 50211

```bash
kill -9 $(lsof -ti :50211)
```

### C. Port-forward the Solo Consensus Node

```bash
kubectl port-forward -n <namespace> network-node1-0 50211:50211
```

### D. Execute Tests

Run the XTS suite again:

```bash
npm run acceptancetest:xts
```

This time all tests sholuld pass without any "unhealthy node" or timeout errors (unless some flaky tests might fail, which is expected).
