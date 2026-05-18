# Shipping Rust binaries

**Status:** planned, not yet implemented.

When implemented, this page will document a `cargo-dist-on-tag.yml`
reusable workflow that wraps [`cargo-dist`](https://opensource.axo.dev/cargo-dist/)
to build cross-platform Rust binaries on `<component>/v<version>`
tag pushes, in the same shape as
[`goreleaser-on-tag.yml`](../../.github/workflows/goreleaser-on-tag.yml)
for Go (see [docs/binaries/go.md](go.md)).

## In the meantime

`publish-on-tag.yml`'s `rs` ecosystem already publishes Rust
**crates** to crates.io. If you only need the library on
crates.io (i.e. users install via `cargo add <crate>`), that's
sufficient — no separate binaries workflow needed.

For Rust **binaries** (installable CLIs), open an issue against
this repo with your use case so we can prioritize the
implementation. Until then, adopter repos can drop a one-off
`.github/workflows/release.yml` calling `cargo-dist` directly;
see <https://opensource.axo.dev/cargo-dist/book/quickstart/rust.html>.

## Why a future reusable workflow

Same reasoning as Go: `<component>/v<version>` tag prefixes
need explicit stripping before they reach `cargo-dist`'s
artifact-naming templates. A reusable workflow centralizes that
shim across adopter repos.
