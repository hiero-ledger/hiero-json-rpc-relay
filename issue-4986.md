## Problem Summary

The current Docker deployment of the Hedera JSON-RPC Relay is inefficient in both memory utilization and signal handling due to its execution model. Specifically, the use of `npm` as the entrypoint creates a process chain that introduces significant memory overhead and prevents the application from responding correctly to container orchestration signals.

---

## Current Behavior

The existing `Dockerfile` relies on an execution chain managed by `npm`:

```dockerfile
# Current Entrypoint
ENTRYPOINT ["npm", "run"]
CMD ["start"]
```

When the container starts, it spawns a hierarchy of processes:

1. `npm run start` (from root and PID 1)
2. `sh -c npx lerna exec --scope @hashgraph/json-rpc-server -- npm run start`
3. `npm exec lerna exec ...`
4. `sh -c lerna exec ...`
5. `node /home/node/app/node_modules/.bin/lerna exec ...`
6. `/bin/sh -c npm run start`
7. `npm run start` (inside packages/server)
8. `sh -c node dist/index.js`
9. `node dist/index.js` (The actual Relay app at PID 65)

### 1. The "Wrapper Tax" (Memory Overhead)

This chain of idle manager processes (`npm`, `sh`, `lerna`) consumes approximately **~65MB of Resident Set Size (RSS)** before the application logic even begins to execute. In high-density environments or when running with strict resource quotas (e.g., **128MB** limits), this overhead accounts for **>50% of the total budget**.

This frequently leads to:

- **Premature OOMKills**: The container is killed during startup because the "wrapper tax" leaves insufficient headroom for Node.js to initialize its heap.
- **Wasted Infrastructure Cost**: Requiring 256MB+ RSS just to account for "manager overhead" increases the total cost of ownership for large-scale relay deployments.

### 2. Signal Handling and PID 1 Issues

In Docker, the process defined in the `ENTRYPOINT` becomes **PID 1**. PID 1 has special responsibilities for handling OS signals (e.g., `SIGTERM`, `SIGINT`).

- Because `npm` is PID 1, the actual `node` application is a "grandchild" process.
- `npm` does not proactively forward signals to its children.
- **The Result**: When Kubernetes tries to stop the container, the application never receives the `SIGTERM`. It fails to perform graceful shutdowns (closing database connections, flushing logs, etc.) and is eventually hard-killed (`SIGKILL`) after the termination grace period, leading to potential state inconsistency.

---

## Proposed Improvements

### 1. Direct Node Execution (PID 1 Fix)

Refactor the entrypoint to bypass the `npm` wrapper and call the built JavaScript directly:

```dockerfile
ENTRYPOINT ["node"]
CMD ["packages/server/dist/index.js"]
```

By making `node` the PID 1 process, we instantly reclaim a significant chunk of resources and ensure the application natively handles lifecycle signals for graceful termination.

### 2. Multi-Stage Build and Image Resizing

The current image size is approximately **~900MB** because it retains build-time dependencies, the `.npm` cache, and raw source code.

- **Recommendation**: Implement a multi-stage `Dockerfile`.
- **Strategy**: Perform the build in a `build` stage, and then copy only the `dist/` folders and production `node_modules` into a `slim` or `alpine` runtime image.
- **Goal**: Reduce image size, speeding up deployment pull times and reducing the security attack surface.
