# 0001 — release-please rebase automation for sibling-component PRs

- Status: Proposed
- Date: 2026-05-28

## Context

`hop-top/.github` adopts `googleapis/release-please-action@v4` with
`separate-pull-requests: true`. The configuration opens one standing
release PR per component listed in `release-please-config.json`. Every
merge of any one of those PRs bumps `.release-please-manifest.json` —
the single file that pins every component's last-released version.

A `.release-please-manifest.json` write from PR `A` puts every other
open release-please bot PR into `DIRTY` / `CONFLICTING` state on the
manifest file. release-please's next `push: branches: [main]` run does
**not** rebase its own bot branches against the new main. They stay
dirty until a human:

1. Fetches the bot branch locally,
2. Rebases against the new main,
3. Resolves the manifest conflict by accepting the union (current
   component's bump from the bot branch + every other component's
   already-released SHA from main),
4. Force-pushes the bot branch with `GH_RELEASE_PLEASE_PAT`.

This was observed at `hop-top/poly-cite v0.1.0` cut: after merging
umbrella PR #7, five per-language PRs went dirty in lockstep and each
required the full local-fetch / rebase / force-push dance before
merge. With more components, the cost is `O(N²)` rebases per release
window — the manifest write from each merge invalidates every
remaining PR.

## Decision drivers

- Releases must remain serialisable: each component lands cleanly with
  its own commit + tag.
- The manifest file MUST converge to the union of all merged component
  bumps; a concurrent-bump conflict resolution that loses one bump is
  a silent regression.
- The fix must not require a hand-merge after the first PR lands.
- Single-component repos and umbrella-only repos must continue to
  work unchanged.

## Considered options

### Option 1 — release-please-action native rebase

Upstream `googleapis/release-please-action` does not currently expose a
`rebase-bot-branches`, `update-manifest-on-pr-merge`, or equivalent
flag. The action's bot-branch lifecycle is "delete + recreate on next
run for the component whose manifest entry changed" — sibling PRs are
not touched.

Verification path: search the action's README, its `action.yml`
inputs, the `release-please` core library's `update-pull-request`
codepaths, and the open issues for `manifest`, `rebase`, `conflict`,
`stale`, and `dirty`. If a flag exists upstream, prefer wiring it over
building our own.

Status as of writing: no such flag found in
[googleapis/release-please-action](https://github.com/googleapis/release-please-action)
or [googleapis/release-please](https://github.com/googleapis/release-please)
through reading public docs. An open issue on `release-please` tracking
"manifest conflicts under separate-pull-requests" should be linked
here once located; if none exists, file one upstream before shipping
our workaround so the upstream behaviour change can eventually retire
our reusable workflow.

Pros: zero local maintenance, one fewer reusable to keep in sync with
upstream release-please semantics.
Cons: blocked on upstream; no eta.

### Option 2 — `release-please-rebase.yml` reusable workflow

Build a reusable workflow in `hop-top/.github/.github/workflows/`
named `release-please-rebase.yml`. Adopters call it on
`pull_request_target` events for the `release-please--*` head-ref
glob, OR on `push: branches: [main]` after the release-please job
runs.

Shape:

```yaml
# .github/workflows/release-please-rebase.yml (reusable)
on:
  workflow_call:
    secrets:
      RELEASE_BOT_APP_ID: { required: true }
      RELEASE_BOT_PRIVATE_KEY: { required: true }
jobs:
  rebase-bot-prs:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/create-github-app-token@v3
        id: app-token
        with:
          app-id: ${{ secrets.RELEASE_BOT_APP_ID }}
          private-key: ${{ secrets.RELEASE_BOT_PRIVATE_KEY }}
      - uses: actions/checkout@v4
        with:
          token: ${{ steps.app-token.outputs.token }}
          fetch-depth: 0
      - name: Rebase open release-please bot PRs
        env:
          GH_TOKEN: ${{ steps.app-token.outputs.token }}
        run: |
          set -euo pipefail
          # 1. Enumerate open PRs whose head ref starts with
          #    `release-please--branches--<default-branch>--components--`.
          # 2. For each: fetch head, attempt `git rebase origin/main`,
          #    resolve `.release-please-manifest.json` by JSON-merge
          #    (union over keys, preferring the higher of any two
          #    overlapping component versions), continue rebase.
          # 3. Force-push with --force-with-lease.
          # 4. If a non-manifest conflict surfaces, skip the PR and
          #    emit `::warning::` with the PR number — never
          #    force-push past a real conflict.
```

Adopter wiring (added to existing `release-please.yml`):

```yaml
jobs:
  release-please:
    # … existing job …
  rebase-bot-prs:
    needs: release-please
    uses: hop-top/.github/.github/workflows/release-please-rebase.yml@v0
    secrets: inherit
```

Pros: solves the conflict cascade today; matches existing reusable
pattern (publish-on-tag, mirror-subtree, preflight); doesn't require
adopter-side branch protection or CODEOWNERS changes.

Cons: extra reusable to maintain; JSON-merge of the manifest must be
exact (any other key in manifest belongs to the PR's own component);
must skip PRs that have non-manifest conflicts to avoid clobbering
human edits to the bot branch (rare but possible).

### Option 3 — squash all release-please PRs into a single PR

Switch from `separate-pull-requests: true` to the default single-PR
mode. The single PR's manifest write is atomic across all components;
no cross-PR conflicts ever arise.

Pros: zero new code; eliminates the conflict class by design.

Cons: loses per-component release-note granularity in the PR review
flow; loses per-component PR labels / CI matrix scoping; conflicts
with the existing org-wide convention of per-component review +
approval gates; doesn't match the polyglot mental model where each
language ships independently.

Verdict: this is the upstream-recommended posture and the right
choice for a single-component repo. For polyglot repos that adopted
`separate-pull-requests` intentionally (the whole point of
hop-top/.github), reverting it would regress review ergonomics.

### Option 4 — branch protection delegates rebase to the bot account

Configure branch protection so the release-bot App can update its own
PRs after a sibling lands. Combined with an `auto-rebase` GitHub
Action (e.g. one of the community `pull_request` rebase actions),
sibling PRs auto-rebase the moment main moves.

Pros: leverages existing community automation.

Cons: the community rebase actions don't know how to resolve the
`.release-please-manifest.json` conflict (it's a semantic, not
textual, merge — the union-preserving merge is specific to release-
please). Hits the same dead end as Option 2 without us writing the
merge resolver, just with worse error surfaces.

## Decision

**Pursue Option 1 (upstream report) and Option 2 (local reusable) in
parallel.** File an upstream issue on
`googleapis/release-please-action` describing the conflict cascade
under `separate-pull-requests: true`; in parallel, scope and ship
`release-please-rebase.yml` as a hop-top/.github reusable. When
upstream lands a native fix, retire our reusable.

## Out of scope for this ADR

Implementing `release-please-rebase.yml` itself, including the exact
manifest-merge logic, the App-token permission set, the
`pull_request_target` vs `workflow_dispatch` trigger trade-off, and
the adopter migration path. Those land as a follow-up implementation
task.

## Consequences

- New reusable workflow to maintain: `release-please-rebase.yml`.
- New caller-side wiring required (one job added to each adopter's
  `release-please.yml`).
- Adopters that use single-component config see no change.
- Once the workflow lands, sibling-PR rebase becomes invisible — the
  reviewer sees clean PRs at all times. The cost shifts to the bot's
  token quota (one extra App-token mint per main-branch push); well
  within free-tier limits.
- The manifest-merge resolver becomes a piece of business logic the
  org must keep in sync with release-please's manifest format changes
  (currently a flat `{component: version}` map). Pin the action
  version that the resolver targets and bump deliberately.

## References

- [googleapis/release-please-action](https://github.com/googleapis/release-please-action)
- [googleapis/release-please](https://github.com/googleapis/release-please)
- `references/how-to/retrigger-release-please.md` (the manual procedure
  this ADR proposes to automate).
- `references/concepts/mental-model.md § Snapshot semantics` (related:
  same family of "workflow file at snapshot time" caveats apply to
  the rebase workflow once it ships).
