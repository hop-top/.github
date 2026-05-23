# `ecosystems` input reference

Field-by-field reference for `publish-on-tag.yml`'s `ecosystems` input.

## Use this when

- You're filling in your `publish.yml`'s `ecosystems:` block.
- You want to know which fields are required vs. optional.
- You're looking up a per-ecosystem default to override.

## Result

You can read or write any `ecosystems` entry with confidence.

## Shape

YAML map. Each key is the **component name** that appears in tag
prefixes (e.g. `kit-ts` → tag `kit-ts/v1.2.3`).

```yaml
ecosystems: |
  <component>:
    dir: <subdir>
    ecosystem: ts|py|rs|php|go
    mirror: <org>/<mirror-repo>
    package: <registry-name>
    # … optional overrides
```

## Fields

| Field | Required | Notes |
|---|---|---|
| `dir` | yes | Subdirectory in the repo (`.` for root) |
| `ecosystem` | yes | `ts` \| `py` \| `rs` \| `php` \| `go` — picks the publish job (none for `go`; `php` runs a Packagist notify after the mirror push, not a publish-from-source step) |
| `mirror` | yes | Full slug of the read-only mirror repo (e.g. `hop-top/kit-ts`) |
| `package` | no | Registry package name (informational; required for php's Packagist notify) |
| `test-command` | no | Override default test step |
| `build-command` | no | Override default build step (ts, py) |
| `node-version` | no | Override default Node version (ts; default `22`) |
| `python-version` | no | Override default Python version (py; default `3.11`) |
| `rust-toolchain` | no | Override default Rust toolchain (rs; default `stable`) |
| `access` | no | Override npm access level (ts; default `public`) |
| `pypi-environment` | no | Override default GitHub Environment for PyPI OIDC (py; default `pypi`) |
| `pypi-auth` | no | PyPI auth mode (py; `oidc` \| `token`; default `oidc`). `token` requires `PYPI_REGISTRY_TOKEN` secret. |

## Built-in defaults per ecosystem

| Ecosystem | Test | Build | Runtime |
|---|---|---|---|
| `ts` | `pnpm install --frozen-lockfile --ignore-scripts && pnpm test` (does implicit install) | `pnpm build` | Node 22 |
| `py` | `python -m pytest -q` | `python -m build` | Python 3.11 |
| `rs` | `cargo test` | _(none; cargo publish handles it)_ | Rust stable |
| `php` | _(no publish-from-source)_ | _(no publish-from-source)_ | `publish-php` POSTs to Packagist `update-package` after mirror push (see [troubleshooting/php.md](troubleshooting/php.md)) |
| `go` | _(no publish)_ | _(no publish)_ | _proxy.golang.org pulls from tag_ |

## Example with overrides

If your repo uses a Makefile for tests/builds:

```yaml
ecosystems: |
  ts:
    dir: ts
    ecosystem: ts
    mirror: hop-top/uri-ts
    test-command: make test-ts
    build-command: make build-ts
  rs:
    dir: rs
    ecosystem: rs
    mirror: hop-top/uri-rs
    # accepts default `cargo test` — no override needed
```

## How outputs feed downstream jobs

The `parse` job emits one set of outputs (component, version, dir,
ecosystem, mirror, package, optional overrides). Downstream jobs
gate themselves on `needs.parse.outputs.ecosystem == 'X'`.

So a tag like `kit-php/v0.4.0-alpha.2` runs parse → mirror →
publish-php; a tag like `kit-ts/v0.4.0-alpha.2` runs parse →
publish-ts → mirror; etc.

## Next steps

- [concepts/mental-model.md](concepts/mental-model.md) — see how `ecosystems` fits into the bigger picture.
- [concepts/install-model.md](concepts/install-model.md) — what `test-command` is responsible for.
- [troubleshooting/ts.md](troubleshooting/ts.md), [py.md](troubleshooting/py.md), [rs.md](troubleshooting/rs.md), [php.md](troubleshooting/php.md), [go.md](troubleshooting/go.md) — per-language gotchas.
