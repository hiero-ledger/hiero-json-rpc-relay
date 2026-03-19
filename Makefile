# Solo Setup Makefile for Memory Profiling (Issue 4900)

SOLO_CLUSTER_NAME ?= solo
SOLO_NAMESPACE ?= solo
SOLO_CLUSTER_SETUP_NAMESPACE ?= solo-cluster
SOLO_DEPLOYMENT ?= solo-deployment

PACKAGE_VERSION := $(shell node -p "require('./package.json').version" 2>/dev/null || echo "0.76.0-SNAPSHOT")

# Modifiers (detected as flags from the command line)
LOCAL_FLAG ?= $(filter local,$(MAKECMDGOALS))
PURE_FLAG  ?= $(filter pure,$(MAKECMDGOALS))
export LOCAL_FLAG PURE_FLAG

# Dummy targets for flags to prevent "No rule to make target" errors
local pure:
	@:

.PHONY: help
help:
	@echo "Usage: make run-relay [mem_limit=<limit>] [old=<mb>] [semi=<mb>] [local] [pure]"
	@echo ""
	@echo "Available commands:"
	@echo "  make setup-solo          - Setup fresh Solo network"
	@echo "  make build-local-relay   - Build and load local image"
	@echo "  make run-relay           - Run relay (default: mem_limit=1000Mi)"
	@echo "  make report              - Resource usage report"
	@echo "  make live-relay-resource - monitor relay resource usage live (1s interval)"
	@echo "  make destroy-relay       - Destroy relay node (for starting fresh)"
	@echo "  make clean-solo          - Delete clusters"
	@echo "  make prune-docker        - Force remove all containers and prune system/volumes"
	@echo "  make run-cn-benchmark    - Prep wallets + run CN throughput benchmark (130 RPS → ≥100 TPS)"
	@echo "  make cn-port-forward     - Port-forward consensus node (50211)"
	@echo "  make mn-port-forward     - Port-forward mirror node REST (8081)"
	@echo "  make relay-port-forward  - Port-forward relay JSON-RPC (7546)"
	@echo ""
	@echo "Parameters:"
	@echo "  mem_limit                - Container memory limit (e.g., 128Mi, 256Mi)"
	@echo "  old                      - V8 max-old-space-size in MB"
	@echo "  semi                     - V8 max-semi-space-size in MB"
	@echo ""
	@echo "Flags:"
	@echo "  local                    - Use optimized local image"
	@echo "  pure                     - Skip auto V8 tuning (standard Node GC)"
	@echo ""
	@echo "Example: make run-relay mem_limit=128 old=32 semi=4 local"

.PHONY: cn-port-forward
cn-port-forward:
	-kill -9 $$(lsof -ti :50211) 2>/dev/null || true
	kubectl port-forward -n "${SOLO_NAMESPACE}" network-node1-0 50211:50211 &
	@echo "Port-forwarding consensus node 50211 → localhost:50211"

.PHONY: mn-port-forward
mn-port-forward:
	-kill -9 $$(lsof -ti :8081) 2>/dev/null || true
	@MIRROR_SVC=$$(kubectl get svc -n "${SOLO_NAMESPACE}" --no-headers \
	  -o custom-columns=":metadata.name" 2>/dev/null \
	  | grep -iE 'rest' | grep -ivE 'grpc|ws|proxy' | head -1); \
	if [ -n "$$MIRROR_SVC" ]; then \
	  MIRROR_PORT=$$(kubectl get svc "$$MIRROR_SVC" -n "${SOLO_NAMESPACE}" \
	    -o jsonpath='{.spec.ports[0].port}' 2>/dev/null || echo "80"); \
	  kubectl port-forward -n "${SOLO_NAMESPACE}" svc/"$$MIRROR_SVC" 8081:"$$MIRROR_PORT" & \
	  echo "Port-forwarding mirror '$$MIRROR_SVC' :$$MIRROR_PORT → localhost:8081"; \
	else \
	  echo "WARNING: Mirror REST service not found; port-forward skipped."; \
	fi

.PHONY: relay-port-forward
relay-port-forward:
	-kill -9 $$(lsof -ti :7546) 2>/dev/null || true
	@RELAY_POD=$$(kubectl get pods -n "${SOLO_NAMESPACE}" --no-headers \
	  -o custom-columns=":metadata.name" 2>/dev/null \
	  | grep -E '^relay-[0-9]+' | grep -v -- '-ws-' | head -1); \
	if [ -n "$$RELAY_POD" ]; then \
	  kubectl port-forward -n "${SOLO_NAMESPACE}" "$$RELAY_POD" 7546:7546 & \
	  echo "Port-forwarding relay '$$RELAY_POD' 7546 → localhost:7546"; \
	else \
	  echo "WARNING: Relay pod not found; port-forward skipped."; \
	fi

.PHONY: clean-solo
clean-solo:
	@echo "Cleaning up..."
	-kind get clusters | grep "^${SOLO_CLUSTER_NAME}" | xargs -I {} kind delete cluster -n {} || true
	-rm -rf ~/.solo

.PHONY: build-local-relay
build-local-relay:
	@echo "Building library/relay-local:0.73.0..."
	docker build -t library/relay-local:0.73.0 .
	kind load docker-image library/relay-local:0.73.0 --name $(SOLO_CLUSTER_NAME)

.PHONY: setup-solo
setup-solo: clean-solo
	@echo "Setting up Solo network..."
	kind create cluster -n "${SOLO_CLUSTER_NAME}"
	kubectl apply -f https://github.com/kubernetes-sigs/metrics-server/releases/latest/download/components.yaml
	kubectl patch deployment metrics-server -n kube-system --type=json -p '[{"op":"add","path":"/spec/template/spec/containers/0/args/-","value":"--kubelet-insecure-tls"}]'
	kubectl rollout status deployment/metrics-server -n kube-system --timeout=120s
	solo init
	solo cluster-ref config connect --cluster-ref kind-${SOLO_CLUSTER_NAME} --context kind-${SOLO_CLUSTER_NAME}
	solo deployment config create -n "${SOLO_NAMESPACE}" --deployment "${SOLO_DEPLOYMENT}"
	solo deployment cluster attach --deployment "${SOLO_DEPLOYMENT}" --cluster-ref kind-${SOLO_CLUSTER_NAME} --num-consensus-nodes 1
	solo keys consensus generate --gossip-keys --tls-keys --deployment "${SOLO_DEPLOYMENT}"
	solo cluster-ref config setup -s "${SOLO_CLUSTER_SETUP_NAMESPACE}"
	solo consensus network deploy --deployment "${SOLO_DEPLOYMENT}"
	solo consensus node setup --deployment "${SOLO_DEPLOYMENT}"
	solo consensus node start --deployment "${SOLO_DEPLOYMENT}"
	solo mirror node add --deployment "${SOLO_DEPLOYMENT}" --cluster-ref kind-${SOLO_CLUSTER_NAME} --enable-ingress --pinger
	solo ledger account predefined --deployment "${SOLO_DEPLOYMENT}"
	$(MAKE) cn-port-forward

# Default values
mem_limit ?= 1000Mi
old ?=
semi ?=
EXTRA_NODE_OPTS ?=

.PHONY: run-relay
run-relay: 
	@echo "Adding Relay node with memory limit: $(mem_limit)"
	@# Ensure we have a consistent unit for calculation and the limit field
	@MEM_RAW=$$(echo "$(mem_limit)" | tr -d '[:alpha:]'); \
	UNIT=$$(echo "$(mem_limit)" | tr -d '0-9' | tr '[:upper:]' '[:lower:]' | sed 's/i//g'); \
	if [ -z "$$UNIT" ]; then \
		FINAL_MEM="$${MEM_RAW}Mi"; \
		MEM_MB=$$MEM_RAW; \
	else \
		FINAL_MEM="$${MEM_RAW}Mi"; \
		MEM_MB=$$MEM_RAW; \
	fi; \
	if [ -n "$(old)" ]; then \
		NODE_OPTS="--max-old-space-size=$(old)"; \
		if [ -n "$(semi)" ]; then \
			NODE_OPTS="$$NODE_OPTS --max-semi-space-size=$(semi) --v8-pool-size=0"; \
		fi; \
	else \
		if [ "$$MEM_MB" -le 64 ]; then \
			OLD_SPACE_MB=16; \
			V8_EXTRA="--max-semi-space-size=1 --v8-pool-size=0"; \
		elif [ "$$MEM_MB" -le 128 ]; then \
			OLD_SPACE_MB=$$(( $$MEM_MB * 1 / 2 )); \
			V8_EXTRA="--max-semi-space-size=2 --v8-pool-size=0"; \
		else \
			OLD_SPACE_MB=$$(( $$MEM_MB * 3 / 4 )); \
			V8_EXTRA=""; \
		fi; \
		NODE_OPTS="--max-old-space-size=$$OLD_SPACE_MB $$V8_EXTRA"; \
	fi; \
	NODE_OPTS="$$NODE_OPTS $(EXTRA_NODE_OPTS)"; \
	if [ -n "$(LOCAL_FLAG)" ]; then echo "  -> Using Local Image"; fi; \
	if [ -z "$(PURE_FLAG)" ]; then \
		echo "  -> V8 tuning: $$NODE_OPTS"; \
	fi; \
	( \
		echo "relay:"; \
		if [ -n "$(LOCAL_FLAG)" ]; then \
			echo "  image:"; \
			echo "    registry: \"library\""; \
			echo "    repository: relay-local"; \
			echo "    tag: \"0.73.0\""; \
			echo "    pullPolicy: Never"; \
		fi; \
		echo "  resources:"; \
		echo "    requests:"; \
		echo "      cpu: 0"; \
		echo "      memory: 0"; \
		echo "    limits:"; \
		echo "      cpu: 1100m"; \
		echo "      memory: $$FINAL_MEM"; \
		echo "  config:"; \
		echo "    npm_package_version: \"$(PACKAGE_VERSION)\""; \
		echo "    WORKERS_POOL_ENABLED: \"false\""; \
		echo "    LOG_LEVEL: \"silent\""; \
		echo "    PRETTY_LOGS_ENABLED: \"false\""; \
		echo "    RATE_LIMIT_DISABLED: \"true\""; \
		echo "    REDIS_ENABLED: \"false\""; \
		echo "    USE_ASYNC_TX_PROCESSING: \"true\""; \
		echo "    ENABLE_NONCE_ORDERING: \"false\""; \
		echo "    CACHE_MAX: \"50\""; \
		echo "    CACHE_TTL: \"300\""; \
		echo "    MIRROR_NODE_HTTP_MAX_SOCKETS: \"10\""; \
		echo "    RELAY_MINIMAL_MODE: \"true\""; \
		if [ -z "$(PURE_FLAG)" ]; then \
			echo "    NODE_OPTIONS: \"$$NODE_OPTS\""; \
		fi; \
	) > relay-resources.yaml; \
	cat relay-resources.yaml
	@echo "Ensuring clean state for node1..."
	@# Workaround for Solo bug: scale up if it was manually scaled to 0, otherwise 'destroy' fails in Initialize
	-@if kubectl get deployment relay-1 -n "${SOLO_NAMESPACE}" >/dev/null 2>&1; then \
		REPS=$$(kubectl get deployment relay-1 -n "${SOLO_NAMESPACE}" -o jsonpath='{.spec.replicas}'); \
		if [ "$$REPS" -eq 0 ]; then \
			echo "  -> Scaling up relay-1 to 1 to satisfy Solo initialization..."; \
			kubectl scale deployment relay-1 -n "${SOLO_NAMESPACE}" --replicas=1; \
			kubectl rollout status deployment/relay-1 -n "${SOLO_NAMESPACE}" --timeout=30s || true; \
		fi; \
	fi
	-solo relay node destroy -i node1 --deployment "${SOLO_DEPLOYMENT}" --quiet-mode 2>/dev/null || true
	solo relay node add -i node1 --deployment "${SOLO_DEPLOYMENT}" -f relay-resources.yaml
	rm -f relay-resources.yaml
# 	@echo "Overriding Solo hardcoded config (MIRROR_NODE_RETRY_DELAY, MIRROR_NODE_GET_CONTRACT_RESULTS_DEFAULT_RETRIES)..."
# 	@RELAY_DEPLOY=$$(kubectl get deployments -n "${SOLO_NAMESPACE}" --no-headers \
# 	  -o custom-columns=":metadata.name" 2>/dev/null \
# 	  | grep -E '^relay-[0-9]+-' | grep -v -- '-ws-' | head -1); \
# 	if [ -n "$$RELAY_DEPLOY" ]; then \
# 	  kubectl set env deployment "$$RELAY_DEPLOY" -n "${SOLO_NAMESPACE}" \
# 	    MIRROR_NODE_RETRY_DELAY="500" \
# 	    MIRROR_NODE_GET_CONTRACT_RESULTS_DEFAULT_RETRIES="1"; \
# 	  kubectl rollout status deployment "$$RELAY_DEPLOY" -n "${SOLO_NAMESPACE}" --timeout=120s; \
# 	else \
# 	  echo "WARNING: Relay deployment not found; skipping config override."; \
# 	fi
# 	$(MAKE) relay-port-forward

.PHONY: destroy-relay clean-relay
destroy-relay clean-relay:
	@echo "Destroying relay node node1..."
	@# Workaround for Solo bug: scale up if it was manually scaled to 0, otherwise 'destroy' fails in Initialize
	-@if kubectl get deployment relay-1 -n "${SOLO_NAMESPACE}" >/dev/null 2>&1; then \
		REPS=$$(kubectl get deployment relay-1 -n "${SOLO_NAMESPACE}" -o jsonpath='{.spec.replicas}'); \
		if [ "$$REPS" -eq 0 ]; then \
			echo "  -> Scaling up relay-1 to 1 to satisfy Solo initialization..."; \
			kubectl scale deployment relay-1 -n "${SOLO_NAMESPACE}" --replicas=1; \
		fi; \
	fi
	-solo relay node destroy -i node1 --deployment "${SOLO_DEPLOYMENT}" --quiet-mode


.PHONY: run-relay-256-profile-with-heapdump
run-relay-256-profile-with-heapdump:
	$(MAKE) run-relay MEMORY_LIMIT=512Mi OLD_SPACE=192 EXTRA_NODE_OPTS="--heapsnapshot-signal=SIGUSR2"

.PHONY: capture-heap-snapshot
capture-heap-snapshot:
	@RELAY_POD=$$(kubectl get pods -n solo --no-headers -o custom-columns=":metadata.name" | grep -E '^relay-[0-9]+-[^w]' | head -1); \
	if [ -z "$$RELAY_POD" ]; then echo "Error: relay pod not found"; exit 1; fi; \
	echo "Discovering active Node.js PID for Relay..."; \
	NODE_PID=$$(kubectl exec -n solo "$$RELAY_POD" -- sh -c 'for p in /proc/[0-9]*; do cat $$p/cmdline 2>/dev/null | tr "\0" " " | grep -Eq "^node .*dist/index.js" && basename $$p && break; done'); \
	if [ -z "$$NODE_PID" ]; then echo "Error: Could not locate running node dist/index.js process."; exit 1; fi; \
	echo "Sending SIGUSR2 to POD: $$RELAY_POD, PID: $$NODE_PID"; \
	kubectl exec -n solo "$$RELAY_POD" -- sh -c "kill -s USR2 $$NODE_PID"

.PHONY: extract-heap-snapshots
extract-heap-snapshots:
	@RELAY_POD=$$(kubectl get pods -n solo --no-headers -o custom-columns=":metadata.name" | grep -E '^relay-[0-9]+-[^w]' | head -1); \
	if [ -z "$$RELAY_POD" ]; then echo "Error: relay pod not found"; exit 1; fi; \
	echo "Extracting snapshot files from $$RELAY_POD..."; \
	for file in $$(kubectl exec -n solo "$$RELAY_POD" -- sh -c 'cd /home/node/app && ls -1 *.heapsnapshot 2>/dev/null'); do \
		echo "Copying $$file to host..."; \
		kubectl cp solo/$$RELAY_POD:/home/node/app/$$file ./$$file; \
	done

.PHONY: extract-heap-profiles
extract-heap-profiles:
	@RELAY_POD=$$(kubectl get pods -n solo --no-headers -o custom-columns=":metadata.name" | grep -E '^relay-[0-9]+-[^w]' | head -1); \
	if [ -z "$$RELAY_POD" ]; then echo "Error: relay pod not found"; exit 1; fi; \
	echo "Extracting .heapprofile files from $$RELAY_POD..."; \
	FILES=$$(kubectl exec -n solo "$$RELAY_POD" -- sh -c 'cd /home/node/app && ls -1 *.heapprofile 2>/dev/null' 2>/dev/null); \
	if [ -z "$$FILES" ]; then echo "No .heapprofile files found in pod."; exit 0; fi; \
	for file in $$FILES; do \
		echo "Copying $$file to host..."; \
		kubectl cp solo/$$RELAY_POD:/home/node/app/$$file ./$$file; \
	done

.PHONY: stop-relay-node
stop-relay-node:
	@RELAY_POD=$$(kubectl get pods -n solo --no-headers -o custom-columns=":metadata.name" | grep -E '^relay-[0-9]+-[^w]' | head -1); \
	if [ -z "$$RELAY_POD" ]; then echo "Error: relay pod not found"; exit 1; fi; \
	echo "Discovering Node.js PID in $$RELAY_POD..."; \
	NODE_PID=$$(kubectl exec -n solo "$$RELAY_POD" -- sh -c 'for p in /proc/[0-9]*; do cat $$p/cmdline 2>/dev/null | tr "\0" " " | grep -Eq "^node .*dist/index.js" && basename $$p && break; done'); \
	if [ -z "$$NODE_PID" ]; then echo "Error: Node.js process not found"; exit 1; fi; \
	echo "Sending SIGTERM to PID $$NODE_PID (Node.js will write .heapprofile on exit)..."; \
	kubectl exec -n solo "$$RELAY_POD" -- sh -c "kill $$NODE_PID"


.PHONY: report
report:
	@echo "=============================="
	@echo "  Solo Memory Benchmark Report"
	@echo "=============================="
	@echo ""
	@echo "--- Pod Resource Usage (kubectl top) ---"
	@kubectl top pods -n "${SOLO_NAMESPACE}" 2>&1 || echo "(metrics-server unavailable)"
	@echo ""
	@echo "--- Relay Resource Consumption ---"
	@kubectl top pods -n "${SOLO_NAMESPACE}" --no-headers 2>/dev/null \
		| grep -E '^relay-' || echo "(relay pods not found)"
	@echo ""
	@echo "--- Relay Container Limits (from pod spec) ---"
	@RELAY_POD=$$(kubectl get pods -n "${SOLO_NAMESPACE}" --no-headers \
		-o custom-columns=":metadata.name" 2>/dev/null \
		| grep -E '^relay-[0-9]+-[^w]' | head -1); \
	if [ -n "$$RELAY_POD" ]; then \
		kubectl get pod "$$RELAY_POD" -n "${SOLO_NAMESPACE}" \
			-o jsonpath='{range .spec.containers[*]}{.name}: cpu={.resources.limits.cpu}, mem={.resources.limits.memory}{"\n"}{end}'; \
	else \
		echo "(relay pod not found)"; \
	fi
	@echo ""
	@echo "--- Actual V8 & Process Memory (via /metrics endpoint) ---"
	@RELAY_POD=$$(kubectl get pods -n "${SOLO_NAMESPACE}" --no-headers \
		-o custom-columns=":metadata.name" 2>/dev/null \
		| grep -E '^relay-[0-9]+-[^w]' | head -1); \
	if [ -n "$$RELAY_POD" ]; then \
		echo "Pod: $$RELAY_POD"; \
		echo "NODE_OPTIONS (env var):"; \
		kubectl exec -n "${SOLO_NAMESPACE}" "$$RELAY_POD" -- \
			sh -c 'echo "$${NODE_OPTIONS:-<not set>}"' 2>/dev/null || echo "(exec failed)"; \
		echo "Live Memory Stats (/metrics):"; \
		kubectl exec -n "${SOLO_NAMESPACE}" "$$RELAY_POD" -- \
			node -e "const http = require('http'); http.get('http://localhost:7546/metrics', r => r.pipe(process.stdout)).on('error', () => process.exit(1));" 2>/dev/null \
			| grep -E '^rpc_relay_(nodejs_heap_size_total|nodejs_heap_size_used|nodejs_external_memory|process_resident_memory)_bytes' \
			| awk '{printf "%-50s %d MB\n", $$1, $$2/1048576}' || echo "(failed to fetch metrics)"; \
	else \
		echo "(relay pod not found)"; \
	fi
	@echo ""
	@echo "--- OOMKill Detection ---"
	@kubectl get pods -n "${SOLO_NAMESPACE}" -o json 2>/dev/null | python3 -c "\
	import sys, json; \
	data = json.load(sys.stdin); \
	oom = set(); \
	[oom.add(p['metadata']['name']) for p in data.get('items', []) \
	  for c in p.get('status', {}).get('containerStatuses', []) \
	  for sk in ('state', 'lastState') \
	  if c.get(sk, {}).get('terminated', {}).get('reason') == 'OOMKilled']; \
	print(', '.join(sorted(oom)) if oom else 'None detected')" 2>/dev/null || echo "N/A"
	@echo ""
	@echo "--- Relay Restart Count ---"
	@kubectl get pods -n "${SOLO_NAMESPACE}" --no-headers 2>/dev/null \
		| awk '/^relay-/ { sum += $$4 } END { print sum+0 }' || echo "N/A"
	@echo ""

.PHONY: live-relay-resource
live-relay-resource:
	@RELAY_POD=$$(kubectl get pods -n "${SOLO_NAMESPACE}" --no-headers -o custom-columns=":metadata.name" | grep -E '^relay-[0-9]+' | head -1); \
	if [ -z "$$RELAY_POD" ]; then echo "Error: relay pod not found"; exit 1; fi; \
	echo "Monitoring memory for $$RELAY_POD (1s interval)..."; \
	while true; do \
		DATA=$$(kubectl top pod $$RELAY_POD -n "${SOLO_NAMESPACE}" --no-headers 2>/dev/null | awk '{print $$3}' || echo "N/A"); \
		kubectl exec -n "${SOLO_NAMESPACE}" "$$RELAY_POD" -- node -e "const http = require('http'); http.get('http://localhost:7546/metrics', r => r.pipe(process.stdout)).on('error', () => process.exit(1));" 2>/dev/null \
		| awk -v pr="$$DATA" -v d="$$(date +%H:%M:%S)" ' \
			/rpc_relay_process_resident_memory_bytes/ {rss=$$2/1048576} \
			/rpc_relay_nodejs_heap_size_total_bytes/ {tot=$$2/1048576} \
			/rpc_relay_nodejs_heap_size_used_bytes/ {use=$$2/1048576} \
			/rpc_relay_nodejs_external_memory_bytes/ {ext=$$2/1048576} \
			END { if(rss) printf "[%s] PodRSS: %s | P_RSS: %.1fM | H_TOT: %.1fM | H_USE: %.1fM | H_EXT: %.1fM\n", d, pr, rss, tot, use, ext }'; \
		sleep 1; \
	done

# Catch-all target to allow positional arguments without "No rule to make target" errors
%:
	@:


.PHONY: exec-relay
exec-relay:
	@ARG1=$(filter-out $@,$(MAKECMDGOALS)); \
	RELAY_POD=$${ARG1:-$$(kubectl get pods -n "${SOLO_NAMESPACE}" --no-headers -o custom-columns=":metadata.name" | grep -E '^relay-[0-9]+' | head -1)}; \
	if [ -z "$$RELAY_POD" ]; then echo "Error: relay pod not found"; exit 1; fi; \
	echo "Entering shell for pod: $$RELAY_POD"; \
	kubectl exec -it -n "${SOLO_NAMESPACE}" "$$RELAY_POD" -- /bin/bash

.PHONY: print-relay-procs
print-relay-procs:
	@ARG1=$(filter-out $@,$(MAKECMDGOALS)); \
	RELAY_POD=$${ARG1:-$$(kubectl get pods -n "${SOLO_NAMESPACE}" --no-headers -o custom-columns=":metadata.name" | grep -E '^relay-[0-9]+' | head -1)}; \
	if [ -z "$$RELAY_POD" ]; then echo "Error: relay pod not found"; exit 1; fi; \
	echo "Reading /proc/ cmdlines for pod: $$RELAY_POD"; \
	kubectl exec -n "${SOLO_NAMESPACE}" "$$RELAY_POD" -- sh -c 'for p in /proc/[0-9]*; do if [ -f "$$p/cmdline" ]; then pid=$$(basename $$p); cmd=$$(cat $$p/cmdline | tr "\0" " "); [ -n "$$cmd" ] && printf "PID %-6s: %s\n" "$$pid" "$$cmd"; fi; done'

.PHONY: prune-docker
prune-docker:
	-docker rm -f $$(docker ps -aq) || true
	-docker rmi -f $$(docker images -aq) || true
	-docker system prune -f || true
	-docker volume prune -f || true

# CN Benchmark parameters
# These can be overridden on the CLI, but now default to the same logic as k6/.env
CN_BENCH_TARGET_RPS ?= 130
WALLETS_AMOUNT      ?= 80
SIGNED_TXS          ?= 300
SMART_CONTRACTS_AMOUNT ?= 10
RAMP_UP_DURATION    ?= 1m
STABLE_DURATION     ?= 1m
RAMP_DOWN_DURATION  ?= 30s

.PHONY: run-cn-benchmark
run-cn-benchmark:
	@echo "--- CN Throughput Benchmark ---"
	@echo "  Relay:          port 7546 (port-forward must be active)"
	@echo "  Mirror Node:    port 5551"
	@echo "  Wallets:        $(WALLETS_AMOUNT)"
	@echo "  Target RPS:     $(CN_BENCH_TARGET_RPS) (→ ≥100 TPS at CN)"
	@echo "  Ramp-up:        $(RAMP_UP_DURATION)"
	@echo "  Stable:         $(STABLE_DURATION)"
	@echo "  Ramp-down:      $(RAMP_DOWN_DURATION)"
	@echo ""
	@echo "Step 1 of 2: Preparing wallets and pre-signed transactions (focused)..."
	cd k6 && \
		WALLETS_AMOUNT=$(WALLETS_AMOUNT) \
		SIGNED_TXS=$(SIGNED_TXS) \
		SMART_CONTRACTS_AMOUNT=$(SMART_CONTRACTS_AMOUNT) \
		env-cmd node src/prepare/cn-prep.js
	@echo ""
	@echo "Step 2 of 2: Running k6 cn-benchmark scenario..."
	cd k6 && \
		CN_BENCH_TARGET_RPS=$(CN_BENCH_TARGET_RPS) \
		WALLETS_AMOUNT=$(WALLETS_AMOUNT) \
		RAMP_UP_DURATION=$(RAMP_UP_DURATION) \
		STABLE_DURATION=$(STABLE_DURATION) \
		RAMP_DOWN_DURATION=$(RAMP_DOWN_DURATION) \
		env-cmd --use-shell k6 run src/scenarios/cn-benchmark.js
	@echo ""
	@echo "Benchmark complete. To verify CN TPS, run:"
	@echo "  cd k6 && npm run verify-cn-tps -- --start <START_ISO> --end <END_ISO>"
	docker system prune -f
	docker volume prune -f


.PHONY: previous-logs
previous-logs:
	@ARG1=$(filter-out $@,$(MAKECMDGOALS)); \
	RELAY_POD=$${ARG1:-$$(kubectl get pods -n "${SOLO_NAMESPACE}" --no-headers -o custom-columns=":metadata.name" | grep -E '^relay-[0-9]+' | head -1)}; \
	if [ -z "$$RELAY_POD" ]; then echo "Error: relay pod not found"; exit 1; fi; \
	echo "Showing previous logs for pod: $$RELAY_POD"; \
	kubectl logs -n "${SOLO_NAMESPACE}" --previous "$$RELAY_POD"

.PHONY: describe-pod
describe-pod:
	@ARG1=$(filter-out $@,$(MAKECMDGOALS)); \
	RELAY_POD=$${ARG1:-$$(kubectl get pods -n "${SOLO_NAMESPACE}" --no-headers -o custom-columns=":metadata.name" | grep -E '^relay-[0-9]+' | head -1)}; \
	if [ -z "$$RELAY_POD" ]; then echo "Error: relay pod not found"; exit 1; fi; \
	echo "Describing pod: $$RELAY_POD"; \
	kubectl describe pod -n "${SOLO_NAMESPACE}" "$$RELAY_POD"