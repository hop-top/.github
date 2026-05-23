# Install model

What the workflows install vs. what your `test-command` is
responsible for.

## Use this when

- Your test step fails with `ModuleNotFoundError` or `cannot find package`.
- You're writing a custom `test-command` and unsure what's pre-installed.
- You're picking between OIDC and token auth for PyPI.

## Result

You know which level of installation each layer handles, and where
your responsibility starts.

## The split

The `publish-{ts,py,rs}.yml` workflows install only **runner-level
deps** — the language toolchain itself, plus minimal tooling (e.g.
`pip install pytest build` for py). They do **not** install the
consuming package's own dependencies.

That's the consumer's job. Your `test-command` (and
`build-command`, where applicable) is responsible for any
package-level install.

## Per-ecosystem behavior

### `ts`

The default `test-command` does an implicit install
(`pnpm install --frozen-lockfile --ignore-scripts && pnpm test`),
which "just works" for the canonical hop-top stack: `pnpm-lock.yaml`
present + `"test": "vitest run"` in `package.json`. The
`--ignore-scripts` flag avoids pnpm 10+ strict-mode failures on
ignored build scripts (e.g. `esbuild` pulled in by `vitest`).

`build-command` defaults to `pnpm build` and skips re-install — the
test step already populated `node_modules`.

If your setup is different, override `test-command`:

```yaml
# install + test (uses lockfile)
test-command: pnpm install --frozen-lockfile && pnpm test

# install + test, skip transitive build scripts
test-command: pnpm install --frozen-lockfile --ignore-scripts && pnpm test

# dlx-based, no node_modules
test-command: pnpm dlx --config.ignore-scripts=true vitest run

# delegate to a Makefile target the repo already maintains
test-command: make test-ts
```

### `py`

Default `test-command` is `python -m pytest -q` — assumes the
package is already on `sys.path`. If your tests import from the
package, install it first:

```yaml
test-command: pip install -e . && pytest
```

### `rs`

Cargo handles deps natively — no install needed in `test-command`.
Default (`cargo test`) just works.

### `php`, `go`

No publish-from-source step, so no test/build commands are honored
by the shared workflows. Tests run in your normal CI; the
publish-on-tag flow only mirrors / notifies Packagist.

## Summary

| Ecosystem | Default installs package? | Notes |
|---|---|---|
| `ts` | **yes** (`pnpm install --frozen-lockfile --ignore-scripts`) | Exception — defaults are tuned for canonical hop-top stack |
| `py` | no | Override to `pip install -e . && pytest` if tests import the package |
| `rs` | no (cargo handles transitive deps) | — |

## py: package naming (install slug vs import name)

PyPI's short names are mostly taken. Bare names like `eva`, `uri`,
`kit` are owned by third parties; trying to publish under them
fails with `403 You're not allowed to upload to project '<name>'`.

The convention across hop-top:

| PyPI install slug | Python import name(s) | Pattern |
|---|---|---|
| `hop-top-eva` | distribution exposes multiple top-level packages: `core`, `cli`, … (no single `eva` import) | install slug prefixed, import names clean |
| `hop-top-uri` | `uri` | same |
| `hop-top-xrr` | `xrr` | same |
| `hop-top-kit` | `hop_top_kit` | matched (one outlier) |

**Default convention: install slug prefixed, import name clean.**
Matches the broader Python ecosystem (`pip install scikit-learn` →
`import sklearn`; `pip install PyYAML` → `import yaml`).
Three-of-four hop-top py packages follow it; new packages should too.

What changes vs what stays when you prefix the install slug:

```toml
# Changes:
[project]
name = "hop-top-eva"            # ← install slug; what users `pip install`

[tool.uv.sources]
hop-top-eva = { workspace = true }  # ← match `[project].name`

[dependency-groups]
dev = ["hop-top-eva", ...]      # ← match `[project].name`

[project.optional-dependencies]
all = ["hop-top-eva[dev,server,...]"]  # ← match `[project].name`

# Stays the same:
[tool.hatch.build.targets.wheel]
packages = ["core", "cli", ...]   # ← import name; what users `import`

[project.scripts]
eva = "cli.main:app"              # ← CLI command name (user-facing UX)

[project.entry-points."eva.evaluators"]   # ← entry-point group name
```

**Same for the `package` field in `publish.yml`'s `ecosystems`
block** — it MUST match the PyPI install slug, not the import name:

```yaml
ecosystems: |
  eva:                           # ← release-please component (tag prefix)
    dir: .
    ecosystem: py
    package: hop-top-eva         # ← MUST be the PyPI install slug
    pypi-auth: token             # ← see references/secrets.md § PyPI auth modes
```

And in `release-please-config.json`:

```jsonc
{
  "packages": {
    ".": {
      "component": "eva",           // tag prefix (eva/v0.1.0-alpha.1)
      "package-name": "hop-top-eva", // PyPI install slug (changelog rendering)
      "release-type": "python"
    }
  }
}
```

**Sanity check before publish**: `uv build` should produce
`hop_top_eva-X.Y.Z-py3-none-any.whl` (slug normalized to
underscore filename), with whatever import-side packages your
`[tool.hatch.build.targets.wheel].packages` lists (e.g. `core/`,
`cli/`, …). If the wheel filename is `eva-X.Y.Z...`, your
`[project].name` wasn't updated.

## Plumbing env vars (available to your test-command)

| Env var | Set in | From | Available to |
|---|---|---|---|
| `TEST_CMD` | `publish-{ts,py,rs}` test step | `inputs.test-command` or built-in default | your test command |
| `BUILD_CMD` | `publish-{ts,py}` build step | `inputs.build-command` or built-in default | your build command |
| `id-token: write` (permission) | `publish-py` job-level | — | OIDC token request for PyPI |

## Next steps

- [references/ecosystems.md](../ecosystems.md) — full input map reference.
- [references/secrets.md](../secrets.md) — PyPI auth modes (OIDC vs token).
- [troubleshooting/ts.md](../troubleshooting/ts.md) / [py.md](../troubleshooting/py.md) / [rs.md](../troubleshooting/rs.md) — language-specific install failures.
