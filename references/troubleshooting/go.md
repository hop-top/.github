# Go troubleshooting

Go module-specific failure modes.

## Use this when

- `go get <module>@latest` returns a pseudo-version after a real release.
- A root-component (`dir: "."`) mirror push fails.
- You're moving an existing Go module onto this pipeline.

## Result

You can diagnose the most common go failure modes and pick the
right fix.

## Ghost versions

`proxy.golang.org` is content-addressed and **immutable**. Once a
version slot is filled, it can never be republished. The proxy's
`@v/list` also caches version names even after the underlying git
tags are deleted (these become "ghosts" — listed but unresolvable).

Symptom: `go get hop.top/<module>@latest` returns a pseudo-version
(`v0.0.0-<commit>-<sha>`) instead of the real tag you just cut.

Cause: a previous incarnation of the module polluted the proxy
with versions that outrank your new tag.

Fix: bump the next release to a version strictly greater than
every ghost so `@latest` resolves correctly:

```sh
curl -s 'https://proxy.golang.org/<module>/@v/list' | sort -V
# Pick a next version above the highest ghost
```

Use a `Release-As: <next-base>-alpha.0` footer or manifest reseed
to jump the base. See [how-to/prerelease-channel.md § Jump base
while staying prerelease](../how-to/prerelease-channel.md#jump-base-while-staying-prerelease).

## Root-component caveats

When the Go module lives at the repo root (`dir: "."`), the mirror
job synthesizes a commit excluding `.github/workflows/` because:

1. `git subtree split --prefix=.` is rejected by git.
2. Mirror repos are read-only artifacts; pushing CI workflows to them triggers GitHub's PAT `workflow` scope guard (`refusing to allow a Personal Access Token to create or update workflow ... without 'workflow' scope`).

`mirror-subtree.yml@v0.4.2+` handles this automatically. No
consumer-side config needed.

If you're pinned to an older version, you'll see errors like:

- `fatal: . does not exist; use git subtree add` (resolved at `v0.4.1+`)
- `refusing to allow a Personal Access Token to create or update workflow ... without 'workflow' scope` (resolved at `v0.4.2+`)

Fix: pin to `@v0` rolling tag.

## Bare-name convention

Go ALWAYS takes the bare-name slot in the hop-top org. Vanity
imports like `hop.top/kit` resolve to `github.com/hop-top/kit` by
default; a `hop-top/kit-go` repo would break that resolution.
`<name>-go` does NOT exist in this org — ever.

This means: don't create `hop-top/<name>-go` mirror repos. The Go
mirror is the bare-name slot `hop-top/<name>`.

For the full resolver mechanism (Cloudflare Worker, `homebrew-tap`
overrides, convention fallback, cache behavior) see
[concepts/vanity-imports.md](../concepts/vanity-imports.md).

## No publish-from-source step

The Go ecosystem has no `publish-go` job. proxy.golang.org pulls
from git tags directly. The pipeline for go is:

```
tag push <component>/v<x.y.z>
  ↓ parse → ecosystem=go → mirror runs
  ↓ proxy.golang.org polls bare-name mirror on next fetch
```

If `<component>` is your only ecosystem, you can drop `publish.yml`
entirely. See [how-to/single-language-repo.md](../how-to/single-language-repo.md).

## Common issues

| Problem | Cause | Fix |
|---|---|---|
| `go get @latest` returns a pseudo-version | Ghost versions in proxy outrank new tag | Bump next release above the highest ghost |
| `fatal: . does not exist; use git subtree add` | Old `mirror-subtree.yml` doesn't handle root components | Pin to `@v0` (≥ v0.4.1) |
| `refusing to allow a Personal Access Token to create or update workflow` | Old `mirror-subtree.yml` pushed `.github/workflows/` to mirror | Pin to `@v0` (≥ v0.4.2) |
| `hop.top/<x>?go-get=1` returns vanity but `go get` fails with 404 | Resolver has no allowlist — convention fallback returns vanity for any name, including typos and unpushed repos | Verify `hop-top/<x>` actually exists on GitHub; if it should clone something else, add `<x>.rb` to `homebrew-tap` with the right `homepage`. See [concepts/vanity-imports.md](../concepts/vanity-imports.md). |
| `hop.top/<x>?go-get=1` returns the wrong repo URL | `homebrew-tap` has `<x>.rb` with a stale or incorrect `homepage` field | Update or delete `<x>.rb` in `hop-top/homebrew-tap`. Edge cache TTL is 1h. |

## Next steps

- [how-to/single-language-repo.md](../how-to/single-language-repo.md) — Go-only repo config.
- [docs/binaries/go.md](../../docs/binaries/go.md) — goreleaser setup for shipping binaries.
