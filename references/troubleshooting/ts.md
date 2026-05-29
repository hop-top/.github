# TypeScript troubleshooting

TypeScript/Node-specific failure modes in the publish-on-tag pipeline.

## Use this when

- `publish-ts` failed and you suspect pnpm 11 or `--ignore-scripts` interactions.
- A test depends on native bindings (`better-sqlite3`, `node-canvas`, etc.) and fails in CI.
- You're moving an existing ts package onto this pipeline.

## Result

You can diagnose the most common ts failure modes and pick the
right escape hatch.

## First publish of a new `@scope/name`

CI's `NPM_REGISTRY_TOKEN` is scoped to the org and can publish
*updates* but cannot *create* a new `@scope/name`. Symptoms vary
(404, 403, "package not found") and look like token problems but
aren't. Use the local bootstrap path before CI takes over.

See [SKILL.md § First publish of a new package — npm](../../SKILL.md#npm)
and [`scripts/bootstrap-first-publish.sh npm`](../../scripts/README.md).

## `ERR_PNPM_OTP_NON_INTERACTIVE` in CI publish

Symptom: CI publish fails with `ERR_PNPM_OTP_NON_INTERACTIVE`,
often after a misleading `OIDC skipped: 404` line. Token is valid,
package exists. Cause is the npm account's 2FA mode set to "Auth
and writes" — CI has no interactive OTP channel.

Full diagnosis + fix:
[SKILL.md § npm 2FA in "Auth and writes" mode breaks CI publish](../../SKILL.md#npm-2fa-in-auth-and-writes-mode-breaks-ci-publish).

## `404 Not Found` on `PUT /@scope%2fname`

Symptom: `pnpm: 404 Not Found - PUT https://registry.npmjs.org/@scope%2fname`.
Looks like a missing package or scope/permission problem — usually
it's an expired token. npm returns 404 instead of 401/403 to
unauthenticated callers to avoid leaking package existence.

Diagnostic + fix:
[SKILL.md § Expired npm token returns HTTP 404, not 401/403](../../SKILL.md#expired-npm-token-returns-http-404-not-401403).

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

## wasm-pack not preinstalled on publish runners

**Symptom (workflow log)**:

```
$ wasm-pack build ../core --target bundler ...
sh: 1: wasm-pack: not found
```

**Root cause**: a `ts` package that wraps a Rust/wasm core (e.g. via
`wasm-bindgen`) typically has a `pnpm build` script that shells out
to `wasm-pack` to compile the `.wasm` artifact before `tsc` runs.
`publish-ts.yml`'s default `build-command` (`pnpm build`) runs on a
bare GitHub-hosted runner, which does not have `wasm-pack`
preinstalled.

**Check `ci.yml` first** — if your test workflow already builds and
tests the wasm bundle, it likely already installs `wasm-pack` for
that job. That install does NOT carry over to `publish.yml`; they're
separate workflow files with separate runners. Drift between the
two is easy to introduce (one gets updated, the other doesn't) and
won't surface until the next tag push.

**Fix**: override `build-command` to install `wasm-pack` first,
matching whatever `ci.yml` already does:

```yaml
ecosystems: |
  ts:
    dir: ts
    ecosystem: ts
    package: "@org/pkg"
    mirror: org/pkg-ts
    build-command: >-
      curl -sSf https://rustwasm.github.io/wasm-pack/installer/init.sh | sh &&
      pnpm build
```

GitHub-hosted `ubuntu-latest` runners ship a Rust toolchain already
(`cargo`/`rustc`), so `wasm-pack`'s installer script (which needs
`cargo install` as its posix fallback) works without an extra
toolchain-setup step. If you've pinned a custom runner image without
Rust, add a `dtolnay/rust-toolchain@stable`-equivalent step to
`ci.yml`'s pattern and replicate it here — `build-command` is a
plain shell string, it can't add setup steps, only shell commands.

## `&&` in `test-command` produces resolver errors

Symptom: `ERR_PNPM_SPEC_NOT_SUPPORTED_BY_ANY_RESOLVER "&&"`.

Cause: `run: $CMD` doesn't re-parse shell operators in env-var
commands.

Two fixes:

1. **Pin to `@v0` or `@v1`** rolling tag — fixed at `publish-ts.yml@v0.4.3+` (now `run: bash -c "$TEST_CMD"`).
2. **Move the pipeline into a package.json script** (`ci:build`) so the workflow command is single-token.

Tracked in [#9](https://github.com/hop-top/.github/issues/9). See
[docs/failure-modes.md § ERR_PNPM_SPEC_NOT_SUPPORTED](../../docs/failure-modes.md#err_pnpm_spec_not_supported_by_any_resolver-on-build-step).

## npm auth failure ladder

`publish-ts` npm failures peel in layers — each error below means the
previous layer is fixed. Climbed in full on poly-cite (2026-08-30):

| Error | Meaning | Fix |
|---|---|---|
| `[E404] 404 - PUT .../@scope%2fpkg` | Token expired or lacks publish rights on the scope (npm 404s instead of 403 on unauthorized PUT). Package existing on npm proves it's auth, not a missing package. | Rotate `NPM_REGISTRY_TOKEN` — or skip tokens: [how-to/npm-trusted-publishing.md](../how-to/npm-trusted-publishing.md) |
| `[ERR_PNPM_OTP_NON_INTERACTIVE]` | Token authenticates, but the package/account requires 2FA on publish and CI has no TTY for the OTP prompt | Bind a trusted publisher (preferred) or relax the package's publishing-access setting |
| `[WARN] Skipped OIDC: ERR_PNPM_AUTH_TOKEN_EXCHANGE ... (status code 404)` | pnpm tried OIDC but no trusted publisher is bound for this package; it falls back to the token | Expected noise on the token path; to use OIDC, bind the publisher |
| `[E422] Error verifying sigstore provenance bundle: Failed to validate repository information` | OIDC worked; npm rejects the provenance cross-check because `package.json` lacks a `repository` field (or it mismatches the build repo) | Add `repository` pointing at the source repo with `directory` — see the how-to |

**A failed `publish-ts` also skips the `mirror` job** — the mirror repo
gets neither the tag nor its Release. After fixing auth, re-run the
failed run (`gh run rerun <id> --failed`) or ship the next version;
don't hand-patch the mirror.

## Common issues

| Problem | Cause | Fix |
|---|---|---|
| `Could not locate the bindings file` | Native dep build scripts blocked by `--ignore-scripts` | Exclude test OR drop `--ignore-scripts` |
| `ERR_PNPM_IGNORED_BUILDS` | pnpm 11 strict-mode | Add deps to `pnpm-workspace.yaml` `allowBuilds:` |
| `ERR_PNPM_SPEC_NOT_SUPPORTED_BY_ANY_RESOLVER "&&"` | Shell operator in `test-command` not re-parsed | Pin `@v0` or use package.json script |
| `wasm-pack: not found` during build | wasm-consuming package's build script needs a toolchain publish.yml doesn't install | Override `build-command` to install wasm-pack first. See [wasm-pack not preinstalled](#wasm-pack-not-preinstalled-on-publish-runners). |

## Next steps

- [concepts/install-model.md § ts](../concepts/install-model.md#ts) — what the default `test-command` does.
- [references/ecosystems.md](../ecosystems.md) — overriding `test-command` / `build-command`.
