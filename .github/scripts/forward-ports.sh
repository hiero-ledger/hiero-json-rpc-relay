#!/usr/bin/env bash
set -euo pipefail

# Built-in SOLO port forwarding does not work :/
# Port forwarding stops shortly after a one-shot Falcon start in GitHub actions.
# For this reason, we use this script to start port forwarding directly via Bash,
# instead of relying on the Node.js script.
# This approach keeps the connection stable and ensures it lasts throughout the tests.

FORWARDS=(
  "mirror-ingress-controller|5551:80"
  "mirror-1-web3|8545:8545"
  "network-node|50211:50211"
)

ps aux | grep "port-forward" | grep kubectl | awk '{print $2}' | xargs -r kill -9
NS="$(kubectl get ns -o name | sed 's|^namespace/||' | grep 'hiero' | head -n1)"

listen() {
  local pod="$1"
  local ports="$2"
  (
    while true; do
      if ! ps aux | grep -F kubectl | grep -F port-forward | grep -F " ${ports}" | grep -v grep >/dev/null; then
        kubectl port-forward --address 0.0.0.0 "$pod" -n "$NS" "${ports}" >/dev/null 2>&1 &
      fi
      sleep 1
    done
  ) &
}

for row in "${FORWARDS[@]}"; do
  IFS='|' read -r include ports <<<"$row"
  POD="$(kubectl get pods -A --no-headers | grep -E "$include" | head -n 1 | awk '{print $2}' | head -n1)"
  listen "$POD" "$ports"
done
