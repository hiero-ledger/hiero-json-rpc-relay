# Network version automation

## Purpose

The acceptance, conformity, and tool-integration test suites run against a local Hedera network deployed with [Solo](https://github.com/hiero-ledger/solo). That network has three moving parts, each pinned to a specific version:

- **Solo** — the CLI that deploys the local network
- **Consensus node** — the [hiero-consensus-node](https://github.com/hiero-ledger/hiero-consensus-node) release
- **Mirror node** — the [hiero-mirror-node](https://github.com/hiero-ledger/hiero-mirror-node) release

Historically these three versions were hardcoded and duplicated across every workflow that deploys the network, so keeping them current meant editing each file by hand which is error-prone, and prone to drifting behind upstream releases.

This subsystem does two things:

1. **Centralizes** the three versions into a single source of truth, `.github/network-versions.env`.
2. **Automates** keeping them current with a weekly workflow that opens a pull request bumping them to the latest stable releases, so CI validates every bump before it is merged.

## The single source of truth

`.github/network-versions.env` holds exactly three values:

```
SOLO_VERSION=0.68.0       # @hashgraph/solo npm package version (no leading "v")
NETWORK_TAG=v0.72.0       # hiero-consensus-node release tag
MIRROR_NODE_TAG=v0.151.0  # hiero-mirror-node release tag
```

These are **pinned** values, not "latest at runtime." Pinning keeps CI deterministic: the same commit always tests against the same network versions until a reviewed pull request changes them. Conceptually it plays the same role as a lockfile i.e. a fixed, committed set of versions that a bot proposes updates to.

> The file must always contain all three keys with real values. It is only ever changed through a reviewed pull request (either the automated one described below, or by hand).

## How the workflows consume it

Every workflow that deploys the local network loads the file into the job's environment with a single step, placed after checkout and before the versions are used:

```yaml
- name: Load pinned versions
  run: grep -vE '^[[:space:]]*(#|$)' .github/network-versions.env >> "$GITHUB_ENV"
```

This strips comment and blank lines and appends the `KEY=value` lines to `$GITHUB_ENV`, making `env.SOLO_VERSION`, `env.NETWORK_TAG`, and `env.MIRROR_NODE_TAG` available to later steps. The deploy steps then reference those variables in two shapes:

- **Reusable workflows** (`workflow_call` / `workflow_dispatch` with inputs) keep a caller override:
  `"${{ inputs.networkTag || env.NETWORK_TAG }}"` — a caller may pass an explicit version (for example `manual-testing.yml`), otherwise the pinned value is used.
- **Standalone workflows** reference the pinned value directly:
  `"${{ env.NETWORK_TAG }}"`.

The workflows that deploy the network and load this file:

| Workflow                  | Shape                                                |
| ------------------------- | ---------------------------------------------------- |
| `acceptance-workflow.yml` | reusable                                             |
| `conformity-workflow.yml` | reusable                                             |
| `hoppscotch.yml`          | reusable                                             |
| `dev-tool-workflow.yml`   | reusable                                             |
| `release-acceptance.yml`  | reusable                                             |
| `subgraph.yml`            | standalone (`working-directory: .` on the load step) |
| `dapp.yml`                | standalone                                           |

## The weekly bump workflow

`.github/workflows/bump-network-versions.yml` runs every Monday at 08:00 UTC (and on demand via `workflow_dispatch`). It runs `.github/scripts/bump-network-versions.sh`, which:

1. Fetches the latest **stable** version of each component:
   - Solo: the npm `latest` dist-tag (`npm view @hashgraph/solo dist-tags.latest`), which excludes pre-releases.
   - Consensus node / mirror node: GitHub's `releases/latest` endpoint, which excludes drafts and pre-releases.
2. Aborts before writing anything if any fetch returned empty, so a transient failure can never overwrite a good pin with garbage.
3. Rewrites only the lines in `network-versions.env` whose value actually changed.
4. Reports back to the workflow via step outputs: `changed` (true/false) and a `summary` of what moved.

If nothing changed, the workflow does nothing so no empty pull request. If anything changed, it opens (or updates) a pull request:

- on a **fixed branch**, `chore/bump-network-versions`, so a re-run updates the open pull request in place rather than opening duplicates;
- restricted to `.github/network-versions.env` only (`add-paths`);
- with a GPG-signed commit;
- authored with a **personal access token** (`GH_ACCESS_TOKEN`), **not** the default `GITHUB_TOKEN`. This is deliberate: pull requests opened by `GITHUB_TOKEN` do not trigger other workflows, so the bump pull request would open with no CI running on it. Using a PAT is what makes the full test suite run against the new versions.

Because CI runs on the pull request, a version bump is only merged after the suite passes against the new versions and a human reviews it.

## Operating it

**Change a version by hand.** Edit the relevant line in `.github/network-versions.env` and open a pull request. Every consuming workflow picks it up automatically so there is nothing else to change.

**Run the bump script locally** without touching the real file, using the `VERSIONS_FILE` override:

```bash
cp .github/network-versions.env /tmp/versions-test.env
VERSIONS_FILE=/tmp/versions-test.env .github/scripts/bump-network-versions.sh
```

It prints `updated …` / `current …` per version and rewrites only `/tmp/versions-test.env`. (Requires an authenticated `gh` and `npm`.)

**When a bump pull request fails CI.** The three versions are bumped together, and nothing guarantees that the latest Solo, consensus node, and mirror node are mutually compatible; a new mirror node or consensus node release can break the current Solo, or vice versa. CI is the gate that surfaces this. When a bump pull request goes red, hold the problematic component back: edit `network-versions.env` on the pull request branch to pin the last known-good version for that one component, leaving the others bumped, and let CI re-run.

## Notes

- The bump script compares versions for **inequality**, not "strictly newer." In the rare case that an upstream project moves its published "latest" backward (a yanked or rolled-back release), the workflow will propose a downgrade. This still goes through the normal pull request + CI + review gate, so nothing lands unreviewed.
- The `Load pinned versions` step assumes full-line comments and LF line endings in `network-versions.env`. Do not add trailing inline comments (`KEY=value # note`), the whole line is loaded verbatim into the environment.
- Any new workflow that deploys a Solo-based network should add the same `Load pinned versions` step and reference `env.*` rather than hardcoding versions.
