# Quick-start

Wire a hop-top repo's release pipeline into `hop-top/.github` in two files.

## Use this when

- You're setting up a brand-new polyglot repo.
- You're copying the pattern from another hop-top repo.
- You want the shortest correct path before reading the deeper docs.

## Before you begin

You need:

- Org-level secrets provisioned. See [secrets.md](secrets.md).
- Read-only mirror repos created, one per shipping language (`<org>/<basename>-ts`, `-py`, `-rs`, `-php`; bare `<org>/<basename>` for Go).
- The `release-bot` GitHub App installed on the source repo.

## Result

After this guide, you have:

- `release-please.yml` that opens a standing release PR on each merge to main.
- `publish.yml` that fires on `<component>/v<version>` tag pushes, publishing to the appropriate language registry and pushing the read-only mirror.

## Quick version

Two workflow files. Drop them into `.github/workflows/`.

## Steps

### 1. Add `release-please.yml`

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

### 2. Add `publish.yml`

```yaml
name: publish

on:
  push:
    tags: ['*/v*']
  # Manual trigger: re-run a publish for an existing tag without re-pushing.
  # Caveat — `workflow_dispatch` replays against the workflow file at the
  # tag's commit, not main HEAD. See `how-to/retrigger-failed-publish.md`.
  workflow_dispatch: {}

jobs:
  publish:
    permissions:
      contents: read
      id-token: write  # required for PyPI OIDC trusted publishing
    uses: hop-top/.github/.github/workflows/publish-on-tag.yml@v0
    secrets:
      NPM_REGISTRY_TOKEN: ${{ secrets.NPM_REGISTRY_TOKEN }}  # fallback; prefer npm trusted publishing (how-to/npm-trusted-publishing.md)
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

### 3. Add release-please config + manifest

Standard release-please files at `.github/release-please-config.json`
and `.github/.release-please-manifest.json`. See [bootstrap-checklist.md](../docs/bootstrap-checklist.md)
for the recommended shape.

On single-component repos, set
`"pull-request-title-pattern": "chore(release): ${component} ${version}"`
in the config — without it release-please defaults to `chore: release main`.

### 4. Verify

Push a `<component>/v<version>` tag and watch `publish.yml`:

```bash
gh run list --workflow publish.yml --limit 1
```

The run's `parse` job should resolve the tag, then the
matching publish job (e.g. `publish-ts` for a `ts` tag) should run,
then `mirror` pushes the read-only mirror. For php, the chain ends
with `publish-php` notifying Packagist.

## Common issues

| Problem | Cause | Fix |
|---|---|---|
| Tag pushed but no workflow run | Tag shape doesn't match `*/v*` (3-segment component) | Rename component to single segment. See [SKILL.md § Tag-shape glob trap](../SKILL.md#tag-shape-glob-trap). |
| `Unknown component '<name>'` at parse | Mismatch between release-please `component`, `ecosystems` key, and mirror basename | Align all three. See [SKILL.md § Three-way name alignment](../SKILL.md#three-way-name-alignment). |
| Anything else | — | See [troubleshooting/common-pitfalls.md](troubleshooting/common-pitfalls.md) |

## Next steps

- [Add a preflight check](how-to/add-preflight.md) — catches misconfigurations at PR time instead of tag-push time.
- [Bootstrap checklist](../docs/bootstrap-checklist.md) — full first-time setup including registry pre-registration.
- [Single-language repos](how-to/single-language-repo.md) — when the polyglot pattern doesn't fit.
