# Pin the reusable workflow

Pick the right `uses:` ref for the publish-on-tag reusable workflow.

## Use this when

- Setting up `publish.yml` for the first time.
- Deciding between rolling-major, exact, and tracking-main.
- Recovering from a workflow change that broke your pipeline.

## Result

You know which of three pinning strategies matches your risk tolerance, and the tradeoffs of each.

## Quick version

```yaml
uses: hop-top/.github/.github/workflows/publish-on-tag.yml@v0  # use this
```

`@v0` is the rolling major — it follows every stable release of the 0.x
line. Before 1.0 that includes breaking changes (see
[How rolling majors work](#how-rolling-majors-work)).

## The three options

| Pin | Behavior | Use when |
|---|---|---|
| `@v0` | Rolling major. Moves on every stable release: `v0.1.0 → v0.1.1 → v0.2.0`. Before 1.0 a breaking change ships as a minor, so it moves `@v0` too. Only 1.0.0 and later open a new major that needs an explicit opt-in to `@v1`. Prereleases never move it. | **Default.** Production pipelines that accept 0.x changes. |
| `@v0.1.0` | Exact tag, frozen. No patches propagate. A commit SHA freezes the same way. | You hit a regression on the rolling tag, or cannot take a breaking change in 0.x, and need to pin while it's fixed. |
| `@main` | Tracks the latest commit, including breaking changes. | Non-production repos only. Useful when developing or testing this repo's workflows. |

## How rolling majors work

Tags follow plain semver: `v0.1.0`, `v0.2.0`, `v1.0.0`. The rolling
majors (`v0`, `v1`, …) are maintained automatically by this repo's
[`roll-major-tag.yml`](../.github/workflows/roll-major-tag.yml)
workflow — when a stable `v0.X.Y` is pushed, `roll-major-tag`
force-moves `v0` to the same commit (creating it if missing). A tag
with a prerelease suffix or build metadata (`v0.15.0-rc.1`) leaves
`v0` where it is, with a notice: `@v0` callers never run a prerelease.

This repo sets `bump-minor-pre-major`, so before 1.0 a breaking change
(`feat!:`) is released as a minor (`0.14.1` → `0.15.0`) and moves `v0`
like any other release. `@v0` therefore does not guarantee
non-breaking updates while the line is 0.x; read the
[changelog](../CHANGELOG.md) before a minor, or pin an exact tag or
SHA.

When the maintainers cut `v1.0.0`, breaking changes get a new major
from then on and `v0` stays at the last `v0.X.Y`. Consumers opt into
v1 by editing their `publish.yml`.

To create a rolling tag that is missing, or point it at an existing
stable tag, run `roll-major-tag` by hand (`workflow_dispatch`, input
`version`, e.g. `v0.1.0`). It sets the major tag to the tag you name;
it does not check that the tag is the newest.

## Next steps

- [Quick-start](quick-start.md) — copy-paste the two workflow files.
- [Re-trigger a failed publish](how-to/retrigger-failed-publish.md) — what to do when a tag already shipped against an older `v0`.
