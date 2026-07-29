# Stay in a prerelease channel

Keep release-please incrementing an alpha/beta/rc counter instead of bumping to stable.

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
package in `release-please-config.json` needs **all four pieces**:

```json
{
  "prerelease": true,
  "prerelease-type": "alpha.0",
  "versioning": "prerelease",
  "bump-minor-pre-major": true
}
```

And the manifest seed must be **prerelease-shaped**:

```json
{ "sdk/ts": "0.3.0-alpha.0" }   // stays prerelease
{ "sdk/ts": "0.3.0" }           // next bump is stable 0.4.0
```

## Why each piece matters

| Piece | Without it |
|---|---|
| `prerelease: true` | Suffix isn't applied at all |
| `prerelease-type: "alpha.0"` | First release skips `alpha.0` and starts at `alpha.1` |
| `versioning: "prerelease"` | Counter-only mode is off; base bumps produce stable versions even with `prerelease: true` |
| Prerelease-shaped manifest seed | release-please sees the prior release as stable, bumps to the next stable |

## Leave the channel (cut stable)

The prerelease suffix is "sticky" — only an explicit footer
escapes it. Add a `Release-As: X.Y.Z` footer (no suffix) on a
commit:

```
feat: add long-awaited X

Release-As: 1.0.0
```

## Jump base while staying prerelease

For example, `0.3.0-alpha.5 → 0.4.0-alpha.0`. Add a `Release-As` footer with the desired prerelease:

```
feat!: breaking redesign of Y

Release-As: 0.4.0-alpha.0
```

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
instead — it overrides regardless of manifest state. See [Release-As
is global across components in manifest mode](#release-as-is-global-across-components-in-manifest-mode)
below for the multi-package caveat.

## Release-As is global across components in manifest mode

In `separate-pull-requests: true` manifest mode (multiple packages
in one repo, one release-please config), a single unscoped
`Release-As: X.Y.Z-alpha.0` footer applies to **every** package
release-please would otherwise consider — not just one.

Verified empirically against a 7-package manifest repo:

- One `Release-As: 0.1.0-alpha.0` footer on a single commit produced
  candidate releases for all 7 packages, each at `0.1.0-alpha.0`.
  This is what you want if you're bootstrapping a polyglot repo's
  first release across every component at the same version — see
  [docs/bootstrap-checklist.md § Cut the first release](../../docs/bootstrap-checklist.md#6-cut-the-first-release).
- **There is no per-component scoping syntax.** A footer like
  `Release-As: my-ts-component: 0.2.0-alpha.0` is NOT parsed as
  "scope this to my-ts-component." release-please treats the entire
  string after `Release-As:` as one opaque version token and applies
  it uniformly to every package — it does not error, it does not
  warn, it just silently produces a garbage or wrong version across
  the board. This is worse than the footer being ignored.
- **Only the first `Release-As:` line wins** if a commit body has
  more than one. The rest are silently ignored — no error, no merge
  of the values.

**If you need different starting versions per package** in the same
bootstrap commit, `Release-As` can't do it. Either bootstrap them in
separate commits (one `Release-As` footer each), or accept the same
starting version across all packages and let subsequent normal
`feat:`/`fix:` commits diverge them from there.

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
| First release skips `alpha.0` and starts at `alpha.1` | `prerelease-type: "alpha"` instead of `"alpha.0"` | Use `"alpha.0"` so the counter has a starting digit |
| `feat:` from `0.0.0` jumps to `1.0.0` | release-please's "0.0.0 trap" — treats `0.0.0` as "no prior release" | Bootstrap with `Release-As: 0.1.0` footer on the first commit |
| release-please proposes stable when you wanted prerelease | Missing `versioning: "prerelease"` and/or manifest seed is stable | Add all four pieces of the combo above |

## Next steps

- [Add the preflight check](add-preflight.md) — catches missing combo pieces at PR time.
- [concepts/version-strings.md](../concepts/version-strings.md) — SemVer ∩ PEP 440 ∩ Composer constraints.
- [troubleshooting/common-pitfalls.md](../troubleshooting/common-pitfalls.md).
