# Stay in a prerelease channel

Keep release-please incrementing an alpha/beta/rc counter instead of bumping to stable.

This is release-please's own `versioning: "prerelease"`, for a caller
that has not opted into [target versioning](target-versioning.md).
Target versioning is the recommended path: each prerelease line
previews one target version, a new line restarts at `alpha.0`, the
stable branch promotes an rc on its own, and nobody pins a version (no
`Release-As` footer, no `release-as` field).

The examples on this page were probed against release-please 17.11.2
(the version `scripts/release-please-target` pins) on that package's
hermetic fixture repositories, unless a section names its own source.

## Use this when

- You're shipping `0.x` and want every release to be `-alpha.N` until you're ready for stable.
- A `feat:` commit unexpectedly bumped you to a stable version.
- You're cutting a fresh repo and need the prerelease config from the start.

## Before you begin

You need:

- `release-please-config.json` and `.release-please-manifest.json` at `.github/`.
- Awareness of which components should be prerelease vs. stable (it's per-package).

## Result

Every release of the configured packages stays in the channel
(e.g. `0.3.0-alpha.5 → 0.3.0-alpha.6 → 0.3.0-alpha.7`) until you
explicitly cut stable.

## The four-piece combo

To stay in an alpha/beta/rc channel (counter-incrementing), every
package in `release-please-config.json` needs **all four pieces**
(with [target versioning](target-versioning.md), `"versioning": "target"`
takes the place of `"prerelease"`):

```json
{
  "prerelease": true,
  "prerelease-type": "alpha.0",
  "versioning": "prerelease",
  "bump-minor-pre-major": true
}
```

The manifest seed is read as the last release. A prerelease seed keeps
counting; a stable seed opens a prerelease of the next version:

```json
{ "sdk/ts": "0.3.0-alpha.0" }   // + fix → 0.3.0-alpha.1
{ "sdk/ts": "0.3.0" }           // + fix → 0.3.1-alpha.0, + feat → 0.4.0-alpha.0
```

`release-please-preflight` still fails a stable seed on a package that
declares `prerelease: true` (stock versioning only), so seed
prerelease-shaped.

## Why each piece matters

| Piece | Without it |
|---|---|
| `prerelease: true` | No suffix: a stable seed bumps to a stable (`0.5.0` + `fix` → `0.5.1`), and a prerelease seed is cut as its stable (`0.5.1-alpha.3` + `fix` → `0.5.1`) |
| `prerelease-type: "alpha.0"` | With `"alpha"`, the first release is `0.5.1-alpha` (no counter), the next `0.5.1-alpha.1`: `alpha.0` never ships |
| `versioning: "prerelease"` | The default strategy bumps the core and keeps the old suffix as is: `0.5.1-alpha.3` + `fix` → `0.5.2-alpha.3`, + `feat` → `0.6.0-alpha.3` (no counter) |
| `bump-minor-pre-major: true` | Before 1.0 a breaking change bumps the major: `0.5.1-alpha.3` + `feat!` → `1.0.0-alpha.3` |

The preflight requires all four on every package with
`prerelease: true` (with `versioning: "target"` in place of
`"prerelease"` for a target package).

## A new line keeps the counter

Stock prerelease versioning bumps the core and carries the counter. It
never restarts a line at `alpha.0` on its own, and it keeps the channel
of `prerelease-type`:

| Manifest | Commit | Stock proposal | Target versioning |
|---|---|---|---|
| `0.5.0-alpha.26` (stable `0.4.0`) | `feat!` | `0.5.0-alpha.27` | `0.5.0-alpha.27` |
| `0.5.1-alpha.3` (stable `0.5.0`) | `feat!` | `0.6.0-alpha.3` | `0.6.0-alpha.0` |
| `1.5.0-alpha.3` (stable `1.4.2`) | `feat!` | `2.0.0-alpha.3` | `2.0.0-alpha.0` |
| `1.6.0-beta.2` (stable `1.5.0`, `prerelease-type: "beta.0"`) | `feat!` | `2.0.0-beta.2` | `2.0.0-alpha.0` |

The rule target versioning enforces: the commits since the last stable
give the required version (breaking: next minor before 1.0, next major
from 1.0; `feat`: next minor; else next patch; a breaking change is any
type with `!` or a `BREAKING CHANGE:` footer, `build(deps)!`
included). While the line's target covers it, the counter goes up;
when it needs more, the line moves to the new target at `alpha.0`,
from beta or rc too. On stock versioning the only way to get that is
a `Release-As` footer per new line ([below](#jump-base-while-staying-prerelease)).
`PRINT_SCENARIOS=1 npm test` in `scripts/release-please-target` prints
both columns for every fixture case.

## Leave the channel (cut stable)

(With [target versioning](target-versioning.md) the stable branch cuts
stable from a promoted rc on its own, `Release-As` footers are
ignored, and channels move through recorded promotions instead of
`prerelease-type`.)

The prerelease suffix is "sticky": with all four pieces set,
release-please never proposes a stable. Two ways out:

- A `Release-As: X.Y.Z` footer (no suffix) on a commit that reaches
  the package (see [What a pin reaches](#what-a-pin-reaches)):

  ```
  feat: add long-awaited X

  Release-As: 1.0.0
  ```

- Flip the package to `prerelease: false`: its next release cuts the
  current core as stable (`0.5.1-alpha.3` + `fix` → `0.5.1`). Flip it
  back after the release, or the package stays stable-only.

### What a pin reaches

A pin only sets the version of a release release-please already makes
for that package:

- A `Release-As:` footer counts for every package whose commits
  include it: the packages whose paths the commit touches, plus the
  root package `.`, which sees every commit its `exclude-paths` does
  not drop. An empty commit
  (`git commit --allow-empty`) touches no path, so it reaches every
  package **except one with `exclude-paths`**: release-please drops a
  file-less commit from such a package. A root package that excludes
  its nested packages and modules, as it should
  ([bootstrap § 5](../../docs/bootstrap-checklist.md#5-configure-release-please)),
  never sees an empty commit.
- The footer makes its commit visible on any type: `chore:` with a
  `Release-As:` footer still opens a release PR.
- The per-package `release-as` field in `release-please-config.json`
  wins over any footer, but opens nothing on its own: with no commit
  since the last release, or only hidden types (`chore`, `ci`, ... by
  default), there is no release PR. Remove the field once the release
  is cut: while it is set, every later release of the package proposes
  that same version again.

Target versioning ignores footers and refuses the field.

## Jump base while staying prerelease

For example, `0.3.0-alpha.5 → 0.4.0-alpha.0`. Add a `Release-As` footer
with the desired prerelease, on a commit that reaches the package
([What a pin reaches](#what-a-pin-reaches)):

```
feat!: breaking redesign of Y

Release-As: 0.4.0-alpha.0
```

With target versioning a change the current line does not cover opens
the next line by itself (`0.3.1-alpha.5`, stable `0.3.0`, + `feat!` →
`0.4.0-alpha.0`; on `0.3.0-alpha.5` with stable `0.2.x` the same
commit only counts, `0.3.0` already previews it). A line no change
would open (`1.0.0`, or one past ghost versions) is opened with
`promote.js open-line`
([target versioning § Promote and open lines](target-versioning.md#promote-and-open-lines)).

## Manifest presence vs `initial-version`

`initial-version` in `release-please-config.json` looks like it
should set the version a package bootstraps at. **It only applies
when the manifest has no key for that package at all.** If the
manifest key is present — even seeded at `"0.0.0-alpha.0"`, which
looks like "nothing released yet" — release-please treats that as a
**real prior version** and computes the next release by bumping
*from* it, ignoring `initial-version` entirely.

Verified empirically (`release-please@17.10.4`, `--dry-run --debug`):

```
✔ No latest release found for path: pkg, component: , but a
  previous version (0.0.0-alpha.0) was specified in the manifest.
```

That debug line is the tell — "a previous version ... was specified
in the manifest" means `initial-version` is dead for this package,
regardless of what it says.

| Manifest state | What controls the first version |
|---|---|
| Key absent (`{}`, no entry for the package) | `initial-version` from config, honored |
| Key present at any value, even `"0.0.0-alpha.0"` | The manifest value; `initial-version` ignored; next release bumps the prerelease counter from that seed (e.g. `alpha.0 → alpha.1`), NOT jump to `initial-version`'s target |

### `release-type: python` does not honor `initial-version`

The "key absent" row above holds for `go` and `node`. It does **not** hold
for `python`: with no manifest key, the python strategy computes a
**stable** first version even when `prerelease: true`,
`prerelease-type: alpha.0` and `versioning: prerelease` are all set. The
release PR proposes `0.1.0`, writes `{"py": "0.1.0"}` plus a stable
`version` into `pyproject.toml`, and `release-please-preflight` fails it:

```
::error::package py declares prerelease but manifest seed '0.1.0' is stable
```

Observed on `poly-axon` 2026-09-09 with all four components on byte-identical
prerelease config — only the `release-type: python` one diverged.

**So seed the manifest for any repo with a python component**, and seed every
component in it, not just the python one. `poly-kit` does exactly this and its
python channel has shipped through `kit-py/v0.5.0-alpha.5`; its earliest
`kit-py` tag is `v0.4.0-alpha.1`, never `alpha.0` — the off-by-one this page
describes, paid deliberately.

Pure go and pure ts repos keep an empty manifest and do get `alpha.0`.

**If you want `initial-version: "0.1.0-alpha.0"` to actually apply**:
omit the package's key from `.release-please-manifest.json` entirely
— don't seed it at `0.0.0-alpha.0` "just to have something there."

```json
// .github/.release-please-manifest.json
{}
```

not

```json
// WRONG if you want initial-version honored
{ "ts": "0.0.0-alpha.0" }
```

**If the manifest is already seeded and you can't easily strip the
key** (e.g. mid-project, other tooling depends on the key existing):
use a `Release-As: <target-version>` footer on the next commit
instead — it overrides regardless of manifest state, for every package
the commit reaches ([What a pin reaches](#what-a-pin-reaches), and
[Release-As is global across components in manifest mode](#release-as-is-global-across-components-in-manifest-mode)
below).

## Release-As is global across components in manifest mode

In `separate-pull-requests: true` manifest mode (multiple packages
in one repo, one release-please config), a single unscoped
`Release-As: X.Y.Z-alpha.0` footer applies to **every** package the
commit reaches — not just one. An initial commit touches every
package; an empty commit reaches every package but one with
`exclude-paths` ([What a pin reaches](#what-a-pin-reaches)).

Verified empirically against a 7-package manifest repo:

- One `Release-As: 0.1.0-alpha.0` footer on a single commit reaching
  all 7 packages produced candidate releases for all 7, each at
  `0.1.0-alpha.0`.
  This is what you want if you're bootstrapping a polyglot repo's
  first release across every component at the same version — see
  [docs/bootstrap-checklist.md § Cut the first release](../../docs/bootstrap-checklist.md#6-cut-the-first-release).
- **There is no per-component scoping syntax.** A footer like
  `Release-As: my-ts-component: 0.2.0-alpha.0` is NOT parsed as
  "scope this to my-ts-component." release-please pulls the first
  `x.y.z[-pre]` out of the value and drops the rest, so the prefix is
  ignored: every package the commit reaches gets `0.2.0-alpha.0`, with
  no error and no warning (probed: `Release-As: kit-ts: 0.9.0` on a
  commit touching kit-ts and qmochi proposed both at `0.9.0`). This is
  worse than the footer being ignored.
- **Only the first `Release-As:` line wins** if a commit body has
  more than one. The rest are silently ignored — no error, no merge
  of the values.

**If you need different starting versions per package** in the same
bootstrap commit, `Release-As` can't do it. Either bootstrap them in
separate commits (one `Release-As` footer each), or accept the same
starting version across all packages and let subsequent normal
`feat:`/`fix:` commits diverge them from there.

## Linked versions

release-please's `linked-versions` is a plugin, read only from
`plugins[]`; a top-level `"linked-versions"` key is ignored without a
word (release-please does not validate config keys). As a plugin it
links **every** release: once any member has a release, it forces every
member to the highest version proposed among the members that have
one, adds a synthetic `chore(<component>): Synchronize <group>
versions` commit with a `Release-As:` footer to members with no
release of their own, and merges the group into one PR (`merge`
defaults to `true`). It compares proposals, not current versions, so a
member can move backwards: kit at `0.5.0-alpha.3`, a fix on kit-ts at
`0.5.0-alpha.1` gives every member `0.5.0-alpha.2`.

```json
"plugins": [
  {"type": "linked-versions", "groupName": "kit", "components": ["kit", "kit-py", "kit-ts"]}
]
```

To link a family only when it opens a new major (and, before 1.0, a
new minor), and never backwards, use target versioning's
`conditional-linked-versions`
([target versioning § Linked family](target-versioning.md#linked-family)).

## Always dry-run before merging a manifest reseed

```sh
npx release-please@latest release-pr \
  --token "$(gh auth token)" \
  --repo-url <url> \
  --config-file .github/release-please-config.json \
  --manifest-file .github/.release-please-manifest.json \
  --target-branch <branch> \
  --dry-run | grep '^title:'
```

The actual proposed titles tell you exactly what release-please
will emit.

## Common issues

| Problem | Cause | Fix |
|---|---|---|
| First release is `x.y.z-alpha`, then `alpha.1`; `alpha.0` never ships | `prerelease-type: "alpha"` instead of `"alpha.0"` | Use `"alpha.0"` so the counter has a starting digit |
| First release proposes `1.0.0` | No release known: no tag, and no manifest key or a `"0.0.0"` one (release-please reads `0.0.0` as none), so release-please opens at `initial-version`, `1.0.0` when unset | Set `initial-version` (`0.1.0-alpha.0`) with the manifest key absent; python ignores it ([above](#release-type-python-does-not-honor-initial-version)), so seed the manifest there. A `Release-As: 0.1.0` footer on the first commit also works on stock versioning |
| release-please proposes stable when you wanted prerelease | `prerelease: true` missing, or `versioning: "prerelease"` missing on a stable seed | Add all four pieces of the combo above |
| A breaking change kept the counter (`0.5.1-alpha.3` → `0.6.0-alpha.3`) | Stock behaviour: the counter carries over a new line | A `Release-As` footer per line, or [target versioning](target-versioning.md) |
| `Release-As` / `release-as` released nothing for a package | The commit did not reach it (an empty commit skips a package with `exclude-paths`), or the field had no visible commit | [What a pin reaches](#what-a-pin-reaches) |
| Linked group members move separately | `linked-versions` at the top level of the config, not in `plugins[]` | Move it into `plugins[]` ([Linked versions](#linked-versions)) |

## Next steps

- [Add the preflight check](add-preflight.md) — catches missing combo pieces at PR time.
- [concepts/version-strings.md](../concepts/version-strings.md) — SemVer ∩ PEP 440 ∩ Composer constraints.
- [troubleshooting/common-pitfalls.md](../troubleshooting/common-pitfalls.md).
