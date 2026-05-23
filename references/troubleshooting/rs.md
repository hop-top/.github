# Rust troubleshooting

Rust/crates.io-specific failure modes.

## Use this when

- `cargo publish` fails with `verified email required` or `1 files in the working directory contain changes`.
- A test under `tests/` fails to compile under default features.
- You're moving an existing Rust crate onto this pipeline.

## Result

You can diagnose the most common rs failure modes and pick the
right fix.

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

## Common issues

| Problem | Cause | Fix |
|---|---|---|
| `1 files in the working directory contain changes` | `cargo test` mutated `target/` and it's tracked or unignored | Add `.gitignore` for `/target/` + `git rm -r --cached <crate>/target/` |
| `unresolved import <crate>::<feature_module>` under default features | Test under `tests/` depends on feature-gated module | Add `#![cfg(feature = "<name>")]` at top of test file |
| `cargo publish` fails: `verified email required` | Token's account has no verified email | Verify email; re-issue token |

## Next steps

- [concepts/install-model.md § rs](../concepts/install-model.md#rs) — what the default `test-command` does.
- [references/ecosystems.md](../ecosystems.md) — `rust-toolchain` override.
