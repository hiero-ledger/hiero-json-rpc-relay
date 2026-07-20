#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
#
# Fetches the latest published Solo / consensus-node / mirror-node versions and
# updates .github/network-versions.env in place, then reports what changed.
#
# "Latest" is the latest STABLE release:
#   - Solo: the npm `latest` dist-tag (pre-releases live under other tags)
#   - CN/MN: GitHub's `releases/latest` endpoint (excludes drafts & pre-releases)
#
# Runnable locally for testing (requires: an authenticated `gh`, and `npm`):
#   .github/scripts/bump-network-versions.sh
#
# In GitHub Actions it also writes `changed` and `summary` step outputs.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
VERSIONS_FILE="${VERSIONS_FILE:-$REPO_ROOT/.github/network-versions.env}"

CN_REPO="hiero-ledger/hiero-consensus-node"
MN_REPO="hiero-ledger/hiero-mirror-node"
SOLO_PKG="@hashgraph/solo"

# --- fetch latest stable versions --------------------------------------------
latest_solo="$(npm view "$SOLO_PKG" dist-tags.latest)"
latest_cn="$(gh api "repos/$CN_REPO/releases/latest" --jq '.tag_name')"
latest_mn="$(gh api "repos/$MN_REPO/releases/latest" --jq '.tag_name')"

# Never overwrite a good pin with an empty value if a fetch silently failed.
for pair in "Solo:$latest_solo" "consensus-node:$latest_cn" "mirror-node:$latest_mn"; do
  if [[ -z "${pair#*:}" ]]; then
    echo "ERROR: failed to fetch the latest ${pair%%:*} version" >&2
    exit 1
  fi
done

# --- helpers -----------------------------------------------------------------
current() { grep -E "^$1=" "$VERSIONS_FILE" | cut -d= -f2- || true; }

set_version() {
  # In-place edit that works with both GNU (CI) and BSD/macOS (local) sed.
  sed -i.bak -E "s|^($1=).*|\1$2|" "$VERSIONS_FILE" && rm -f "$VERSIONS_FILE.bak"
}

declare -a changes=()
maybe_update() {
  local key="$1" latest="$2" cur
  cur="$(current "$key")"
  if [[ "$cur" != "$latest" ]]; then
    set_version "$key" "$latest"
    changes+=("- \`$key\`: \`$cur\` → \`$latest\`")
    echo "updated  $key: $cur -> $latest"
  else
    echo "current  $key: $cur (already latest)"
  fi
}

maybe_update SOLO_VERSION    "$latest_solo"
maybe_update NETWORK_TAG     "$latest_cn"
maybe_update MIRROR_NODE_TAG "$latest_mn"

# --- report ------------------------------------------------------------------
emit() { [[ -n "${GITHUB_OUTPUT:-}" ]] && echo "$1" >> "$GITHUB_OUTPUT"; return 0; }

if [[ ${#changes[@]} -eq 0 ]]; then
  echo "No version changes; everything is already up to date."
  emit "changed=false"
  exit 0
fi

summary="$(printf '%s\n' "${changes[@]}")"
echo "----"
printf 'Changes:\n%s\n' "$summary"

emit "changed=true"
if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
  {
    echo "summary<<SUMMARY_EOF"
    echo "$summary"
    echo "SUMMARY_EOF"
  } >> "$GITHUB_OUTPUT"
fi