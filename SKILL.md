---
name: hop-top-dotgithub
description: Use hop-top/.github's reusable workflows to publish releases (npm/PyPI/crates.io) and push subtree mirrors. Use when wiring a hop-top repo's release pipeline to call publish-on-tag.yml on `<component>/v<version>` tag pushes, mapping registry secrets, or troubleshooting why a tag didn't trigger a publish.
---

# Using hop-top/.github

This skill is for **consumers**: people wiring up release pipelines
in hop-top repos by calling the reusable workflows in
`hop-top/.github`. If you're modifying the workflows themselves, see
this repo's `DEVELOPING.md` instead.

## Mental model

```
commits → release-please opens standing PR
            ↓ merge
          release-please creates tag <component>/v<version>
            ↓ tag push
          your publish.yml triggers
            ↓ uses:
          hop-top/.github/.github/workflows/publish-on-tag.yml
            ↓ dispatches
          publish-{ts,py,rs}.yml + mirror-subtree.yml
            ↓
          registry + mirror push
```

`hop-top/.github` owns the **publish/mirror** half. release-please
(consumer-side, configured in YOUR repo) owns the **version/tag**
half. Both compose; you wire them up.

## Quick-start

Two workflow files in your repo:

### `.github/workflows/release-please.yml`

```yaml
name: release-please

on:
  push:
    branches: [main]

permissions:
  contents: write
  pull-requests: write

jobs:
  release-please:
    runs-on: ubuntu-latest
    steps:
      - uses: googleapis/release-please-action@v4
        with:
          config-file: .github/release-please-config.json
          manifest-file: .github/.release-please-manifest.json
          token: ${{ secrets.GH_RELEASE_PLEASE_PAT }}
```

### `.github/workflows/publish.yml`

```yaml
name: publish

on:
  push:
    tags: ['*/v*']

jobs:
  publish:
    permissions:
      contents: read
      id-token: write  # required for PyPI OIDC trusted publishing
    uses: hop-top/.github/.github/workflows/publish-on-tag.yml@v0.1.0
    secrets:
      NPM_REGISTRY_TOKEN: ${{ secrets.NPM_REGISTRY_TOKEN }}
      CARGO_REGISTRY_TOKEN: ${{ secrets.CARGO_REGISTRY_TOKEN }}
      GH_MIRROR_PAT: ${{ secrets.GH_MIRROR_PAT }}
    with:
      homepage: https://your-project-url
      description-prefix: "READ-ONLY MIRROR"
      ecosystems: |
        ts:  { dir: ts,  ecosystem: ts,  package: "@org/pkg",  mirror: org/pkg-ts }
        py:  { dir: py,  ecosystem: py,  package: org-pkg,     mirror: org/pkg-py }
        rs:  { dir: rs,  ecosystem: rs,  package: org-pkg,     mirror: org/pkg-rs }
        php: { dir: php, ecosystem: php, package: org/pkg,     mirror: org/pkg-php }
        go:  { dir: go,  ecosystem: go,                        mirror: org/pkg }
```

Plus release-please config + manifest (see release-please's docs).

## Pinning

```yaml
uses: hop-top/.github/.github/workflows/publish-on-tag.yml@v0.1.0
```

Pin to a tag for production. `@main` works but means breaking
changes propagate immediately. Tags follow plain semver: `v0.1.0`,
`v0.2.0`, `v1.0.0`, etc.

## Secrets reference

All secret names follow the convention
`<NAMESPACE>_<PURPOSE>_<TYPE>`. The shared workflows expect **exact**
names — no fallback chains or aliases. Either:

1. Create org/repo secrets with the canonical names, OR
2. Explicitly map at the call site (`CANONICAL: ${{ secrets.YOUR_NAME }}`)

### Secrets the shared workflows expect

| Secret | Required by | Scope | Notes |
|---|---|---|---|
| `GH_MIRROR_PAT` | `mirror-subtree` (always) | Org | Fine-grained PAT with `Administration: RW` + `Contents: RW` on every mirror repo |
| `GH_RELEASE_PLEASE_PAT` | release-please job | Org or repo | Fine-grained PAT with `Contents: RW` + `Pull Requests: RW` + `Workflows: RW` on the source repo. **Default `GITHUB_TOKEN` doesn't work** — its PRs don't trigger downstream workflows. |
| `NPM_REGISTRY_TOKEN` | `publish-ts` (if shipping TS) | Org | npm Granular Access Token with publish on your scope |
| `CARGO_REGISTRY_TOKEN` | `publish-rs` (if shipping Rust) | Org | crates.io API token. Account must have a verified email. |

### Secrets the shared workflows DO NOT need

| What | Why not |
|---|---|
| **PyPI token** | `publish-py` uses [PyPI trusted publishing](https://docs.pypi.org/trusted-publishers/) (OIDC). Configure on PyPI's side bound to your repo + `pypi-environment` (default: `pypi`). |
| **Packagist token** | Packagist auto-syncs from public GitHub via webhook. |
| **Go module token** | proxy.golang.org pulls from git tags. |

### Env vars exported inside workflow steps

Documented here so you know what's available if you customize
`test-command` or `build-command`:

| Env var | Set in | From | Available to |
|---|---|---|---|
| `NODE_AUTH_TOKEN` | `publish-ts` publish step | `secrets.NPM_REGISTRY_TOKEN` | npm CLI (`pnpm publish` reads this) |
| `CARGO_REGISTRY_TOKEN` | `publish-rs` publish step | `secrets.CARGO_REGISTRY_TOKEN` | cargo |
| `GH_TOKEN` | `mirror-subtree` all steps | `secrets.GH_MIRROR_PAT` | `gh` CLI + `git push` URL |
| `TEST_CMD` | `publish-ts`, `publish-py`, `publish-rs` test step | `inputs.test-command` or built-in default | your test command |
| `BUILD_CMD` | `publish-ts`, `publish-py` build step | `inputs.build-command` or built-in default | your build command |
| `id-token: write` | `publish-py` job-level | _(permission, no value)_ | OIDC token request for PyPI |

### Aliasing legacy secret names

If your org has legacy secret names (e.g. `MIRROR_PAT` from a prior
convention), DO NOT rename them via fallback chains in workflows.
Instead, create a new secret with the canonical name using the
underlying PAT value, then remove the legacy secret.

The shared workflows accept ONE name only. No fallback. If
`GH_MIRROR_PAT` isn't set, the mirror job fails — visibly and
immediately.

### Scoping: org vs repo vs environment

- **Org secrets**: tokens used across multiple repos
  (`GH_MIRROR_PAT`, `NPM_REGISTRY_TOKEN`, `CARGO_REGISTRY_TOKEN`)
- **Repo secrets**: tokens specific to one repo (`GH_RELEASE_PLEASE_PAT`
  may be repo-scoped if you want per-repo PATs)
- **Environment secrets**: high-stakes scoping with optional manual
  approval. Used only for `pypi` environment (no secret, just OIDC
  binding).
- **GITHUB_TOKEN** (auto): not used by the shared workflows. Doesn't
  trigger downstream — hence why release-please needs its own PAT.

## `ecosystems` input reference

YAML map. Each key is the **component name** that appears in tag
prefixes. Each value:

| Field | Required | Notes |
|---|---|---|
| `dir` | yes | Subdirectory in the repo |
| `ecosystem` | yes | `ts` \| `py` \| `rs` \| `php` \| `go` — picks the publish job (or none for php/go) |
| `mirror` | yes | Full slug of the read-only mirror repo |
| `package` | no | Registry package name (informational) |
| `test-command` | no | Override default test step |
| `build-command` | no | Override default build step (ts, py) |
| `node-version` | no | Override default Node version (ts; default `22`) |
| `python-version` | no | Override default Python version (py; default `3.11`) |
| `rust-toolchain` | no | Override default Rust toolchain (rs; default `stable`) |
| `access` | no | Override npm access level (ts; default `public`) |
| `pypi-environment` | no | Override default GitHub Environment for PyPI OIDC (py; default `pypi`) |

### Built-in defaults per ecosystem

| Ecosystem | Test | Build | Runtime |
|---|---|---|---|
| `ts` | `pnpm test` | `pnpm build` | Node 22 |
| `py` | `python -m pytest -q` | `python -m build` | Python 3.11 |
| `rs` | `cargo test` | _(none; cargo publish handles it)_ | Rust stable |
| `php` | _(no publish)_ | _(no publish)_ | _Packagist auto-syncs_ |
| `go` | _(no publish)_ | _(no publish)_ | _proxy.golang.org pulls from tag_ |

### Example with overrides

If your repo uses a Makefile for tests/builds:

```yaml
ecosystems: |
  ts:
    dir: ts
    ecosystem: ts
    mirror: hop-top/uri-ts
    test-command: make test-ts
    build-command: make build-ts
  rs:
    dir: rs
    ecosystem: rs
    mirror: hop-top/uri-rs
    # accepts default `cargo test` — no override needed
```

## Common pitfalls

| Issue | Cause | Fix |
|---|---|---|
| Tag push doesn't trigger publish | `release-please` used default `GITHUB_TOKEN`, which can't trigger downstream | Set `token: ${{ secrets.GH_RELEASE_PLEASE_PAT }}` on the release-please action |
| Mirror push fails with `denied to github-actions[bot]` | `actions/checkout` planted an extraheader that overrides the PAT | The shared `mirror-subtree.yml` already sets `persist-credentials: false`. If you're customizing, ensure that's set. |
| PyPI publish fails with `invalid-token-bad-audience` | OIDC trusted-publisher config doesn't match | Verify on PyPI: org name, repo name, workflow filename, environment name |
| crates.io publish fails with `verified email required` | The CARGO_REGISTRY_TOKEN's account has no verified email | Verify email at <https://crates.io/settings/profile>, then re-issue the token |
| First release skips alpha.0 and starts at alpha.1 | `prerelease-type: "alpha"` instead of `"alpha.0"` | Use `"alpha.0"` so the counter has a starting digit |
| `feat:` from `0.0.0` jumps to `1.0.0` | release-please's "0.0.0 trap" — treats `0.0.0` as "no prior release" | Bootstrap with `Release-As: 0.1.0` footer on the first commit |

## See also

- [`docs/architecture.md`](docs/architecture.md) — full control/data
  flow diagrams + design rationale
- `custom-release-please` skill (separate) — the consumer-side
  release-please configuration concerns (three-key prerelease combo,
  channel transitions, Release-As footers)
