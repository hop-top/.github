# Shipping Python binaries

**Status:** planned, not yet implemented.

When implemented, this page will document a `pyinstaller-on-tag.yml`
(or `shiv`/`pex`-based) reusable workflow that produces
self-contained Python executables on `<component>/v<version>`
tag pushes, in the same shape as
[`goreleaser-on-tag.yml`](../../.github/workflows/goreleaser-on-tag.yml)
for Go (see [docs/binaries/go.md](go.md)).

## In the meantime

`publish-on-tag.yml`'s `py` ecosystem already publishes Python
**packages** to PyPI. If users install via `pip install <package>`
or `pipx install <package>`, that's sufficient — no separate
binaries workflow needed.

For Python **binaries** (no-Python-runtime executables, useful
when distributing to users without a managed Python install),
open an issue against this repo with your use case so we can
prioritize the implementation. Until then, adopter repos can drop
a one-off `.github/workflows/release.yml` calling PyInstaller /
Shiv / Pex directly.

## Tool tradeoffs (when this gets implemented)

- **PyInstaller** — heaviest; bundles the Python interpreter +
  C extensions; per-OS builds (no cross-compilation).
- **Shiv** — single zipapp; requires a Python interpreter on the
  target machine.
- **Pex** — similar to Shiv but with richer environment isolation.

The likely choice for a reusable workflow is PyInstaller (the
most truly "no Python required" option), but the matrix build
cost is high.
