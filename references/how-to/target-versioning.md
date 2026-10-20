# Version by target

Let the branch decide the version: a prerelease line previews one
target stable version, the stable branch cuts exactly that version
from its rc (and otherwise only patches what is already stable),
maintenance branches take patches only, and a linked family moves
together only when it opens a new major (or, before 1.0, a new minor).
Nothing ships that no prerelease previewed. Nobody picks a version and
nobody writes `Release-As`.

## Use this when

- `versioning: "prerelease"` carries counters across lines
  (`0.5.1-alpha.3` + `feat!` → `0.6.0-alpha.3`) and you want every new
  line to start at `alpha.0`.
- Cutting stable needs a `Release-As: X.Y.Z` footer and you want the
  stable branch to promote the rc on its own.
- A `release/x.y` branch must never ship a feature.
- A polyglot family (kit, kit-ts, kit-py, ...) should link on a new
  major (and on every minor while pre-1.0) and version independently
  otherwise.

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
releases as usual. A package the rules cannot version is **blocked**:
left out, and the run fails with the reason after every other package
was processed. A package the branch does not release (an alpha or beta
on the stable branch, a prerelease on a maintenance branch, a package
with no release yet on either) is **skipped**: left out with a notice,
and the run stays green.

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
| The required target is higher | new line at `alpha.0`, whatever channel the old line was on | `0.5.1-alpha.3` + `feat!` → `0.6.0-alpha.0`; `1.6.0-beta.2` + `feat!` → `2.0.0-alpha.0` |
| The current target was already released stable (a cut, or a hotfix on `main`) | new line from that stable | `0.6.0-rc.2` (0.6.0 tagged) + `feat` → `0.7.0-alpha.0`; `0.6.1-alpha.4`, `main` hotfixed 0.6.1, + `fix` → `0.6.2-alpha.0` |
| The manifest is stable | new line from it | `0.6.0` + `fix` → `0.6.1-alpha.0` |
| No release yet (no manifest entry, no tag) | its `initial-version`, as release-please opens it; a linked family member: see [its initial version](#initial-version-of-a-linked-member) | `initial-version: "0.1.0-alpha.0"` + `feat` → `0.1.0-alpha.0` |
| The line is promoted (`x-channel` for this line) | `<channel>.0` on the same target, then its counter; cut at once, with no other change | `0.6.0-alpha.7`, promoted to beta on 0.6.0 → `0.6.0-beta.0` |
| A promotion that skips a channel (alpha → rc) | **blocked** | `0.6.0-alpha.7`, `rc` recorded for 0.6.0 |
| A promotion recorded for another line | not used (the runner refuses the config first) | `0.7.0-alpha.0` + `fix`, record for 0.6.1 → `0.7.0-alpha.1` |
| An open line (`x-open-line`) not reached yet | `<line>-alpha.0`, cut at once, unless a change requires more (then **blocked**) | `0.9.0-alpha.3`, open 1.0.0 → `1.0.0-alpha.0` |

### Channels and lines: manual steps

The engine never changes a channel. Every line starts and stays on
alpha; moving a package to beta, then rc, is a decision recorded in the
config with [`bin/promote.js`](#promote-and-open-lines), by package or
by group. A promotion is recorded together with the line it applies to:

```json
"x-channel": {"line": "0.6.0", "channel": "beta"}
```

- It applies while the package is on `0.6.0`: the run on the
  prerelease branch that first sees the record cuts `0.6.0-beta.0`
  (no pin, and no commit needed besides the config change); later
  releases count on beta. Once that release is merged the record is
  just the channel the package is on, so nothing more is cut.
- It counts only for a package already on that line. A record for a
  line the package has not reached is refused (runner and preflight);
  a package moved to a new line by a change or by its linked family
  starts it on alpha.
- It expires with its line. After a line move or a stable cut the
  package starts on alpha again, and the release PR on the prerelease
  branch that leaves the line removes the record from the config.
- Channels move one step at a time, `alpha` → `beta` → `rc`, from the
  channel the package is released on, never back: `promote.js`, the
  preflight and the runner refuse anything else, and the rules block
  a package whose record skips a step.

Reaching a new major from 0.x (or any line no change would open on its
own) is the same kind of step:

```json
"x-open-line": "1.0.0"
```

The run that first sees it opens `1.0.0-alpha.0` at once (no other
change needed) if that is at or above what the commits require; below
it, the package is blocked and the run fails. The release PR that
reaches the line removes the record; a record for a line already
reached is refused.

The records live in the config, which the prerelease branch merges
into the stable branch. There they are inert: a stable or maintenance
branch neither uses them, nor checks them against its manifest (only
their shape), nor edits them (only the prerelease branch's release PRs
do, so the two branches never churn the same keys).

Why one object and not `prerelease-type: "beta.0"` plus a line key:
the channel and its line are one fact and cannot drift apart, an
absent record simply means alpha, and `prerelease-type` keeps its
release-please meaning (`alpha.0`, where every line starts) instead of
holding a promotion that outlives its line.

### Stable branch (`main`)

| Situation | Proposal |
|---|---|
| Manifest at `x.y.z-rc.N` (next promoted into main) | `x.y.z`, even with no commit since the merge |
| … and a commit since requires more than `x.y.z` (`1.3.0-rc.1`, then a `feat!` → `2.0.0`) | **blocked**: stable must equal what the rc previewed; land the change on `next`, where it opens a new line |
| … and `x.y.z` is already released (`next` at `0.6.1-rc.2`, `main` hotfixed `0.6.1`, then `next` merged) | **blocked** (`rc-released`): re-line on `next` (a change there, or `x-open-line 0.6.2`, opens the next line), promote that line via beta to rc and merge again |
| Manifest stable, only fixes since (no `feat`, nothing breaking) | patch: `0.6.0` + `fix` → `0.6.1`, `1.2.0` + `fix` → `1.2.1` |
| Manifest stable, a `feat` or breaking change since | **blocked**: it would ship unpreviewed; land it on `next` |
| Manifest at an alpha or beta (an SDK in the [experimental support tier](#experimental-support-tier), a package still previewing) | **skipped** with a notice: no PR, no failure |
| A linked family member's rc cut opens a new major, or a new minor before 1.0 whatever its patch (`1.0.0-rc.1`, `0.6.0-rc.2` from 0.5.0 or no stable, `0.6.1-rc.0` from 0.5.0) | the whole family in one group PR at that version once every member is at an rc of it; until then every member is **blocked** (see [Linked family](#linked-family)) |
| No release yet (no manifest entry, no tag: a package added since) | **skipped** with a notice, never opened at its `initial-version`: that opens it on `next` |
| A linked family member with no stable at an rc of a line from 1.0 (its `initial-version`, `1.0.0-rc.0`) while the family is before 1.0 | **blocked**: 1.0 opens for the family only through `x-open-line` (see [its initial version](#initial-version-of-a-linked-member)) |

Only rc packages are cut on the stable branch: merging `next` into
`main` while some packages are still on alpha or beta cuts the rc ones
and leaves the others for a later merge, unless they are members of a
linked family whose cut links (a new major, or a new minor before
1.0): then nothing in the family is cut until every member is at an
rc. A package already stable on `main` is patch-only there: a hotfix
is cut at once, a `feat` or breaking change blocks that package (with
or without a group) and fails the run, so nothing reaches stable
without a preview on `next`.
A hotfix that releases the version `next` is previewing moves `next`
on: its next release opens the following line (`0.6.1-alpha.4` →
`0.6.2-alpha.0` after `main` cut `0.6.1`), and an rc of the released
version reaching `main` is blocked rather than bumped.

### Maintenance branch (`release/x.y`)

Stable patches only. `fix` → `x.y.(z+1)`. A `feat` or breaking change
since the package's last release produces no version for that
package: it is blocked, every other package still gets its PR, and the
run fails at the end. A package whose manifest is a prerelease there
is skipped with a notice (never turned into its stable), and so is a
package with no release yet (never opened at its `initial-version`). A
package whose manifest is off the branch's `x.y` line still gets its
patch, with a warning in the log.

### Linked family

A `conditional-linked-versions` group links only when one member's
proposal opens a new major (always), or a new minor line while the
family is before 1.0 (major 0), on the prerelease branch and on the
stable branch alike. On the stable branch the cut is measured against
the member's last stable; with none, against the family's highest
stable when the member's line is above it, else the smallest stable
its rc can stem from (a `0.y.0` or `x.0.0` cut links): `1.0.0` from
0.9.x, `0.6.0` from 0.5.x or from no stable, and `0.6.1` from 0.5.x
(a minor line opened at a patch by `x-open-line`), also for a member
with no stable in a family stable at 0.5.x. From 1.0 a
new minor is independent, and a patch never links (a `0.5.1` hotfix
on `main` is cut for that member alone). A member opening a line
through a record (promotion or `x-open-line`) links the same way.

When it links:

- one release PR for the whole group, members without commits (or
  with only a chore or config change) included; merging it tags every
  member;
- every member moves to the group's target: the highest line the
  linking members open, or, on the prerelease branch, a later linked
  line a member already previews (kit opening `0.6.0` while kit-rs
  previews `0.7.0-alpha.2` links at `0.7.0`). A member's own patch,
  proposed or previewed (`0.6.1-alpha.N` after its own `0.6.0`), never
  raises it, on either branch, nor does a first release or a line from
  1.0 a member's initial version opened while the family is before 1.0
  ([below](#initial-version-of-a-linked-member));
- each member keeps its own channel: a member already on the target
  line keeps its channel there, or takes its promotion recorded for
  that line; any other member starts the line on alpha;
- members on the same channel share one counter: the highest of that
  channel's members already on the line + 1, or `.0`. kit-rs at
  `0.6.0-alpha.4` when kit opens `0.6.0` puts every alpha member at
  `0.6.0-alpha.5`; a member promoted to beta on `0.6.0` at `beta.2`
  gets `0.6.0-beta.3` in the same PR. A member promoted from
  `0.6.0-alpha.4` to beta in that PR still leaves `alpha.4` counted:
  the alpha members get `alpha.5`. Nobody moves backwards or changes
  channel;
- on the stable branch a linked major, or a linked minor before 1.0,
  holds the whole family, members in the
  [experimental support tier](#experimental-support-tier) included:
  every member must be at an rc of the target, and then all are cut
  together at it in one group PR. kit `1.0.0` is not cut until
  kit-py, kit-ts, kit-php and kit-rs are all at `1.0.0-rc.N`; kit at
  `1.0.0-rc.1` with kit-py still at `1.0.0-alpha.3` blocks the group
  (no member is cut, the run fails) until kit-py is promoted via beta
  to rc on `next`. The same for `0.5.0`: kit at `0.5.0-rc.1` with
  kit-py at `0.5.0-alpha.3` blocks every member; all five at
  `0.5.0-rc.N` are cut at `0.5.0` in one PR, and merging it tags all
  five. A linked release never ships a member that previewed anything
  but that rc. The consequence: an SDK in the experimental support
  tier must reach rc before each of the family's linked minors (before
  1.0) and majors ships;
- a pre-1.0 patch (`0.5.1` hotfix) and a minor from 1.0 stay unlinked
  on the stable branch: each member is cut from its own rc, and a
  member not at rc is skipped (kit, kit-py and kit-ts at `1.2.0-rc.N`
  are cut; kit-php and kit-rs, still on alpha, wait for a later
  merge);
- a member blocked on its own (an `x-open-line` below what its
  commits require, say) blocks the group;
- a member that already released the target (or later) as stable
  blocks the group: no member gets a PR. On `main`: kit-py cut `0.5.0`
  on its own earlier and has a fix since (`0.5.1`), the other members
  at `0.5.0-rc.N` link at `0.5.0`; the run fails naming kit-py as
  already stable at `0.5.0`. On `next` the same: kit (stable `0.5.0`)
  opens `0.6.0` with a `feat` while kit-py, cut `0.6.0` on its own, has
  a fix since (`0.6.1-alpha.0`) or already previews `0.6.1-alpha.2`;
  the group links at `0.6.0`, not `0.6.1`, and the run fails naming
  kit-py as already stable at `0.6.0`;
- a member already on a later line than the target, one that does not
  raise it, blocks the group too: it never moves backwards. kit
  (stable `0.5.0`) opens `0.6.0` with a `feat` while kit-rs, with no
  stable, previews `0.6.1-alpha.0` (or, from 1.0, kit opens `2.0.0`
  while kit-rs previews `2.3.0-alpha.0`): the run fails naming kit-rs
  as past group target `0.6.0` (`2.0.0`), on either branch. Opening
  kit-rs's line for the group with `x-open-line` (`promote.js open-line
  0.6.1 --group kit`; kit-rs, already on it, is left as it is) links
  the family there, on `main` too: with `x-open-line 0.6.1` the family
  moves to `0.6.1-alpha.1` on `next`, and `main` holds every member
  until all five are at `0.6.1-rc.N`, whichever reaches rc first
  (kit-rs, with no stable, included), then cuts `0.6.1` in one group
  PR.

#### Initial version of a linked member

A member's first release (no stable, no prior prerelease) opens at its
`initial-version`, which is config, not a change: it never raises the
group's target. When the family links in that run, the member takes the
group's version instead (kit opening `0.6.0` makes a new kit-rs
`0.6.0-alpha.0`, whatever its `initial-version`).

Otherwise it opens on its own, so it must start exactly on the
family's line, or wait for the family to link:

| The family | A new member starts at | Example |
|---|---|---|
| has a line open above its highest stable | that line, `alpha.0` | stable `0.4.0`, kit at `0.5.0-alpha.26` → `0.5.0-alpha.0` |
| has no line open above its highest stable | the patch line after that stable, `alpha.0` | all at stable `0.5.0` → `0.5.1-alpha.0` |

Never the stable line itself: `0.5.0-alpha.0` next to a stable `0.5.0`
would, once at rc on `main`, link the family at `0.5.0` and block it
(members already stable at it), hotfixes included. Never a new minor
either: that would move the whole family because a member joined. Cut
at that patch line, the member's rc is an unlinked pre-1.0 patch on
`main`, cut on its own.

On `next`, a first release off that line is **blocked**, that member
alone (the others still release), before 1.0 and after: past it
(`0.9.0-alpha.0` in a `0.5` family, `1.0.0-alpha.0`), below it
(`0.3.0-alpha.0` in a `0.5` family, `0.5.0-alpha.0` beside a stable
`0.5.0`, `2.0.0-alpha.0` in a family stable at `2.3.0`, `1.0.0-alpha.0`
in one at `1.1.0`: at rc on `main` it would link the family at its own
line and block it), or not a prerelease at all (`0.3.0`, or the
`1.0.0` release-please opens when `initial-version` is unset: go, node,
simple). The message names the line to set, or the member waits until
the family links and takes the group version then. Set `initial-version`
for every new linked member; python and rust ignore it and open at
`0.1.0`
([seed the manifest](prerelease-channel.md#release-type-python-does-not-honor-initial-version)
if that is off the family's line).

1.0 opens only through `x-open-line`, so while the family is before 1.0
(the highest stable or line across its members is `0.x`):

- a first release at `1.0.0` or later is blocked as above; opening
  `1.0.0` for the group with `x-open-line` instead (`promote.js
  open-line 1.0.0 --group kit`, which leaves out the member with no
  release yet) links the new member there too;
- a member with no stable already on a line from 1.0 (a first release
  at `1.0.0-alpha.0` from before it joined the group, say) never links
  the family nor raises its target. When the family links below it,
  the run fails naming it as past the group target (on `next` and
  `main`); on `main`, when nothing else links, its own stable cut is
  **blocked**, that member alone. Opening its line for the family with
  `x-open-line` on `next` resolves both.

What counts is the highest version across the members, each member's
stable or line, whichever is higher: a 1.x family with one late `0.x`
member is not before 1.0, and a family that opened 1.0 through
`x-open-line` (lines at `1.0.0-alpha.N`, no stable from 1.0) is on the
1.0 line, where a new member takes the group's version. A line from 1.0
of a member with no stable does not count: it may be that member's
initial version.

Outside a group nothing changes: a package may start at any
configured `initial-version`, `1.0.0` included.

#### Experimental support tier

A package in the experimental support tier is one whose SDK is not
graduated yet (kit-php and kit-rs in the examples). The tier is a
support promise, not a rule: such a package releases on alpha → beta →
rc like any member (one channel at a time, by `x-channel`), and on the
stable branch it holds the family's linked majors, and its minors
before 1.0, like any member: nothing in the family is cut until it is
at an rc of the target too.

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
  the reverse), or the reason when its package is blocked or skipped.
  A PR with neither is left open, and so is any PR not on a
  release-please branch (one opened by hand with the release label).
  Nothing is closed while a merged release PR waits for its tag.

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
      "bump-minor-pre-major": true,
      "exclude-paths": ["sdk", "extensions/mcp"]
    }
  }
}
```

The SDK members (`kit-php`, `kit-py`, ...) are packages under `sdk/`,
each configured like `.`. The root package lists every nested package
and every nested Go module (`extensions/mcp`, with its own `go.mod`)
in `exclude-paths`: release-please gives the root every commit its
`exclude-paths` does not drop, so without them a fix in an SDK would
also release kit
([bootstrap § 5](../../docs/bootstrap-checklist.md#5-configure-release-please)).

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

- `prerelease-type`: exactly `alpha.0` (or unset); promotions are
  `x-channel`
- `x-channel` / `x-open-line`: written by `bin/promote.js`; on the
  prerelease branch a recorded line must be the package's current
  target, a channel the current one or the next, an open line not yet
  reached (inert on other branches; the shape is checked everywhere)
- no `release-as`
- `initial-version` (a new member of a linked family): a prerelease on
  the family's line, the one the block message names
  ([which](#initial-version-of-a-linked-member))
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
at PR time. The runner refuses the same config before it writes any
pull request; releases of release PRs already merged are still
created, so a config problem never holds a tag back. The runner also
refuses a target package whose manifest version is on a channel other
than alpha, beta or rc (`0.5.0-experimental.3`, left from a stock
setup), on every branch: the rules know alpha → beta → rc only, so
seed the manifest on alpha when adopting.

## Promote and open lines

`scripts/release-please-target/bin/promote.js` writes the records,
keeping the rest of the config file as written. A repository's promote
script or gate calls it from the repository root (Node 20+, after
`npm ci` in `scripts/release-please-target` of a hop-top/.github
checkout):

```sh
P=path/to/hop-top-dotgithub/scripts/release-please-target/bin/promote.js

node "$P" channel beta --package kit --package qmochi   # by package (path or component)
node "$P" channel rc --group kit                          # by conditional-linked-versions group
node "$P" open-line 1.0.0 --group kit                     # open 1.0.0 for the family
node "$P" clear channel --package kit                     # drop a record
node "$P" channel beta --package kit --dry-run            # print, write nothing
```

`--config` / `--manifest` override the `.github/` defaults. The line
recorded is the package's current target, from the manifest, and the
step is measured from the channel the manifest shows: with beta
recorded but `0.5.0-beta.0` not released yet, `channel rc` is refused
as a skip. All or nothing: if one package is refused (not on
`target`, no open line, a skipped or backward step, a line already
reached, passed or released stable), nothing is written and it exits
1. A package already on the channel, already promoted to it, or
already on the line to open, is refused when named with `--package`;
picked through `--group` it is left as it is (printed `unchanged, …`)
and the other members are recorded, so promoting a family after
promoting one of its members works, and so does opening the line a
member is already past the group's target on. For `open-line`, a group
member with no release yet is left out too: the group's link gives it
the version. Commit the change to
the prerelease branch:
the run that push triggers cuts each package's release PR
(`0.5.0-beta.0`, `1.0.0-alpha.0`) with no other commit.

The kit round, `channel beta --package kit --package qmochi` on `next`:
that run proposes `kit 0.5.0-beta.0` and `qmochi 0.2.0-beta.0`; every
other package stays where it is.

## Migrate

From `versioning: "prerelease"` with `Release-As` cuts:

1. **Pick the branch roles.** A stable branch skips a manifest at an
   alpha or beta (no release there until it is an rc). If `main`
   carries prereleases today, list it under `prereleaseBranches` until
   `next` is promoted to rc and merged into `main`, then move it to
   `stableBranches` (the config travels with the merge).
2. **Edit the config.** Every package: `versioning: "prerelease"` →
   `"target"`, `prerelease-type: "alpha.0"`, drop `release-as`. Add
   `{"type": "target-context"}` first in `plugins`; replace
   `linked-versions` (or any hand-kept group list) with
   `conditional-linked-versions`. A top-level `"linked-versions"` key
   never linked anything (release-please reads groups only from
   `plugins[]`): drop it and list the group in `plugins`. A package
   already past alpha on its current line keeps counting on its
   channel; record the promotion (`promote.js channel beta --package …`)
   so the config says so. A manifest on another channel
   (`experimental.N`) is refused: seed it on alpha.
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
| notice `… is not an rc: skipped` (not a failure) | `main` carries an alpha/beta of that package | promote it to rc on `next` and merge, or leave it for a later merge |
| notice `no release yet: skipped` (not a failure) | a package added on `main` or `release/x.y` that was never released | release it on `next` (its `initial-version`), promote it via beta to rc, then merge |
| `changes since x.y.z-rc.N require …, more than the x.y.z it previews` | a change on `main` needs a bigger version than the rc | revert it on `main` and land it on `next` (a new line there) |
| `feat since stable x.y.z would ship … unpreviewed` (or `breaking change since …`) | a feature or breaking change landed on `main` for a package already stable there | revert it on `main` and land it on `next`; `main` takes fixes only |
| `x.y.z-rc.N previews x.y.z, already released …: re-line on next` | `main` released `x.y.z` (a hotfix) while `next` previewed it, then `next` merged | on `next`, land a change or `promote.js open-line x.y.(z+1) --package <path>`, promote that line via beta to rc, merge again |
| `linked at x.y.0 …, but … is at …: a linked release is cut only when every member is at an rc` | a linked major (or minor before 1.0) reached `main` with a member not at rc (members in the [experimental support tier](#experimental-support-tier) included) | do what the message says on `next` (`promote kit-py via beta to rc …`), then merge again |
| `x-channel … skips a channel from …` | a promotion two steps ahead (hand edit) | record the next channel only (`promote.js channel`) |
| `feat on maintenance branch release/x.y: patch only` | a feature landed on a maintenance line | revert it there; ship it from `next` |
| `… already released x.y.z as stable, at or past group target …` | a linked member is already stable at the target (cut on its own before the family linked, on `next` or `main`) | owner decision: re-seed the member or the group |
| `… is already at …, past group target …, and a member never moves backwards` | a linked member previews a later line than the family links at (its own patch line, a minor from 1.0, a line from 1.0 its `initial-version` opened), so the group would move it back | on `next`, open that line for the group (`promote.js open-line x.y.z --group <group>`; the member already on it is left as it is), then the family links at it |
| `… has no release yet and its first release would be …, past the family's line …` (or `below …`, `not a prerelease`) | a new linked member with no `initial-version` (release-please opens `1.0.0`), or one off the family's line | set its `initial-version` to the line the message names (`0.5.0-alpha.0` on an open line, `0.5.1-alpha.0` after a stable `0.5.0`), or wait for the family to link; for 1.0, open it for the group with `x-open-line` |
| `… has no stable and would cut 1.0.0 from …, a line from 1.0 its initial version opened` | `main` would ship a linked member's 1.0 that no `x-open-line` opened, the family still before 1.0 | on `next`, open that line for the group (`promote.js open-line x.y.z --group <group>`), promote the family via beta to rc, merge again |
| `plugins has no "target-context"` | config lists target packages without the plugin | add it, first |
| `prerelease-type '…': every line starts on alpha.0` | a channel set through `prerelease-type` | `alpha.0`; promote with `promote.js channel` |
| `manifest version '…' is on channel '…': target versioning supports alpha/beta/rc only` | a target package's manifest on another channel (`experimental.N` from a stock setup) | seed the manifest on alpha, then promote via beta to rc |
| `x-open-line … is below the required target …` | a change since needs more than the opened line | raise the line or remove it (`promote.js clear open-line`) |
| preflight: `x-channel is for line …, but its current target is …` | a record for another line (hand edit) | `promote.js clear channel`, or promote the current line |

A caller chaining a job on the outputs (`releases_created`, ...)
should gate it on `!cancelled()` as well: a failed run still created
the releases it could.

## Next steps

- [Add the preflight check](add-preflight.md).
- [Stay in a prerelease channel](prerelease-channel.md) — the stock
  `versioning: "prerelease"` setup this replaces.
- [`DEVELOPING.md`](../../DEVELOPING.md#release-please-target) —
  the extension's layout and how to upgrade the pinned release-please.
