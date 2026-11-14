#!/usr/bin/env bash
# Enable Dependabot alerts + security updates on a repo. Idempotent: PUT on an
# already-enabled setting is a no-op. Security updates ignore `cooldown`
# (version updates only), so fixes arrive immediately.
#
# Usage: scripts/enable-dependabot-security.sh <org>/<repo> [<org>/<repo>...]
set -euo pipefail

if [ "$#" -lt 1 ]; then
  echo "usage: $0 <org>/<repo> [<org>/<repo>...]" >&2
  exit 2
fi

for repo in "$@"; do
  gh api -X PUT "repos/${repo}/vulnerability-alerts" >/dev/null
  gh api -X PUT "repos/${repo}/automated-security-fixes" >/dev/null
  state=$(gh api "repos/${repo}/automated-security-fixes" --jq .enabled)
  echo "${repo}: automated-security-fixes enabled=${state}"
done
