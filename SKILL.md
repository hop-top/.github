---
name: hop-top-dotgithub
description: Use hop-top/.github's reusable workflows to publish releases (npm/PyPI/crates.io/Packagist) and push subtree mirrors. Use when wiring a hop-top repo's release pipeline to call publish-on-tag.yml on `<component>/v<version>` tag pushes, adding the release-please-preflight check, mapping registry secrets, troubleshooting why a tag didn't trigger a publish, registering a new package on PyPI/Packagist (via OIDC trusted publishing or API tokens), creating GitHub Environments, or debugging pnpm 11 strict-mode install failures.
---

# Using hop-top/.github

Wire your hop-top repo's release pipeline into the shared
publish/mirror/artifacts workflows in `hop-top/.github`.

## Use this when

- You're setting up release automation for a new polyglot repo.
- You're adding a new ecosystem (ts/py/rs/php/go) to an existing repo.
- A release pipeline misfired and you need to diagnose it.
- You're picking between OIDC and API-token modes for PyPI/Packagist.

This skill is for **consumers**. If you're modifying the
workflows themselves, see [`DEVELOPING.md`](DEVELOPING.md).

## Result

After applying this skill, every merge of a release-please standing
PR cuts a `<component>/v<version>` tag, which triggers:

- The matching language-registry publish (npm / PyPI / crates.io / Packagist notify). Go has no publish-from-source step — proxy.golang.org pulls from the tag directly.
- A read-only mirror push to `<org>/<name>-<lang>` (or `<org>/<name>` for Go, which takes the bare-name slot — see [Repo naming convention](#repo-naming-convention) below).
- (Optionally) language-specific installable artifacts via `<lang>-on-tag.yml`.

## Find your intent

| What you're trying to do | Go to |
|---|---|
| Set up a brand-new repo's release pipeline | [references/quick-start.md](references/quick-start.md) |
| Run the full first-time-setup checklist | [docs/bootstrap-checklist.md](docs/bootstrap-checklist.md) |
| Catch misconfigurations at PR time | [references/how-to/add-preflight.md](references/how-to/add-preflight.md) |
| Configure a single-language repo (no polyglot split) | [references/how-to/single-language-repo.md](references/how-to/single-language-repo.md) |
| Stay in an alpha/beta/rc channel | [references/how-to/prerelease-channel.md](references/how-to/prerelease-channel.md) |
| Keep a monorepo Release-free (Releases only on mirrors) | [references/how-to/release-free-monorepo.md](references/how-to/release-free-monorepo.md) |
| Re-trigger a failed publish | [references/how-to/retrigger-failed-publish.md](references/how-to/retrigger-failed-publish.md) |
| Understand why a workflow-file fix on main doesn't apply on rerun | [Re-runs use the tag's workflow snapshot, not main](#re-runs-use-the-tags-workflow-snapshot-not-main) |
| Bootstrap a hand-populated mirror before the first tag | [Bootstrap-mirror gotcha](#bootstrap-mirror-gotcha) |
| Understand why an umbrella tag (`<umbrella>/vX.Y.Z`) shows all-skipped | [Umbrella / meta-component tags](#umbrella--meta-component-tags) |
| Re-trigger release-please after sibling-PR conflicts | [references/how-to/retrigger-release-please.md](references/how-to/retrigger-release-please.md) |
| Ship installable binaries (Homebrew, Scoop, WinGet, …) | [references/how-to/ship-binaries.md](references/how-to/ship-binaries.md) |
| Look up a secret name | [references/secrets.md](references/secrets.md) |
| Publish to npm without tokens (trusted publishing) | [references/how-to/npm-trusted-publishing.md](references/how-to/npm-trusted-publishing.md) |
| Look up an `ecosystems` field | [references/ecosystems.md](references/ecosystems.md) |
| Pick the right `@v0` / `@v0.x.y` / `@main` pin | [references/pinning.md](references/pinning.md) |
| Understand the overall flow | [references/concepts/mental-model.md](references/concepts/mental-model.md) |
| Understand why secret names are canonical | [references/concepts/facade-pattern.md](references/concepts/facade-pattern.md) |
| Understand the install model | [references/concepts/install-model.md](references/concepts/install-model.md) |
| Understand how `hop.top/<x>` vanity URLs resolve | [references/concepts/vanity-imports.md](references/concepts/vanity-imports.md) |
| Understand SemVer ∩ PEP 440 ∩ Composer constraints | [references/concepts/version-strings.md](references/concepts/version-strings.md) |
| Understand why release PRs come from release-bot | [references/concepts/release-bot.md](references/concepts/release-bot.md) |
| Understand when releases ship (lanes, channels, cadence) | [docs/release-schedule.md](docs/release-schedule.md) |
| Generate doc lists from code (kill stale enumerations) | [docs/generated-docs.md](docs/generated-docs.md) |
| Triage a release-pipeline failure | [references/troubleshooting/common-pitfalls.md](references/troubleshooting/common-pitfalls.md) |
| ts-specific failure | [references/troubleshooting/ts.md](references/troubleshooting/ts.md) |
| py-specific failure | [references/troubleshooting/py.md](references/troubleshooting/py.md) |
| rs-specific failure | [references/troubleshooting/rs.md](references/troubleshooting/rs.md) |
| php-specific failure | [references/troubleshooting/php.md](references/troubleshooting/php.md) |
| go-specific failure | [references/troubleshooting/go.md](references/troubleshooting/go.md) |

## Two essentials you need before anything else

The two pieces below are recognition-critical: without them, every
other doc reads wrong. Everything else is in `references/`.

## Repo naming convention

Polyglot repos in the hop-top org follow a strict shape:

| Shape | Pattern | Example |
|---|---|---|
| Polyglot source | `poly-<name>` | `hop-top/poly-kit` |
| Go mirror (or single-language Go repo) | `<name>` (bare) | `hop-top/kit`, `hop-top/uri`, `hop-top/tlc` |
| TS mirror | `<name>-ts` | `hop-top/kit-ts` |
| Py mirror | `<name>-py` | `hop-top/kit-py` |
| Rust mirror | `<name>-rs` | `hop-top/kit-rs` |
| PHP mirror | `<name>-php` | `hop-top/kit-php` |

**Go ALWAYS takes the bare-name slot.** Vanity imports like
`hop.top/kit` resolve to `github.com/hop-top/kit` by default; a
`hop-top/kit-go` repo would break that resolution. `<name>-go`
does NOT exist in this org — ever. See [vanity imports
concept](references/concepts/vanity-imports.md) for the resolver
mechanism and how to override per-name.

**Tag shape is `<component>/v<version>` everywhere**, including
single-language repos (e.g. `tlc/v1.4.2`, not `v1.4.2`). The
`tags: ['*/v*']` glob in `publish.yml` requires this — bare
`v...` tags would never trigger publish.

## Tag-shape glob trap

The `tags: ['*/v*']` filter is **single-segment**: `*` does NOT
match `/`. Tags like `sdk/ts/v0.2.0-alpha.0` (3-segment) silently
fail to trigger `publish.yml`. The release-please-action's
`component` field is what produces the tag prefix, so component
names with `/` in them are the trap.

✅ Good: `component: kit-ts` → tag `kit-ts/v0.2.0-alpha.0` → publish fires.
✗ Bad: `component: sdk/ts` → tag `sdk/ts/v0.2.0-alpha.0` → publish silent.

The `path` (manifest key) can contain `/` — only the `component`
must be a single segment.

## Three-way name alignment

For each shipping component, three names must match exactly:

```
release-please-config.json:packages.<path>.component
        ==
publish.yml:ecosystems.<KEY>
        ==
mirror repo basename (org/<name>)
```

If they drift, `publish-on-tag.yml`'s `ecosystems[<component>]`
lookup fails with `Unknown component '<tag-prefix>'` at parse
time, before any publish work happens.

## Umbrella / meta-component tags

Some release-please setups define an umbrella entry (the `.` root in
the manifest, e.g. `poly-cite`, `poly-uri`, `poly-kit`) that bumps
repo-level meta changes with no publish target. Its tag fires
`publish.yml` like any other; `publish-on-tag.yml` resolves the
component prefix against the caller's `ecosystems` map, finds no
match, and **skips cleanly with a `::notice::`** — every downstream
job no-ops via the empty `ecosystem` output. The workflow finishes
green with all publish jobs marked `skipped`. Do NOT add a stub
entry to `ecosystems` for the umbrella; the skip is the contract.

## Bootstrap-mirror gotcha

`mirror-subtree.yml` does a non-force subtree push, which assumes
the mirror's `main` is empty or a strict descendant of what the
subtree split produces. Two bootstrap shapes are safe:

1. **Empty mirror repo** — `gh repo create <org>/<name>-<lang>
   --public --description "..."` and stop. The first tag's subtree
   push initialises `main` cleanly.
2. **Pre-registration mirror** — if you must seed `main` before the
   first tag (e.g. to register the repo on Packagist or claim a
   crates.io name), populate `main` with `git subtree split` from
   the polyglot source at the exact commit the first tag will land
   on, then push. Anything else (hand-written `README.md`,
   placeholder commits, license-only seed) will cause the first
   subtree publish to non-fast-forward and the `mirror` job to fail.

If you hit a non-fast-forward on the first publish:

- Delete and recreate the mirror as empty, then re-run the publish.
- OR hand-push a `git subtree split` of the source-commit-for-the-tag
  to the mirror's `main`, then re-run.

Force-push is intentionally NOT the default — a stray force from
`mirror-subtree.yml` would silently destroy a hand-written
pre-registration commit on the mirror. A `bootstrap-mirror: true`
per-component opt-in flag is a candidate future enhancement (would
flip the first publish to `--force-with-lease` then auto-revert);
not implemented yet.

## Re-runs use the tag's workflow snapshot, not main

When `publish.yml` fails on a tag and you fix the workflow on main,
**re-running the failed run still uses the workflow file from the
tag's commit, not current main**. Same for `workflow_dispatch` reruns
of an existing tag. The same applies to the reusable workflow
references (`@v0`, `@main`) — they're resolved at the original tag's
push time and frozen for the rerun.

Two paths to apply a main-side fix to an already-pushed tag:

- **Delete + recreate the tag at current main** — see
  [references/how-to/retrigger-failed-publish.md](references/how-to/retrigger-failed-publish.md).
  Reliable; works for both `publish.yml` and reusable-workflow fixes.
- **Cut a new patch tag with the fix included** — `gh release create
  <component>/v<next-patch>` after the fix lands on main. Use when
  the original tag is already published (npm/PyPI/etc. won't accept
  a re-publish of the same version anyway).

See [references/concepts/mental-model.md § Snapshot semantics](references/concepts/mental-model.md#snapshot-semantics)
for the full reasoning.

## Quick start (TL;DR)

Two workflow files in your repo. Full snippets:
[references/quick-start.md](references/quick-start.md).

```yaml
# .github/workflows/publish.yml
on:
  push:
    tags: ['*/v*']
  # Manual trigger: re-run a publish for an existing tag without re-pushing.
  # Note: GitHub Actions snapshots the workflow file at the tag's commit; a
  # `workflow_dispatch` rerun still replays against that snapshot. To pick up
  # fixes landed on main, delete + recreate the tag — see
  # `references/how-to/retrigger-failed-publish.md`.
  workflow_dispatch: {}

jobs:
  publish:
    permissions:
      contents: read
      id-token: write
    uses: hop-top/.github/.github/workflows/publish-on-tag.yml@v0
    secrets:
      NPM_REGISTRY_TOKEN:   ${{ secrets.NPM_REGISTRY_TOKEN }}
      CARGO_REGISTRY_TOKEN: ${{ secrets.CARGO_REGISTRY_TOKEN }}
      PACKAGIST_USERNAME:   ${{ secrets.PACKAGIST_USERNAME }}
      PACKAGIST_TOKEN:      ${{ secrets.PACKAGIST_TOKEN }}
      GH_MIRROR_PAT:        ${{ secrets.GH_MIRROR_PAT }}
    with:
      ecosystems: |
        ts:  { dir: ts,  ecosystem: ts,  package: "@org/pkg",  mirror: org/pkg-ts }
        # … py / rs / php / go as needed
```

## See also

- [`docs/bootstrap-checklist.md`](docs/bootstrap-checklist.md) — order of operations for a brand-new polyglot repo.
- [`docs/failure-modes.md`](docs/failure-modes.md) — extended symptom→cause→fix guide; covers each entry in the Common Pitfalls table with workflow-log excerpts, root-cause analysis, and what does NOT work.
- [`docs/browser-playbooks.md`](docs/browser-playbooks.md) — verbal step-by-step walkthroughs for web-side setup (PyPI trusted publisher, PyPI API token mint, Packagist registration, Packagist token mint, Packagist unmark abandoned, GitHub Environment creation, crates.io email verification).
- [`docs/architecture.md`](docs/architecture.md) — full control/data flow diagrams + design rationale.
- [`docs/generated-docs.md`](docs/generated-docs.md) — generated doc regions: metadata source, in-repo renderer, cog markers, staleness gate.
- [`docs/adr/`](docs/adr/) — architecture decision records.
- `custom-release-please` skill (separate) — the consumer-side release-please configuration concerns.
