# Keep a monorepo Release-free (Releases only on mirrors)

Suppress GitHub Releases on a polyglot monorepo so the user-facing
Releases live only on the per-language mirror repos — without breaking
release-please's tagging.

## Use this when

- Your monorepo's release feed interleaves every language's history
  and you want it empty, with Releases only on `<org>/<name>-<lang>`
  mirrors.
- You set `skip-github-release: true` and releases stopped tagging,
  with every release-please run aborting:
  `There are untagged, merged release PRs outstanding`.

## Result

`skip-github-release: true` stays on every package. Tags still land on
release-PR merge (so `publish-on-tag` and `mirror-subtree` still fire —
mirror Releases are created by `mirror-subtree` **on tag push**), and
release-please keeps working.

## Why the companion is needed

release-please creates tags **only as part of creating a GitHub
Release** ([release-please#1561](https://github.com/googleapis/release-please/issues/1561);
tag-only mode is an unimplemented feature request,
[release-please-action#1034](https://github.com/googleapis/release-please-action/issues/1034)).
With Releases skipped it creates neither tag nor label flip, so the
merged release PR stays on the pending label and every subsequent run
aborts. `skip-github-release` alone therefore breaks the exact thing
it's usually adopted for: no tag means no mirror Release either.

## Steps

### 1. Skip Releases in `release-please-config.json`

```json
"packages": {
  "go": { "release-type": "go", "component": "cite", "skip-github-release": true },
  ...
}
```

### 2. Add the companion caller

`.github/workflows/release-tag.yml`:

```yaml
name: release-tag

on:
  pull_request:
    types: [closed]

permissions:
  contents: read

jobs:
  tag:
    if: >
      github.event.pull_request.merged == true &&
      startsWith(github.event.pull_request.head.ref, 'release-please--branches--')
    uses: hop-top/.github/.github/workflows/release-tag-on-merge.yml@v0
    secrets:
      RELEASE_BOT_APP_ID: ${{ secrets.RELEASE_BOT_APP_ID }}
      RELEASE_BOT_PRIVATE_KEY: ${{ secrets.RELEASE_BOT_PRIVATE_KEY }}
```

On merge of a release-please PR it derives the component from the head
branch and the version from the manifest **at the merge commit** (never
the PR title), pushes `<component><tag-separator>v<version>`, and flips
the PR label from `label` to `release-label` (both read from your
config).

### 3. Nothing else

`publish-on-tag` and `mirror-subtree` trigger from the tag push exactly
as before.

## Gotchas

- **The tag must not come from `GITHUB_TOKEN`.** Events created with
  the workflow's own token don't trigger workflows — the tag would land
  but publish/mirror would silently never run. The reusable workflow
  mints a release-bot App token for this reason.
- **Requires `separate-pull-requests: true`** (the org default). The
  component is derived from the release-please branch name; combined
  release PRs have no `--components--` segment and fail loudly.
- **Umbrella root packages are handled.** The companion tags them like
  any component; `publish-on-tag` skips components with no `ecosystems:`
  entry via a `::notice::` (green run, all publish jobs `skipped`) — no
  tag-exclusion needed.
- **Safe without the skips too.** Tag creation is idempotent, so in a
  repo where release-please still creates Releases the companion simply
  loses the race.
- **The merge-push release-please run races the companion.** Merging a
  release PR triggers release-please at the same moment the companion is
  tagging. Usually that run just aborts (harmless — the next run is
  clean), but if the label flips mid-run it can emit a **spurious
  release PR** proposing a bogus version (observed: an umbrella downgrade
  re-listing released history). Close it; a fresh run will not
  regenerate it.
- **Recovering a release merged before the companion existed**: push
  the tag by hand at the merge commit, then flip the release PR's label
  to your `release-label` — release-please tracks release state by
  label, not by the git tag.
