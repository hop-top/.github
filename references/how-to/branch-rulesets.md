# Apply branch rulesets to a hop-top repo

## Use this when

A repo is new, or has no branch protection, or its protection drifted from the org baseline.

## Result

The default branch, `main` and `release/*` reject deletion and force-push, and take changes only through a pull request with passing required checks.

## Why per repo

Org-level rulesets need a paid GitHub plan; the org is on the free plan, so `gh api orgs/hop-top/rulesets` returns 403. Each repo gets its own copy, applied from the versioned templates in [`templates/rulesets/`](../../templates/rulesets/) by [`scripts/apply-rulesets.sh`](../../scripts/apply-rulesets.sh).

Secrets need no per-repo step: the org secrets are already org-level with visibility `all` (see [secrets.md](../secrets.md)).

## Branch model

| Branch | Role |
|---|---|
| default (`next`) | prerelease line |
| `main` | stable line |
| `release/x.y` | maintenance line |

Every ruleset targets `~DEFAULT_BRANCH`, `refs/heads/main` and `refs/heads/release/*`.

## Templates

| File | Enforcement | Rules |
|---|---|---|
| `production-branch-guardrail.json` | active | no deletion, no force-push, pull request with code-owner review, required status checks |
| `conventional-commits.json` | active | `commit_message_pattern`: Conventional Commits subject |

Required checks in the guardrail:

| Context | Source | Scope |
|---|---|---|
| `preflight / preflight` | [add-preflight](add-preflight.md) | generic; the repo must run it |
| `ci-ok / gate` | [single-required-check](single-required-check.md) | generic; the repo must run it |

A required check the repo never reports blocks every merge. Replace the list with `--checks`, or add repo-specific ones with `--add-check` (poly-kit also requires `validate-promotion`, a job of its own CI).

Both rulesets let the repository `admin` role bypass (`RepositoryRole` 5, mode `always`). `--bypass-user <id>` adds a user on top.

`conventional-commits` assumes a rebase-only repo, where every commit subject is the PR commit. A repo that allows merge commits ("Merge pull request ...") must not take it: apply with `--only production-branch-guardrail`, or set the ruleset to `disabled`.

Before applying, the repo must already run both required jobs. A check that never reports blocks every merge. `--dry-run` warns for each required check not seen on the default branch head.

## Steps

```sh
# 1. Preview; writes nothing
scripts/apply-rulesets.sh --dry-run hop-top/<repo>

# 2. Apply
scripts/apply-rulesets.sh hop-top/<repo>
```

Options: `--checks a,b`, `--add-check <context>`, `--bypass-user <id>`, `--only <template-stem>`.

The script matches rulesets by `name`: it creates a missing one, updates an existing one in place, and reports `up to date` when nothing differs. Re-running is safe. Land the check workflows on every covered branch before applying.

## Verify

```sh
gh api repos/hop-top/<repo>/rulesets --jq '.[] | [.name, .enforcement] | @tsv'
```
