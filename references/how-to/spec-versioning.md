# Version a spec tree

Keep a spec's version directories, `**Status:**` lines and
release-version literals in lockstep with release-please, checked on
every pull request by three reusable workflows from this repo.

## Use this when

- Your repo is a spec repo (`specs/v0.1/`, `specs/v0.2/`, …) that release-please ships as one `simple` package per version line.
- A product repo carries an in-repo spec tree (`spec/v1.0/`) next to its language ports.
- A release-version literal (a `version.ts` constant, an exact-pin example in a README) drifted after a release and you want the next such drift to fail a PR.
- A spec document still says `**Status:** Draft` after the rc shipped.
- You copy-pasted these checks into your repo and want the shared ones instead.

## Before you begin

- release-please is wired per [Quick-start](../quick-start.md): config and manifest under `.github/`, `release-please.yml` minting the release-bot App token and declaring `workflow_dispatch: {}`.
- The org secrets `RELEASE_BOT_APP_ID` and `RELEASE_BOT_PRIVATE_KEY` reach the repo ([secrets.md](../secrets.md)).
- The `status:release-pending` label exists on the repo ([bootstrap checklist § 5b](../../docs/bootstrap-checklist.md#5b-create-required-repo-labels)).

## Result

Three workflows, pinned `@v0`, run against your tree:

| Workflow | Fires on | Enforces |
|---|---|---|
| `spec-commit-rules` | pull requests touching the spec root | every commit stays inside one `<root>/vX.Y/` directory; no breaking-change syntax on a spec commit |
| `spec-status-line` | release-please PRs carrying the release label | `**Status:**` lines rewritten from the channel and pushed to the PR branch |
| `version-check` | every push to `main` and every pull request | annotated literals equal the manifest; annotated files and `extra-files` are one set; no stray version literal; every `<root>/vX.Y` path is a manifest version; no forbidden pattern |

Plus the [release-please preflight](add-preflight.md), which rejects a
spec package with no directory or no manifest key, and an
`extra-files` entry that points at no file.

## The rules

- **A spec version directory is the released major.minor line**: `<root>/vX.Y/`, where `<root>` is `specs` (a spec repo) or `spec` (a product repo with an in-repo spec tree) and `X.Y` is the line release-please ships for that package. The release-please package path *is* the directory (`"specs/v0.1": { "release-type": "simple", … }`); the workflows derive the spec roots from that shape and assume nothing else.
- **A commit stays inside one version directory.** The one admitted shape across two directories is a whole-directory rename: every path under `<root>/vA.B/` reappears at the same relative path under one other `<root>/vC.D/` and nothing is left behind. A breaking change opens a new directory; nothing bumps within one — no `!`, no `BREAKING CHANGE:` trailer on a spec commit.
- **Every spec document carries a `**Status:**` line** (bold, exactly that spelling) in its first fifteen lines. Automation writes it from the version's channel: alpha → Draft, beta → Pre-release, rc → Release Candidate, unsuffixed → General Availability. Hands never edit it.
- **Every release-version literal outside the files release-please rewrites natively** (the manifest, changelogs, the strategy's own version file) sits on a line annotated `x-release-please-version`, and its file is an `extra-files` entry of its package. Never `pyproject.toml`: the python strategy owns that file and an `extra-files` entry there bypasses PEP 440 normalization — [version-strings.md § Don't break the normalization](../concepts/version-strings.md#dont-break-the-normalization). A version typed anywhere else is a defect.
- **Every `<root>/vX.Y/` path in the tree names a version the manifest knows.**

## Quick version

Three caller files in `.github/workflows/`, copied from the steps
below; the two App secrets mapped in the status-line caller; one
`**Status:**` line per spec document; annotation plus `extra-files`
for every other version literal. Open a PR touching the spec root and
watch the checks.

## Steps

### 1. Declare the spec package

The version directory is a release-please package of its own. One
package per shipped line; the manifest seed is prerelease-shaped when
the package is prerelease (the first release is then `alpha.1` — see
[prerelease-channel.md](prerelease-channel.md)).

```jsonc
// .github/release-please-config.json
{
  "separate-pull-requests": true,
  "pull-request-title-pattern": "chore(release): ${component} ${version}",
  "include-component-in-tag": true,
  "tag-separator": "/",
  "label": "status:release-pending",
  "release-label": "status:release-tagged",
  "packages": {
    "specs/v0.1": {
      "release-type": "simple",
      "component": "myspec-v0.1",
      "prerelease": true,
      "prerelease-type": "alpha.0",
      "versioning": "prerelease",
      "bump-minor-pre-major": true
    }
  }
}
```

```json
// .github/.release-please-manifest.json
{ "specs/v0.1": "0.1.0-alpha.0" }
```

The title pattern matters: `spec-status-line` parses
`chore(release): <component> <version>` and exits with an error on
any other title.

### 2. Add `spec-commit-rules.yml`

```yaml
name: spec-commit-rules
on:
  pull_request:
    paths: ["specs/**"]        # the spec root: specs/ or spec/
permissions:
  contents: read
jobs:
  rules:
    uses: hop-top/.github/.github/workflows/spec-commit-rules.yml@v0
```

The `paths:` filter keeps it off PRs that never touch the spec; the
workflow itself fails (exit 2) when called on anything but a
`pull_request` event or from a config with no spec package — a wiring
error, never "nothing to validate".

### 3. Add `spec-status-line.yml`

```yaml
name: spec-status-line
on:
  pull_request:
    types: [labeled, opened, synchronize]
permissions:
  contents: read
jobs:
  status-line:
    uses: hop-top/.github/.github/workflows/spec-status-line.yml@v0
    secrets:
      RELEASE_BOT_APP_ID: ${{ secrets.RELEASE_BOT_APP_ID }}
      RELEASE_BOT_PRIVATE_KEY: ${{ secrets.RELEASE_BOT_PRIVATE_KEY }}
```

The job runs only when the PR carries the release label
(`status:release-pending` by default; override `release-label` if
your config uses another). It mints the App token, rewrites the
status lines under the PR title's package and pushes the commit to
the PR branch; a release PR for a component whose package is not a
spec directory is a `::notice::` no-op. `GITHUB_TOKEN` stays
read-only — the push is the App's.

Every spec document needs the bold form in its first fifteen lines:

```markdown
**Status:** Draft
```

A plain `Status: Draft` is not managed and stays wrong forever.

### 4. Add `version-check.yml`

```yaml
name: version-check
on:
  push:
    branches: [main]
  pull_request:
permissions:
  contents: read
jobs:
  guard:
    uses: hop-top/.github/.github/workflows/version-check.yml@v0
```

With inputs, one glob or regex per line, blank lines ignored:

```yaml
    with:
      forbid-literal: |
        vstar-(go|ts|py|rs|php) v\d
      allow: |
        docs/examples/*
```

`allow` skips tracked paths for the literal, spec-path and forbidden
rules (`*` crosses `/`); it is for a file that must pin a third-party
prerelease — say why in the caller. `forbid-literal` names shapes your
own code must never spell, such as a product identifier carrying a
library version. Both default to empty.

### 5. Annotate the literals release-please must rewrite

For every release-version literal outside the natively rewritten
files, two things, always together:

```jsonc
// release-please-config.json — the file is an extra-files entry of
// the package whose version it carries; paths are package-relative
"ts": {
  "release-type": "node",
  "extra-files": ["src/version.ts"]     // package.json stays native
}
```

```ts
// ts/src/version.ts — the literal's line carries the annotation
export const VERSION = "1.0.0-alpha.3"; // x-release-please-version
```

The generic updater rewrites the first version on an annotated line
and nothing else, so one version literal per annotated line. Never
list `pyproject.toml`; the preflight rejects it for a python package.
Full reasoning: [version-strings.md § Where `extra-files` is right](../concepts/version-strings.md#where-extra-files-is-right).

### 6. Add the preflight and retire local copies

- Add the [preflight caller](add-preflight.md) if the repo has none; its path filter already covers the config, the manifest and `release-please.yml`.
- Make `release-please.yml` mint the App token (`actions/create-github-app-token@v3` from `RELEASE_BOT_APP_ID` / `RELEASE_BOT_PRIVATE_KEY`) and declare `workflow_dispatch: {}`; drop any `GH_RELEASE_PLEASE_PAT` use — the preflight fails it.
- Delete in-repo copies of the validator, the status-line script and the guard, with their tests and CI jobs. The shared workflows are the only copy; a local one drifts.
- Update prose that named the deleted paths.

### 7. Verify

Run the guard locally once, from a clone of this repo at the pin
your callers use:

```sh
cache="${XDG_CACHE_HOME:-$HOME/.cache}/hop-top-dotgithub"
git clone --quiet --depth 1 --branch v0 https://github.com/hop-top/.github "$cache"
python3 "$cache/scripts/spec/version_check.py" --root .
# version-check: ok (<n> annotated, <m> files scanned)
```

Then open the PR:

- `version-check` runs on the PR; `spec-commit-rules` runs if the PR touches the spec root; `spec-status-line` is skipped by its label gate.
- Each run's log carries `Shared tooling: hop-top/.github@<sha>` — the commit of this repo the Python ran from.
- The status line is proven on the next labelled release PR: its `synchronize` event after the bot's push finds nothing left to patch.

## What it checks

### spec-commit-rules

For every commit in the PR's `base..head`:

- **A** — the commit touches files under at most one `<root>/vX.Y/`, unless it is a whole-directory rename (the old directory is gone, every path reappears at the same relative path under one other directory). Files may be edited on the way; a partial move or a reshuffle counts both versions and fails.
- **B** — a commit touching `<root>/vX.Y/` carries neither `!` in its header nor a `BREAKING CHANGE:` trailer.

Exit 0 clean, 1 on a violation, 2 on bad input (no spec package in the config, missing SHAs).

### spec-status-line

- The PR title parses as `chore(release): <component> <version>`; the component's package path comes from the config.
- If that path is `<root>/vX.Y`: every `*.md` under it and `<root>/README.md` get `**Status:** <label>` in their first fifteen lines, label from the channel; lines below the head window are untouched.
- Commit and push to the PR branch as the release bot; nothing to change → no commit.
- Any other component → `::notice::`, exit 0.

### version-check

Only `git ls-files` output is scanned; `CHANGELOG.md`, lockfiles, the
manifest and each package's natively rewritten file are skipped.

| Rule | Fails when |
|---|---|
| `annotated` | an `x-release-please-version` line sits outside every package path, holds more or fewer than one version literal (SemVer or PEP 440), or its literal differs from the package's manifest version |
| `configured` | a file is an `extra-files` entry but carries no annotation, or carries one but is not an `extra-files` entry |
| `literal` | an un-annotated line carries a literal equal to a manifest version, or a literal in the prerelease channel shape (`X.Y.Z-alpha.N`, PEP 440 `X.Y.ZaN`) — outside the skipped files and the `allow` globs |
| `spec-path` | a `<root>/vX.Y` path (or a corpus walker's `"vX.Y"` … `"conformance"` spelling) names a version with no `<root>/vX.Y` manifest key; inert when the config has no spec package |
| `forbidden` | an un-annotated line matches a `forbid-literal` regex |

One `path:line: <rule>: <detail>` per finding and exit 1, or
`version-check: ok (<n> annotated, <m> files scanned)`.

## Inputs and secrets

| Workflow | Input | Default | Meaning |
|---|---|---|---|
| all three | `config-path` | `.github/release-please-config.json` | the caller's release-please config; its `<root>/vX.Y` packages define the spec roots |
| all three | `tooling-ref` | `v0` | ref of this repo to run the scripts from when the runner does not expose the running workflow's SHA (normally never used) |
| `spec-status-line` | `release-label` | `status:release-pending` | label that marks a release-please PR; the job runs only when the PR carries it |
| `version-check` | `manifest-path` | `.github/.release-please-manifest.json` | the versions every literal is checked against |
| `version-check` | `allow` | empty | tracked paths to skip for the `literal`, `spec-path` and `forbidden` rules, one fnmatch glob per line |
| `version-check` | `forbid-literal` | empty | regexes no un-annotated line may match, one per line |

| Workflow | Secret | Purpose |
|---|---|---|
| `spec-status-line` | `RELEASE_BOT_APP_ID` | GitHub App ID of the release-bot; its token pushes the status-line commit |
| `spec-status-line` | `RELEASE_BOT_PRIVATE_KEY` | private key paired with the App ID |

Both secrets are required; the other two workflows take none.

## Gotchas

- **The scripts run from this repo, at the workflow's own commit.** Nothing of `hop-top/.github` is on the caller's disk, so each job resolves the commit of the reusable workflow file that is running and checks that revision out into `.hop-top-dotgithub` — the Python and the workflow always match. When the runner does not expose that SHA the job warns and uses `tooling-ref` (`v0`, the pin every caller uses). The line `Shared tooling: <repo>@<ref>` in the log names what actually ran.
- **`**Status:**` must be bold and in the first fifteen lines.** The rewriter matches `**Status:** …` only, in the head of the file; a `Status: Draft` in plain text or a status line further down is never touched.
- **The status-line push re-triggers `synchronize`.** The second run finds nothing to patch and exits clean; do not add a guard against it.
- **`allow` globs cross `/`.** `docs/*` skips everything under `docs/`, not just its direct children.
- **The channel-shape rule flags third-party pins.** A `1.2.0-rc.1` of some dependency in a config file is a `literal` finding; allow-list that file with the reason in the caller rather than annotating it.
- **A spec-only repo has no `publish.yml`.** The preflight treats a one-package config with no publish workflow as a single-language adopter and skips the publish checks; a spec repo with more than one package needs `publish.yml` or the preflight's Check 1 fails.

## Next steps

- [Add the release-please preflight check](add-preflight.md) — the config-shape checks, including the two for spec packages and `extra-files` targets.
- [version-strings.md](../concepts/version-strings.md) — why `pyproject.toml` is the one file `extra-files` must never name.
- [prerelease-channel.md](prerelease-channel.md) — the four-piece combo and what a manifest seed means.
- [secrets.md](../secrets.md) — the App secrets and where to scope them.
