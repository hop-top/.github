# Rust troubleshooting

Rust/crates.io-specific failure modes.

## Use this when

- `cargo publish` fails with `verified email required` or `1 files in the working directory contain changes`.
- A test under `tests/` fails to compile under default features.
- You're moving an existing Rust crate onto this pipeline.
- The build fails with ``Could not find `protoc` ``.

## Result

You can diagnose the most common rs failure modes and pick the
right fix.

## First publish of a new crate

Post-2023 crates.io tokens carry name-scope restrictions: a
name-scoped token cannot publish a crate name it doesn't already
include. First publish of a new crate requires an *unrestricted*
token or a local `cargo login` session — never put the unrestricted
token in CI secrets.

Token-scoping reasoning + local `cargo publish` recipe:
[SKILL.md § First publish of a new package — crates.io](../../SKILL.md#cratesio)
and [`scripts/bootstrap-first-publish.sh cargo`](../../scripts/README.md).

## target/ + cargo publish dirty-tree check

`cargo publish` refuses to package if the working tree has
uncommitted changes. The publish workflow runs `cargo test` first,
which writes to `target/`.

**Every Rust crate must:**

1. Have a `.gitignore` ignoring `/target/`.
2. Not have `target/` files committed.

Canonical `.gitignore` for hop-top Rust crates:

```gitignore
# Build outputs
/target/
**/*.rs.bk
*.profraw
*.profdata

# Local workspace/editor noise
.DS_Store
.idea/
.vscode/

# Cargo.lock is a release input for this mirrored package.
!Cargo.lock
```

If `target/` is already tracked, untrack it:

```bash
git rm -r --cached <crate-dir>/target/
git commit -m "chore: untrack target/"
```

## Feature-gated test files

cargo compiles **every file under `tests/`** unconditionally,
regardless of `[features]`. A test that imports a feature-gated
module fails to compile under default features:

```
error[E0432]: unresolved import `my_crate::api::Client`
```

Fix: gate the whole test file with `#![cfg(feature = "<name>")]`:

```rust
#![cfg(feature = "api")]

use my_crate::api::Client;
// ...
```

This makes `cargo test` (default features) silently skip the file,
while `cargo test --features api` or `--all-features` runs it.

**Test under both modes** locally to match publish-side coverage:

```sh
cargo test --locked                    # default features (what publish-rs runs)
cargo test --all-features --locked     # full coverage
```

## crates.io: verified email required

The CARGO_REGISTRY_TOKEN's account has no verified email.

Fix:

1. Verify email at <https://crates.io/settings/profile>.
2. Re-issue the token.
3. Update the org-level `CARGO_REGISTRY_TOKEN` secret.

## Path deps need a version too

**Symptom (workflow log)**:

```
error: failed to verify manifest at `.../rs/Cargo.toml`
Caused by:
  all dependencies must have a version requirement specified when publishing.
  dependency `my-crate-core` does not specify a version
```

**Root cause**: in a Cargo workspace where one crate depends on a
sibling by path only —

```toml
[dependencies]
my-crate-core = { path = "../core" }
```

— `cargo build`/`cargo test` are fine with this (the path resolves
locally), but `cargo publish` refuses: once published, the crate
can't rely on a local path that won't exist for consumers. crates.io
requires every dependency to also carry a `version =` so it can be
resolved from the registry after publish.

**Fix**: add the version explicitly, matching the sibling crate's
current published (or about-to-be-published) version:

```toml
[dependencies]
my-crate-core = { path = "../core", version = "0.1.0-alpha.0" }
```

**Ordering matters in a first release.** If `core` and `rs` release
together for the first time, `core` must publish successfully
*before* `rs`'s publish job runs, or the version pin references a
crate that doesn't exist on crates.io yet (a separate but related
failure: `error: no matching package named ...`). release-please
opens independent PRs per component with no ordering guarantee —
merge (or retry) the dependency crate first if both are landing in
the same batch.

**This needs updating on every version bump.** `version =` is a
static string, not resolved from the workspace `Cargo.toml` version
automatically — bumping `core`'s version without bumping this pin in
`rs/Cargo.toml` leaves `rs` published against a stale `core` pin
(cargo will still resolve it as long as semver-compatible, but drift
accumulates).

## build.rs needs protoc

**Symptom (workflow log)**, from the Test or Publish step:

```
Error: Custom { kind: NotFound, error: "Could not find `protoc`. If `protoc` is installed, try setting the `PROTOC` environment variable to the path of the `protoc` binary." }
```

**Root cause**: `prost-build` / `tonic-prost-build` shell out to
`protoc`, and `ubuntu-latest` ships none. `cargo publish` rebuilds the
packaged crate, so it hits this even when `test-command` skips the
build.

**Fix**: set `protoc-version` on the entry, quoted, at the version the
crate's own CI uses:

```yaml
  nerv-rs:
    dir: sdk/rs
    ecosystem: rs
    mirror: hop-top/nerv-rs
    protoc-version: '36.2'
```

`publish-rs` downloads the official release zip, checks its sha256
against the pin in `publish-rs.yml`, and puts `protoc` on `PATH` (and
in `PROTOC`) before any cargo step. A version with no pin fails with
`no pinned sha256 for protoc <version>`: pass `protoc-sha256` too, or
add the pin here ([ecosystems.md](../ecosystems.md)). New pins follow
the 14-day age gate.

## Common issues

| Problem | Cause | Fix |
|---|---|---|
| `1 files in the working directory contain changes` | `cargo test` mutated `target/` and it's tracked or unignored | Add `.gitignore` for `/target/` + `git rm -r --cached <crate>/target/` |
| `unresolved import <crate>::<feature_module>` under default features | Test under `tests/` depends on feature-gated module | Add `#![cfg(feature = "<name>")]` at top of test file |
| `cargo publish` fails: `verified email required` | Token's account has no verified email | Verify email; re-issue token |
| `cargo publish` fails: `all dependencies must have a version requirement specified` | Path-only dependency on a workspace sibling | Add `version = "..."` alongside `path =`. See [Path deps need a version too](#path-deps-need-a-version-too). |
| ``Could not find `protoc` `` | `build.rs` runs `prost-build` / `tonic-prost-build`; the runner has no `protoc` | Set `protoc-version: '<version>'` on the entry. See [build.rs needs protoc](#buildrs-needs-protoc). |

## Next steps

- [concepts/install-model.md § rs](../concepts/install-model.md#rs) — what the default `test-command` does.
- [references/ecosystems.md](../ecosystems.md) — `rust-toolchain` and `protoc-version` overrides.
