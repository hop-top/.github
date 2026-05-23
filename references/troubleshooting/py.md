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

## Next steps

- [concepts/install-model.md § py](../concepts/install-model.md#py) — what the default `test-command` does.
- [concepts/version-strings.md](../concepts/version-strings.md) — SemVer ∩ PEP 440 details.
- [references/secrets.md § PyPI auth modes](../secrets.md#pypi-auth-modes) — OIDC vs token.
- [docs/browser-playbooks.md](../../docs/browser-playbooks.md) — PyPI trusted-publisher setup walkthrough.
