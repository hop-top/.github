<!-- Generated — managed centrally; do not edit here. -->
# Release schedule

How releases ship from hop-top repos using this repo's reusable release workflows.
Cadence is organized as **lanes**; hop-top currently runs two, with three more reserved.

## Channels in use

| Suffix | Semantics | Status |
|---|---|---|
| `-alpha.N` | Early, unstable, breaking allowed | Active — every repo today |
| `-beta.N` / `-rc.N` | Feature-complete / release candidate | Reached via the promote gate (channel ladder `alpha → beta → rc → release`, all packages in lockstep) |
| (empty) | Stable | `Release-As: X.Y.Z` footer or `prerelease: false` flip |
| `-nightly.YYYYMMDD` | Dated builds | Reserved — lane not yet adopted |
| `-experimental.N` | POC / R&D distributions — end-user feedback, anonymized usage-data collection | Available, per-package opt-in; outside the promote ladder (never promotes — graduate via `alpha → beta → rc`). Packagist: Composer rejects the suffix, php components map to `alpha.N` or skip |

## Lane 1 — Auto-cut (active)

The standing release-please PR is merged automatically at cadence:

- Cron daily **04:00 UTC** finds the PR at head `release-please--branches--main`;
  if CI is green, `gh pr merge --squash --auto`.
- The merge completes only after release-team approval: release PRs always rewrite
  `.release-please-manifest.json`, which is code-owner-gated — see
  [release-bot](../references/concepts/release-bot.md) for the full mechanism
  (guardrail ruleset: zero required approvals + code-owner review). The cron times the
  merge; it can never bypass the review.
- Kill-switch: repo variable `NIGHTLY_RELEASE=false` (skipped runs = off).

## Lane 2 — Drafted (active)

Release when a human says so:

1. Inspect the standing release-please PR.
2. Choose the cut:
   - Continue the prerelease line (`-alpha.N+1`): merge as-is.
   - Graduate the counter to the next base: seed `.release-please-manifest.json`
     directly — worked example:
     [poly-kit#37](https://github.com/hop-top/poly-kit/pull/37).
   - Cut stable: `Release-As: X.Y.Z` footer or flip `prerelease: false`; without one of
     those, merging produces another `-alpha.N`.
3. Merge. The publish workflow fires on the resulting tag.

## Reserved lanes (defined org-wide, not yet adopted)

- **Channel-nightly** — dated `-nightly.YYYYMMDD` builds from `main` under per-registry
  nightly channels (npm `@nightly` dist-tag, PyPI `.devYYYYMMDD`, composer `dev-main`).
- **Hotfix (LTS)** — `release/<base>` long-lived lines with issue-driven backports;
  activates once a first stable line ships (everything is pre-1.0 alpha today). The
  `release/<base>` + `backport/<base>/<slug>` branch grammar is reserved for it.
- **Cadenced** — fixed monthly cut with freeze → RC → ship waterfall.

## Branch protection

Default branches use the guardrail ruleset: zero required approvals +
required code-owner review + deletion/non-fast-forward blocks, paired with the minimal
CODEOWNERS described in [release-bot](../references/concepts/release-bot.md). A
`conventional-commits` ruleset enforces commit grammar.

## Repos in scope

Consumers of the shared release workflows today:

- `publish-on-tag.yml`: poly-kit, poly-aim, poly-c12n
- `goreleaser-on-tag.yml`: aps, tlc, poly-c12n

To opt in, see [quick-start](../references/quick-start.md) and the
[bootstrap checklist](bootstrap-checklist.md).
