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

A caller of the shared `release-please-on-push.yml` reusable workflow
(`kit init` renders this file):

```yaml
name: release-please

on:
  push:
    branches: [main]
  workflow_dispatch: {}

permissions:
  contents: read

jobs:
  release-please:
    uses: hop-top/.github/.github/workflows/release-please-on-push.yml@v0
    secrets:
      RELEASE_BOT_APP_ID: ${{ secrets.RELEASE_BOT_APP_ID }}
      RELEASE_BOT_PRIVATE_KEY: ${{ secrets.RELEASE_BOT_PRIVATE_KEY }}
```

The reusable workflow:

- mints a short-lived token from the hop-top release-bot GitHub App,
  so release PRs are opened by `release-bot[bot]` rather than the
  human owner — they trigger downstream workflows, and sidestep the
  CODEOWNERS self-approval block on `.release-please-manifest.json`;
- runs one release-please job per branch at a time, newest push wins.
  A run that started before a release PR merged and finished after it
  would otherwise re-open a release PR for the version just tagged;
- fails with the path named when the config or manifest is missing or
  malformed; with neither file present it warns and skips, so a repo
  can carry the caller before it adopts release-please.

Inputs, all optional:

| Input | Default | Use when |
|---|---|---|
| `config-file` | `.github/release-please-config.json` | the config lives elsewhere |
| `manifest-file` | `.github/.release-please-manifest.json` | the manifest lives elsewhere |
| `target-branch` | the branch that triggered the run | release PRs should target a fixed branch |

Outputs keep `googleapis/release-please-action`'s names
(`releases_created`, `release_created`, `tag_name`, `version`, `prs_created`,
`paths_released`, ...), plus `json` — every output of the action,
including the per-package `<path>--release_created` / `<path>--tag_name`
ones. Chain a publish job in the caller:

```yaml
  publish:
    needs: release-please
    if: needs.release-please.outputs.releases_created == 'true'
    # per package: fromJSON(needs.release-please.outputs.json)['ts--release_created'] == 'true'
```

Releasing from several integration branches (e.g. `main` and `next`)?
List them under `push.branches`; each run targets its own branch.

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
