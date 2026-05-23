# Ship installable binaries

Add cross-platform binaries, desktop apps, or package-manager
formulae on top of the language-registry publish.

## Use this when

- You're shipping a Go CLI that needs Homebrew/Scoop/WinGet formulae.
- You want platform-specific binaries attached to each GitHub Release.
- You have a Rust/Python/Node app that compiles to a single distributable.

## Result

When a tag is cut, a language-specific builder workflow runs in
parallel with `publish-on-tag.yml` and attaches binaries (and any
formulae updates) to the same GitHub Release.

## The split

`publish-on-tag.yml` handles **language-registry publishing** (npm,
PyPI, crates.io, Packagist) plus the read-only mirror push. It
doesn't handle **installable artifacts**. Those need a
language-specific builder, each with its own canonical tool and
its own prefix-stripping quirks when paired with release-please's
`<component>/v<version>` tag shape.

Per-language reusable workflows live alongside `publish-on-tag.yml`
in this repo, with focused reference docs:

| Language | Reusable workflow | Reference | Status |
|---|---|---|---|
| Go | `goreleaser-on-tag.yml` | [docs/binaries/go.md](../../docs/binaries/go.md) | shipped |
| Rust | (planned) `cargo-dist-on-tag.yml` | [docs/binaries/rust.md](../../docs/binaries/rust.md) | stub |
| Python | (planned) `pyinstaller-on-tag.yml` | [docs/binaries/python.md](../../docs/binaries/python.md) | stub |
| TypeScript / Node | (planned) `pkg-on-tag.yml` or electron equivalent | [docs/binaries/typescript.md](../../docs/binaries/typescript.md) | stub |

## Composition

Each binary workflow fires on the same tag-push event as
`publish-on-tag.yml`, in parallel. The GitHub Release is created
by release-please at tag-cut time; both layers attach their
artifacts to that existing release.

```
release-please cuts tag <component>/v<version>
  ↓
publish-on-tag.yml fires        ← language-registry + mirror push
  ↓ (in parallel)
<lang>-on-tag.yml fires         ← installable artifacts (binaries, formulae, …)
```

You opt into the binaries lane per language — most adopter repos
won't need it. Pick the reference doc for your language and
follow the caller-workflow snippet there.

## Org-wide tap/bucket convention

When shipping binaries via package managers, **use the org-wide
tap/bucket repos** — not per-binary ones. For hop-top:

| Manager | Tap/bucket repo | NOT |
|---|---|---|
| Homebrew | `hop-top/homebrew-tap` | `hop-top/homebrew-<name>` |
| Scoop | `hop-top/scoop-bucket` | `hop-top/scoop-<name>` |

Why: per-binary taps multiply maintenance (separate CI, separate
access tokens, users have to `brew tap` once per tool). The
org-wide tap pattern means users `brew tap hop-top/tap` once and
get every hop-top binary via `brew install hop-top/tap/<name>`.

goreleaser's `brews[].repository.name` field controls this; set
it to `homebrew-tap`. Same for `scoops[].repository.name` — set
it to `scoop-bucket`.

The reference doc ([docs/binaries/go.md](../../docs/binaries/go.md))
covers the goreleaser config in detail — this is just the
entry-point reminder.

## Common pitfall

Created `homebrew-<binary>` or `scoop-<binary>` tap/bucket repo
per binary: misread convention. Use `<org>/homebrew-tap` +
`<org>/scoop-bucket` (single repos serving every org binary).
Delete the per-binary tap/bucket; point goreleaser's
`brews[].repository.name` at `homebrew-tap` and
`scoops[].repository.name` at `scoop-bucket`.

## Next steps

- [docs/binaries/go.md](../../docs/binaries/go.md) — full goreleaser setup with WinGet support.
- [troubleshooting/common-pitfalls.md](../troubleshooting/common-pitfalls.md).
