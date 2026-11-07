# Lock workflow dependencies

Pin every action your workflows use to an exact commit, keep readable tags in the workflow files, and fail PRs when the lock goes stale.

## Use this when

- Onboarding a repo to `.github/workflows/actions.lock`.
- Adding a workflow to a repo that already has a lockfile.
- `verify-lockfile` failed, or a `ref-moved` warning appeared.

## Result

A committed lockfile covering every workflow, including transitive actions, a required `verify-lockfile` check, and Dependabot keeping both current.

## Quick version

```sh
gh extension install github/gh-actions-lock --pin v0.4.0
gh actions-lock            # generate; run from the repo root
gh actions-lock --verify   # read-only; what CI runs
```

Use the same extension version as `verify-lockfile.yml`'s `extension-version` default.

## Steps

### 1. Enable Dependabot for Actions first

Dependabot regenerates the matching lock entry in the same PR, with no extra configuration. It only touches workflows that already have entries; it never onboards one.

```yaml
# .github/dependabot.yml
version: 2
updates:
  - package-ecosystem: github-actions
    directory: /
    schedule:
      interval: weekly
    cooldown:
      default-days: 14
    ignore:
      - dependency-name: "*"
        update-types: [version-update:semver-major]
```

### 2. Generate the lockfile

Run `gh actions-lock` from the repo root and review the whole diff before committing. The extension also rewrites `uses:` refs to the resolved version (`@v7` may become `@v7.0.1`, same commit). Commit the rewritten refs with the lockfile.

If a same-repo `./` action calls remote actions, the run reports `local-action` and writes nothing. Fix it with:

```sh
gh actions-lock --migrate-local-actions
```

That rewrites `./` to `$/`, which always runs at the workflow's own commit.

### 3. Verify in CI

```yaml
# .github/workflows/verify-lockfile.yml
name: verify-lockfile
on:
  pull_request:
  push:
    branches: [main]
permissions:
  contents: read
jobs:
  verify:
    uses: hop-top/.github/.github/workflows/verify-lockfile.yml@v0
```

Make it a required check last: [bootstrap checklist § 6b](../../docs/bootstrap-checklist.md#6b-make-checks-required-last).

### 4. Fix allowed-actions lists

Once a repo is onboarded, allowed-actions lists are checked against locked commit SHAs. An entry pinned to a tag (`actions/checkout@v7`) stops matching; use a wildcard or the full SHA.

### 5. Turn on `Require lockfile` last

Set it under Settings → Actions → Policies, once `gh actions-lock --verify` passes in every targeted repo. Active blocks:

- every targeted workflow that is not onboarded, even if others in the same repo are;
- a caller whose reusable workflow is not onboarded in its own repo.

This repo's workflows are locked here, so callers of `@v0` are covered. `Evaluate` mode is GitHub Enterprise Cloud only. If workflows need to run as `dependabot[bot]`, add Dependabot as an allowed actor.

## What the lockfile leaves out

- Reusable workflows at `jobs.<id>.uses`: keep [the `@v0` pin](../pinning.md). Their own actions are covered by the lockfile in the repo that defines them.
- Inputs, secrets and the runner image.
- Container images without an `@sha256:` digest: warned about, not locked.
- Whether a dependency is safe. Review it before locking it.

## Keep it current

| Situation | Do this |
|---|---|
| New workflow, or a changed `uses:` | `gh actions-lock`, commit the diff |
| `ref-moved` warning (`@v7` or `@main` moved) | Read upstream history, then `gh actions-lock --relock` |
| Full version tag moved (error) | `--relock` after review, or change the `uses:` line |
| Locked commit left the ref's history (force-push) | Review, then `gh actions-lock --accept-moved`; never in automation |
| Changed `owner_id` or `repo_id` in a diff | The repo behind the name changed; investigate before merging |
| Corrupted lockfile | Restore it from the default branch, then `gh actions-lock`; never delete it to clear errors |

## Next steps

- [Pin the reusable workflow](../pinning.md)
- [GitHub docs: workflow dependency lockfiles](https://docs.github.com/actions/concepts/security/workflow-dependency-lockfiles)
- [gh-actions-lock troubleshooting](https://github.com/github/gh-actions-lock/blob/main/docs/troubleshooting.md)
