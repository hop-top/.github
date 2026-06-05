# Vanity imports

How `hop.top/<pkg>?go-get=1` resolves to a GitHub URL, and how to
override the default when you need to.

## Use this when

- You want to understand what makes `go get hop.top/<name>` work.
- You're debugging why `go get hop.top/<name>` clones the wrong repo.
- You want vanity for a name that doesn't match its GitHub repo
  (e.g. `hop.top/foo` → `github.com/hop-top/bar`).
- You're considering a rename and need to know what vanity will do.

## Result

You can predict what `https://hop.top/<x>?go-get=1` returns for any
`<x>`, name the override mechanism, and reason about edge cases.

## The resolver

`hop.top` is a Cloudflare Worker (source: `hop-top/hop.top` →
`worker/src/index.ts`) bound to `hop.top/*`. On each
`?go-get=1` request, it resolves the package name to a GitHub URL
using a two-step lookup:

```
hop.top/<pkg>?go-get=1
    ↓
1. Fetch raw.githubusercontent.com/hop-top/homebrew-tap/main/<pkg>.rb
   (cached at the Cloudflare edge for 1h)
   ↓
   Found?  →  Parse `homepage "..."` line  →  Use that URL
   ↓
   Not found / parse miss / network error
   ↓
2. Fall back to convention: github.com/hop-top/<pkg>
   ↓
Return go-import meta tag pointing at the resolved URL.
```

**No allowlist.** Any single-segment `<pkg>` resolves — to its
formula `homepage` if the formula exists, otherwise to the
convention. New repos get vanity the moment they exist on GitHub,
with zero registration step.

Reserved namespace: `x[number]` returns 404 (carve-out for future
`x402`-style protocol slots), except `x402` itself which resolves
normally.

Multi-segment paths (`hop.top/foo/bar`) do **not** return vanity —
they fall through to the main site proxy. There is no
submodule-key support in the resolver.

## Why this works for the polyglot mirror pattern

For Go subprojects of a `poly-<name>` repo (e.g. `cite` shipped
from `hop-top/poly-cite`, `xrr` from `hop-top/poly-xrr`), the convention works
without any formula because the **mirror** publishes the Go-only
subtree to `hop-top/<name>` on every tagged release:

```
hop-top/poly-kit  (polyglot source of truth)
    ↓  mirror-subtree.yml fires on <component>/v* tag push
hop-top/<name>    (read-only Go mirror; module = "hop.top/<name>")
    ↑
hop.top/<name>?go-get=1  →  github.com/hop-top/<name>  (via convention)
```

Go tooling clones the mirror, finds `module hop.top/<name>` in its
`go.mod`, everything resolves. This is the **bare-name slot
convention** described in [SKILL.md § Repo naming
convention](../../SKILL.md#repo-naming-convention) — and the reason
Go must take the bare-name slot is so the convention fallback
points at a clone-able mirror.

A `hop-top/<name>-go` repo would break this: convention would still
point at `hop-top/<name>` (which now wouldn't exist or wouldn't be
the Go mirror), and Go-get would 404 or clone the wrong thing.

## Override via formula

Add a file `<pkg>.rb` to `hop-top/homebrew-tap` with a `homepage`
line:

```ruby
class Foo < Formula
  homepage "https://github.com/hop-top/something-else"
end
```

After the next edge-cache TTL (1h max), `hop.top/foo?go-get=1`
returns a go-import meta tag pointing at
`https://github.com/hop-top/something-else`.

**When to use:**

- The vanity name doesn't match a GitHub repo (rename, alias, etc.).
- You want a name that historically referred to repo A to now point
  at repo B.

**When NOT to use:**

- The vanity name *does* match its GitHub repo (e.g. `hop.top/kit`
  → `hop-top/kit`). The convention fallback handles it; adding a
  formula is duplicate work that drifts over time.
- For binary-install support (`brew install hop-top/tap/<x>`).
  That's a separate concern — vanity-only stub formulas (just a
  `homepage` line) won't satisfy `brew install`. See
  [how-to/ship-binaries.md](../how-to/ship-binaries.md).

## How formulas get into the tap

Two paths, by intent:

| Goal | Path |
|---|---|
| Binary install via `brew install hop-top/tap/<x>` (CLI tools) | GoReleaser writes the formula automatically on tagged release. Configure with `brews:` in the repo's `.goreleaser.yaml`. See [docs/binaries/go.md](../../docs/binaries/go.md). |
| Vanity-only override (no binary) | Hand-add `<pkg>.rb` to `hop-top/homebrew-tap` with just a `homepage` line. Flag it in the file comment so future readers know `brew install` won't work. |

The Worker's resolver only reads `homepage`. Both paths produce a
file the resolver can parse, so the *vanity* behavior is identical
regardless of how the formula was created.

## Cache behavior

The Worker uses Cloudflare's edge cache (`cf: { cacheTtl: 3600,
cacheEverything: true }`) on the formula fetch. After publishing a
formula change:

- **Within 1h** of TTL expiry: the next vanity request to a cold
  edge node picks up the change.
- **Forcing a refresh**: there is no manual purge from this side.
  Wait for TTL or hit the URL with `Cache-Control: no-cache`
  (works on the worker side; the formula fetch still uses its own
  TTL).
- **Worker code itself** is not cached this way — `wrangler deploy`
  is immediately live globally.

## Resolver source of truth

- **Worker code:** `hop-top/hop.top` → `worker/src/index.ts`.
- **Deploy mechanism:** `hop-top/hop.top` →
  `.github/workflows/deploy-worker.yml` (fires on `worker/**`
  changes pushed to `main`).
- **Deployed Worker name:** `hop-top-router` (route: `hop.top/*`,
  zone: `hop.top`).
- **Override store:** `hop-top/homebrew-tap` (one `.rb` file per
  override).

If the resolver misbehaves, those are the only four places to look.

## Edge cases worth knowing

| Behavior | Reason |
|---|---|
| `hop.top/typo-that-doesnt-exist?go-get=1` returns 200 with vanity | Convention fallback has no existence check — Go tooling fails at clone time instead |
| `hop.top/x999?go-get=1` returns 404 | `x[number]` is a reserved namespace |
| `hop.top/x402?go-get=1` returns 200 with vanity | Explicit carve-out for the existing `x402` repo |
| `hop.top/foo/bar?go-get=1` does not contain `go-import` | Multi-segment paths fall through to the site proxy; no submodule keys |
| Adding a formula doesn't take effect immediately | Edge cache TTL is 1h per pkg name |
| Renaming the Worker breaks deploys | `worker/wrangler.toml` `name` field must match the live Worker in the Cloudflare dashboard |

## See also

- [SKILL.md § Repo naming convention](../../SKILL.md#repo-naming-convention) — why Go takes the bare-name slot.
- [troubleshooting/go.md](../troubleshooting/go.md) — Go-specific failure modes.
- [how-to/ship-binaries.md](../how-to/ship-binaries.md) — Homebrew formulas as binary distribution (different concern, same tap).
