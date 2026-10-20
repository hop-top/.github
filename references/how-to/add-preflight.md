# Add the release-please preflight check

Catch misconfigurations at PR time instead of tag-push time.

## Use this when

- You're setting up a fresh repo.
- You're about to do your first release.
- A previous release failed because of a config drift.

## Result

A workflow that fails PRs touching `release-please-config.json`,
`.release-please-manifest.json`, `release-please.yml`, `publish.yml`,
or per-language manifests if any of the
[bootstrap checks](../../docs/bootstrap-checklist.md) would fail.

## Quick version

Add this workflow file. No inputs required — it auto-infers from
your config.

## Steps

### 1. Add `.github/workflows/release-please-preflight.yml`

```yaml
name: release-please-preflight

on:
  pull_request:
    paths:
      - '.github/release-please-config.json'
      - '.github/.release-please-manifest.json'
      - '.github/workflows/release-please.yml'
      - '.github/workflows/publish.yml'
      # Single-language repo: root-level manifests. Polyglot monorepo:
      # per-directory manifests for EVERY language you ship, e.g.
      #   go/go.mod  ts/package.json  py/pyproject.toml  rs/Cargo.toml  php/composer.json
      - 'pyproject.toml'
      - 'package.json'
      - 'Cargo.toml'
      - 'go.mod'
      - 'composer.json'
  workflow_dispatch: {}

jobs:
  preflight:
    permissions:
      contents: read  # annotations + step summary need nothing more
    uses: hop-top/.github/.github/workflows/release-please-preflight.yml@v0
```

### 2. Verify it runs

Open a PR touching any of the configured paths. The
`release-please-preflight` check should appear in the PR status
list.

## What it checks

Auto-infers from your config — no inputs required:

- All four required files exist (config, manifest, both workflows). `publish.yml` may be absent when the config has a single package, or when every package resolves to `release-type: go` (a [Go-only repo](single-language-repo.md#go-only-what-you-still-need), multi-module included); the `publish.yml` checks below are then skipped
- `release-please-config.json` parses + has `packages`
- Every component is single-segment (the tag-shape glob trap); a Go-only repo may use a nested directory path, since it has no `publish.yml` glob and nested Go modules need `<dir/path>/vX.Y.Z` tags
- Prerelease packages have the [four-piece combo](prerelease-channel.md), with `versioning` either `prerelease` or `target`
- [Target versioning](target-versioning.md), when any package uses `versioning: "target"`: the `target-context` plugin is present and listed before every `conditional-linked-versions`; its branch-role options are well-typed and no branch has two roles; every group has a name and a non-empty component list of configured `target` components, no component sits in two groups or in a stock `linked-versions` group; `prerelease-type` is exactly `alpha.0`; records are well-formed and sit on `target` packages only, and on a prerelease branch (the PR's base, or the pushed branch, in `target-context`'s `prereleaseBranches`, default `next`) an `x-channel` record names the package's current target (from the manifest) and its current or next channel (`alpha` → `beta` → `rc`), an `x-open-line` record a line not reached yet (on other branches the records are inert: an `[INFO]` line says so); no `release-as`; no `bump-minor-pre-major: false` / `bump-patch-for-minor-pre-major: true`; `release-please.yml` calls `release-please-on-push` with `versioning-extension: true`
- Manifest seed shape matches prerelease declaration (a `target` package takes either shape: its branch decides)
- [SemVer ∩ PEP 440 intersection](../concepts/version-strings.md): Python packages don't have an `extra-files` override on `pyproject.toml` (the trap that bypasses PEP 440 normalization), and `pyproject.toml`'s current version is PEP 440-shaped (not SemVer-shaped)
- Spec packages: every package whose path is `<root>/vX.Y` exists as a directory, has a manifest key (a hard failure — the [version-check guard](spec-versioning.md) reads that key), and uses `release-type: simple` (warning otherwise)
- `extra-files` targets: every entry (a string, or an object with `path`), joined with its package path, names an existing file, and is checked by the rule of the updater release-please picks for it:
  - `type: json` / `yaml` / `toml`: the `jsonpath` reaches the value (json: a version string, yaml: a string). No `jsonpath`, or a JSON file that does not parse, fails (release-please's run would); a path that matches nothing is a warning. Paths beyond `$.a.b` / `['a']` / `[n]` are not evaluated (an `[INFO]` line says so)
  - `type: xml` needs an `xpath`; `xml` and `pom` are checked for existence only
  - a string entry ending in `.json` / `.yaml` / `.yml` / `.toml` / `.xml` passes with a version at `$.version` (`/*/version`) or an annotation; a `.json` one that does not parse fails
  - `type: generic` and any other string entry: a target without an `x-release-please-<scope>` annotation (inline, or a `x-release-please-start-<scope>` block) is warned about (the guard fails it)
  - any other `type`, or none, fails; a `glob` entry is reported, its matches are not checked
  - `pyproject.toml` entries stay with the PEP 440 check above
- `publish.yml` triggers on `*/v*` and delegates to `publish-on-tag.yml`
- Three-way name alignment holds
- `release-please.yml` uses the release-bot App token (not the deprecated PAT) and declares `workflow_dispatch`
- Per-ecosystem infrastructure: GitHub Environment exists (for PyPI OIDC), mirror repo exists (if configured), PyPI/npm package-name availability (informational)

## Optional overrides

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

## When to use

- **Always** for repos using this skill's release pipeline. The preflight catches every checklist item from the [Bootstrap checklist](../../docs/bootstrap-checklist.md) at PR time instead of at tag-push time (when failures are much costlier — see [Re-trigger a failed publish](retrigger-failed-publish.md)).
- **Especially** for fresh repos doing their first release. The per-ecosystem infrastructure checks (Environment exists, mirror repo exists) prevent the most common bootstrap failures.

## Next steps

- [Bootstrap checklist](../../docs/bootstrap-checklist.md) — full first-time setup.
- [troubleshooting/common-pitfalls.md](../troubleshooting/common-pitfalls.md).
