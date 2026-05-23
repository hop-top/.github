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
