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
    uses: hop-top/.github/.github/workflows/publish-on-tag.yml@v0
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

Three options, in order of preference:

```yaml
uses: hop-top/.github/.github/workflows/publish-on-tag.yml@v0   # rolling major (recommended)
uses: hop-top/.github/.github/workflows/publish-on-tag.yml@v0.1.0  # exact, frozen
uses: hop-top/.github/.github/workflows/publish-on-tag.yml@main # latest, breaking changes welcome
```

`@v0` is the **rolling major tag** — auto-updates on each non-breaking
release (`v0.1.0 → v0.1.1 → v0.2.0`). When dotgithub cuts `v1.0.0`
(breaking), `@v0` stays where it is; you opt in by changing to `@v1`.

`@v0.1.0` is **exact** — frozen, no patches propagate.

`@main` is **rolling everything** — gets every change including
breaking. Only use in non-production repos.

Tags follow plain semver: `v0.1.0`, `v0.2.0`, `v1.0.0`. The rolling
majors (`v0`, `v1`, ...) are maintained automatically by dotgithub's
[`roll-major-tag.yml`](.github/workflows/roll-major-tag.yml)
workflow.

## Facade pattern

Consumers see one set of names; the workflows internally adapt those
to whatever env-var names upstream tools demand. This is a deliberate
**facade**: the canonical secret names follow the
`<NAMESPACE>_<PURPOSE>_<TYPE>` convention this repo authors, and the
shared workflows do the translation so consumers never reference
upstream-specific identifiers.

| Canonical (what you set) | Adapter env (internal) | Read by |
|---|---|---|
| `NPM_REGISTRY_TOKEN` | `NODE_AUTH_TOKEN` | `actions/setup-node` for `pnpm publish` |
| `GH_MIRROR_PAT` | `GH_TOKEN` | `gh` CLI |
| `CARGO_REGISTRY_TOKEN` | `CARGO_REGISTRY_TOKEN` | `cargo` (name happens to match) |

`GITHUB_TOKEN` is GitHub's auto-injected per-job token. It is **not**
used by these workflows. release-please needs `GH_RELEASE_PLEASE_PAT`
specifically because PRs opened by `GITHUB_TOKEN` don't trigger
downstream workflows; a real PAT does.

Consumers should reference only the canonical names in `secrets:`
blocks at the call site. The adapter names are an internal
implementation detail — never set them yourself.

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

### Secrets the shared workflows DO NOT need (default mode)

| What | Why not |
|---|---|
| **PyPI token** | `publish-py` uses [PyPI trusted publishing](https://docs.pypi.org/trusted-publishers/) (OIDC) by default. Configure on PyPI's side bound to your repo + `pypi-environment` (default: `pypi`). If OIDC won't work for your setup, see [PyPI auth modes](#pypi-auth-modes) below for the token escape hatch. |
| **Packagist token** | Packagist auto-syncs from public GitHub via webhook. |
| **Go module token** | proxy.golang.org pulls from git tags. |

### PyPI auth modes

`publish-py` supports two authentication modes, picked via the
`pypi-auth` field in your ecosystem entry:

| `pypi-auth` | Mechanism | Requires |
|---|---|---|
| `oidc` (default) | PyPI trusted publishing via short-lived OIDC token | Trusted publisher configured on PyPI matching the **caller workflow filename** (NOT the reusable's); GitHub Environment named per `pypi-environment` must exist on the caller repo |
| `token` | Long-lived PyPI API token uploaded via twine | `PYPI_REGISTRY_TOKEN` secret available to the caller (no environment binding, no OIDC permissions needed) |

**Choosing**: `oidc` is preferred (no long-lived secret, automatic
rotation). Use `token` when:

- PyPI trusted publishing isn't matching despite correct claims
  (rare; pending-publisher table drift).
- You're publishing from a forked workflow that can't set
  `id-token: write`.
- You need to bootstrap-publish before a pending publisher can be
  configured.

Example caller using token auth for py:

```yaml
jobs:
  publish:
    uses: hop-top/.github/.github/workflows/publish-on-tag.yml@v0
    secrets:
      PYPI_REGISTRY_TOKEN: ${{ secrets.PYPI_REGISTRY_TOKEN }}
      # ... other secrets
    with:
      ecosystems: |
        py:
          dir: py
          ecosystem: py
          package: hop-top-uri
          mirror: hop-top/uri-py
          pypi-auth: token
```

**OIDC trap — the workflow_ref claim is the CALLER, not the
reusable.** When configuring a PyPI trusted publisher for a repo that
calls into `hop-top/.github`, the "Workflow filename" field on PyPI
must be the filename of YOUR workflow (e.g. `publish.yml`), not the
reusable's (`publish-py.yml`). GitHub's OIDC `workflow_ref` claim is
always set from the calling workflow.

### Env vars exported inside workflow steps

Two flavors: **adapter mappings** (internal facade — you don't touch
these) and **plumbing vars** (available inside your `test-command` /
`build-command` overrides).

#### Adapter mappings (internal facade — FYI only)

| Canonical secret | Adapter env (internal) | Where | Why |
|---|---|---|---|
| `NPM_REGISTRY_TOKEN` | `NODE_AUTH_TOKEN` | `publish-ts` publish step | `actions/setup-node` reads this |
| `CARGO_REGISTRY_TOKEN` | `CARGO_REGISTRY_TOKEN` | `publish-rs` publish step | cargo reads this (name matches by coincidence) |
| `GH_MIRROR_PAT` | `GH_TOKEN` | `mirror-subtree` all steps | `gh` CLI reads this |

#### Plumbing env vars (available to your test-command / build-command)

| Env var | Set in | From | Available to |
|---|---|---|---|
| `TEST_CMD` | `publish-{ts,py,rs}` test step | `inputs.test-command` or built-in default | your test command |
| `BUILD_CMD` | `publish-{ts,py}` build step | `inputs.build-command` or built-in default | your build command |
| `id-token: write` (permission) | `publish-py` job-level | — | OIDC token request for PyPI |

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

## Install model

The `publish-{ts,py,rs}.yml` workflows install only **runner-level
deps** — the language toolchain itself, plus minimal tooling (e.g.
`pip install pytest build` for py). They do **not** install the
consuming package's own dependencies.

That's the consumer's job. Your `test-command` (and `build-command`,
where applicable) is responsible for any package-level install.

### `ts`

The default `test-command` does an implicit install
(`pnpm install --frozen-lockfile --ignore-scripts && pnpm test`),
which "just works" for the canonical hop-top stack: `pnpm-lock.yaml`
present + `"test": "vitest run"` in `package.json`. The
`--ignore-scripts` flag avoids pnpm 10+ strict-mode failures on
ignored build scripts (e.g. `esbuild` pulled in by `vitest`).

`build-command` defaults to `pnpm build` and skips re-install — the
test step already populated `node_modules`.

If your setup is different, override `test-command`:

```yaml
# install + test (uses lockfile)
test-command: pnpm install --frozen-lockfile && pnpm test

# install + test, skip transitive build scripts
test-command: pnpm install --frozen-lockfile --ignore-scripts && pnpm test

# dlx-based, no node_modules
test-command: pnpm dlx --config.ignore-scripts=true vitest run

# delegate to a Makefile target the repo already maintains
test-command: make test-ts
```

### `py`

Default `test-command` is `python -m pytest -q` — assumes the package
is already on `sys.path`. If your tests import from the package,
install it first:

```yaml
test-command: pip install -e . && pytest
```

### `rs`

Cargo handles deps natively — no install needed in `test-command`.
Default (`cargo test`) just works.

### Summary

| Ecosystem | Default installs package? | Notes |
|---|---|---|
| `ts` | **yes** (`pnpm install --frozen-lockfile --ignore-scripts`) | Exception — defaults are tuned for canonical hop-top stack |
| `py` | no | Override to `pip install -e . && pytest` if tests import the package |
| `rs` | no (cargo handles transitive deps) | — |

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
| `pypi-auth` | no | PyPI auth mode (py; `oidc` \| `token`; default `oidc`). `token` requires `PYPI_REGISTRY_TOKEN` secret. |

### Built-in defaults per ecosystem

| Ecosystem | Test | Build | Runtime |
|---|---|---|---|
| `ts` | `pnpm install --frozen-lockfile --ignore-scripts && pnpm test` (does implicit install) | `pnpm build` | Node 22 |
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
