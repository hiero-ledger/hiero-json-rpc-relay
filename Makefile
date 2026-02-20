# Solo Setup Makefile for Memory Profiling (Issue 4900)

SOLO_CLUSTER_NAME ?= solo
SOLO_NAMESPACE ?= solo
SOLO_CLUSTER_SETUP_NAMESPACE ?= solo-cluster
SOLO_DEPLOYMENT ?= solo-deployment

.PHONY: help
help:
	@echo "Available commands:"
	@echo "  make setup-solo          - Delete existing clusters and setup fresh Solo network (Consensus + Mirror)"
	@echo "  make run-relay-1000      - Add Relay with 1000Mi memory limit (baseline)"
	@echo "  make run-relay-512       - Add Relay with 512Mi memory limit"
	@echo "  make run-relay-256       - Add Relay with 256Mi memory limit"
	@echo "  make run-relay-64        - Add Relay with 64Mi memory limit (P0 target: 48MB old-space)"
	@echo "  make port-forward        - Port-forward consensus node (50211) to bypass HAProxy timeouts"
	@echo "  make report              - Show relay resource usage, limits, OOMs, and restarts"
	@echo "  make clean-solo          - Delete all Solo clusters and configurations"

.PHONY: clean-solo
clean-solo:
	@echo "Cleaning up previous Solo deployment..."
	-kind get clusters | grep "^${SOLO_CLUSTER_NAME}" | xargs -I {} kind delete cluster -n {} || true
	-rm -rf ~/.solo

.PHONY: setup-solo
setup-solo: clean-solo
	@echo "Setting up Solo network infrastructure..."
	kind create cluster -n "${SOLO_CLUSTER_NAME}"
	# metrics-server is not bundled with Kind; --kubelet-insecure-tls is required
	# because Kind kubelets use self-signed certificates.
	# See: https://github.com/kubernetes-sigs/metrics-server#requirements
	kubectl apply -f https://github.com/kubernetes-sigs/metrics-server/releases/latest/download/components.yaml
	kubectl patch deployment metrics-server -n kube-system \
		--type=json \
		-p '[{"op":"add","path":"/spec/template/spec/containers/0/args/-","value":"--kubelet-insecure-tls"}]'
	kubectl rollout status deployment/metrics-server -n kube-system --timeout=120s
	solo init
	solo cluster-ref config connect --cluster-ref kind-${SOLO_CLUSTER_NAME} --context kind-${SOLO_CLUSTER_NAME}
	solo deployment config create -n "${SOLO_NAMESPACE}" --deployment "${SOLO_DEPLOYMENT}"
	solo deployment cluster attach --deployment "${SOLO_DEPLOYMENT}" --cluster-ref kind-${SOLO_CLUSTER_NAME} --num-consensus-nodes 1
	solo keys consensus generate --gossip-keys --tls-keys --deployment "${SOLO_DEPLOYMENT}"
	solo cluster-ref config setup -s "${SOLO_CLUSTER_SETUP_NAMESPACE}"
	# No --profile flag: keeps behaviour identical to CI (solo-test.yml) to avoid
	# silent topology mismatches that break relay connectivity.
	solo consensus network deploy --deployment "${SOLO_DEPLOYMENT}"
	solo consensus node setup --deployment "${SOLO_DEPLOYMENT}"
	solo consensus node start --deployment "${SOLO_DEPLOYMENT}"
	solo mirror node add --deployment "${SOLO_DEPLOYMENT}" --cluster-ref kind-${SOLO_CLUSTER_NAME} --enable-ingress --pinger

.PHONY: run-relay-1000
run-relay-1000: setup-solo
	$(MAKE) run-relay MEMORY_LIMIT=1000Mi
	$(MAKE) port-forward

.PHONY: run-relay-512
run-relay-512: setup-solo
	$(MAKE) run-relay MEMORY_LIMIT=512Mi
	$(MAKE) port-forward

.PHONY: run-relay-256
run-relay-256: setup-solo
	$(MAKE) run-relay MEMORY_LIMIT=256Mi
	$(MAKE) port-forward

.PHONY: run-relay-64
run-relay-64: setup-solo
	$(MAKE) run-relay MEMORY_LIMIT=64Mi
	$(MAKE) port-forward

.PHONY: run-relay
run-relay: 
	@echo "Adding Relay node with memory limit: $(MEMORY_LIMIT)"
	# Root key must be "relay" — this is the Helm chart value path that Solo's
	# relay chart exposes. Using the wrong key silently ignores the block.
	# V8 old-space is capped at 75% of the container limit to leave headroom
	# for V8's code cache, stack, and other off-heap memory regions.
	@MEM_MB=$$(echo "$(MEMORY_LIMIT)" | tr -d 'Mi'); \
	OLD_SPACE_MB=$$(( $$MEM_MB * 3 / 4 )); \
	echo "  V8 old-space: $${OLD_SPACE_MB}MB (75% of $(MEMORY_LIMIT))"; \
	printf 'relay:\n  resources:\n    requests:\n      cpu: 0\n      memory: 0\n    limits:\n      cpu: 1100m\n      memory: $(MEMORY_LIMIT)\n  config:\n    NODE_OPTIONS: "--max-old-space-size=%s"\n' "$$OLD_SPACE_MB" > relay-resources.yaml; \
	echo "--- relay-resources.yaml ---"; \
	cat relay-resources.yaml; \
	solo relay node add -i node1 --deployment "${SOLO_DEPLOYMENT}" -f relay-resources.yaml; \
	rm relay-resources.yaml; \
	echo "Relay setup complete with $(MEMORY_LIMIT) limit."

.PHONY: port-forward
port-forward:
	@echo "Port-forwarding consensus node port 50211..."
	-sudo kill -9 $$(sudo lsof -ti :50211) || true
	kubectl port-forward -n "${SOLO_NAMESPACE}" network-node1-0 50211:50211

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
	@echo "--- V8 Heap Configuration (from running relay process) ---"
	@RELAY_POD=$$(kubectl get pods -n "${SOLO_NAMESPACE}" --no-headers \
		-o custom-columns=":metadata.name" 2>/dev/null \
		| grep -E '^relay-[0-9]+-[^w]' | head -1); \
	if [ -n "$$RELAY_POD" ]; then \
		echo "Pod: $$RELAY_POD"; \
		echo "NODE_OPTIONS (configured env var):"; \
		kubectl exec -n "${SOLO_NAMESPACE}" "$$RELAY_POD" -- \
			sh -c 'echo "$${NODE_OPTIONS:-<not set>}"' 2>/dev/null || echo "(exec failed)"; \
		echo "V8 heap_size_limit (observed by running process):"; \
		kubectl exec -n "${SOLO_NAMESPACE}" "$$RELAY_POD" -- \
			node -e "const v8=require('v8');const s=v8.getHeapStatistics();console.log(Math.round(s.heap_size_limit/1024/1024)+'MB')" \
			2>/dev/null || echo "(node exec failed)"; \
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
