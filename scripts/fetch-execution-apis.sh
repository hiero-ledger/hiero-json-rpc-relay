#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
#
# Downloads the ethereum/execution-apis OpenRPC schema and test fixtures used by
# the conformity tests, for the version pinned in package.json (config.executionApisVersion).
#
#   - schema:   the release asset openrpc.json        -> openrpc_exec_apis.json
#   - fixtures: tests/ from the tag's source archive  -> tests/server/acceptance/data/conformity/execution-apis/
#
# Nothing is cloned or built. Both outputs are git-ignored and fully replaced on every run.
#
# Usage:
#   npm run conformity:fetch-spec          # version from package.json
#   scripts/fetch-execution-apis.sh <tag>  # explicit version, e.g. v1.0.0-beta.7
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

UPSTREAM_REPO="ethereum/execution-apis"
VERSION="${1:-${npm_package_config_executionApisVersion:-}}"
SCHEMA_FILE="$REPO_ROOT/openrpc_exec_apis.json"
FIXTURES_DIR="$REPO_ROOT/tests/server/acceptance/data/conformity/execution-apis"

if [[ -z "$VERSION" ]]; then
  echo "ERROR: no execution-apis version given; run via 'npm run conformity:fetch-spec' or pass a tag" >&2
  exit 1
fi

WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT

echo "Downloading execution-apis $VERSION"

# Only releases from v1.0.0-beta.5 onward ship a prebuilt openrpc.json asset.
if ! curl -fsSL --retry 3 -o "$WORK_DIR/openrpc.json" \
  "https://github.com/$UPSTREAM_REPO/releases/download/$VERSION/openrpc.json"; then
  echo "ERROR: release $VERSION has no openrpc.json asset (or does not exist)" >&2
  exit 1
fi

# The whole archive is extracted to a temp dir; only tests/ is kept.
mkdir -p "$WORK_DIR/source"
if ! curl -fsSL --retry 3 "https://codeload.github.com/$UPSTREAM_REPO/tar.gz/refs/tags/$VERSION" |
  tar -xz -C "$WORK_DIR/source" --strip-components=1; then
  echo "ERROR: could not download or extract the source archive for tag $VERSION" >&2
  exit 1
fi

# Validate before touching the existing files, so a bad download never replaces a good one.
method_count="$(node -e 'console.log(require(process.argv[1]).methods.length)' "$WORK_DIR/openrpc.json")"
fixture_count="$(find "$WORK_DIR/source/tests" -name '*.io' | wc -l | tr -d ' ')"
if [[ "$method_count" -eq 0 || "$fixture_count" -eq 0 ]]; then
  echo "ERROR: downloaded spec looks empty (methods=$method_count, fixtures=$fixture_count)" >&2
  exit 1
fi

rm -rf "$FIXTURES_DIR"
mv "$WORK_DIR/source/tests" "$FIXTURES_DIR"
mv "$WORK_DIR/openrpc.json" "$SCHEMA_FILE"

echo "Schema:   ${SCHEMA_FILE#"$REPO_ROOT"/} ($method_count methods)"
echo "Fixtures: ${FIXTURES_DIR#"$REPO_ROOT"/} ($fixture_count .io files)"
