# scripts/

Helper scripts that complement the publish-on-tag CI pipeline.
These run locally — they exist for the steps CI deliberately
cannot perform.

## `bootstrap-first-publish.sh`

Local helper for the very first publish of a brand-new package on
npm, PyPI, or crates.io. The standard CI token in each registry is
scoped to *update* existing packages and cannot *create* a new
one — that first publish has to come from a higher-privilege
interactive session. After it succeeds once, `publish-on-tag.yml`
handles every subsequent version automatically.

Conceptual companion:
[SKILL.md § First publish of a new package](../SKILL.md#first-publish-of-a-new-package)
(this README is for discoverability; the SKILL section owns the
explanation, token-scoping rationale, and post-bootstrap CI
handoff).

### Subcommands

| Subcommand | When to use | What it does |
|---|---|---|
| `npm` | First publish of a new `@scope/name` to npm | Reads `package.json`, verifies `npm whoami`, probes the registry to confirm the name is unclaimed, then `pnpm publish --access public`. |
| `pypi` | First publish of a brand-new PyPI project name | Reads `pyproject.toml`, probes pypi.org for prior existence, requires `TWINE_PASSWORD` / `UV_PUBLISH_TOKEN` from an *account-scoped* token, then `uv build` + `twine upload`. |
| `cargo` | First publish of a new crates.io crate | Reads `Cargo.toml` via `cargo metadata`, probes crates.io for prior versions, requires an *unrestricted* token (or existing `cargo login`), then `cargo publish`. |

Run from the package directory (where `package.json` /
`pyproject.toml` / `Cargo.toml` lives).

### Note on dirty trees

The script does not expose a `--allow-dirty` flag. `cargo publish`
will refuse a dirty working tree on its own; the npm and pypi paths
inherit the same expectation by convention. Commit (or stash) local
changes before bootstrapping — that's intentional, not a bug.
