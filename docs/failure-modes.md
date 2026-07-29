# Failure modes & escape hatches

The painful lessons. Each entry: symptom you'll see, root cause, fix, and (where relevant) the tracking issue.

## `ERR_PNPM_SPEC_NOT_SUPPORTED_BY_ANY_RESOLVER` on build step

**Symptom (workflow log)**:

```
[ERR_PNPM_SPEC_NOT_SUPPORTED_BY_ANY_RESOLVER] "&&" isn't supported by any available resolver.
```

(Or the same shape with `|`, `;`, `>`, quote chars, etc., depending on the operator.)

**Root cause**: the reusable workflows execute caller-supplied `test-command` / `build-command` via:

```yaml
env:
  BUILD_CMD: ${{ inputs.build-command }}
run: $BUILD_CMD
```

Under GitHub Actions' default `bash -e {0}` shell, `$BUILD_CMD` undergoes word-splitting but **not** re-parsing for shell operators. `&&` reaches pnpm as a literal argv token; pnpm interprets it as a package spec and fails. The same trap applies to any shell operator or quote character.

**Tracked at**: [hop-top/.github#9](https://github.com/hop-top/.github/issues/9).

**Fix (caller-side workaround)**: collapse the pipeline into a single npm/cargo/make script invocation so the GitHub-Actions-side command is a single argv token. Example for ts:

```jsonc
// package.json
"scripts": {
  "ci:build": "pnpm install --ignore-scripts && pnpm build"
}
```

```yaml
# publish.yml
build-command: pnpm ci:build
```

The `&&` is interpreted by pnpm's script runner, not by the GitHub Actions shell. Same approach with `npm run`, `make`, `cargo --bin`, etc.

**What does NOT work**:

- `sh -c "pnpm install && pnpm build"` — the quote chars in the value are literal after bash expansion; the inner shell receives a broken script.
- `eval "$BUILD_CMD"` — same expansion semantics; quote chars are still literal.

**Also works but less preferred**:

- A wrapper script committed to the repo and exec'd via path. Functional, but the package.json script approach above keeps the pipeline visible in one file and avoids an extra checked-in shim.

## Tag pushed before the publish workflow existed → no publish run

**Symptom**: tag exists at `<owner>/<repo>/releases/tag/<component>/v<version>`, but Actions tab shows no publish run for that tag. Registry has no artifact.

**Root cause**: GitHub Actions reads workflows from the **commit the tag points to**, not from main. If `.github/workflows/publish.yml` doesn't exist in the tag's tree (because the tag was cut before the workflow was added), no workflow file matches the tag-push event → no run.

**Fix**: cut a new tag at a commit that contains the workflow, OR force-update the existing tag to such a commit:

```bash
git push --delete origin refs/tags/py/v0.2.0-alpha.0
git tag -f py/v0.2.0-alpha.0 <commit-with-publish.yml>
git push origin refs/tags/py/v0.2.0-alpha.0
```

Re-pushing the tag fires a fresh tag-push event → publish runs against the new tag SHA.

**Diagnostic**: `git merge-base --is-ancestor <publish.yml-introducing-commit> <tag>` — if it exits non-zero, the workflow isn't in the tag's tree.

**Prevention**: install the publish pipeline **before** doing your first release-please run. If you migrate from an older release flow, retag (or re-release) anything cut under the previous flow that needs to ship through the new one.

## pnpm 11 `strictDepBuilds` blocks install on transitive postinstalls

**Symptom (workflow log)**:

```
[ERR_PNPM_IGNORED_BUILDS] Ignored build scripts: esbuild@0.21.5

Run "pnpm approve-builds" to pick which dependencies should be allowed to run scripts.
```

(Common transitive offenders: `esbuild` via `vitest`, `core-js`, native binaries.)

**Root cause**: pnpm 11 enables `strictDepBuilds: true` by default. `pnpm install` exits 1 when any dep with a build script (`preinstall` / `install` / `postinstall`) hasn't been explicitly allowed OR explicitly ignored — **even when `--ignore-scripts` is set**. The `--ignore-scripts` flag suppresses execution; it does not suppress the strict-mode check.

**Fix**: declare the dep in `allowBuilds:` (allow or deny) in **`pnpm-workspace.yaml`** at the package root:

```yaml
# pnpm-workspace.yaml
allowBuilds:
  esbuild: false
  electron: true
```

`false` = block builds (equivalent to ignoring); `true` = allow. Either resolves strict-mode.

**What does NOT work in pnpm 11**:

- `pnpm.onlyBuiltDependencies` in `package.json` — deprecated.
- `pnpm.neverBuiltDependencies` in `package.json` — deprecated.
- `pnpm.ignoredBuiltDependencies` in `package.json` — deprecated.
- `--config.strict-dep-builds=false` flag — silently ignored in pnpm 11.

The replacement is `allowBuilds:` in `pnpm-workspace.yaml`. Even single-package repos need this file.

## PyPI OIDC `invalid-publisher` despite correct-looking claims

**Symptom (workflow log)**:

```
Trusted publishing exchange failure:
* `invalid-publisher`: valid token, but no corresponding publisher
  (Publisher with matching claims was not found)
```

…followed by a claim dump showing `repository`, `workflow_ref`, `environment`, etc. that all visually match your PyPI pending publisher configuration.

**Root cause #1 (common)**: workflow filename mismatch. The OIDC `workflow_ref` claim is always set from the **caller** workflow (e.g. `publish.yml`), not the reusable workflow (`publish-py.yml`). Your PyPI trusted publisher's "Workflow filename" field must be the caller's filename.

**Fix**: edit pending publisher on PyPI; set workflow filename to your caller's filename (`publish.yml` for a repo using the canonical hop-top setup).

**Root cause #2 (rare)**: PyPI pending-publisher matching drift. Even with all 5 form fields visually matching the OIDC claims, PyPI returns `invalid-publisher`. Delete + re-add of the pending publisher doesn't help. No public diagnostic surface. Tracked privately with PyPI support when it happens.

**Escape hatch**: switch the component to `pypi-auth: token` (added in hop-top/.github v0.4.0):

```yaml
ecosystems: |
  py:
    dir: py
    ecosystem: py
    package: my-pkg
    mirror: my-org/my-pkg-py
    pypi-auth: token
```

…and pass `PYPI_REGISTRY_TOKEN` in your caller's `secrets:` block. See [PyPI auth modes](../references/secrets.md#pypi-auth-modes).

**Once published once**, switch back to OIDC via the **project-scoped** trusted publisher path on PyPI (`https://pypi.org/manage/project/<name>/settings/publishing/`), which bypasses pending-publisher matching entirely.

## PyPI version doesn't match git tag (PEP 440 normalization)

**Symptom**: git tag `py/v0.2.0-alpha.1` → PyPI ships `hop-top-uri@0.2.0a1`. Tag string and registry version don't match. Consumers see two different version notations across ecosystems.

**Root cause**: PyPI requires PEP 440 canonical form. `0.2.0-alpha.1` is normalized through `packaging.version.Version(...)`:

- `alpha` → `a`
- separator dash/dot before the pre-release marker → dropped
- dot between marker and number → dropped
- leading zeros → stripped

Result: `0.2.0a1`. Other ecosystems (npm, cargo, composer) accept the dotted form as-is, so a polyglot project with the same logical release ships as `0.2.0-alpha.1` everywhere except PyPI.

**Fix (cosmetic, by choice)**:

- Accept the mismatch. `pip install pkg==0.2.0-alpha.1` actually works because pip normalizes the spec too. The version string just *displays* differently.
- Or: pick a release-please versioning scheme that emits PEP 440-form tags (`py/v0.2.0a1` instead of `py/v0.2.0-alpha.1`). Then npm/cargo/composer carry the PEP 440 form too. Cleaner but breaks the "dotted prerelease" convention used elsewhere.

We accept the mismatch in hop-top repos. Document for consumers who notice.

## GitHub Environment binding fails when env doesn't exist

**Symptom (workflow log)**:

```
Job 'publish' is requesting 'environment: pypi' but the environment does not exist.
```

Or the job runs but stalls waiting for environment approval that never comes (when protection rules exist on a different env name).

**Root cause**: PyPI OIDC mode requires `environment: pypi` (or whatever `pypi-environment` resolves to). The GitHub Environment must exist on the **caller** repo before the publish run — not on the mirror, not on the reusable's repo.

**Fix**: create the environment via API (deterministic) before cutting any py tags:

```bash
gh api -X PUT repos/<owner>/<repo>/environments/pypi
```

No protection rules needed for the default case. If you want manual approval, add reviewers via the UI after creation.

**Verify**:

```bash
gh api repos/<owner>/<repo>/environments --jq '.environments[].name'
```

## release-please PR goes DIRTY after main moves

**Symptom**: `gh pr view <n> --json mergeStateStatus` returns `DIRTY`. Trying to merge fails with `the merge commit cannot be cleanly created`. Files conflict between the release-please branch and main.

**Root cause**: release-please opened the standing release PR at commit X. After that, you (or other automation) merged commits to main that touch the same files release-please wants to bump (`<component>/package.json`, `<component>/CHANGELOG.md`, `.github/.release-please-manifest.json`). Now the PR branch can't fast-forward or three-way-merge cleanly.

**Fix (idiomatic)**: close the PR and delete the branch. release-please regenerates a fresh PR on the next push to main:

```bash
gh pr close <n> --comment "stale; regenerating against fresh main" --delete-branch
```

If release-please decides there's nothing left to release (because the in-progress main commits already shipped what would've been in the PR), no new PR appears — correct outcome.

**Anti-pattern**: don't try to rebase the release-please branch manually. release-please owns those files and will overwrite/conflict again on its next run.

## Tag predates the publish workflow + force-update collides with prior failed runs

**Symptom**: you force-update a tag to retry a publish; the new run also fails for a different reason; you fix again, force-update again; npm rejects the publish with "version already exists" or PyPI gives 400 on duplicate file upload.

**Root cause**: registries are immutable per version. Some (npm) allow a 72-hour grace `npm unpublish`; some (PyPI) don't allow republishing the same filename ever; some (crates.io) only allow `yank`. Each successful upload burns the version permanently.

**Fix**:

- npm: check `npm view <pkg> versions --json` before retrying. If the version already landed, the publish job fails on the duplicate upload.
- PyPI: same shape. Once `hop_top_uri-0.2.0a1.tar.gz` is uploaded, re-running the publish step errors with a 400.
- crates.io: yank doesn't free the version number. Once published, that number is gone.

**Important: the mirror does NOT update on a duplicate-version failure.** `publish-on-tag.yml` gates the mirror job on `needs.publish-*.result != 'failure'`, so a duplicate upload short-circuits the whole pipeline including the mirror push. If the artifact made it to the registry but the mirror is stale, you need a fresh tag (next bullet) — re-running the failed workflow won't fix it.

If you need a clean retry after a partial publish, **bump the version** rather than reusing.

## Sibling PRs and the close+retrigger trap

**Symptom**: bootstrapping a 7-component polyglot repo's first
release. Merge PR 1, sibling PRs 2-7 go CONFLICTING (expected —
shared manifest file, see [release-please PR goes DIRTY after main
moves](#release-please-pr-goes-dirty-after-main-moves) above).
Following the documented fix (close conflicting PR, `gh workflow run
release-please.yml`, repeat), the cycle doesn't converge: 26 PRs
opened and closed to land 7 real releases.

**Root causes, compounding**:

1. **A missing repo label silently broke the auto-rebase.**
   `release-please-config.json` referenced `status:release-pending`
   / `status:release-tagged` labels that didn't exist on a freshly
   recreated repo (GitHub's default label set doesn't include them).
   The release-please run's Action step **succeeded at computing
   candidate PRs**, then failed at the labeling API call — a failure
   mode that looks unrelated to labels unless you read the error
   body (`Validation Failed: {"value":"status:release-pending",...}`).
   Every "close + retrigger" cycle during this window silently did
   nothing to the sibling PRs, because the run that was supposed to
   rebase them errored out after label assignment, before it got
   around to updating other PRs. See [Required repo
   labels](../references/troubleshooting/common-pitfalls.md#required-repo-labels-for-release-please).

2. **The regeneration loop spawned spurious duplicate PRs.** After
   closing a conflicting PR for a component that had *already
   released* (no new commits since its tag), the next release-please
   run sometimes reopened a new PR for that same component with a
   no-op diff (duplicate CHANGELOG entry, no manifest change). These
   looked like real work but weren't — merging them would have been
   harmless but pointless; the fix was noticing the diff was empty
   and closing them too.

3. **Once labels were fixed, the close+retrigger loop still wasn't
   the fastest path** for this specific conflict shape: 6 remaining
   sibling PRs, each conflicting only on one line of a shared JSON
   object (one key per component, no real overlap). Switching to
   manual local rebase (fetch the release-please branch, rebase onto
   main, resolve the one-line JSON conflict by hand, force-push,
   merge) landed all 6 in a few minutes with zero new PRs opened.
   Contrary to this doc's older guidance, release-please did **not**
   reject the manually-rebased branch — it just merged normally.

**Takeaway for next time**:

- Create required labels **before** the first release-please run on
  any repo, especially a freshly recreated one — see [Fresh-repo
  recreate checklist](../references/troubleshooting/common-pitfalls.md#fresh-repo-recreate-checklist).
- If a "close + retrigger" cycle doesn't seem to be converging after
  2-3 attempts, stop and check the release-please run's full log for
  a labeling/API error — don't assume the loop just needs more
  iterations.
- For a **small number of stale sibling PRs** (single-digit) with a
  **trivial, well-understood conflict** (one shared file, additive
  changes, no release-please-owned logic being fought), manual local
  rebase is faster and more reliable than close+retrigger. Reserve
  close+retrigger for conflicts you don't want to hand-resolve, or
  when release-please's own commits on the branch are non-trivial.
  See [how-to/retrigger-release-please.md § Two fixes](../references/how-to/retrigger-release-please.md#two-fixes--pick-based-on-how-many-siblings-are-stale).

## See also

- [SKILL.md](../SKILL.md) — main consumer guide
- [browser-playbooks.md](browser-playbooks.md) — web-side setup steps (PyPI, Packagist, GitHub Environments)
- [bootstrap-checklist.md](bootstrap-checklist.md) — greenfield setup order
- [architecture.md](architecture.md) — control/data flow diagrams
