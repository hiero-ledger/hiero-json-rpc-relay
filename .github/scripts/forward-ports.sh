#!/usr/bin/env bash
set -euo pipefail

# Right now with solo base cli we can't choose the exposing service endpoints.
# So access has to be provided through a separate kubectl port-forward script that binds the forwarded
# ports on 0.0.0.0.
#
# Thanks to that we are also dropping the need to connect to the services through haproxy and
# are accessing them directly.
#
# And we are also able to explicitly direct the calls to the ports we expect them to be (like 5551 for mirror-node).

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
  #  while true; do
      if ! ps aux | grep -F kubectl | grep -F port-forward | grep -F " ${ports}" | grep -v grep >/dev/null; then
        kubectl port-forward --address 0.0.0.0 "$pod" -n "$NS" "${ports}" >/dev/null 2>&1 &
      fi
   #   sleep 1
  #  done
  ) &
}

for row in "${FORWARDS[@]}"; do
  IFS='|' read -r include ports <<<"$row"
  POD="$(kubectl get pods -A --no-headers | grep -E "$include" | head -n 1 | awk '{print $2}' | head -n1)"
  listen "$POD" "$ports"
done
