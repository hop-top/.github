# release-bot

Why release PRs are opened by `release-bot[bot]`, and what your repo needs for that to work.

## What

release-please runs on every push to main and maintains a standing release PR. That PR is
not opened with the workflow's default token or anyone's personal token — each run mints a
short-lived installation token from the **release-bot** GitHub App via
`actions/create-github-app-token` and passes it to `googleapis/release-please-action`. The
PR author you see is `release-bot[bot]`.

## Why

Three problems, one authorship choice:

1. **CI must run on the release PR.** PRs created with the default `GITHUB_TOKEN` cannot
   trigger downstream workflows. The release PR would sit with zero checks; branch
   protection would then block the merge (or, worse, merge unverified).
2. **No long-lived credentials.** Long-lived personal tokens proved unreliable at delivery
   time on fresh repos, and are a standing secret to rotate and leak. The
   release-please-preflight check rejects PAT mode outright.
3. **Review stays real.** A PR author cannot approve their own PR. If a human authored the
   release PR, a single-owner repo would deadlock on required review — or rubber-stamp it.
   Bot authorship leaves the human free to actually review.

## What consumers set up

- Org secrets `RELEASE_BOT_APP_ID` and `RELEASE_BOT_PRIVATE_KEY` — maintained org-wide;
  verify your repo can read them.
- The release-bot App installed on your repo with Contents, Pull requests, and Workflows
  read/write.
- Full wiring order: [docs/bootstrap-checklist.md](../../docs/bootstrap-checklist.md).
- Catch misconfiguration at PR time: [add-preflight](../how-to/add-preflight.md).

## CODEOWNERS note

Scope the release-config paths to the release team, not an individual:

```
# Release configuration + changelogs — release team only
release-please-config.json    @hop-top/release
.release-please-manifest.json @hop-top/release
CHANGELOG.md                  @hop-top/release
```

This does two jobs:

1. Path-level required review can't self-deadlock (team, not one person).
2. **Auto-merge brake.** Every release PR rewrites the manifest, so with
   code-owner review required, no generic auto-merge (merge-on-green,
   dependabot flows) can ever complete on a release PR. Releases cut only
   after an explicit release-team approval; scheduled auto-cut jobs merge
   approved-and-green release PRs at cadence — they time the merge, they
   cannot bypass the approval.

The pairing that makes it work (reference shape: poly-kit ruleset
`production-branch-guardrail`):

- Ruleset on the default branch: `required_approving_review_count: 0` +
  `require_code_owner_review: true`.
- CODEOWNERS stays **minimal** — only the release-config lines above, no
  `*` fallback. A `*` rule would pull every PR into code-owner review and
  kill frictionless auto-merge for everything else. Zero approvals + owned
  release paths = review-free repo except release state.

Basename patterns match the files under `.github/` too. With an individual owner instead,
any release-config change that person authors would hit the same self-approval block the
bot authorship exists to avoid.
