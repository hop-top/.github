# Version by target

Let the branch decide the version: a prerelease line previews one
target stable version, the stable branch promotes it, maintenance
branches take patches only, and a linked family moves together only
when it opens a new line. Nobody picks a version and nobody writes
`Release-As`.

## Use this when

- `versioning: "prerelease"` carries counters across lines
  (`0.5.1-alpha.3` + `feat!` → `0.6.0-alpha.3`) and you want every new
  line to start at `alpha.0`.
- Cutting stable needs a `Release-As: X.Y.Z` footer and you want the
  stable branch to promote the rc on its own.
- A `release/x.y` branch must never ship a feature.
- A polyglot family (kit, kit-ts, kit-py, ...) should link on a new
  line and version independently otherwise.

## Before you begin

You need:

- The release-please config and manifest in `.github/` (any path works;
  pass `config-file` / `manifest-file`).
- `.github/workflows/release-please.yml` calling
  `release-please-on-push.yml@v0` (see [quick-start](../quick-start.md)).
- The branch roles of the repository: which branch carries
  prereleases (`next`), which is stable (`main`), which are
  maintenance lines (`release/x.y`).

## Result

Every push to a role branch runs release-please with the
target-versioning extension. The standing release PR on that branch
proposes the version the rules below give; merging it tags and
releases as usual. A package the rules cannot version is left out
and the run fails with the reason, after every other package was
processed.

## How it works

`versioning: "target"` is not part of release-please. It is an
extension shipped in this repository
(`scripts/release-please-target`): a versioning strategy plus two
release-please plugins, run against an exactly pinned release-please
by an action-equivalent runner. `release-please-on-push` uses it when
the caller passes `versioning-extension: true`; the job, App token,
inputs and outputs are the ones of the default path.

The target of a prerelease `x.y.z-alpha.N` is `x.y.z`. The required
target is the component's last stable release (from its tags) bumped
by the commits since its latest release:

| Change | Before 1.0 | From 1.0 |
|---|---|---|
| breaking (`feat!`, `BREAKING CHANGE:`) | `x.(y+1).0` | `(x+1).0.0` |
| `feat` | `x.(y+1).0` | `x.(y+1).0` |
| anything else | `x.y.(z+1)` | `x.y.(z+1)` |

### Prerelease branch (`next`)

| Situation | Proposal | Example |
|---|---|---|
| The current target covers the required target | counter + 1 | `0.5.0-alpha.26` + `feat!` → `0.5.0-alpha.27` |
| The required target is higher | new line at `alpha.0`, whatever the configured channel | `0.5.1-alpha.3` + `feat!` → `0.6.0-alpha.0`; `1.6.0-beta.2` + `feat!` → `2.0.0-alpha.0` |
| The current target was already released stable | new line from that stable | `0.6.0-rc.2` (0.6.0 tagged) + `feat` → `0.7.0-alpha.0` |
| The manifest is stable | new line from it | `0.6.0` + `fix` → `0.6.1-alpha.0` |
| `prerelease-type` moved ahead (promote) | `<channel>.0` on the same target | `0.6.0-alpha.7` + `fix`, config `beta.0` → `0.6.0-beta.0` |
| `prerelease-type` behind the current channel | counter + 1, never backwards | `0.6.0-rc.2`, config `alpha.0` → `0.6.0-rc.3` |

A channel moves only when `prerelease-type` changes: promotion
(`alpha.0` → `beta.0` → `rc.0`) is a config change, made on purpose.

### Stable branch (`main`)

| Situation | Proposal |
|---|---|
| Manifest at `x.y.z-rc.N` (next promoted into main) | `x.y.z`, even with no commit since the merge |
| … and a commit since requires more than `x.y.z` | the required version (guard against main's previous stable) |
| Manifest stable | plain stable bump (`0.6.0` + `fix` → `0.6.1`) |
| Manifest at an alpha or beta | **blocked**: a stable branch promotes only an rc |

### Maintenance branch (`release/x.y`)

Patch only. `fix` → `x.y.(z+1)`. A `feat` or breaking change since
the package's last release produces no version for that package: it
is blocked, every other package still gets its PR, and the run fails
at the end. A package whose manifest is off the branch's `x.y` line
still gets its patch, with a warning in the log.

### Linked family

A `conditional-linked-versions` group links only when one member's
proposal opens a new major (on the stable branch: against its last
stable), or a new minor line on the prerelease branch. Otherwise its
members release independently.

When it links:

- one release PR for the whole group, every member at the same
  version, members without commits included; merging it tags every
  member;
- the version is on the highest target among the members (a member
  already previewing a later target wins);
- on that target it is the highest of `alpha.0`, the members' own
  proposals, and the highest member already on the target line with
  its counter + 1 — kit-rs at `0.6.0-alpha.4` when kit opens `0.6.0`
  puts the group at `0.6.0-alpha.5`. A member never moves backwards
  and linking never changes a channel;
- a member that already released the target (or later) as stable
  blocks the group: no member gets a PR.

### Release-As footers

A `Release-As:` footer would override the strategy, so the extension
drops it from the commits of every target package and logs
`ignoring "Release-As: …"`. `release-as` in the config is refused
(preflight and runner).

### GitHub releases and release PRs

- A release is a GitHub prerelease when its version has a prerelease
  suffix, and only then: stable `0.x` releases are not flagged
  prerelease (release-please flags them when `prerelease: true`).
- An open release PR on the branch that the run no longer proposes is
  closed with a comment: `Superseded by #N.` when another PR now
  carries its components (per-package PRs replaced by a group PR, or
  the reverse), or the block reason when its package is blocked. A PR
  with neither is left open. Nothing is closed while a merged release
  PR waits for its tag.

## Config

```json
{
  "separate-pull-requests": true,
  "include-component-in-tag": true,
  "tag-separator": "/",
  "label": "status:release-pending",
  "release-label": "status:release-tagged",
  "plugins": [
    {"type": "target-context"},
    {"type": "conditional-linked-versions", "groupName": "kit",
     "components": ["kit", "kit-php", "kit-py", "kit-rs", "kit-ts"]}
  ],
  "packages": {
    ".": {
      "release-type": "go",
      "component": "kit",
      "prerelease": true,
      "prerelease-type": "alpha.0",
      "versioning": "target",
      "bump-minor-pre-major": true
    }
  }
}
```

`target-context` must come before every `conditional-linked-versions`.
Its options, all optional:

| Option | Default | Meaning |
|---|---|---|
| `stableBranches` | `["main"]` | stable role |
| `prereleaseBranches` | `["next"]` | prerelease role |
| `maintenanceBranchPattern` | `^release/\d+\.\d+$` | maintenance role (JavaScript regex) |

A branch with no role falls back to the package's `prerelease` flag
and logs a warning. `conditional-linked-versions` takes `groupName`
and `components` like release-please's `linked-versions`; every
component must use `versioning: "target"`.

Per target package:

- `prerelease-type`: `alpha.0`, `beta.0` or `rc.0` (unset = `alpha.0`)
- no `release-as`
- `bump-minor-pre-major: true`, no `bump-patch-for-minor-pre-major`
  (the bump table above is fixed)
- `prerelease` decides only on a branch with no role
- manifest seed: stable or prerelease, the branch decides

Caller:

```yaml
on:
  push:
    branches: [main, next, 'release/*']
  workflow_dispatch: {}
jobs:
  release-please:
    uses: hop-top/.github/.github/workflows/release-please-on-push.yml@v0
    secrets:
      RELEASE_BOT_APP_ID: ${{ secrets.RELEASE_BOT_APP_ID }}
      RELEASE_BOT_PRIVATE_KEY: ${{ secrets.RELEASE_BOT_PRIVATE_KEY }}
    with:
      versioning-extension: true
```

[`release-please-preflight`](add-preflight.md) checks all of the above
at PR time.

## Migrate

From `versioning: "prerelease"` with `Release-As` cuts:

1. **Pick the branch roles.** A stable branch blocks a manifest at an
   alpha or beta. If `main` carries prereleases today, list it under
   `prereleaseBranches` until `next` is promoted to rc and merged
   into `main`, then move it to `stableBranches` (the config travels
   with the merge).
2. **Edit the config.** Every package: `versioning: "prerelease"` →
   `"target"`, drop `release-as`. Add `{"type": "target-context"}`
   first in `plugins`; replace `linked-versions` (or any hand-kept
   group list) with `conditional-linked-versions`.
3. **Leave old `Release-As` footers alone.** They are ignored from now
   on (the log names each one); history needs no rewrite. Stop
   writing new ones.
4. **Switch the caller** to `release-please-on-push.yml@v0` with
   `versioning-extension: true`, triggered on every role branch. A
   hand-rolled `googleapis/release-please-action` job does not know
   `versioning: "target"`.
5. **Dry-run** before merging the config change (reads only, nothing
   written):

   ```sh
   cd scripts/release-please-target && npm ci
   TOKEN="$(gh auth token)" GITHUB_REPOSITORY=<org>/<repo> \
   TARGET_BRANCH=next \
   CONFIG_FILE=.github/release-please-config.json \
   MANIFEST_FILE=.github/.release-please-manifest.json \
   DRY_RUN=true node bin/run.js
   ```

   The config is read from the target branch, so dry-run against a
   branch that already carries the new config.
6. **First run.** Standing release PRs are updated to the new
   proposal, or closed as superseded.

## Common issues

| Run fails with | Cause | Fix |
|---|---|---|
| `… is not an rc: a stable branch promotes only an rc` | `main` carries an alpha/beta | promote `next` to rc and merge it, or give `main` the prerelease role for now |
| `feat on maintenance branch release/x.y: patch only` | a feature landed on a maintenance line | revert it there; ship it from `next` |
| `… already released x.y.z as stable, at or past group target …` | a linked member is already stable at the target | owner decision: re-seed the member or the group |
| `plugins has no "target-context"` | config lists target packages without the plugin | add it, first |
| `prerelease-type '…' is not a target channel` | `alpha`, `dev.0`, ... | `alpha.0`, `beta.0` or `rc.0` |

A caller chaining a job on the outputs (`releases_created`, ...)
should gate it on `!cancelled()` as well: a failed run still created
the releases it could.

## Next steps

- [Add the preflight check](add-preflight.md).
- [Stay in a prerelease channel](prerelease-channel.md) — the stock
  `versioning: "prerelease"` setup this replaces.
- [`DEVELOPING.md`](../../DEVELOPING.md#release-please-target) —
  the extension's layout and how to upgrade the pinned release-please.
