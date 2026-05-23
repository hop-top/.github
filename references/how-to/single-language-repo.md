# Configure a single-language repo

Ship a repo that has only one ecosystem (no polyglot split).

## Use this when

- Your repo is `ts`-only, `py`-only, or `rs`-only.
- Your repo is Go-only.
- Your repo is php-only.
- You want to skip the mirror push because there's no second-slot mirror repo.

## Result

You know whether to keep `publish.yml` at all, and if so, what
configuration matches your case.

## Decision table

The right config depends on whether `publish-on-tag.yml` has any
work to do for that ecosystem beyond the mirror:

| Ecosystem | `publish-X` job fires? | Mirror needed? | Recommended config |
|---|---|---|---|
| `go` | No (proxy.golang.org pulls tags directly) | No (source IS the bare-name install slot — no second-slot mirror) | **Drop `publish.yml` entirely** |
| `ts` | Yes (`pnpm publish` → npm) | Optional | Keep `publish.yml`; set `enable-mirror: false` unless a real `<name>-ts` mirror exists |
| `py` | Yes (`twine`/OIDC → PyPI) | Optional | Same as `ts` |
| `rs` | Yes (`cargo publish` → crates.io) | Optional | Same as `ts` |
| `php` | Yes (`publish-php` notifies Packagist after mirror push) | **Required** — Packagist polls the mirror, not the source | Keep `publish.yml`; `enable-mirror: false` is rejected at parse time for php |

For the Go-only case, `publish-on-tag.yml` has nothing to do —
proxy.golang.org pulls directly from the source repo. Keeping
`publish.yml` would only fire the (unwanted) mirror push.

For `ts`/`py`/`rs`-only repos, the publish step IS needed but the
unconditional mirror destination is awkward when there's no
canonical second-slot repo. Use `enable-mirror: false`:

## Steps (ts-only repo, no mirror)

```yaml
name: publish

on:
  push:
    tags: ['*/v*']

jobs:
  publish:
    permissions:
      contents: read
      id-token: write
    uses: hop-top/.github/.github/workflows/publish-on-tag.yml@v0
    secrets:
      NPM_REGISTRY_TOKEN: ${{ secrets.NPM_REGISTRY_TOKEN }}
      GH_MIRROR_PAT: ${{ secrets.GH_MIRROR_PAT }}  # still required by the schema
    with:
      enable-mirror: false
      ecosystems: |
        ts: { dir: ., ecosystem: ts, package: "@org/pkg", mirror: org/pkg-ts }
```

## How `enable-mirror` works

`enable-mirror` defaults to `true` for back-compat with existing
polyglot callers — single-language adopters opt out explicitly.

- `GH_MIRROR_PAT` is still required by the workflow's `secrets:` contract even when `enable-mirror: false` (the mirror job's `if:` gates the run, not the schema). Pass the real PAT; it's not consumed when the gate is `false`.
- Same goes for `mirror:` inside the `ecosystems` map — the parse step reads it but the mirror job is skipped, so a placeholder slug (no real repo needed) satisfies the YAML schema.

## PHP rejects `enable-mirror: false`

If a caller sets `enable-mirror: false` with `ecosystem: php`, the
`parse` job fails early:

```
::error::ecosystem=php requires enable-mirror=true (Packagist notify depends on the mirror job)
```

The `publish-php` job has `needs: mirror` — Packagist polls the
mirror slug, not the source. There is no "publish to Packagist
without the mirror" path. See [troubleshooting/php.md § PHP
requires the mirror](../troubleshooting/php.md#php-requires-the-mirror).

## Next steps

- [Quick-start](../quick-start.md) — the polyglot template.
- [references/ecosystems.md](../ecosystems.md) — field-by-field reference for the `ecosystems` map.
- [troubleshooting/common-pitfalls.md](../troubleshooting/common-pitfalls.md).
