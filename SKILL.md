---
name: hop-top-dotgithub
description: Use hop-top/.github's reusable workflows to publish releases (npm/PyPI/crates.io) and push subtree mirrors. Use when wiring a hop-top repo's release pipeline to call publish-on-tag.yml on `<component>/v<version>` tag pushes, adding the release-please-preflight check, mapping registry secrets, troubleshooting why a tag didn't trigger a publish, registering a new package on PyPI/Packagist (via OIDC trusted publishing or API tokens), creating GitHub Environments, or debugging pnpm 11 strict-mode install failures.
---

# Using hop-top/.github

This skill is for **consumers**: people wiring up release pipelines
in hop-top repos by calling the reusable workflows in
`hop-top/.github`. If you're modifying the workflows themselves, see
this repo's `DEVELOPING.md` instead.

## Repo naming convention

Polyglot repos in the hop-top org follow a strict shape:

| Shape | Pattern | Example |
|---|---|---|
| Polyglot source | `poly-<name>` | `hop-top/poly-kit` |
| Go mirror (or single-language Go repo) | `<name>` (bare) | `hop-top/kit`, `hop-top/uri`, `hop-top/tlc` |
| TS mirror | `<name>-ts` | `hop-top/kit-ts` |
| Py mirror | `<name>-py` | `hop-top/kit-py` |
| Rust mirror | `<name>-rs` | `hop-top/kit-rs` |
| PHP mirror | `<name>-php` | `hop-top/kit-php` |

**Go ALWAYS takes the bare-name slot.** Vanity imports like
`hop.top/kit` resolve to `github.com/hop-top/kit` by default; a
`hop-top/kit-go` repo would break that resolution. `<name>-go` does
NOT exist in this org — ever.

**Tag shape is `<component>/v<version>` everywhere**, including
single-language repos (e.g. `tlc/v1.4.2`, not `v1.4.2`). The
`tags: ['*/v*']` glob in `publish.yml` requires this — bare `v...`
tags would never trigger publish.

## Tag-shape glob trap

The `tags: ['*/v*']` filter is **single-segment**: `*` does NOT
match `/`. Tags like `sdk/ts/v0.2.0-alpha.0` (3-segment) silently
fail to trigger `publish.yml`. The release-please-action's
`component` field is what produces the tag prefix, so component
names with `/` in them are the trap.

✅ Good: `component: kit-ts` → tag `kit-ts/v0.2.0-alpha.0` → publish fires.
✗ Bad: `component: sdk/ts` → tag `sdk/ts/v0.2.0-alpha.0` → publish silent.

The `path` (manifest key) can contain `/` — only the `component`
must be a single segment.

## Three-way name alignment

For each shipping component, three names must match exactly:

```
release-please-config.json:packages.<path>.component
        ==
publish.yml:ecosystems.<KEY>
        ==
mirror repo basename (org/<name>)
```

If they drift, `publish-on-tag.yml`'s `ecosystems[<component>]`
lookup fails with `Unknown component '<tag-prefix>'` at parse time,
before any publish work happens.

## Mental model

```
commits → release-please opens standing PR
            ↓ merge
          release-please creates tag <component>/v<version>
            ↓ tag push
          publish.yml triggers          (+ optional <lang>-binaries.yml)
            ↓ uses:                        ↓ uses:
          publish-on-tag.yml             <lang>-on-tag.yml (per language)
            ↓ dispatches                   ↓
          publish-{ts,py,rs}.yml +       installable artifacts
            mirror-subtree.yml           (binaries, formulae, …)
            ↓                              ↓
          registry + mirror push         GitHub Release assets
```

`hop-top/.github` owns the **publish/mirror/artifacts** half.
release-please (consumer-side, configured in YOUR repo) owns the
**version/tag** half. Both compose; you wire them up. The per-
language binaries lane is opt-in — most adopter repos won't need
it. See [Shipping installable artifacts](#shipping-installable-artifacts).

## Quick-start

Two workflow files in your repo:

### `.github/workflows/release-please.yml`

```yaml
name: release-please

on:
  push:
    branches: [main]
  workflow_dispatch: {}

permissions:
  contents: write
  pull-requests: write

jobs:
  release-please:
    runs-on: ubuntu-latest
    steps:
      # Mint a short-lived installation token from the hop-top
      # release-bot GitHub App so the release PRs are opened by
      # `release-bot[bot]` rather than the human owner — sidesteps
      # the CODEOWNERS self-approval block on
      # `.release-please-manifest.json` and avoids the long-lived-PAT
      # delivery quirks that have bitten fresh repos.
      - uses: actions/create-github-app-token@v1
        id: app-token
        with:
          app-id: ${{ secrets.RELEASE_BOT_APP_ID }}
          private-key: ${{ secrets.RELEASE_BOT_PRIVATE_KEY }}

      - uses: googleapis/release-please-action@v4
        with:
          config-file: .github/release-please-config.json
          manifest-file: .github/.release-please-manifest.json
          token: ${{ steps.app-token.outputs.token }}
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
      PACKAGIST_USERNAME: ${{ secrets.PACKAGIST_USERNAME }}
      PACKAGIST_TOKEN: ${{ secrets.PACKAGIST_TOKEN }}
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
On single-component repos, don't skip the
[release-PR title pattern](#release-pr-title-pattern) — the polyglot
default leaves the component name out of the title.

## Single-language repos

Single-language repos (one ecosystem, no polyglot split) don't always
need `publish.yml` — and when they do, they don't always want the
subtree mirror push. The right config depends on whether
`publish-on-tag.yml` has any work to do for that ecosystem beyond the
mirror:

| Ecosystem | `publish-X` job fires? | Mirror needed? | Recommended config |
|---|---|---|---|
| `go` | No (proxy.golang.org pulls tags directly) | No (source IS the bare-name install slot — no second-slot mirror) | **Drop `publish.yml` entirely** |
| `ts` | Yes (`pnpm publish` → npm) | Optional | Keep `publish.yml`; set `enable-mirror: false` unless a real `<name>-ts` mirror exists |
| `py` | Yes (`twine`/OIDC → PyPI) | Optional | Same as `ts` |
| `rs` | Yes (`cargo publish` → crates.io) | Optional | Same as `ts` |
| `php` | Yes (Packagist `update-package` API notify after mirror push) | **Required** — Packagist polls the mirror, not the source | Keep `publish.yml`; `enable-mirror: false` is rejected at parse time for php (see [PHP requires the mirror](#php-requires-the-mirror)) |

For the Go-only case, `publish-on-tag.yml` has nothing to do —
proxy.golang.org pulls directly from the source repo. Keeping
`publish.yml` would only fire the (unwanted) mirror push.

For `ts`/`py`/`rs`-only repos, the publish step IS needed but the
unconditional mirror destination is awkward when there's no canonical
second-slot repo. Use `enable-mirror: false`:

```yaml
name: publish

on:
  push:
    tags: ['*/v*']

jobs:
  publish:
    permissions:
      contents: read
      id-token: write
    uses: hop-top/.github/.github/workflows/publish-on-tag.yml@v0
    secrets:
      NPM_REGISTRY_TOKEN: ${{ secrets.NPM_REGISTRY_TOKEN }}
      GH_MIRROR_PAT: ${{ secrets.GH_MIRROR_PAT }}  # still required by the schema
    with:
      enable-mirror: false
      ecosystems: |
        ts: { dir: ., ecosystem: ts, package: "@org/pkg", mirror: org/pkg-ts }
```

`enable-mirror` defaults to `true` for back-compat with existing
polyglot callers — single-language adopters opt out explicitly.
`GH_MIRROR_PAT` is still required by the workflow's `secrets:`
contract even when `enable-mirror: false` (the mirror job's `if:`
gates the run, not the schema). Pass an org-level dummy or the real
PAT; neither is consumed when the gate is `false`. Same goes for
`mirror:` inside the `ecosystems` map — the parse step reads it but
the mirror job is skipped, so a placeholder slug (no real repo
needed) satisfies the YAML schema.

## Preflight check (recommended)

Add a third workflow that pre-validates your release-please setup on
every PR touching the release files. It runs the same checks as the
[Bootstrap checklist](#bootstrap-checklist-first-time-setup) but live,
inline, with specific fix commands for each failure.

### `.github/workflows/release-please-preflight.yml`

```yaml
name: release-please-preflight

on:
  pull_request:
    paths:
      - '.github/release-please-config.json'
      - '.github/.release-please-manifest.json'
      - '.github/workflows/release-please.yml'
      - '.github/workflows/publish.yml'
      - 'pyproject.toml'   # adjust per language
      - 'package.json'
      - 'Cargo.toml'
  workflow_dispatch: {}

jobs:
  preflight:
    permissions:
      contents: read
      pull-requests: write
    uses: hop-top/.github/.github/workflows/release-please-preflight.yml@v0
```

### What it checks

Auto-infers from your config — no inputs required:

- All four required files exist (config, manifest, both workflows)
- `release-please-config.json` parses + has `packages`
- Every component is single-segment (the
  [tag-shape glob trap](#tag-shape-glob-trap))
- Prerelease packages have the
  [four-piece combo](#prerelease-channel--the-four-piece-combo)
- Manifest seed shape matches prerelease declaration
- [SemVer ∩ PEP 440 intersection](#version-string-strategy--semver--pep-440):
  Python packages don't have an `extra-files` override on
  `pyproject.toml` (the trap that bypasses PEP 440 normalization),
  and `pyproject.toml`'s current version is PEP 440-shaped (not
  SemVer-shaped)
- `publish.yml` triggers on `*/v*` and delegates to
  `publish-on-tag.yml`
- [Three-way name alignment](#three-way-name-alignment) holds
- `release-please.yml` uses the release-bot App token (not the
  deprecated PAT) and declares `workflow_dispatch`
- Per-ecosystem infrastructure: GitHub Environment exists (for PyPI
  OIDC), mirror repo exists (if configured), PyPI/npm package-name
  availability (informational)

### Optional overrides

```yaml
jobs:
  preflight:
    uses: hop-top/.github/.github/workflows/release-please-preflight.yml@v0
    with:
      fail-on: any              # default 'breaking' — also fail on warnings
      config-path: custom/path  # default '.github/release-please-config.json'
```

`fail-on` values:

| Value | Behavior |
|---|---|
| `breaking` (default) | Fail on broken config / missing infra |
| `any` | Also fail on informational warnings (strict mode) |
| `never` | Annotation-only; always exit 0 |

### When to use

- **Always** for repos using this skill's release pipeline. The
  preflight catches every checklist item from the [Bootstrap
  checklist](#bootstrap-checklist-first-time-setup) at PR time
  instead of at tag-push time (when failures are much costlier —
  see [Re-triggering a failed publish](#re-triggering-a-failed-publish)).
- **Especially** for fresh repos doing their first release. The
  per-ecosystem infrastructure checks (Environment exists, mirror
  repo exists) prevent the most common bootstrap failures.

## Bootstrap checklist (first-time setup)

Hit every box on this list before pushing the first release tag.
Each missing box was a real session-blocking failure at some point.

**Naming + tag shape**

- [ ] Repo follows the [naming convention](#repo-naming-convention)
      (`poly-<name>` source + bare-name Go mirror + `<name>-<lang>` mirrors).
- [ ] Every `component` in `release-please-config.json` is a
      **single segment** (no `/`). See [Tag-shape glob trap](#tag-shape-glob-trap).
- [ ] For each component, the **three names match exactly**:
      `release-please-config.json` `component` == `publish.yml`
      `ecosystems` key == mirror repo basename. See
      [Three-way name alignment](#three-way-name-alignment).
- [ ] `release-please-config.json` sets
      `"pull-request-title-pattern": "chore(release): ${component} ${version}"`.
      Without it, release-please defaults to `chore: release main` (the
      component name and version are buried in the body). See
      [Release-PR title pattern](#release-pr-title-pattern).

**Prerelease channel** (if not shipping stable from day one)

- [ ] Every package has all four pieces: `prerelease: true`,
      `prerelease-type: "alpha.0"`, `versioning: "prerelease"`,
      `bump-minor-pre-major: true`. See
      [Prerelease channel](#prerelease-channel--the-four-piece-combo).
- [ ] Manifest seed values are **prerelease-shaped**
      (`0.x.y-alpha.N` or `0.x.y-experimental.N`), not stable.
- [ ] Verified with a release-please dry-run (`grep '^title:'`).

**Secrets** (org-level unless noted)

- [ ] `GH_MIRROR_PAT` — fine-grained, `Administration: RW` +
      `Contents: RW` on every mirror repo
- [ ] `RELEASE_BOT_APP_ID` + `RELEASE_BOT_PRIVATE_KEY` — the
      hop-top release-bot GitHub App credentials, used to mint a
      short-lived token for release-please. Org-level; already set
      across the org. (Cf. legacy `GH_RELEASE_PLEASE_PAT` —
      deprecated; PAT delivery proved unreliable for fresh repos.)
- [ ] `NPM_REGISTRY_TOKEN` (if shipping ts) — npm Granular Access
      Token with publish on your scope
- [ ] `CARGO_REGISTRY_TOKEN` (if shipping rs) — crates.io API
      token; account email **verified**
- [ ] `PYPI_REGISTRY_TOKEN` (only if using `pypi-auth: token`) —
      PyPI API token
- [ ] `PACKAGIST_USERNAME` + `PACKAGIST_TOKEN` (if shipping php) —
      Packagist account username + API token. Required for the
      automated `publish-php` notify step. See
      [PHP: Packagist notify](#php-packagist-notify).

**Registry pre-registration**

- [ ] npm: no pre-registration needed (first publish claims the
      name)
- [ ] crates.io: no pre-registration needed; verify email FIRST
- [ ] PyPI (OIDC mode): pending trusted publisher configured on
      <https://pypi.org/manage/account/publishing/>; matches the
      **caller workflow filename** (not the reusable's)
- [ ] PyPI: GitHub Environment matching `pypi-environment` (default:
      `pypi`) exists on the source repo
- [ ] Packagist: one-time package submit at
      <https://packagist.org/packages/submit> with the mirror repo URL,
      AFTER the first tag lands on `<name>-php`. After that, the
      `publish-php` job auto-notifies on every tag (no webhook needed)

**Repo hygiene per language**

- [ ] Rust: `.gitignore` ignores `/target/`; no `target/` files
      tracked. See [Rust: target/](#rust-target--cargo-publish-dirty-tree-check).
- [ ] Rust: feature-gated test files have `#![cfg(feature = "...")]`
      at the top. See [Rust: feature-gated test files](#rust-feature-gated-test-files).
- [ ] TS: if any test depends on native bindings, exclude it from
      the publish run via `test-command` override. See
      [TS: native bindings](#ts-native-bindings----ignore-scripts).

**Workflow setup**

- [ ] `release-please.yml` declares `workflow_dispatch: {}` so you
      can manually retrigger after closing conflicted PRs. See
      [Retriggering release-please](#retriggering-release-please-after-sibling-pr-conflicts).
- [ ] `publish.yml` uses `@v0` (rolling major), not `@main`, not a
      pinned `@v0.x.y` — that way you get all backwards-compatible
      fixes (e.g. `mirror-subtree` root-component support,
      shell-operator preservation) automatically.

**Mirror repos**

- [ ] One mirror repo per shipping language exists:
      `<org>/<name>-ts`, `-py`, `-rs`, `-php`, and bare `<org>/<name>`
      for Go.
- [ ] All currently empty / fresh. The `mirror-subtree` workflow
      auto-archives them after the first sync.

**Post-merge sanity**

After the first release-please standing PR is merged and the tag is
pushed:

- [ ] `publish.yml` actually triggered (`gh run list --workflow
      publish.yml`)
- [ ] If something failed, fix on `main` then **delete + recreate
      the tag** (do not `gh run rerun`). See
      [Re-triggering a failed publish](#re-triggering-a-failed-publish).

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
used by these workflows. release-please needs a higher-privilege
token specifically because PRs opened by `GITHUB_TOKEN` don't
trigger downstream workflows. The canonical pattern is to mint a
short-lived installation token from the **`release-bot` GitHub App**
(`RELEASE_BOT_APP_ID` + `RELEASE_BOT_PRIVATE_KEY` org secrets) via
`actions/create-github-app-token@v1` — see the [Quick-start](#quick-start)
example. Avoid long-lived PATs (`GH_RELEASE_PLEASE_PAT`); delivery
to fresh repos has proved unreliable, and PR authorship as the
human owner trips CODEOWNERS self-approval on the manifest file.

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
| `RELEASE_BOT_APP_ID` + `RELEASE_BOT_PRIVATE_KEY` | release-please job (via `actions/create-github-app-token@v1`) | Org | GitHub App credentials for the hop-top release-bot. The App must be installed on every source repo that ships releases **plus every package-manager target repo passed via `goreleaser-on-tag.yml` inputs** (`<org>/homebrew-tap` for `homebrew-tap-repo`, `<org>/scoop-bucket` for `scoop-bucket-repo`, `<org>/winget-pkgs` (the org's fork of `microsoft/winget-pkgs`) for `winget-fork-repo`); `Contents: RW` + `Pull Requests: RW` + `Workflows: RW`. **Default `GITHUB_TOKEN` doesn't work** — its PRs don't trigger downstream workflows. **Legacy `GH_RELEASE_PLEASE_PAT` is deprecated** (PAT-delivery proved unreliable on fresh repos, and PRs authored by the human owner trip CODEOWNERS self-approval on `.release-please-manifest.json`). |
| `NPM_REGISTRY_TOKEN` | `publish-ts` (if shipping TS) | Org | npm Granular Access Token with publish on your scope |
| `CARGO_REGISTRY_TOKEN` | `publish-rs` (if shipping Rust) | Org | crates.io API token. Account must have a verified email. |
| `PACKAGIST_USERNAME` | `publish-php` (if shipping PHP) | Org | Packagist account username. Paired with `PACKAGIST_TOKEN`. Find at <https://packagist.org/profile/edit>. URL-encoded into the `update-package` query string; `::add-mask::`-registered inside the job to keep the encoded form out of logs. |
| `PACKAGIST_TOKEN` | `publish-php` (if shipping PHP) | Org | Packagist API token. Mint at <https://packagist.org/profile/edit>. URL-encoded into the `update-package` query string; `::add-mask::`-registered inside the job to keep the encoded form out of logs. |

### Secrets the shared workflows DO NOT need (default mode)

| What | Why not |
|---|---|
| **PyPI token** | `publish-py` uses [PyPI trusted publishing](https://docs.pypi.org/trusted-publishers/) (OIDC) by default. Configure on PyPI's side bound to your repo + `pypi-environment` (default: `pypi`). If OIDC won't work for your setup, see [PyPI auth modes](#pypi-auth-modes) below for the token escape hatch. |
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
  (`GH_MIRROR_PAT`, `RELEASE_BOT_APP_ID`, `RELEASE_BOT_PRIVATE_KEY`,
  `NPM_REGISTRY_TOKEN`, `CARGO_REGISTRY_TOKEN`)
- **Repo secrets**: rarely needed once the org App is set up; reserved
  for one-off credentials a single repo owns
- **Environment secrets**: high-stakes scoping with optional manual
  approval. Used only for `pypi` environment (no secret, just OIDC
  binding).
- **GITHUB_TOKEN** (auto): not used by the shared workflows. Doesn't
  trigger downstream — hence why release-please needs the App token.

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

### `py`: package naming (install slug vs import name)

PyPI's short names are mostly taken. Bare names like `eva`, `uri`,
`kit` are owned by third parties; trying to publish under them fails
with `403 You're not allowed to upload to project '<name>'`. The
convention across hop-top:

| PyPI install slug | Python import name(s) | Pattern |
|---|---|---|
| `hop-top-eva` | distribution exposes multiple top-level packages: `core`, `cli`, … (no single `eva` import) | install slug prefixed, import names clean |
| `hop-top-uri` | `uri` | same |
| `hop-top-xrr` | `xrr` | same |
| `hop-top-kit` | `hop_top_kit` | matched (one outlier) |

**Default convention: install slug prefixed, import name clean.** This
matches the broader Python ecosystem (`pip install scikit-learn` →
`import sklearn`; `pip install PyYAML` → `import yaml`). Three-of-four
hop-top py packages follow it; new packages should too.

What changes vs what stays when you prefix the install slug:

```toml
# Changes:
[project]
name = "hop-top-eva"            # ← install slug; what users `pip install`

[tool.uv.sources]
hop-top-eva = { workspace = true }  # ← match `[project].name`

[dependency-groups]
dev = ["hop-top-eva", ...]      # ← match `[project].name`

[project.optional-dependencies]
all = ["hop-top-eva[dev,server,...]"]  # ← match `[project].name`

# Stays the same:
[tool.hatch.build.targets.wheel]
packages = ["core", "cli", ...]   # ← import name; what users `import`

[project.scripts]
eva = "cli.main:app"              # ← CLI command name (user-facing UX)

[project.entry-points."eva.evaluators"]   # ← entry-point group name
```

**Same for the `package` field in `publish.yml`'s `ecosystems` block** —
it MUST match the PyPI install slug, not the import name:

```yaml
ecosystems: |
  eva:                           # ← release-please component (tag prefix)
    dir: .
    ecosystem: py
    package: hop-top-eva         # ← MUST be the PyPI install slug
    pypi-auth: token             # ← see [PyPI auth modes](#pypi-auth-modes)
```

And in `release-please-config.json`:

```jsonc
{
  "packages": {
    ".": {
      "component": "eva",           // tag prefix (eva/v0.1.0-alpha.1)
      "package-name": "hop-top-eva", // PyPI install slug (changelog rendering)
      "release-type": "python"
    }
  }
}
```

**Sanity check before publish**: `uv build` should produce
`hop_top_eva-X.Y.Z-py3-none-any.whl` (slug normalized to underscore
filename), with whatever import-side packages your
`[tool.hatch.build.targets.wheel].packages` lists (e.g. `core/`,
`cli/`, …). If the wheel filename is `eva-X.Y.Z...`, your
`[project].name` wasn't updated.

### `rs`

Cargo handles deps natively — no install needed in `test-command`.
Default (`cargo test`) just works.

### Summary

| Ecosystem | Default installs package? | Notes |
|---|---|---|
| `ts` | **yes** (`pnpm install --frozen-lockfile --ignore-scripts`) | Exception — defaults are tuned for canonical hop-top stack |
| `py` | no | Override to `pip install -e . && pytest` if tests import the package |
| `rs` | no (cargo handles transitive deps) | — |

## Shipping installable artifacts

`publish-on-tag.yml` handles **language-registry publishing** (npm,
PyPI, crates.io, Packagist) plus the read-only mirror push. It
doesn't handle **installable artifacts** — cross-platform binaries,
desktop apps, package-manager formulae. Those need a language-
specific builder, each with its own canonical tool and its own
prefix-stripping quirks when paired with release-please's
`<component>/v<version>` tag shape.

Per-language reusable workflows live alongside `publish-on-tag.yml`
in this repo, with focused reference docs:

| Language | Reusable workflow | Reference | Status |
|---|---|---|---|
| Go | [`goreleaser-on-tag.yml`](.github/workflows/goreleaser-on-tag.yml) | [docs/binaries/go.md](docs/binaries/go.md) | ✅ shipped |
| Rust | (planned) `cargo-dist-on-tag.yml` | [docs/binaries/rust.md](docs/binaries/rust.md) | ⏳ stub |
| Python | (planned) `pyinstaller-on-tag.yml` | [docs/binaries/python.md](docs/binaries/python.md) | ⏳ stub |
| TypeScript / Node | (planned) `pkg-on-tag.yml` or electron equivalent | [docs/binaries/typescript.md](docs/binaries/typescript.md) | ⏳ stub |

**Composition**: each workflow fires on the same tag-push event as
`publish-on-tag.yml`, in parallel. The GitHub Release is created
by release-please at tag-cut time; both layers attach their
artifacts to that existing release.

```
release-please cuts tag <component>/v<version>
  ↓
publish-on-tag.yml fires        ← language-registry + mirror push
  ↓ (in parallel)
<lang>-on-tag.yml fires         ← installable artifacts (binaries, formulae, …)
```

You opt into the binaries lane per language — most adopter repos
won't need it. Pick the reference doc for your language and follow
the caller-workflow snippet there.

### Org-wide tap/bucket convention

When shipping binaries via package managers, **use the org-wide
tap/bucket repos** — not per-binary ones. For hop-top:

| Manager | Tap/bucket repo | NOT |
|---|---|---|
| Homebrew | `hop-top/homebrew-tap` | `hop-top/homebrew-<name>` |
| Scoop | `hop-top/scoop-bucket` | `hop-top/scoop-<name>` |

Why: per-binary taps multiply maintenance (separate CI, separate
access tokens, users have to `brew tap` once per tool). The
org-wide tap pattern means users `brew tap hop-top/tap` once and
get every hop-top binary via `brew install hop-top/tap/<name>`.
goreleaser's `brews[].repository.name` field controls this; set
it to `homebrew-tap`. Same for `scoops[].repository.name` — set
it to `scoop-bucket`.

The reference doc ([docs/binaries/go.md](docs/binaries/go.md))
covers the goreleaser config in detail — this is just the
entry-point reminder.

## `ecosystems` input reference

YAML map. Each key is the **component name** that appears in tag
prefixes. Each value:

| Field | Required | Notes |
|---|---|---|
| `dir` | yes | Subdirectory in the repo |
| `ecosystem` | yes | `ts` \| `py` \| `rs` \| `php` \| `go` — picks the publish job (none for `go`; `php` runs a Packagist notify after the mirror push, not a publish-from-source step) |
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
| `php` | _(no publish-from-source)_ | _(no publish-from-source)_ | `publish-php` POSTs to Packagist `update-package` after mirror push (see [PHP: Packagist notify](#php-packagist-notify)) |
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

## Version-string strategy — SemVer ∩ PEP 440

A polyglot release pipeline has to satisfy four conflicting version
grammars:

| Format | Accepts `0.1.0-alpha.1` | Accepts `0.1.0a1` | Notes |
|---|---|---|---|
| Git tag | yes | yes | No format constraint |
| SemVer (npm, crates, cargo, Go) | yes | no | `a1` lacks the required leading hyphen |
| PEP 440 (PyPI) | no | yes | Hyphen-separated alpha is rejected by `pip` |

No single string is valid in every registry. The solution: **one
canonical internal form (SemVer), per-registry normalization at
file-write time**.

| Layer | Form | Why |
|---|---|---|
| Git tag (`<component>/v<version>`) | SemVer (`0.1.0-alpha.1`) | What release-please produces; consumed by Go module proxy, GitHub Releases |
| `.release-please-manifest.json` | SemVer (`0.1.0-alpha.1`) | Internal state; release-please's native format |
| `pyproject.toml [project].version` | PEP 440 (`0.1.0a1`) | Required by `pip` / `twine` / PyPI; written by release-type `python` |
| `package.json version` | SemVer (`0.1.0-alpha.1`) | Required by npm; written by release-type `node` |
| `Cargo.toml version` | SemVer (`0.1.0-alpha.1`) | Required by cargo; written by release-type `rust` |

### Don't break the normalization

The `release-type` field on each package owns its native file
formats. `release-type: python` already updates `pyproject.toml`
(and `setup.py`, `_version.py`) with PEP 440 strings. **Do not add
an `extra-files` block targeting `pyproject.toml`** — the generic
`type: toml` updater bypasses the normalization and writes raw
SemVer into the file, which then fails `pip install` and
`twine check`.

```jsonc
// ❌ BROKEN — extra-files bypasses PEP 440 normalization
{
  "release-type": "python",
  "extra-files": [
    { "type": "toml", "path": "pyproject.toml", "jsonpath": "$.project.version" }
  ]
}

// ✅ CORRECT — release-type python updates pyproject.toml natively
{
  "release-type": "python"
}
```

The preflight workflow catches this misconfiguration; see
[Preflight check](#preflight-check-recommended).

### Why SemVer is the canonical internal form

- release-please's data model is SemVer-native; PEP 440 is computed
  on the write side, not stored.
- The Go module proxy, npm, and crates.io all want SemVer in tags
  and files. Outvoting them on the canonical form would require
  per-registry tag rewriting at publish time.
- PEP 440's normalization is one-way derivable from SemVer
  (`-alpha.N` → `aN`, `-beta.N` → `bN`, `-rc.N` → `rcN`, `+build` →
  `+build`). The reverse is ambiguous (`a1` could be `-alpha.1` or
  `-a.1` — PEP 440 forbids the latter, SemVer allows both).

### Gradual ecosystem adoption

The PEP 440 normalization concern is Python-specific today. As
other languages join the polyglot setup, each gets a corresponding
release-type that owns its native file format:

| Language | release-type | Native file | Format |
|---|---|---|---|
| Python | `python` | `pyproject.toml`, `setup.py`, `_version.py` | PEP 440 |
| TypeScript/Node | `node` | `package.json` | SemVer |
| Rust | `rust` | `Cargo.toml` | SemVer |
| Go | `go` | (none — proxy reads tags) | n/a |
| PHP | `php` | `composer.json` | SemVer-compatible |

When adding a polyglot repo, set `release-type` at the package
level (or top-level if uniform across packages). The preflight
workflow checks for native-format integrity per ecosystem.

## Prerelease channel — the four-piece combo

To stay in an alpha/beta/rc channel (counter-incrementing), every
package in `release-please-config.json` needs **all four pieces**:

```json
{
  "prerelease": true,
  "prerelease-type": "alpha.0",
  "versioning": "prerelease",
  "bump-minor-pre-major": true
}
```

And the manifest seed must be **prerelease-shaped**:

```json
{ "sdk/ts": "0.3.0-alpha.0" }   // ✅ stays prerelease
{ "sdk/ts": "0.3.0" }            // ✗ next bump is stable 0.4.0
```

Why each piece matters:

| Piece | Without it |
|---|---|
| `prerelease: true` | Suffix isn't applied at all |
| `prerelease-type: "alpha.0"` | First release skips `alpha.0` and starts at `alpha.1` |
| `versioning: "prerelease"` | Counter-only mode is off; base bumps produce stable versions even with `prerelease: true` |
| Prerelease-shaped manifest seed | release-please sees the prior release as stable, bumps to the next stable |

**To leave the prerelease channel** (cut stable), add a `Release-As: X.Y.Z` footer (no suffix) on a commit. The prerelease suffix is "sticky" — only an explicit footer escapes it.

**To jump base while staying prerelease** (e.g. `0.3.0-alpha.5 → 0.4.0-alpha.0`), add `Release-As: 0.4.0-alpha.0` footer.

**Always dry-run before merging a manifest reseed**:

```sh
npx release-please@latest release-pr \
  --token "$(gh auth token)" \
  --repo-url <url> \
  --config-file .github/release-please-config.json \
  --manifest-file .github/.release-please-manifest.json \
  --target-branch <branch> \
  --dry-run | grep '^title:'
```

The actual proposed titles tell you exactly what release-please will emit.

## Release-PR title pattern

By default release-please generates PR titles like:

```
chore: release main
```

The component name and version are buried inside the PR body. Set
`pull-request-title-pattern` so the title carries them at a glance:

```json
{
  "pull-request-title-pattern": "chore(release): ${component} ${version}"
}
```

Result: `chore(release): ben 0.2.0-alpha.1`. Matches the convention
used in `hop-top/kit`; grep-able across the org via the GitHub search
bar; the component name disambiguates which release-please PR is which
on polyglot repos (where multiple components share the standing PR
set).

This is most often missed on **single-component repos** that set
`separate-pull-requests: false` and don't bother with the pattern —
the polyglot canonical example (see [`docs/bootstrap-checklist.md`](docs/bootstrap-checklist.md))
includes it but the single-language sections of this SKILL did not
mention it pre-v0.8.x. The Bootstrap-checklist line above flags it as
a required setup step.

**Org-secrets gotcha on the free plan.** Even with the title pattern
fixed, the release-please workflow will still fail on a private repo
under a **free** GitHub org with:

```
Error: Input required and not supplied: app-id
```

Because org-level secrets with `visibility: all` are **not** available
to private repos on the free plan — they reach public repos only.
Three fixes:

1. **Make the source repo public** (cheapest; org secrets propagate).
2. **Upgrade the org to Team / Enterprise** (org secrets propagate to
   private repos).
3. **Set the same secret at repo level** on the private repo
   (`RELEASE_BOT_APP_ID`, `RELEASE_BOT_PRIVATE_KEY`, `GH_MIRROR_PAT`,
   plus any registry tokens), duplicating the org-level entries.

Documented at <https://docs.github.com/en/actions/security-guides/using-secrets-in-github-actions#using-secrets-in-a-workflow>.

## Re-triggering a failed publish

The single most-counterintuitive thing about this pipeline:

**`publish.yml` runs against the `publish.yml` at the tag's
commit, NOT current `main`.** When a tag is pushed, GitHub Actions
snapshots the workflow file from that commit's tree.

This means:

- Fixing `publish.yml` on main doesn't help an already-pushed tag.
- `gh run rerun <id>` reuses the originally-resolved workflow refs
  (including `@main` and `@v0`) — it does NOT pick up newer reusable
  workflows.
- The reliable retry: **delete the tag + recreate it at current
  `main`**.

```bash
SHA=$(gh api repos/<org>/<repo>/branches/main -q '.commit.sha')
gh release delete <component>/v<version> --repo <org>/<repo> --yes
gh api -X DELETE repos/<org>/<repo>/git/refs/tags/<component>/v<version>
gh api -X POST repos/<org>/<repo>/git/refs \
  -f ref="refs/tags/<component>/v<version>" -f sha="$SHA"
```

The fresh tag push triggers a fresh workflow run that resolves the
caller workflow at the new tagged commit AND the reusable workflow
refs (`@main`, `@v0`) at run time.

## Retriggering release-please (after sibling-PR conflicts)

release-please opens one PR per component, but they share one
manifest file. When you merge component A's PR, the manifest
advances — component B's PR is now CONFLICTING because its branch
still proposes an older manifest.

The fix isn't "rebase the PR" (release-please won't accept manual
rebases). The fix is **close the conflicted PR + retrigger
release-please**, which reopens the PR with a freshly rebased
manifest:

```bash
gh pr close <conflicting-pr> --repo <org>/<repo>
gh workflow run release-please.yml --repo <org>/<repo>
```

For `workflow_dispatch` to work, the workflow must declare it:

```yaml
on:
  push:
    branches: [main]
  workflow_dispatch: {}
```

If `workflow_dispatch` isn't enabled, branch protection will likely
block direct pushes to `main`. Workaround: PR an empty commit so
release-please runs on the resulting merge to main.

## Language-specific gotchas

### Go: root-component caveats

When the Go module lives at the repo root (`dir: "."`), the mirror
job synthesizes a commit excluding `.github/workflows/` because:

1. `git subtree split --prefix=.` is rejected by git.
2. Mirror repos are read-only artifacts; pushing CI workflows to
   them triggers GitHub's PAT `workflow` scope guard
   (`refusing to allow a Personal Access Token to create or update
   workflow ... without 'workflow' scope`).

`mirror-subtree.yml@v0.4.2+` handles this automatically. No
consumer-side config needed.

### Rust: target/ + cargo publish dirty-tree check

`cargo publish` refuses to package if the working tree has
uncommitted changes. The publish workflow runs `cargo test` first,
which writes to `target/`. **Every Rust crate must have a
`.gitignore` ignoring `/target/`** AND must not have `target/`
files committed.

Canonical `.gitignore` for hop-top Rust crates:

```gitignore
# Build outputs
/target/
**/*.rs.bk
*.profraw
*.profdata

# Local workspace/editor noise
.DS_Store
.idea/
.vscode/

# Cargo.lock is a release input for this mirrored package.
!Cargo.lock
```

If `target/` is already tracked, untrack it:

```bash
git rm -r --cached <crate-dir>/target/
git commit -m "chore: untrack target/"
```

### Rust: feature-gated test files

cargo compiles **every file under `tests/`** unconditionally,
regardless of `[features]`. A test that imports a feature-gated
module fails to compile under default features.

If your test depends on an optional feature, gate the whole test
file:

```rust
#![cfg(feature = "api")]

use my_crate::api::Client;
// ...
```

This makes `cargo test` (default features) silently skip the file,
while `cargo test --features api` or `--all-features` runs it.

**Test under both modes** to match publish-side coverage:

```sh
cargo test --locked              # default features (what publish-rs runs)
cargo test --all-features --locked  # full coverage
```

### TS: native bindings + --ignore-scripts

`publish-ts.yml`'s default `test-command` uses
`--ignore-scripts` (supply-chain hygiene). Native-binding deps
(`better-sqlite3`, `node-canvas`, etc.) don't compile their bindings
under that flag. Tests that depend on those bindings fail with
`Could not locate the bindings file`.

Two options:

1. Exclude the affected tests from the publish run:

   ```yaml
   test-command: pnpm install --frozen-lockfile --ignore-scripts && pnpm vitest run --exclude src/sqlstore.test.ts
   ```

2. Drop `--ignore-scripts` (only if you trust the dep tree):

   ```yaml
   test-command: pnpm install --frozen-lockfile && pnpm test
   ```

### Go module proxy: ghost versions

`proxy.golang.org` is content-addressed and **immutable**. Once a
version slot is filled, it can never be republished. The proxy's
`@v/list` also caches version names even after the underlying git
tags are deleted (these become "ghosts" — listed but unresolvable).

If a Go module's previous incarnation polluted the proxy with ghost
versions (e.g. a repo restructure), the new release must use a
version **strictly greater** than every ghost so `@latest` resolves
correctly:

```sh
curl -s 'https://proxy.golang.org/<module>/@v/list' | sort -V
# Pick a next version above the highest ghost
```

Use a `Release-As: <next-base>-alpha.0` footer or manifest reseed
to jump the base.

### PHP: Packagist notify

PHP "publishing" is not publish-from-source — Packagist polls the
mirror repo for tags. The `publish-php` job runs **after** the
mirror push and POSTs to Packagist's `update-package` API to
trigger an immediate re-index (vs. waiting for the polling
interval, which can be ~hours). Without the notify step, the
mirror's new tag eventually surfaces on Packagist anyway, but the
workflow run completes green with no signal that anything is
pending — a silent-success failure mode that motivated PR
[#41](https://github.com/hop-top/.github/pull/41).

#### One-time setup per package

After the **first** mirror push lands on `<org>/<name>-php`, submit
the package at <https://packagist.org/packages/submit> with the
mirror repo URL. See [browser-playbooks.md](docs/browser-playbooks.md#packagist-submit-package).
This is a one-time operation — Packagist needs to know the package
exists before the API notify can re-index it.

#### Per-tag flow (automated)

```
tag push <name-php>/v<x.y.z>
  ↓ publish.yml fires
  ↓ parse → ecosystem=php → mirror runs → publish-php runs
  ↓ publish-php: POST https://packagist.org/api/update-package
  ↓                 ?username=…&apiToken=…
  ↓                 {"repository":{"url":"https://github.com/<org>/<name>-php"}}
  ↓ Packagist returns 202 + job id, queues re-index
  ↓ p2 metadata (composer-install path) updates within minutes
  ↓ legacy /packages/<vendor>/<pkg>.json (web UI) lags behind CDN — up to 12h
```

#### PHP requires the mirror

The `publish-php` job `needs: mirror`. If a caller sets
`enable-mirror: false` with `ecosystem: php`, `parse` fails early
with `::error::ecosystem=php requires enable-mirror=true (Packagist
notify depends on the mirror job)`. There is no "publish to
Packagist without the mirror" path — Packagist polls the mirror
slug, not the source.

#### Composer rejects `experimental.N` pre-release identifiers

PHP's Composer parser only accepts a fixed list of pre-release
stability identifiers: **`dev` | `alpha` | `beta` | `RC` |
`stable`**. A SemVer string like `0.4.0-experimental.1` parses
everywhere else (npm, cargo, Go module proxy, PyPI after
normalization) but **fails `composer install` with `Invalid version
string`**.

Use `0.4.0-alpha.N` for the prerelease counter in `composer.json`
(and the release-please manifest for the php package). The other
ecosystems can keep `experimental.N` if you prefer — but the php
package needs `alpha.N`. This bit T-0183; see commit
[`0b76224d`](https://github.com/hop-top/poly-kit/commit/0b76224d).

#### "Abandoned" flag is sticky and Packagist-side only

Packagist has a per-package `abandoned: bool` flag that's set via
the Packagist **web UI** (or undocumented authenticated API), NOT
via `composer.json`. The flag persists across `update-package`
notify calls — re-indexing the mirror tag will not clear it.

If a previous test/cleanup or accidental click marked the package
abandoned, unmark it in the browser at the package's edit page
(maintainer access required). The p2 metadata (`/p2/<vendor>/<pkg>.json`,
the install path) updates immediately on unmark; the legacy
`/packages/<vendor>/<pkg>.json` endpoint can lag the CDN's
`s-maxage=43200` (12h) cache.

#### Workflow internals (for debuggers)

- The `publish-php` job's `if:` uses `always() && needs.parse.outputs.ecosystem == 'php' && needs.mirror.result == 'success'`. The `always()` is required because the transitive needs include `publish-ts/publish-py/publish-rs` (via `mirror`), which are `skipped` for a php tag — without `always()`, GitHub Actions applies the implicit "skip downstream if any transitive need is non-success" rule and skips publish-php before evaluating the explicit conditions. Same pattern the `mirror` job uses. See PR [#43](https://github.com/hop-top/.github/pull/43).
- Credentials are URL-encoded with `jq @uri` and registered with `::add-mask::` before they appear in the `$url` variable — GH's auto-masking only matches the raw secret value, not its URL-encoded form (e.g. tokens containing `+`/`/`/`=`).

## Common pitfalls

Entries linked below to [docs/failure-modes.md](docs/failure-modes.md) have extended treatment there (workflow log symptoms, verification commands, escape hatches). The rest are summarized in this table only.

| Issue | Cause | Fix |
|---|---|---|
| Tag push doesn't trigger publish (silent) | 3-segment tag (e.g. `sdk/ts/v...`) — `*` in `tags: ['*/v*']` doesn't match `/` | Rename `component` in release-please-config.json so it's a single segment (`kit-ts`, not `sdk/ts`). See [Tag-shape glob trap](#tag-shape-glob-trap). |
| `Unknown component '<name>'` at publish parse step | `ecosystems` map key in `publish.yml` doesn't match the `component` in release-please-config.json | Make all three names match: release-please `component` == `ecosystems` key == mirror repo basename. See [Three-way name alignment](#three-way-name-alignment). |
| Tag push doesn't trigger publish (no error) | `release-please` used default `GITHUB_TOKEN`, which can't trigger downstream | Mint an App token via `actions/create-github-app-token@v1` against `RELEASE_BOT_APP_ID` + `RELEASE_BOT_PRIVATE_KEY`, pass to `token:` on the release-please action. See [Quick-start](#quick-start). |
| release-please run fails immediately: `Input required and not supplied: token` | `secrets.GH_RELEASE_PLEASE_PAT` reference resolves empty on a fresh repo (deprecated path) | Switch to the App-token pattern. The org-level `GH_RELEASE_PLEASE_PAT` secret has not proven reliably reachable for new repos; the `release-bot` App is the supported path. |
| Tag pushed before `publish.yml` existed → no publish run | Actions reads workflows from the tag's tree, not main | Force-update the tag to a commit containing `publish.yml`; see [failure-modes.md](docs/failure-modes.md#tag-pushed-before-the-publish-workflow-existed--no-publish-run) |
| release-please proposes stable when you wanted prerelease | Missing `versioning: "prerelease"` and/or manifest seed is stable | Add all four pieces of the prerelease combo. See [Prerelease channel](#prerelease-channel--the-four-piece-combo). |
| First release skips `alpha.0` and starts at `alpha.1` | `prerelease-type: "alpha"` instead of `"alpha.0"` | Use `"alpha.0"` so the counter has a starting digit |
| `feat:` from `0.0.0` jumps to `1.0.0` | release-please's "0.0.0 trap" — treats `0.0.0` as "no prior release" | Bootstrap with `Release-As: 0.1.0` footer on the first commit |
| Fixed `publish.yml` on main, retry still fails | `publish.yml` snapshots from the tag's commit; `gh run rerun` reuses the original workflow refs | Delete + recreate the tag at current main. See [Re-triggering a failed publish](#re-triggering-a-failed-publish). |
| Mirror push fails with `denied to github-actions[bot]` | `actions/checkout` planted an extraheader that overrides the PAT | The shared `mirror-subtree.yml` already sets `persist-credentials: false`. If you're customizing, ensure that's set. |
| Mirror push rejected: `workflow ... without 'workflow' scope` | Root component (`dir: "."`) push includes `.github/workflows/*` | Resolved at `mirror-subtree.yml@v0.4.2+` — `.github/workflows/` is stripped from root-component pushes. Pin to `@v0` or `@v1` rolling tag. |
| Mirror step fails: `fatal: . does not exist; use git subtree add` | Root-component (`dir: "."`) on `mirror-subtree.yml@v0.4.0` or older | Resolved at `mirror-subtree.yml@v0.4.1+`. Pin to `@v0` or `@v1` rolling tag. |
| `&&` in `test-command` produces pip/cargo arg-parsing errors | Resolved at `publish-{py,rs,ts}.yml@v0.4.3+` (was `run: $TEST_CMD`, now `run: bash -c "$TEST_CMD"`) | Pin to `@v0` or `@v1` rolling tag. |
| Build step fails with `ERR_PNPM_SPEC_NOT_SUPPORTED_BY_ANY_RESOLVER "&&"` | `run: $CMD` doesn't re-parse shell operators in env-var commands (tracked in [#9](https://github.com/hop-top/.github/issues/9)) | Move the pipeline into a package.json script (`ci:build`) so the workflow command is single-token. [Details](docs/failure-modes.md#err_pnpm_spec_not_supported_by_any_resolver-on-build-step) |
| pnpm install fails with `ERR_PNPM_IGNORED_BUILDS` | pnpm 11 `strictDepBuilds: true` default | Declare offending deps in `pnpm-workspace.yaml` `allowBuilds:` (NOT package.json — that's deprecated in pnpm 11). [Details](docs/failure-modes.md#pnpm-11-strictdepbuilds-blocks-install-on-transitive-postinstalls) |
| PyPI publish fails with `invalid-publisher` despite correct claims | Pending-publisher table drift, OR caller-vs-reusable workflow_ref confusion | Verify the **caller workflow filename** matches the trusted-publisher config (not the reusable's). If still failing, switch to `pypi-auth: token` as escape hatch. See [PyPI auth modes](#pypi-auth-modes) and [failure-modes.md](docs/failure-modes.md#pypi-oidc-invalid-publisher-despite-correct-looking-claims). |
| PyPI publish fails with `403 You're not allowed to upload to project '<name>'` | Bare PyPI name (e.g. `eva`, `uri`) is already owned by a third party | Prefix the install slug — rename `[project].name` to `hop-top-<name>` and update `package:` in `publish.yml`'s ecosystems block + `package-name` in `release-please-config.json`. Import name (`packages` in `[tool.hatch.build.targets.wheel]`) can stay clean. See [`py`: package naming](#py-package-naming-install-slug-vs-import-name). |
| `uv pip install -e .` fails with `references a workspace in tool.uv.sources but is not a workspace member` | `[tool.uv.sources]` key and/or `[dependency-groups].dev` entry references the old `[project].name` after renaming | Update `[tool.uv.sources].<name>` AND `[dependency-groups].dev` AND `[project.optional-dependencies].all` to match the new `[project].name`. All four point at the install slug, not the import name. See [`py`: package naming](#py-package-naming-install-slug-vs-import-name). |
| PyPI publish fails with `invalid-token-bad-audience` | OIDC trusted-publisher config doesn't match | Verify on PyPI: org name, repo name, workflow filename, environment name |
| PyPI version doesn't match git tag | PEP 440 normalization (`0.2.0-alpha.1` → `0.2.0a1`) | Cosmetic; pip accepts both forms in specs. [Details](docs/failure-modes.md#pypi-version-doesnt-match-git-tag-pep-440-normalization) |
| GitHub Environment binding fails | `pypi` environment doesn't exist on caller repo | `gh api -X PUT repos/<org>/<repo>/environments/pypi` |
| crates.io publish fails with `verified email required` | The CARGO_REGISTRY_TOKEN's account has no verified email | Verify email at <https://crates.io/settings/profile>, then re-issue the token |
| crates.io publish fails: `1 files in the working directory contain changes` | `cargo test` mutates `target/` and the crate has no `.gitignore`, or `target/` files are tracked | Add `.gitignore` ignoring `/target/` + `git rm -r --cached <crate>/target/`. See [Rust: target/](#rust-target--cargo-publish-dirty-tree-check). |
| Rust test fails: `unresolved import <crate>::<feature_module>` under default features | Test file under `tests/` depends on a feature-gated module; cargo compiles all test files unconditionally | Add `#![cfg(feature = "<name>")]` at the top of the test file. See [Rust: feature-gated test files](#rust-feature-gated-test-files). |
| TS test fails: `Could not locate the bindings file` | Native-binding dep needs build scripts that `--ignore-scripts` blocks | Either exclude the test or drop `--ignore-scripts`. See [TS: native bindings](#ts-native-bindings----ignore-scripts). |
| `go get <module>@latest` returns a pseudo-version after a real release | Ghost versions cached in proxy.golang.org from a prior incarnation outrank the new tag | Bump the next release to a version strictly greater than every ghost. See [Go module proxy: ghost versions](#go-module-proxy-ghost-versions). |
| Packagist returns 404 even after the mirror has a tag | First version requires manual one-time submit | Submit once at <https://packagist.org/packages/submit>; subsequent tags auto-notify via `publish-php`. See [PHP: Packagist notify](#php-packagist-notify). |
| PHP tag push runs green but Packagist shows no new version | `publish-php` job was `skipped` (pre-v0.9.1 of dotgithub: `if:` lacked `always()` and got short-circuited by GHA's transitive-needs rule) OR consumer `publish.yml` doesn't forward `PACKAGIST_USERNAME` / `PACKAGIST_TOKEN` | Bump `publish.yml` to `@v0` (rolling) — already fixed at `v0.9.1+`. Confirm the consumer `publish.yml` lists both secrets in its `secrets:` block. See [PHP: Packagist notify](#php-packagist-notify). |
| `composer install` fails: `Invalid version string "0.4.0-experimental.1"` | Composer's parser only accepts `dev`/`alpha`/`beta`/`RC`/`stable` as pre-release identifiers | Rename the php package's pre-release suffix to `alpha.N` (in `composer.json`, the release-please manifest, and `prerelease-type`). Other ecosystems can keep `experimental.N`. See [Composer rejects experimental.N](#composer-rejects-experimentaln-pre-release-identifiers). |
| Packagist still shows package as `"abandoned": true` after re-notify | The `abandoned` flag is Packagist-side, set via web UI; not in `composer.json`; not cleared by re-indexing | Unmark in the package's edit page on packagist.org (maintainer-only). p2 metadata reflects the change immediately; legacy `/packages/X.json` CDN can lag up to 12h. See [Abandoned flag](#abandoned-flag-is-sticky-and-packagist-side-only). |
| PHP tag publish fails at `parse`: `ecosystem=php requires enable-mirror=true` | Caller set `enable-mirror: false` for a php component, which would silently skip `publish-php` (it `needs: mirror`) | Set `enable-mirror: true` (default) for any caller that ships a php component. See [PHP requires the mirror](#php-requires-the-mirror). |
| Sibling release-please PRs go CONFLICTING after merging one | Shared manifest; merging A advances it, B's branch is stale | Close the conflicting PR + retrigger release-please via `workflow_dispatch`. See [Retriggering release-please](#retriggering-release-please-after-sibling-pr-conflicts). |
| release-please PR shows `mergeStateStatus: DIRTY` | Main moved between PR creation and merge attempt | Close PR + delete branch; release-please regenerates on next push. [Details](docs/failure-modes.md#release-please-pr-goes-dirty-after-main-moves) |
| Created `homebrew-<binary>` or `scoop-<binary>` tap/bucket repo per binary | Misread convention — taps are org-wide, not per-binary | Use `<org>/homebrew-tap` + `<org>/scoop-bucket` (single repos serving every org binary). Delete the per-binary tap/bucket; point goreleaser's `brews[].repository.name` at `homebrew-tap` and `scoops[].repository.name` at `scoop-bucket`. See [Org-wide tap/bucket convention](#org-wide-tapbucket-convention). |

## See also

- [`docs/bootstrap-checklist.md`](docs/bootstrap-checklist.md) — order
  of operations for a brand-new polyglot repo (org secrets, mirror
  repos, registry registration, env creation, first release)
- [`docs/failure-modes.md`](docs/failure-modes.md) — extended
  symptom→cause→fix guide; covers each entry in the Common Pitfalls
  table with workflow-log excerpts, root-cause analysis, and what
  does NOT work
- [`docs/browser-playbooks.md`](docs/browser-playbooks.md) — verbal
  step-by-step walkthroughs for web-side setup (PyPI trusted
  publisher, PyPI API token mint, Packagist registration, GitHub
  Environment creation, crates.io email verification). Each playbook
  includes an `ibr`-style prompt you can drive with an authenticated
  browser session.
- [`docs/architecture.md`](docs/architecture.md) — full control/data
  flow diagrams + design rationale
- `custom-release-please` skill (separate) — the consumer-side
  release-please configuration concerns (three-key prerelease combo,
  channel transitions, Release-As footers)
