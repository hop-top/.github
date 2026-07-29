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

## Two fixes — pick based on how many siblings are stale

### Fix A: manual rebase (fastest, use this first)

Contrary to older guidance in this doc, release-please **does**
accept a manually rebased branch — it doesn't own the branch in any
special way, it just pushes commits to it like any other actor. For
the common case (N sibling PRs each adding one key to the same
single-line manifest JSON), the conflict is trivial and mechanical:

```bash
git fetch origin
git checkout -b rebase-<component> origin/release-please--branches--main--components--<component>
git rebase origin/main
# CONFLICT (content): Merge conflict in .github/.release-please-manifest.json
# Resolve by hand — merge both sides' keys into one object:
#   {"already-released-pkg": "0.1.0-alpha.0", "<component>": "0.1.0-alpha.0"}
git add .github/.release-please-manifest.json
git rebase --continue
git push origin rebase-<component>:release-please--branches--main--components--<component> --force-with-lease
gh pr merge <pr-number> --repo <org>/<repo> --merge --delete-branch
```

Repeat per sibling, one at a time (rebase against the just-updated
`main` each time). This is the path we now recommend for a batch of
sibling PRs going stale after each merge — see the retrospective in
[docs/failure-modes.md § Sibling PRs and the close+retrigger
trap](../../docs/failure-modes.md#sibling-prs-and-the-closeretrigger-trap)
for why the close+retrigger loop (Fix B) burned through 20+ PR
numbers on a 7-component repo before we switched to this.

**When Fix A doesn't apply**: if release-please's own automation
already rewrote the PR's commits (not just a plain "add one key"
diff) since you last looked, or the conflict is on a file you don't
understand well enough to hand-resolve, fall back to Fix B.

### Fix B: close + retrigger (when the diff isn't trivial, or you don't trust a hand merge)

#### 1. Close the conflicting PR

```bash
gh pr close <conflicting-pr> --repo <org>/<repo> --delete-branch
```

#### 2. Re-run the release-please workflow

```bash
gh workflow run release-please.yml --repo <org>/<repo>
```

#### 3. Verify a fresh PR was opened

```bash
gh pr list --repo <org>/<repo> --label 'autorelease: pending' --state open
```

**Watch for spurious duplicate PRs.** After closing a conflicting PR
for a component that's *already released* (no new commits since),
the next release-please run can still open a new PR for it with a
no-op diff (e.g. re-adding an identical CHANGELOG entry). This isn't
a bug you introduced — check the diff before merging; if it doesn't
actually change the manifest version, close it too.

**If retriggering doesn't rebase the other stale PRs**: check that
both `status:release-pending` and `status:release-tagged` labels
(or whatever your config's `label`/`release-label` fields say) exist
on the repo. A missing label makes the release-please run fail
_after_ it's already computed candidates, silently leaving sibling
PRs un-rebased with no obvious error pointing at "labels." See
[troubleshooting/common-pitfalls.md § Required repo
labels](../troubleshooting/common-pitfalls.md#required-repo-labels-for-release-please).

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
