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
prefixes (e.g. `kit-ts` → tag `kit-ts/v1.2.3`) and must equal the
release-please `component` of the package it publishes. By convention
it is also the basename of its `mirror` slug (`kit-ts` →
`hop-top/kit-ts`); the router reads `mirror` verbatim, so that part is
not checked ([SKILL.md § Three-way name
alignment](../SKILL.md#three-way-name-alignment)).

```yaml
ecosystems: |
  <component>:
    dir: <subdir>
    ecosystem: ts|py|rs|php|go|none
    mirror: <org>/<mirror-repo>
    package: <registry-name>
    # … optional overrides
```

## Fields

| Field | Required | Notes |
|---|---|---|
| `dir` | yes | Subdirectory in the repo (`.` for root). In a per-language polyglot layout (module under `go/`) the Go entry is `go`, not `.` — a root dir mirrors every other language tree too ([how-to/polyglot-repo.md § 3](how-to/polyglot-repo.md#3-add-the-ecosystems-entry)); a root-Go layout like `poly-kit` uses `.` on purpose |
| `ecosystem` | yes | `ts` \| `py` \| `rs` \| `php` \| `go` \| `none` — picks the publish job. `go` and `none` have no publish job: Go releases through the mirror plus the module proxy, and `none` is a payload with no registry at all (a spec tree, say). Both still run the mirror job. `php` runs a Packagist notify after the mirror push, not a publish-from-source step. Prefer `none` over omitting the field: an absent `ecosystem` yields an empty output, which the mirror job's `!= ''` guard reads as an umbrella tag and skips |
| `mirror` | yes | Full slug of the read-only mirror repo (e.g. `hop-top/kit-ts`). Before any push the mirror job resolves the slug's real name (`gh api repos/<mirror>`, which follows rename redirects) and fails when it is this repo, whatever the spelling or redirect, and when it is any other redirect (see `allow-mirror-redirect`). A slug that does not exist yet is created |
| `allow-mirror-redirect` | no | `true` lets the mirror job push through a rename / transfer redirect on `mirror`, to the resolved repo, with a warning. Default `false`: a redirected slug fails the job and names the real repo. Never overrides the self-mirror refusal. Prefer fixing `mirror` to the resolved name |
| `package` | no | Registry package name. Informational at publish time (no publish job reads it, php's Packagist notify included: that one uses `mirror`); the preflight's first-publish probe reads it |
| `mirror-mode` | no | `mirror` (default) or `tag-only`. `tag-only` is for a nested Go module whose tree already ships inside another component's mirror (e.g. `sdk/go` inside the root-Go mirror): it pushes only the tag `<mirror-tag-prefix><version>` to `mirror`, at the newest mirror commit whose `<mirror-tag-prefix>` subtree equals this commit's `dir` tree. It never pushes a branch, never moves an existing tag, never creates the mirror and never touches its description, settings or releases. `go` / `none` only. Ordering rule: tag the enclosing component no later than the nested one, at a commit with the same module tree. See [troubleshooting/go.md § Nested Go module](troubleshooting/go.md#nested-go-module-inside-a-mirrored-tree) |
| `mirror-tag-prefix` | `tag-only` | The module's path on the mirror, which is also Go's tag prefix: `sdk/go/` → tag `sdk/go/v0.3.0`. Repo-relative; whitespace, duplicate and trailing slashes normalised. Rejected in `mirror` mode |
| `mirror-wait-seconds` | no | `tag-only`: how long to keep polling (every 30s) for the enclosing release's mirror push, for when both tags run in parallel. Default `600`; `0` checks once |
| `target-prefix` | no | Path on the mirror to publish under (e.g. `specs/v0.1`); empty (default) publishes at the mirror root. For mirrors whose convention nests the payload, as the `spec-*` repos do (`specs/v<MAJOR>.<MINOR>/<files>`). Repo-relative: an absolute path or a `.` / `..` component fails the mirror job; surrounding whitespace, duplicate slashes and trailing slashes are normalised. The mirror gets one commit carrying the source commit's metadata, not the split history |
| `test-command` | no | Override default test step |
| `build-command` | no | Override default build step (ts, py) |
| `node-version` | no | Override default Node version (ts; default `22`) |
| `python-version` | no | Override default Python version (py; default `3.11`) |
| `rust-toolchain` | no | Override default Rust toolchain (rs; default `stable`) |
| `protoc-version` | no | rs: protobuf release whose `protoc` to install before any cargo step, for a crate whose `build.rs` runs `prost-build` / `tonic-prost-build`. Default empty: no install. Quoted string (`'36.2'`): an unquoted number fails `parse`, since YAML reads `36.10` as `36.1`. The official release zip is sha256-checked, unpacked under `$RUNNER_TEMP`, put on `PATH` and exported as `PROTOC` (also visible to `test-command`). Pinned in `publish-rs.yml`: `36.2` |
| `protoc-sha256` | no | rs: sha256 of `protoc-<version>-linux-x86_64.zip`, for a `protoc-version` with no pin. Must equal the pin when there is one. Take it from the release asset (`gh api repos/protocolbuffers/protobuf/releases/tags/v<version> --jq '.assets[] \| select(.name == "protoc-<version>-linux-x86_64.zip") \| .digest'`) and check it against a download of your own |
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
  uri-ts:
    dir: ts
    ecosystem: ts
    mirror: hop-top/uri-ts
    test-command: make test-ts
    build-command: make build-ts
  uri-rs:
    dir: rs
    ecosystem: rs
    mirror: hop-top/uri-rs
    # accepts default `cargo test` — no override needed
```

A crate that generates gRPC code in `build.rs` (`tonic-prost-build`)
needs `protoc` on the runner:

```yaml
ecosystems: |
  nerv-rs:
    dir: sdk/rs
    ecosystem: rs
    package: hop-top-nerv
    mirror: hop-top/nerv-rs
    protoc-version: '36.2'   # matches the CI job's protoc
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
- [how-to/polyglot-repo.md](how-to/polyglot-repo.md) — component / `package` / `mirror` values per language for a `poly-<name>` repo.
- [concepts/install-model.md](concepts/install-model.md) — what `test-command` is responsible for.
- [troubleshooting/ts.md](troubleshooting/ts.md), [py.md](troubleshooting/py.md), [rs.md](troubleshooting/rs.md), [php.md](troubleshooting/php.md), [go.md](troubleshooting/go.md) — per-language gotchas.
