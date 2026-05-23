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

### 2. Verify it runs

Open a PR touching any of the configured paths. The
`release-please-preflight` check should appear in the PR status
list.

## What it checks

Auto-infers from your config — no inputs required:

- All four required files exist (config, manifest, both workflows)
- `release-please-config.json` parses + has `packages`
- Every component is single-segment (the tag-shape glob trap)
- Prerelease packages have the [four-piece combo](prerelease-channel.md)
- Manifest seed shape matches prerelease declaration
- [SemVer ∩ PEP 440 intersection](../concepts/version-strings.md): Python packages don't have an `extra-files` override on `pyproject.toml` (the trap that bypasses PEP 440 normalization), and `pyproject.toml`'s current version is PEP 440-shaped (not SemVer-shaped)
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
