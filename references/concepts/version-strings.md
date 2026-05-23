# Version strings: SemVer ∩ PEP 440

How the pipeline reconciles four conflicting version grammars.

## Use this when

- You're surprised that `pyproject.toml` shows `0.1.0a1` while the git tag is `0.1.0-alpha.1`.
- You're tempted to add an `extra-files` block to keep one canonical version string everywhere.
- You're adding a new ecosystem and wondering which format to author in.

## Result

You know why each file format differs, where normalization happens, and which one is the canonical internal form.

## The conflict

A polyglot release pipeline has to satisfy four conflicting version grammars:

| Format | Accepts `0.1.0-alpha.1` | Accepts `0.1.0a1` | Notes |
|---|---|---|---|
| Git tag | yes | yes | No format constraint |
| SemVer (npm, crates, cargo, Go) | yes | no | `a1` lacks the required leading hyphen |
| PEP 440 (PyPI) | no | yes | Hyphen-separated alpha is rejected by `pip` |
| Composer (PHP) | partial | no | Accepts SemVer-ish but rejects unknown pre-release identifiers like `experimental.N` |

No single string is valid in every registry.

## The resolution

**One canonical internal form (SemVer), per-registry normalization at file-write time.**

| Layer | Form | Why |
|---|---|---|
| Git tag (`<component>/v<version>`) | SemVer (`0.1.0-alpha.1`) | What release-please produces; consumed by Go module proxy, GitHub Releases |
| `.release-please-manifest.json` | SemVer (`0.1.0-alpha.1`) | Internal state; release-please's native format |
| `pyproject.toml [project].version` | PEP 440 (`0.1.0a1`) | Required by `pip` / `twine` / PyPI; written by release-type `python` |
| `package.json version` | SemVer (`0.1.0-alpha.1`) | Required by npm; written by release-type `node` |
| `Cargo.toml version` | SemVer (`0.1.0-alpha.1`) | Required by cargo; written by release-type `rust` |
| `composer.json version` | SemVer-compatible (`0.4.0-alpha.1`) | Required by Composer; pre-release identifier must be `dev`/`alpha`/`beta`/`RC`/`stable` |

## Don't break the normalization

The `release-type` field on each package owns its native file
formats. `release-type: python` already updates `pyproject.toml`
(and `setup.py`, `_version.py`) with PEP 440 strings. **Do not add
an `extra-files` block targeting `pyproject.toml`** — the generic
`type: toml` updater bypasses the normalization and writes raw
SemVer into the file, which then fails `pip install` and
`twine check`.

```jsonc
// BROKEN — extra-files bypasses PEP 440 normalization
{
  "release-type": "python",
  "extra-files": [
    { "type": "toml", "path": "pyproject.toml", "jsonpath": "$.project.version" }
  ]
}

// CORRECT — release-type python updates pyproject.toml natively
{
  "release-type": "python"
}
```

The preflight workflow catches this misconfiguration; see
[how-to/add-preflight.md](../how-to/add-preflight.md).

## Why SemVer is the canonical internal form

- release-please's data model is SemVer-native; PEP 440 is computed on the write side, not stored.
- The Go module proxy, npm, and crates.io all want SemVer in tags and files. Outvoting them on the canonical form would require per-registry tag rewriting at publish time.
- PEP 440's normalization is one-way derivable from SemVer (`-alpha.N` → `aN`, `-beta.N` → `bN`, `-rc.N` → `rcN`, `+build` → `+build`). The reverse is ambiguous (`a1` could be `-alpha.1` or `-a.1` — PEP 440 forbids the latter, SemVer allows both).

## Composer's narrow whitelist

Composer's parser only accepts **`dev` | `alpha` | `beta` | `RC` |
`stable`** as pre-release stability identifiers. A SemVer string
like `0.4.0-experimental.1` parses everywhere else (npm, cargo, Go
module proxy, PyPI after normalization) but **fails `composer
install` with `Invalid version string`**.

Use `0.4.0-alpha.N` for the prerelease counter in `composer.json`
(and the release-please manifest for the php package). The other
ecosystems can keep `experimental.N` if you prefer — but the php
package needs `alpha.N`. This bit T-0183; see commit
[`0b76224d`](https://github.com/hop-top/poly-kit/commit/0b76224d).

See [troubleshooting/php.md § Composer rejects experimental.N](../troubleshooting/php.md#composer-rejects-experimentaln-pre-release-identifiers).

## Gradual ecosystem adoption

Each language gets a corresponding release-type that owns its native file format:

| Language | release-type | Native file | Format |
|---|---|---|---|
| Python | `python` | `pyproject.toml`, `setup.py`, `_version.py` | PEP 440 |
| TypeScript/Node | `node` | `package.json` | SemVer |
| Rust | `rust` | `Cargo.toml` | SemVer |
| Go | `go` | (none — proxy reads tags) | n/a |
| PHP | `php` | `composer.json` | SemVer-compatible |

When adding a polyglot repo, set `release-type` at the package
level (or top-level if uniform across packages). The preflight
workflow checks for native-format integrity per ecosystem.

## Next steps

- [how-to/prerelease-channel.md](../how-to/prerelease-channel.md) — staying in an alpha/beta/rc channel.
- [troubleshooting/php.md](../troubleshooting/php.md) — Composer pre-release whitelist details.
- [troubleshooting/py.md](../troubleshooting/py.md) — PEP 440 normalization symptoms.
