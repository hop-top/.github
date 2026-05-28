#!/usr/bin/env bash
# bootstrap-first-publish.sh
#
# Local helper for the first publish of a brand-new package in npm,
# PyPI, or crates.io. CI tokens are intentionally scoped and cannot
# create new packages — the very first publish has to come from an
# interactive session with broader credentials. After this script
# succeeds once, the standard publish-on-tag.yml pipeline takes over
# for every subsequent version.
#
# Reference: SKILL.md § "First publish of a new package".
#
# Usage:
#   scripts/bootstrap-first-publish.sh <ecosystem>
#
# Subcommands:
#   npm     publish current dir's package.json to npm (public access)
#   pypi    build + upload current dir's pyproject.toml to PyPI
#   cargo   publish current dir's Cargo.toml crate to crates.io
#
# Run from the package directory (where package.json /
# pyproject.toml / Cargo.toml lives).

set -euo pipefail

# -------- shared helpers --------

err()  { printf 'error: %s\n' "$*" >&2; exit 1; }
warn() { printf 'warn: %s\n' "$*" >&2; }
info() { printf 'info: %s\n' "$*" >&2; }

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || err "required command not found: $1"
}

confirm() {
  # Skip prompts when stdin is non-interactive (CI / piped input).
  if [[ ! -t 0 ]]; then
    info "non-interactive stdin; skipping confirmation: $1"
    return 0
  fi
  local reply
  printf '%s [y/N] ' "$1" >&2
  read -r reply
  [[ "$reply" =~ ^[Yy]$ ]] || err "aborted"
}

usage() {
  cat >&2 <<'EOF'
Usage: bootstrap-first-publish.sh <ecosystem>

Ecosystems:
  npm     publish package.json to npm (public access)
  pypi    build + twine upload pyproject.toml package to PyPI
  cargo   cargo publish a new crates.io crate

Run from the package directory. See SKILL.md "First publish of a
new package" for background and post-bootstrap CI handoff.
EOF
  exit 64
}

# -------- npm --------

bootstrap_npm() {
  require_cmd node
  require_cmd pnpm

  [[ -f package.json ]] || err "no package.json in $PWD"

  local name
  name=$(node -p "require('./package.json').name") || err "could not read package.json name"
  info "package: $name"

  # Verify login. `npm whoami` reads ~/.npmrc; a fresh session has no token.
  if ! npm whoami >/dev/null 2>&1; then
    warn "not logged in to npm — run 'npm login' first"
    err "aborting (no auth)"
  fi
  local who
  who=$(npm whoami)
  info "authenticated as: $who"

  # Sanity check: is the package already on the registry? If yes, the
  # first-publish bootstrap is unnecessary — direct the user back to CI.
  local encoded http
  encoded=${name//\//%2F}
  http=$(curl -s -o /dev/null -w '%{http_code}' "https://registry.npmjs.org/${encoded}")
  if [[ "$http" == "200" ]]; then
    err "package '$name' already exists on npm — use CI for version bumps"
  fi
  info "package '$name' is unclaimed (HTTP $http) — proceeding"

  confirm "Publish $name to npm as $who?"

  pnpm publish --access public --no-git-checks
  info "first publish complete — subsequent versions go through publish-on-tag.yml"
}

# -------- pypi --------

bootstrap_pypi() {
  require_cmd uv
  require_cmd curl

  [[ -f pyproject.toml ]] || err "no pyproject.toml in $PWD"

  local name
  name=$(python3 - <<'PY'
import sys
try:
    import tomllib  # 3.11+
except ImportError:
    import tomli as tomllib  # 3.10 fallback
with open("pyproject.toml", "rb") as f:
    doc = tomllib.load(f)
name = (doc.get("project") or {}).get("name") or (
    doc.get("tool", {}).get("poetry", {}) or {}
).get("name") or ""
if not name:
    sys.exit("could not extract project name from pyproject.toml")
print(name)
PY
  ) || err "could not parse pyproject.toml"
  info "project: $name"

  # Probe PyPI for prior existence. 404 = unclaimed, 200 = exists.
  local http
  http=$(curl -s -o /dev/null -w '%{http_code}' "https://pypi.org/pypi/${name}/json")
  if [[ "$http" == "200" ]]; then
    err "project '$name' already exists on PyPI — use CI for version bumps"
  fi
  info "project '$name' is unclaimed (HTTP $http) — proceeding"

  # Require an account-scoped token. Project-scoped tokens cannot
  # create new projects (see SKILL.md).
  if [[ -z "${TWINE_PASSWORD:-}" && -z "${UV_PUBLISH_TOKEN:-}" ]]; then
    warn "no TWINE_PASSWORD or UV_PUBLISH_TOKEN env var set"
    warn "for first publish, mint an Entire-account token at https://pypi.org/manage/account/token/"
    warn "after publish, delete that token and create a per-project token for CI"
    err "aborting (no auth)"
  fi

  confirm "Build and upload $name to PyPI?"

  rm -rf dist/
  uv build

  # Prefer twine for the upload step — explicit, well-known errors. Fall
  # back to `uv publish` only when twine is unavailable.
  if uv run --with twine -- twine --version >/dev/null 2>&1; then
    : "${TWINE_USERNAME:=__token__}"
    export TWINE_USERNAME
    uv run --with twine -- twine upload dist/*
  else
    info "twine unavailable; falling back to 'uv publish'"
    uv publish
  fi
  info "first publish complete — subsequent versions go through publish-on-tag.yml"
}

# -------- cargo --------

bootstrap_cargo() {
  require_cmd cargo
  require_cmd curl

  [[ -f Cargo.toml ]] || err "no Cargo.toml in $PWD"

  local name
  name=$(cargo metadata --no-deps --format-version=1 \
    | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d["packages"][0]["name"])') \
    || err "could not extract crate name via cargo metadata"
  info "crate: $name"

  # crates.io HEAD endpoint returns 200 with empty `versions` for unknown crates.
  # Inspect the JSON shape to distinguish.
  local body http
  body=$(mktemp)
  trap 'rm -f "$body"' RETURN
  http=$(curl -s -o "$body" -w '%{http_code}' "https://crates.io/api/v1/crates/${name}")
  if [[ "$http" == "200" ]]; then
    local versions
    versions=$(python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); print(len(d.get("versions") or []))' "$body" 2>/dev/null || echo 0)
    if [[ "${versions:-0}" -gt 0 ]]; then
      err "crate '$name' already exists on crates.io (${versions} versions) — use CI for version bumps"
    fi
  fi
  info "crate '$name' has no published versions — proceeding"

  # crates.io tokens scoped to specific crate names cannot publish a new
  # crate. Require either an unrestricted token in CARGO_REGISTRY_TOKEN
  # or an existing `cargo login` session in ~/.cargo/credentials.toml.
  if [[ -z "${CARGO_REGISTRY_TOKEN:-}" ]] && [[ ! -f "${CARGO_HOME:-$HOME/.cargo}/credentials.toml" ]]; then
    warn "no CARGO_REGISTRY_TOKEN env var and no ~/.cargo/credentials.toml"
    warn "for first publish, use an UNRESTRICTED token: cargo login <token>"
    warn "keep that token in your personal keyring, NOT in CI secrets"
    err "aborting (no auth)"
  fi

  confirm "Publish crate $name to crates.io?"

  cargo publish
  info "first publish complete — subsequent versions go through publish-on-tag.yml"
}

# -------- dispatch --------

main() {
  [[ $# -ge 1 ]] || usage
  case "$1" in
    npm)   shift; bootstrap_npm   "$@" ;;
    pypi)  shift; bootstrap_pypi  "$@" ;;
    cargo) shift; bootstrap_cargo "$@" ;;
    -h|--help|help) usage ;;
    *) err "unknown ecosystem: $1 (expected: npm | pypi | cargo)" ;;
  esac
}

main "$@"
