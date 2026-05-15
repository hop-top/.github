# Consuming hop-top/.github workflows

How to wire up a hop-top repo to use the shared publish/mirror
workflows. The version + tag side of the release is owned by
release-please (consumer-side config); this repo runs *after* the tag.

## Release model (single path)

```
commits to main
   ↓
release-please opens standing PR (versioned by config)
   ↓
merge → release-please creates tag <component>/v<version>
   ↓
tag push triggers consumer publish.yml
   ↓
publish.yml calls hop-top/.github/.github/workflows/publish-on-tag.yml@main
   ↓
router dispatches to publish-{ts,py,rs}.yml + mirror-subtree.yml
   ↓
published to registry + pushed to mirror
```

**Prereleases AND stable cuts both flow through this path.** Whether a
tag is `ts/v0.2.0-alpha.1` (prerelease) or `ts/v1.0.0` (stable) makes
no difference to dotgithub — it parses the version string and publishes
it. The shape of the version (suffix vs no-suffix, counter increments)
is determined by release-please's config on the consumer side. See the
`custom-release-please` skill for the three-key prerelease setup.

## Secrets reference

All secret names follow the convention
`<NAMESPACE>_<PURPOSE>_<TYPE>`. See your local
[`custom-release-please/references/naming-convention.md`](https://github.com/jadb/dotfiles/blob/main/.agents/skills/custom-release-please/references/naming-convention.md)
for the full rule.

The shared workflows expect **exact** names. There are no fallback
chains or aliases. Consuming repos must either:

1. Create org/repo secrets with the canonical names, OR
2. Explicitly map at the call site (`CANONICAL: ${{ secrets.YOUR_NAME }}`)

### Secrets the shared workflows expect

| Secret | Required by | Scope | Notes |
|---|---|---|---|
| `GH_MIRROR_PAT` | `mirror-subtree` (always) | Org | Fine-grained PAT with `Administration: RW` + `Contents: RW` on every mirror repo. See `setup/gh-mirror-pat.md` in the skill. |
| `GH_RELEASE_PLEASE_PAT` | release-please job | Repo | Fine-grained PAT with `Contents: RW` + `Pull Requests: RW` + `Workflows: RW` on the source repo only. **Default `GITHUB_TOKEN` doesn't work** — its PRs don't trigger downstream workflows. |
| `NPM_REGISTRY_TOKEN` | `publish-ts` (if shipping TS) | Org | npm Granular Access Token with publish on your scope. |
| `CARGO_REGISTRY_TOKEN` | `publish-rs` (if shipping Rust) | Org | crates.io API token. Account must have a verified email. |

### Secrets the shared workflows DO NOT need

| What | Why not |
|---|---|
| **PyPI token** | `publish-py` uses [PyPI trusted publishing](https://docs.pypi.org/trusted-publishers/) (OIDC). Configure on PyPI's side bound to your repo + `pypi-environment` (default: `pypi`). |
| **Packagist token** | Packagist auto-syncs from public GitHub via webhook. |
| **Go module token** | proxy.golang.org pulls from git tags. |

### Env vars exported inside workflow steps

These are set by the workflows themselves. Documented here so you
know what's available if you customize `test-command` or
`build-command`:

| Env var | Set in | From | Available to |
|---|---|---|---|
| `NODE_AUTH_TOKEN` | `publish-ts` publish step | `secrets.NPM_REGISTRY_TOKEN` | npm CLI (`pnpm publish` reads this) |
| `CARGO_REGISTRY_TOKEN` | `publish-rs` publish step | `secrets.CARGO_REGISTRY_TOKEN` | cargo |
| `GH_TOKEN` | `mirror-subtree` all steps | `secrets.GH_MIRROR_PAT` | `gh` CLI + `git push` URL |
| `TEST_CMD` | `publish-ts`, `publish-py`, `publish-rs` test step | `inputs.test-command` or built-in default | your test command |
| `BUILD_CMD` | `publish-ts`, `publish-py` build step | `inputs.build-command` or built-in default | your build command |
| `id-token: write` permission | `publish-py` job-level | _(no value — it's a permission)_ | OIDC token request for PyPI |

### Aliasing legacy secret names

If your org has legacy secret names (e.g. `MIRROR_PAT` from a prior
convention), DO NOT rename them in CI configs via fallback chains.
Instead, **create a new secret with the canonical name** by reusing
the underlying PAT value, then remove the legacy secret.

The shared workflows accept ONE name only. No fallback. If
`GH_MIRROR_PAT` isn't set, the mirror job fails — visibly and
immediately.

### Scoping: org vs repo vs environment

- **Org secrets**: tokens used across multiple repos. `GH_MIRROR_PAT`,
  `NPM_REGISTRY_TOKEN`, `CARGO_REGISTRY_TOKEN`.
- **Repo secrets**: tokens specific to one repo. `GH_RELEASE_PLEASE_PAT`
  must be repo-scoped (its PAT permissions are repo-specific).
- **Environment secrets**: high-stakes scoping with optional manual
  approval. Currently used only for `pypi` environment (no secret,
  just OIDC binding).
- **GITHUB_TOKEN** (auto): not used by the shared workflows. Doesn't
  trigger downstream, hence why release-please needs its own PAT.

## Tag-push publish workflow

```yaml
# .github/workflows/publish.yml
name: publish
on:
  push:
    tags: ['*/v*']

jobs:
  publish:
    uses: hop-top/.github/.github/workflows/publish-on-tag.yml@main
    secrets: inherit
    with:
      homepage: https://hop.top/uri
      description-prefix: "READ-ONLY MIRROR"
      ecosystems: |
        ts:  { dir: ts,  ecosystem: ts,  package: "@hop-top/uri", mirror: hop-top/uri-ts }
        py:  { dir: py,  ecosystem: py,  package: hop-top-uri,    mirror: hop-top/uri-py }
        rs:  { dir: rs,  ecosystem: rs,  package: hop-top-uri,    mirror: hop-top/uri-rs }
        php: { dir: php, ecosystem: php, package: hop-top/uri,    mirror: hop-top/uri-php }
        go:  { dir: go,  ecosystem: go,                           mirror: hop-top/uri }
```

`ecosystems` is a YAML map. Each key is the **component name** that
appears in tag prefixes. Each value:

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

## release-please workflow

```yaml
# .github/workflows/release-please.yml
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

That's the whole release-please workflow. No publish jobs here — they fire
on tag push from the other workflow.

## release-please config

For the **hybrid model** (release-please = stable only, prereleases manual):

```json
{
  "$schema": "https://raw.githubusercontent.com/googleapis/release-please/main/schemas/config.json",
  "separate-pull-requests": true,
  "pull-request-title-pattern": "chore(release):${component} ${version}",
  "include-component-in-tag": true,
  "tag-separator": "/",
  "packages": {
    "ts": {
      "release-type": "node",
      "component": "ts",
      "changelog-path": "CHANGELOG.md",
      "bump-minor-pre-major": true
    },
    "py": { "release-type": "python", "component": "py", "bump-minor-pre-major": true },
    "rs": { "release-type": "rust",   "component": "rs", "bump-minor-pre-major": true },
    "php": { "release-type": "php",   "component": "php", "bump-minor-pre-major": true },
    "go": { "release-type": "go",     "component": "go", "bump-minor-pre-major": true }
  }
}
```

**No `prerelease: true`, no `prerelease-type`.** Those keys make
release-please try to manage prereleases — which is what we're routing
around with the manual script.

## Cutting a prerelease

```sh
# from repo root
~/.w/ideacrafterslabs/dotgithub/.github/scripts/tag-prerelease.sh ts alpha
git push && git push --tags
```

The script:
1. Reads current version from `ts/package.json` (or equivalent for the
   ecosystem)
2. Computes next: `0.2.0` → `0.3.0-alpha.0`, or `0.3.0-alpha.0` →
   `0.3.0-alpha.1`, or alpha→beta/rc transitions
3. Writes new version, commits `chore(release): ts vX.Y.Z-N`, tags
   `ts/vX.Y.Z-N`

After `git push --tags`, `publish-on-tag.yml` fires:
- Runs `publish-ts` (test → build → publish to npm)
- Runs `mirror-subtree` (split + push to `hop-top/uri-ts`)

## Cutting a stable release

1. Make sure release-please's standing PR (`chore(release): ts X.Y.Z`)
   has accumulated the commits you want
2. Merge it
3. release-please tags `ts/vX.Y.Z`
4. Tag push fires `publish-on-tag.yml` — same path as prerelease

## Channel transitions

| From | To | Command |
|---|---|---|
| stable | alpha | `tag-prerelease.sh ts alpha` (bumps minor, adds `-alpha.0`) |
| alpha.N | alpha.N+1 | `tag-prerelease.sh ts alpha` |
| alpha.N | beta.0 | `tag-prerelease.sh ts beta` |
| beta.N | beta.N+1 | `tag-prerelease.sh ts beta` |
| beta.N | rc.0 | `tag-prerelease.sh ts rc` |
| rc.N | rc.N+1 | `tag-prerelease.sh ts rc` |
| rc.N | stable | merge release-please's PR (don't use the script) |

## Pinning

Pin to a major tag in your `uses:` line:

```yaml
uses: hop-top/.github/.github/workflows/publish-on-tag.yml@v1
```

`v1`, `v2` etc. are major tags on this repo. Breaking changes bump the
major. Patch and minor fixes flow into the same major tag automatically.

`main` is the working branch — pin to it only if you're actively iterating
on the shared workflows.
