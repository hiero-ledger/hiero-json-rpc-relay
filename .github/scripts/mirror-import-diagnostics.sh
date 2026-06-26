#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
#
# On-failure diagnostics for the solo `one-shot falcon deploy` record-stream freeze.
#
# When an acceptance job fails because the mirror node stopped importing, this dumps enough
# state to (a) tell the freeze apart from ordinary flakiness and (b) point at the consensus
# node's record-stream writer as the stalled component:
#
#   1. mirror REST block height, sampled over ~12s  -> pinned (frozen) vs climbing (healthy)
#   2. consensus-node record-stream files + sizes    -> 10-byte empty-stub detection
#   3. mirror importer log                           -> both freeze "faces" (see below)
#   4. uploader sidecars                             -> show they go idle, not broken
#   5. consensus-node platform health + JVM pauses   -> node stays ACTIVE; the GC-pause lead
#
# The two importer faces are the same root cause (the CN emits empty record files):
#   face A (stubs unsigned): "No new signature files to download after <ts>.rcd.gz"
#   face B (stubs signed):   "None of the data files could be verified"
#
# Best-effort and read-only: it must never fail the job, so errors are swallowed. Wire it in
# as an `if: failure()` step right after the acceptance-test step.

set +e

NS="$(kubectl get pods -A --no-headers 2>/dev/null | grep network-node | head -n1 | awk '{print $1}')"
CN="$(kubectl get pods -n "$NS" --no-headers 2>/dev/null | grep network-node | head -n1 | awk '{print $1}')"
IMPORTER="$(kubectl get pods -n "$NS" --no-headers 2>/dev/null | grep importer | head -n1 | awk '{print $1}')"
ING="$(kubectl get pods -n "$NS" --no-headers 2>/dev/null | grep mirror-ingress-controller | head -n1 | awk '{print $1}')"

echo "::group::pods (namespace: ${NS:-<not found>})"
kubectl get pods -n "$NS" -o wide 2>/dev/null
echo "consensus=${CN:-?}  importer=${IMPORTER:-?}  ingress=${ING:-?}"
echo "::endgroup::"

echo "::group::1. mirror REST block height (sampled 6x / ~12s)"
kubectl port-forward -n "$NS" "pod/$ING" 18081:80 >/tmp/diag-pf.log 2>&1 &
PF_PID=$!
sleep 3
for _ in $(seq 1 6); do
  blk="$(curl -s --max-time 5 'http://127.0.0.1:18081/api/v1/blocks?order=desc&limit=1' \
        | grep -o '"number":[0-9]*' | head -n1 | grep -o '[0-9]*')"
  echo "$(date +%T)  latest block: ${blk:-<no response>}"
  sleep 2
done
kill "$PF_PID" 2>/dev/null
echo "-> identical across all samples = REST frozen; climbing = healthy"
echo "::endgroup::"

echo "::group::2. consensus-node record-stream files (+ sizes)"
kubectl exec -n "$NS" "$CN" -c root-container -- sh -c '
  D=/opt/hgcapp/recordStreams/record0.0.3
  echo "node time now: $(date -u +%H:%M:%S)"
  echo "newest 15 .rcd.gz:"
  ls -la "$D"/*.rcd.gz 2>/dev/null | tail -n 15
  total=$(ls -1 "$D"/*.rcd.gz 2>/dev/null | wc -l)
  stubs=$(find "$D" -name "*.rcd.gz" -size 10c 2>/dev/null | wc -l)
  echo "10-byte stub files: ${stubs} / ${total} total .rcd.gz"
' 2>/dev/null
echo "-> freeze fingerprint: newest .rcd.gz is 10 bytes AND stays the last file"
echo "::endgroup::"

echo "::group::3. mirror importer log (both freeze faces)"
kubectl logs -n "$NS" "$IMPORTER" --tail=150 2>/dev/null \
  | grep -E 'RecordFileDownloader|RecordFileParser|No new signature files|None of the data files could be verified|Successfully processed|Downloaded [0-9]+ signature' \
  | tail -n 40
echo "-> face A: 'No new signature files to download after <ts>.rcd.gz'"
echo "-> face B: 'None of the data files could be verified'"
echo "::endgroup::"

echo "::group::4. uploader sidecars (expected: idle, not broken)"
for c in $(kubectl get pod "$CN" -n "$NS" -o jsonpath='{.spec.containers[*].name}' 2>/dev/null); do
  case "$c" in
    *uploader*) echo "### $c"; kubectl logs -n "$NS" "$CN" -c "$c" --tail=12 2>/dev/null ;;
  esac
done
echo "::endgroup::"

echo "::group::5. consensus-node platform health + JVM pauses"
kubectl exec -n "$NS" "$CN" -c root-container -- sh -c '
  LOGS=$(find /opt/hgcapp \( -name "swirlds*.log" -o -name "hgcaa.log" \) 2>/dev/null)
  echo "platform log files: ${LOGS:-<none found>}"
  for f in $LOGS; do
    echo "== $f : platform status / rounds / ISS =="
    grep -hE "PLATFORM_STATUS|is ACTIVE|STATE_TO_DISK|reported a hash for round|ISS " "$f" 2>/dev/null | tail -n 15
    echo "== $f : JVM pause detector =="
    grep -hE "jvmPauseDetector|JVM paused for" "$f" 2>/dev/null | tail -n 15
  done
' 2>/dev/null
echo "-> node healthy (rounds advance, ISS ok) while the stream is dead = upstream writer stall"
echo "::endgroup::"

# MinIO is the S3 upload target the consensus-node uploader sidecars (section 4) push record/event
# streams into. A healthy freeze shows MinIO green + idle; if MinIO itself is degraded the uploaders
# would be *broken* (not idle) and the whole stream pipeline backs up for a different reason. The
# MinIO Operator (solo-setup ns) reconciles the Tenant CR; the Tenant's pool pods (one-shot ns) run
# the actual `minio` server + a `sidecar` that watches config.
OPNS="$(kubectl get pods -A --no-headers 2>/dev/null | grep minio-operator | head -n1 | awk '{print $1}')"
OP="$(kubectl get pods -A --no-headers 2>/dev/null | grep minio-operator | head -n1 | awk '{print $2}')"
TNS="$(kubectl get tenants.minio.min.io -A --no-headers 2>/dev/null | head -n1 | awk '{print $1}')"
TENANT="$(kubectl get tenants.minio.min.io -A --no-headers 2>/dev/null | head -n1 | awk '{print $2}')"
POOL="$(kubectl get pods -n "$TNS" --no-headers 2>/dev/null | grep minio-pool | head -n1 | awk '{print $1}')"

echo "::group::6. MinIO operator + tenant health (upload target for the uploader sidecars)"
echo "operator=${OPNS:-?}/${OP:-?}  tenant=${TNS:-?}/${TENANT:-?}  pool=${POOL:-?}"

echo "-- tenant state / health / quorum / usage --"
kubectl get tenant "$TENANT" -n "$TNS" \
  -o custom-columns='STATE:.status.currentState,HEALTH:.status.healthStatus,DRIVES_ONLINE:.status.drivesOnline,WRITE_QUORUM:.status.writeQuorum,BUCKETS:.status.provisionedBuckets,USAGE:.status.usage.usage,CAPACITY:.status.usage.capacity' \
  2>/dev/null
echo "-> healthy freeze: STATE=Initialized HEALTH=green DRIVES_ONLINE>=WRITE_QUORUM"

echo "-- tenant pool pods (minio + sidecar) --"
kubectl get pods -n "$TNS" -l 'v1.min.io/tenant' -o wide 2>/dev/null

echo "-- pool StatefulSet(s) (READY must equal DESIRED) --"
kubectl get statefulset -n "$TNS" -l 'v1.min.io/tenant' 2>/dev/null

echo "-- tenant PVC (data volume must be Bound) --"
kubectl get pvc -n "$TNS" 2>/dev/null | grep -E "minio|NAME"

echo "-- minio server log (tail) --"
kubectl logs -n "$TNS" "$POOL" -c minio --tail=30 2>/dev/null \
  | grep -iE 'error|fatal|panic|unable|denied|quorum|healing|Status:|Endpoint:|Docs:' \
  | tail -n 20
echo "-> empty/no errors = MinIO accepting writes; quorum/disk errors here = uploads will stall"

echo "-- pool sidecar log (config watcher; tail) --"
kubectl logs -n "$TNS" "$POOL" -c sidecar --tail=20 2>/dev/null \
  | grep -iE 'error|warn|fail|reload|config' \
  | tail -n 15

echo "-- operator log (reconcile errors) --"
kubectl logs -n "$OPNS" "$OP" --tail=40 2>/dev/null \
  | grep -iE 'error|warn|fail|reconcile|tenant' \
  | tail -n 20
echo "::endgroup::"

echo "diagnostics complete"
