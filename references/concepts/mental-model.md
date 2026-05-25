# Mental model

Understand how release-please, publish-on-tag, and the mirror push
fit together.

## Use this when

- You're new to this skill and want the big picture.
- You're debugging why something didn't fire — knowing which layer owns what helps narrow it down.

## Result

You can name the two halves of the pipeline (version/tag vs.
publish/mirror/artifacts), which lives where, and how they
compose.

## The flow

```
commits → release-please opens standing PR
            ↓ merge
          release-please creates tag <component>/v<version>
            ↓ tag push
          publish.yml triggers          (+ optional <lang>-binaries.yml)
            ↓ uses:                        ↓ uses:
          publish-on-tag.yml             <lang>-on-tag.yml (per language)
            ↓ dispatches                   ↓
          publish-{ts,py,rs}.yml +       installable artifacts
            mirror-subtree.yml +         (binaries, formulae, …)
            publish-php (Packagist)        ↓
            ↓                              GitHub Release assets
          registry + mirror push
```

For Go: vanity URLs (`hop.top/<name>`) are resolved live by a
Cloudflare Worker on `hop-top/hop.top` — not produced by the
release pipeline. The mirror push is what makes them clone-able;
no extra notification step is needed. See
[vanity-imports.md](vanity-imports.md).

## Who owns what

| Half | Lives in | Responsibility |
|---|---|---|
| **Version/tag** | YOUR repo (release-please) | Walk commits, propose next versions, open standing PRs, cut tags on merge. |
| **Publish/mirror/artifacts** | `hop-top/.github` | On tag push: publish to registry, push read-only mirror, build installable artifacts. |

Both compose; you wire them up.

## The per-language binaries lane

`publish-on-tag.yml` handles **language-registry publishing** (npm,
PyPI, crates.io, Packagist) plus the read-only mirror push. It
does **not** handle **installable artifacts** — cross-platform
binaries, desktop apps, package-manager formulae. Those need a
language-specific builder, each with its own canonical tool.

Per-language reusable workflows live alongside `publish-on-tag.yml`
in this repo, with focused reference docs:

| Language | Reusable workflow | Reference | Status |
|---|---|---|---|
| Go | `goreleaser-on-tag.yml` | [docs/binaries/go.md](../../docs/binaries/go.md) | shipped |
| Rust | (planned) `cargo-dist-on-tag.yml` | [docs/binaries/rust.md](../../docs/binaries/rust.md) | stub |
| Python | (planned) `pyinstaller-on-tag.yml` | [docs/binaries/python.md](../../docs/binaries/python.md) | stub |
| TypeScript / Node | (planned) `pkg-on-tag.yml` or electron equivalent | [docs/binaries/typescript.md](../../docs/binaries/typescript.md) | stub |

Composition: each fires on the same tag-push event as
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

The binaries lane is opt-in — most adopter repos won't need it.

## Snapshot semantics

The single most-counterintuitive thing about this pipeline:

**`publish.yml` runs against the `publish.yml` at the tag's commit,
NOT current `main`.**

When a tag is pushed, GitHub Actions snapshots the workflow file
from that commit's tree. Three consequences:

1. Fixing `publish.yml` on main doesn't help an already-pushed tag.
2. `gh run rerun <id>` reuses the originally-resolved workflow refs (including `@main` and `@v0`) — it does NOT pick up newer reusable workflows automatically.
3. The reliable retry: **delete the tag + recreate it at current main**. See [how-to/retrigger-failed-publish.md](../how-to/retrigger-failed-publish.md).

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
lookup fails with `Unknown component '<tag-prefix>'` at parse time,
before any publish work happens.

## Next steps

- [references/quick-start.md](../quick-start.md) — see the model in code.
- [concepts/facade-pattern.md](facade-pattern.md) — why secret names are decoupled from upstream tool names.
- [concepts/install-model.md](install-model.md) — what the workflows install vs. what you install.
