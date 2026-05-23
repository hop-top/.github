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

`@v0` is the rolling major — auto-updates on non-breaking releases.

## The three options

| Pin | Behavior | Use when |
|---|---|---|
| `@v0` | Rolling major. Auto-updates `v0.1.0 → v0.1.1 → v0.2.0`. Breaking changes (v1.0.0) require an explicit opt-in to `@v1`. | **Default.** Production pipelines. |
| `@v0.1.0` | Exact tag, frozen. No patches propagate. | You hit a regression on the rolling tag and need to pin while it's fixed. |
| `@main` | Tracks the latest commit, including breaking changes. | Non-production repos only. Useful when developing or testing this repo's workflows. |

## How rolling majors work

Tags follow plain semver: `v0.1.0`, `v0.2.0`, `v1.0.0`. The rolling
majors (`v0`, `v1`, …) are maintained automatically by this repo's
[`roll-major-tag.yml`](../.github/workflows/roll-major-tag.yml)
workflow — when `v0.X.Y` is pushed, `roll-major-tag` force-moves
`v0` to the same commit.

When the maintainers cut `v1.0.0` (breaking), `v0` stays at the
last `v0.X.Y`. Consumers opt into v1 by editing their `publish.yml`.

## Next steps

- [Quick-start](quick-start.md) — copy-paste the two workflow files.
- [Re-trigger a failed publish](how-to/retrigger-failed-publish.md) — what to do when a tag already shipped against an older `v0`.
