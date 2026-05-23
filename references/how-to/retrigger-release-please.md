# Re-trigger release-please

Recover from sibling-PR manifest conflicts.

## Use this when

- You merged release-please PR for component A, and component B's PR now shows `mergeStateStatus: DIRTY` or CONFLICTING.
- You closed a release-please PR manually and want a fresh one.
- You want to force release-please to recompute the standing PRs.

## Result

release-please reopens the affected PRs with a freshly rebased
manifest.

## Why this happens

release-please opens one PR per component, but they share one
manifest file. When you merge component A's PR, the manifest
advances — component B's PR is now CONFLICTING because its branch
still proposes an older manifest.

The fix isn't "rebase the PR" (release-please won't accept manual
rebases). The fix is **close the conflicted PR + retrigger
release-please**.

## Steps

### 1. Close the conflicting PR

```bash
gh pr close <conflicting-pr> --repo <org>/<repo>
```

### 2. Re-run the release-please workflow

```bash
gh workflow run release-please.yml --repo <org>/<repo>
```

### 3. Verify a fresh PR was opened

```bash
gh pr list --repo <org>/<repo> --label 'autorelease: pending' --state open
```

## Requirement: `workflow_dispatch`

For `gh workflow run` to work, `release-please.yml` must declare
`workflow_dispatch`:

```yaml
on:
  push:
    branches: [main]
  workflow_dispatch: {}
```

This is already in the [quick-start template](../quick-start.md).
If your repo predates the template, add `workflow_dispatch: {}` to
your `release-please.yml`.

## Workaround when `workflow_dispatch` isn't enabled

If branch protection blocks direct pushes to `main` and
`workflow_dispatch` isn't declared, PR an empty commit so
release-please runs on the resulting merge to main:

```bash
git commit --allow-empty -m "chore: re-trigger release-please"
```

## Common issues

| Problem | Cause | Fix |
|---|---|---|
| `gh workflow run` returns `Resource not accessible by integration` | `workflow_dispatch` not declared | Add it to `release-please.yml` |
| Sibling PRs go CONFLICTING again | Multiple components share a manifest; merging in sequence is normal | Just close each and retrigger — it's idempotent |
| release-please PR shows DIRTY immediately after open | Main moved between PR creation and merge attempt | Close PR + delete branch; release-please regenerates on next push |

## Next steps

- [Re-trigger a failed publish](retrigger-failed-publish.md) — different problem, similar feel.
- [troubleshooting/common-pitfalls.md](../troubleshooting/common-pitfalls.md).
