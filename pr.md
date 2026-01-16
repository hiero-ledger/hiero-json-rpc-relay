### Description

This PR addresses a misconfiguration in the default SDK settings where strict timeouts prevented the retry mechanism from functioning effectively.

Previously, `SDK_REQUEST_TIMEOUT` was set too low relative to the gRPC deadline and retry count, causing the total operation to time out before the SDK could attempt retries on other nodes.

**Key Changes:**

1. **New Configuration:** Introduced `SDK_GRPC_DEADLINE` (default 10s) and `SDK_MAX_ATTEMPTS` (default 10) to control SDK behavior directly.
2. **Optimized Default:** Maintains `SDK_REQUEST_TIMEOUT` at 30s which allows for approximately 3 full retry cycles (30s / 10s node attempt), striking a practical balance between resilience and user experience.
3. **Deprecation:** marked `CONSENSUS_MAX_EXECUTION_TIME` as deprecated in favor of `SDK_GRPC_DEADLINE`.
4. **Documentation:** Added a new [SDK Configuration Guide](docs/sdk-timeout-retry-config-guide.md) detailing best practices and the configuration formula.

### Related issue(s)

Fixes #4805

### Testing Guide

**Verification of Configuration Logic:**

1. Set `SDK_GRPC_DEADLINE=5000` and `SDK_MAX_ATTEMPTS=5` in `.env`.
2. Start the relay and verify logs show the SDK client configured with these values.
3. Verify `SDK_REQUEST_TIMEOUT` defaults to 30000ms if not set.

**Verification of Legacy Fallback:**

1. Set `CONSENSUS_MAX_EXECUTION_TIME=8000` (remove `SDK_GRPC_DEADLINE`).
2. Start the relay.
3. Verify logs show a warning about deprecation but correct value (8000ms) is used.

**Verification of Precedence:**

1. Set both `SDK_GRPC_DEADLINE=10000` and `CONSENSUS_MAX_EXECUTION_TIME=5000`.
2. Start the relay.
3. Verify logs show a warning about redundant config and `SDK_GRPC_DEADLINE` (10000ms) value is used.

### Changes from original design (optional)

N/A

### Additional work needed (optional)

N/A

### Checklist

- [ ] I've assigned an assignee to this PR and related issue(s) (if applicable)
- [ ] I've assigned a label to this PR and related issue(s) (if applicable)
- [ ] I've assigned a milestone to this PR and related issue(s) (if applicable)
- [ ] I've updated documentation (code comments, README, etc. if applicable)
- [ ] I've done sufficient testing (unit, integration, etc.)
