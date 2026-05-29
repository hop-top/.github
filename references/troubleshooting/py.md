# Python troubleshooting

Python/PyPI-specific failure modes.

## Use this when

- PyPI OIDC publish fails despite seemingly correct config.
- `403 You're not allowed to upload to project '<name>'`.
- `pyproject.toml` shows `0.2.0a1` but you expected `0.2.0-alpha.1` (or vice versa).
- `uv pip install -e .` rejects your package after a rename.

## Result

You can diagnose the most common py failure modes and pick the
right fix.

## First publish of a new PyPI project

Project-scoped API tokens cannot create new PyPI projects, and OIDC
trusted publishing requires pre-registering the project name on
pypi.org before first publish. Symptoms look like auth failures
but reflect a chicken-and-egg in PyPI's permission model.

Token scoping rules + OIDC pre-registration walkthrough:
[SKILL.md § First publish of a new package — PyPI](../../SKILL.md#pypi)
and [`scripts/bootstrap-first-publish.sh pypi`](../../scripts/README.md).

## OIDC `invalid-publisher`

Symptom: PyPI publish step fails with `invalid-publisher` even
though your trusted-publisher config looks right.

Two common causes:

1. **`workflow_ref` is the CALLER, not the reusable.** The "Workflow filename" field on PyPI must match YOUR `publish.yml`, not the reusable `publish-py.yml`. GitHub's OIDC `workflow_ref` claim is always set from the calling workflow.
2. **Pending-publisher table drift.** Rare; can require recreating the pending entry on PyPI.

Escape hatch: switch to `pypi-auth: token` mode. See
[references/secrets.md § PyPI auth modes](../secrets.md#pypi-auth-modes).

## `403 You're not allowed to upload to project '<name>'`

Bare PyPI names like `eva`, `uri`, `kit` are owned by third
parties. Prefix the install slug:

1. Rename `[project].name` to `hop-top-<name>` in `pyproject.toml`.
2. Update `package:` in `publish.yml`'s `ecosystems` block.
3. Update `package-name` in `release-please-config.json`.
4. Keep `[tool.hatch.build.targets.wheel].packages` at the clean import name (e.g. `uri/`).

See [concepts/install-model.md § py: package naming](../concepts/install-model.md#py-package-naming-install-slug-vs-import-name) for the full pattern.

## `uv pip install -e .` rejects after rename

Symptom: `references a workspace in tool.uv.sources but is not a workspace member`.

Cause: `[tool.uv.sources]` key and/or `[dependency-groups].dev`
entry references the OLD `[project].name` after renaming.

Fix: update all four references to match the new `[project].name`
(the install slug, not the import name):

- `[tool.uv.sources].<name>`
- `[dependency-groups].dev`
- `[project.optional-dependencies].all`
- `[project].name` itself

## PyPI version doesn't match git tag

Cosmetic: PEP 440 normalization. `0.2.0-alpha.1` (SemVer in the
git tag) becomes `0.2.0a1` in `pyproject.toml` and on PyPI.

`pip` accepts both forms in version specs:

```
hop-top-eva == 0.2.0a1
hop-top-eva == 0.2.0-alpha.1   # also works
```

See [concepts/version-strings.md](../concepts/version-strings.md)
and [docs/failure-modes.md § PyPI version doesn't match git tag](../../docs/failure-modes.md#pypi-version-doesnt-match-git-tag-pep-440-normalization).

## `invalid-token-bad-audience`

OIDC trusted-publisher config doesn't match. Verify on PyPI:

- Org name
- Repo name
- Workflow filename (caller, not reusable)
- Environment name

## GitHub Environment binding fails

Symptom: workflow can't bind to the `pypi` environment.

Cause: the environment doesn't exist on the caller repo.

Fix:

```bash
gh api -X PUT repos/<org>/<repo>/environments/pypi
```

Environment name must match `pypi-environment` in your ecosystem
config (default `pypi`).

## maturin/PyO3 compiled extensions (manylinux)

**Everything else in this doc set assumes a pure-Python (or
Hatch-backed) `py` package.** If your `pyproject.toml` uses
`maturin` as the build backend (a Rust/PyO3 extension module,
`crate-type = ["cdylib"]`), the default `build-command`
(`python -m build`) will succeed locally but produce an artifact
PyPI rejects. This section is that case.

### Stage 1 symptom: PyPI rejects the wheel outright

```
HTTPError: 400 Bad Request from https://upload.pypi.org/legacy/
Binary wheel 'my_pkg-0.1.0-cp311-cp311-linux_x86_64.whl' has an
unsupported platform tag 'linux_x86_64'.
```

**Root cause**: `python -m build` on a bare `ubuntu-latest` runner
invokes `maturin pep517 build-wheel ... --compatibility off` by
default — no manylinux tagging at all. PyPI requires Linux binary
wheels to carry a `manylinux*` platform tag; a raw `linux_x86_64`
wheel isn't portable across distros and PyPI won't host it.

**The obvious-looking fix does NOT work.** Passing
`--compatibility manylinux2014` to `maturin build` only changes the
wheel's *filename tag* — it does not change what glibc symbols the
compiled `.so` actually links against:

### Stage 2 symptom: `--compatibility manylinux2014` alone still fails

```
💥 maturin failed
  Caused by: Error ensuring manylinux_2_17 compliance
  Caused by: Your library is not manylinux_2_17 (aka manylinux2014)
  compliant because of the presence of too-recent versioned symbols:
  ["libc.so.6 offending versions: GLIBC_2.25, GLIBC_2.18, GLIBC_2.32, ...",
   "libm.so.6 offending versions: GLIBC_2.29"].
  Consider building in a manylinux docker container
```

GitHub-hosted `ubuntu-latest` runners ship a glibc newer than what
manylinux2014 (or even manylinux_2_28) permits. maturin correctly
refuses to lie about compatibility — good, but it means the tag-only
fix silently fails at build time instead of at PyPI upload time.
Progress, but still broken.

### The actual fix: build inside a manylinux container

Override `build-command` to run `maturin build` inside the official
container image, which is itself built on the matching manylinux
base:

```yaml
ecosystems: |
  py:
    dir: py
    ecosystem: py
    package: hop-top-my-pkg
    mirror: org/my-pkg-py
    pypi-auth: token
    build-command: >-
      docker run --rm -v "$(git rev-parse --show-toplevel)":/io -w /io/py
      ghcr.io/pyo3/maturin build --release --compatibility manylinux2014 --out dist
      --interpreter python3.11
```

Notes:

- `-v "$(git rev-parse --show-toplevel)":/io` mounts the **whole
  repo**, not just `py/` — required if your Rust crate is part of a
  Cargo workspace with a path dependency on a sibling crate (e.g.
  `core/`). Mounting only `py/` breaks the workspace resolution.
- `-w /io/py` sets the working directory inside the container to the
  package dir, matching where `pyproject.toml` lives.
- `--interpreter python3.11` pins which CPython ABI to build against;
  match your `python-version` input.
- `docker` is preinstalled on GitHub-hosted `ubuntu-latest` runners —
  no extra setup step needed, unlike a self-hosted runner.
- This changes `dist/` to contain a real manylinux wheel; the
  `sdist` (source distribution) step earlier in the same build is
  unaffected and still runs on the bare host (source-only, no
  compiled artifact, no manylinux concern).

**This is a container-build, not a flag** — don't try to shortcut it
with a bare `--compatibility` flag on the host runner. If you see
the Stage 2 symptom above, you're on the right track but need the
container step, not a different flag value.

## Don't add `extra-files` for `pyproject.toml`

If you have `release-type: python`, do NOT add an `extra-files`
block targeting `pyproject.toml`. The generic `type: toml` updater
bypasses PEP 440 normalization and writes raw SemVer into the
file, which then fails `pip install` and `twine check`.

See [concepts/version-strings.md § Don't break the normalization](../concepts/version-strings.md#dont-break-the-normalization).

## Common issues

| Problem | Cause | Fix |
|---|---|---|
| `invalid-publisher` despite correct claims | Caller-vs-reusable `workflow_ref` confusion | Use the CALLER's filename in PyPI config |
| `403 You're not allowed to upload to project '<name>'` | Bare name owned by third party | Prefix to `hop-top-<name>` |
| `uv pip install -e .`: `not a workspace member` | Stale `[tool.uv.sources]` after rename | Update all four references |
| Version on PyPI is `0.2.0a1` not `0.2.0-alpha.1` | PEP 440 normalization | Cosmetic; pip accepts both |
| `invalid-token-bad-audience` | OIDC config mismatch | Re-verify org/repo/workflow/environment |
| Environment binding fails | `pypi` environment doesn't exist | `gh api -X PUT repos/<org>/<repo>/environments/pypi` |
| PyPI rejects wheel: `unsupported platform tag 'linux_x86_64'` | maturin/PyO3 package built on bare runner, `python -m build` uses `--compatibility off` | Build inside `ghcr.io/pyo3/maturin` container. See [maturin/PyO3 compiled extensions](#maturinpyo3-compiled-extensions-manylinux). |
| maturin fails even with `--compatibility manylinux2014`: `too-recent versioned symbols` | Runner's glibc is newer than the manylinux tag allows; `--compatibility` only sets the tag, not the actual link target | Build inside a real manylinux container, not just a flag on the host. Same section as above. |

## Next steps

- [concepts/install-model.md § py](../concepts/install-model.md#py) — what the default `test-command` does.
- [concepts/version-strings.md](../concepts/version-strings.md) — SemVer ∩ PEP 440 details.
- [references/secrets.md § PyPI auth modes](../secrets.md#pypi-auth-modes) — OIDC vs token.
- [docs/browser-playbooks.md](../../docs/browser-playbooks.md) — PyPI trusted-publisher setup walkthrough.
