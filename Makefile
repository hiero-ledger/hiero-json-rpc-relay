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
	@echo "  make clean-solo          - Delete clusters"
	@echo "  make prune-docker        - Force remove all containers and prune system/volumes"
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

.PHONY: port-forward
port-forward:
	kill -9 $$(lsof -ti :50211) || true
	kubectl port-forward -n "${SOLO_NAMESPACE}" network-node1-0 50211:50211 &

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
	$(MAKE) port-forward

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
			OLD_SPACE_MB=$$(( $$MEM_MB * 3 / 8 )); \
			V8_EXTRA="--max-semi-space-size=1 --v8-pool-size=0 --jitless --stack-trace-limit=5"; \
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
		echo "    PRETTY_LOGS_ENABLED: \"false\""; \
		echo "    LOG_LEVEL: \"info\""; \
		if [ "$$MEM_MB" -le 128 ]; then \
			echo "    CACHE_MAX: \"100\""; \
			echo "    UV_THREADPOOL_SIZE: \"2\"";\
			echo "    RELAY_MINIMAL_MODE: \"true\""; \
		fi; \
		if [ -z "$(PURE_FLAG)" ]; then \
			echo "    NODE_OPTIONS: \"$$NODE_OPTS\""; \
		fi; \
	) > relay-resources.yaml; \
	cat relay-resources.yaml
	solo relay node add -i node1 --deployment "${SOLO_DEPLOYMENT}" -f relay-resources.yaml
	rm relay-resources.yaml
	@echo "Relay setup complete with $$FINAL_MEM limit."


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
	for file in $$(kubectl exec -n solo "$$RELAY_POD" -- sh -c 'cd /home/node/app/packages/server && ls -1 *.heapsnapshot 2>/dev/null'); do \
		echo "Copying $$file to host..."; \
		kubectl cp solo/$$RELAY_POD:/home/node/app/packages/server/$$file ./$$file; \
	done


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
	-docker rm -f $$(docker ps -aq)
	-docker rmi -f $$(docker images -aq)
	docker system prune -f
	docker volume prune -f

