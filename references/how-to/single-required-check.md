# Require one check per workflow (`ci-gate`)

Gate jobs by what a PR changed, keep every required check reporting,
and require a single check instead of a list.

## Use this when

- Every job runs on every PR, because a filtered required check would
  leave PRs pending.
- Jobs start a runner, decide they have nothing to do, and report
  success, so the PR's checks do not show what ran.
- The ruleset lists many checks, and adding or renaming a job means
  editing it.

## Result

Jobs a PR cannot affect show as skipped and start no runner. One check,
`ci-ok / gate`, fails when any job failed or was cancelled, and is the
only one the ruleset requires.

## Why not trigger filters

A required check whose workflow a trigger-level `paths:` / `branches:`
filter skips never reports, and the PR waits on it forever
([bootstrap-checklist § 6b](../../docs/bootstrap-checklist.md#6b-make-checks-required-last)).
A job skipped by its own `if:` reports as skipped, which GitHub counts
as passing. So the decision moves from the trigger to the job.

A step-level skip (`if: steps.scope.outputs.run == 'true'` on every
step) also keeps the check reporting, but the job still takes a runner
and a checkout, and reports success for work it never did.

## Steps

### 1. Decide once, in a `changes` job

One job works out what the PR touched and publishes a flag per area.
Run the repo's own scope script, or any path filter, once:

```yaml
jobs:
  changes:
    runs-on: ubuntu-latest
    outputs:
      go: ${{ steps.scope.outputs.go }}
      docs: ${{ steps.scope.outputs.docs }}
    steps:
      - uses: actions/checkout@v7
        with:
          fetch-depth: 0
          persist-credentials: false
      - id: scope
        run: scripts/ci-scope.sh >> "$GITHUB_OUTPUT"   # prints go=true / docs=false
```

On `push`, `schedule` and `workflow_dispatch`, have the script set every
flag to `true`: post-merge and nightly runs are the safety net for
anything PRs skip.

### 2. Gate each job on its flag

```yaml
  go-test:
    needs: changes
    if: needs.changes.outputs.go == 'true'
    runs-on: ubuntu-latest
    steps: ...
```

A job gated off shows as skipped. A job that depends on a skipped job
is skipped too, unless its own `if:` uses `always()` or `!cancelled()`.

### 3. Add the gate

```yaml
  ci-ok:
    if: always()
    needs: [changes, go-test, docs-lint]   # every other job in the workflow
    uses: hop-top/.github/.github/workflows/ci-gate.yml@v0
    with:
      needs: ${{ toJSON(needs) }}
```

`if: always()` is required: without it the gate is skipped when a job it
needs fails, and a skipped required check passes. A job left out of
`needs:` is not checked; add each new job to the list.

### 4. Require only the gate

Land the workflow on every branch the ruleset covers, watch `ci-ok /
gate` report on a PR into each, then make it the one required check for
the workflow. Remove the job-level checks it replaces from the ruleset in
the same change.

Other workflows that must stay required (preflight, lockfile check) keep
their own check. Inside each, gate by job `if:`, never by trigger
filter.

## What the gate checks

| A needed job ended | Gate |
|---|---|
| `success` | passes |
| `skipped` | passes |
| `failure`, `cancelled` | fails, names the job |
| anything else | fails |

It also fails when `needs` is empty or is not a JSON object, so a
misconfigured gate never passes on nothing. The step summary lists every
job with its result.

## Next steps

- [add-preflight.md](add-preflight.md): the preflight caller, gated the
  same way.
- [bootstrap-checklist § 6b](../../docs/bootstrap-checklist.md#6b-make-checks-required-last):
  the order for making a check required.
