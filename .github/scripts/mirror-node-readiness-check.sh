#!/usr/bin/env bash
# Blocks until the local mirror node has imported the operator account's balance,
# so acceptance tests don't start before genesis state is queryable. 
#
# Reads MIRROR_NODE_URL and OPERATOR_ID_MAIN from the test .env.
set -euo pipefail

ENV_FILE="${ENV_FILE:-.env}"
TIMEOUT="${MIRROR_READINESS_TIMEOUT:-180}" # seconds
INTERVAL=2

# Read a KEY=value line from the env file (empty if absent).
read_env() { grep -E "^$1=" "$ENV_FILE" 2>/dev/null | head -1 | cut -d= -f2- | tr -d '"'\''' || true; }

MIRROR_NODE_URL="$(read_env MIRROR_NODE_URL)"
OPERATOR_ID_MAIN="$(read_env OPERATOR_ID_MAIN)"

# Only the local solo mirror has a startup race; skip remote (public) networks.
case "$MIRROR_NODE_URL" in
  *127.0.0.1*|*localhost*) ;;
  *) echo "Mirror is not local ('${MIRROR_NODE_URL:-unset}'); skipping readiness check"; exit 0 ;;
esac
# Without an operator account there is nothing to poll.
if [ -z "$OPERATOR_ID_MAIN" ]; then
  echo "OPERATOR_ID_MAIN not set in ${ENV_FILE}; skipping readiness check"; exit 0
fi

OPERATOR_ACCOUNT_URL="${MIRROR_NODE_URL%/}/api/v1/accounts/${OPERATOR_ID_MAIN}"
echo "Waiting up to ${TIMEOUT}s for mirror node to import ${OPERATOR_ID_MAIN} (${OPERATOR_ACCOUNT_URL})"

# Poll until the operator account has a balance (genesis state imported) or we time out.
SECONDS=0 # bash built-in: auto-counts elapsed wall-clock seconds from this reset
while ((SECONDS < TIMEOUT)); do
  balance="$(curl -sf "$OPERATOR_ACCOUNT_URL" 2>/dev/null | jq -r '.balance.balance // 0' 2>/dev/null || echo 0)"
  if [ "$balance" -gt 0 ] 2>/dev/null; then
    echo "Mirror node ready after ${SECONDS}s; operator balance=${balance}"
    exit 0
  fi
  sleep "$INTERVAL"
done

echo "::error::Mirror node did not import ${OPERATOR_ID_MAIN} balance within ${TIMEOUT}s"
exit 1
