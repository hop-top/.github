# TypeScript troubleshooting

TypeScript/Node-specific failure modes in the publish-on-tag pipeline.

## Use this when

- `publish-ts` failed and you suspect pnpm 11 or `--ignore-scripts` interactions.
- A test depends on native bindings (`better-sqlite3`, `node-canvas`, etc.) and fails in CI.
- You're moving an existing ts package onto this pipeline.

## Result

You can diagnose the most common ts failure modes and pick the
right escape hatch.

## Native bindings + --ignore-scripts

`publish-ts.yml`'s default `test-command` uses `--ignore-scripts`
(supply-chain hygiene). Native-binding deps (`better-sqlite3`,
`node-canvas`, etc.) don't compile their bindings under that flag.
Tests that depend on those bindings fail with `Could not locate
the bindings file`.

Two options:

1. **Exclude the affected tests from the publish run**:

   ```yaml
   test-command: pnpm install --frozen-lockfile --ignore-scripts && pnpm vitest run --exclude src/sqlstore.test.ts
   ```

2. **Drop `--ignore-scripts`** (only if you trust the dep tree):

   ```yaml
   test-command: pnpm install --frozen-lockfile && pnpm test
   ```

## pnpm 11 strict-mode build failures

pnpm 11 sets `strictDepBuilds: true` by default. Transitive deps
with `postinstall` / `install` scripts fail with
`ERR_PNPM_IGNORED_BUILDS`.

Fix: declare the offending deps in `pnpm-workspace.yaml`'s
`allowBuilds:` (NOT package.json — that's deprecated in pnpm 11):

```yaml
# pnpm-workspace.yaml
allowBuilds:
  - better-sqlite3
  - esbuild
```

See [docs/failure-modes.md § pnpm 11 strictDepBuilds](../../docs/failure-modes.md#pnpm-11-strictdepbuilds-blocks-install-on-transitive-postinstalls).

## `&&` in `test-command` produces resolver errors

Symptom: `ERR_PNPM_SPEC_NOT_SUPPORTED_BY_ANY_RESOLVER "&&"`.

Cause: `run: $CMD` doesn't re-parse shell operators in env-var
commands.

Two fixes:

1. **Pin to `@v0` or `@v1`** rolling tag — fixed at `publish-ts.yml@v0.4.3+` (now `run: bash -c "$TEST_CMD"`).
2. **Move the pipeline into a package.json script** (`ci:build`) so the workflow command is single-token.

Tracked in [#9](https://github.com/hop-top/.github/issues/9). See
[docs/failure-modes.md § ERR_PNPM_SPEC_NOT_SUPPORTED](../../docs/failure-modes.md#err_pnpm_spec_not_supported_by_any_resolver-on-build-step).

## Common issues

| Problem | Cause | Fix |
|---|---|---|
| `Could not locate the bindings file` | Native dep build scripts blocked by `--ignore-scripts` | Exclude test OR drop `--ignore-scripts` |
| `ERR_PNPM_IGNORED_BUILDS` | pnpm 11 strict-mode | Add deps to `pnpm-workspace.yaml` `allowBuilds:` |
| `ERR_PNPM_SPEC_NOT_SUPPORTED_BY_ANY_RESOLVER "&&"` | Shell operator in `test-command` not re-parsed | Pin `@v0` or use package.json script |

## Next steps

- [concepts/install-model.md § ts](../concepts/install-model.md#ts) — what the default `test-command` does.
- [references/ecosystems.md](../ecosystems.md) — overriding `test-command` / `build-command`.
