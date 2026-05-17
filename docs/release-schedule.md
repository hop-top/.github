# Release schedule

How releases ship from repos using `hop-top/.github`'s reusable
release workflows (`publish-on-tag.yml`, `release-please.yml`,
mirror + per-language publish flows).

Three lanes: **nightly** (automatic), **hotfix** (any time),
**planned** (drafted or cadenced).

## Channels

| Suffix | Semantics | Trigger |
|---|---|---|
| `-nightly.YYYYMMDD` | Latest unreleased state from `main` | Daily cron |
| `-alpha.N` | Early, unstable, breaking allowed | Standing release-please PR (counter increments on every accepted release-please PR merge, not on every commit) |
| `-beta.N` | Feature-complete, API may still shift | `Release-As:` footer + RC plan |
| `-rc.N` | Release candidate, no functional change expected | Cut N days before planned release date |
| (empty) | Stable | Planned release date OR hotfix |
| `-experimental.N` | Explicitly experimental SDKs (Rust, PHP today) | Same cadence as alpha, distinct suffix |

Stable has no suffix — `v0.4.0`, `v1.2.3`. The alpha/beta/rc suffixes
all use `<channel>.N` where N is a counter.

## Lane 1 — Nightly

**Trigger:** cron, daily at **02:00 UTC**.

**Source:** `main`, current HEAD.

**Skip condition:** no commits since the last nightly tag.

**Version format:** `<next-base>-nightly.YYYYMMDD` where `<next-base>`
is the version release-please would propose next from the standing
PR. Example: if release-please's standing PR is at `0.4.0-alpha.3`,
the nightly tag is `0.4.0-nightly.20260517`.

**Registry destination:** same registry, distinct dist-tag.

| Ecosystem | Dist-tag / channel |
|---|---|
| npm | `nightly` (`npm i @hop-top/kit@nightly`) |
| PyPI | `--pre` install resolves nightly; no separate channel |
| crates.io | published as ordinary version, consumers pin explicitly |
| Packagist | composer `dev-main` alias is preferred for nightly use |
| Go proxy | `go get hop.top/kit@<commit>` for pseudo-versions; nightly tags resolve via the same proxy |

**Linked-version coordination** (for polyglot repos like `poly-kit`): each linked component is evaluated independently against its own paths. Components with no commits since their last nightly **skip the new tag and stay on their previous nightly version**. Linked components are *not* date-aligned across the group — `kit-ts@nightly` and `kit-py@nightly` may resolve to different date suffixes if one had no changes that day. Consumers pinning by date should pin per-component.

## Lane 2 — Hotfix

**Trigger:** human-initiated, any time. Bug discovered in production,
security issue, regression.

**Source:** the LTS branch matching the affected release. NOT `main`. See [Branch convention](#branch-convention) for branch naming, creation, and EOL.

**LTS window:**

| Major | LTS scope |
|---|---|
| `0.x` | Last 2 **minor** lines (e.g. if current is `0.4`, support `0.4` + `0.3`) |
| `≥1.x` | Last 2 **major** lines (e.g. if current is `2.x`, support `2.x` + `1.x`) |

**Backport eligibility:**

| Fix type | Eligible? | Notes |
|---|---|---|
| Security (CVE, disclosed vulnerability) | Yes | All in-scope LTS branches |
| Data-loss / corruption bugs | Yes | All in-scope LTS branches |
| Regressions vs. prior release | Yes | Branches where the regression shipped |
| Performance fixes | No | Use planned release |
| Feature additions | No | Use planned release |
| Refactors / code cleanup | No | Stay on `main` |
| Docs-only | No | Stay on `main` |

**Cadence:** a hotfix patches **every in-scope LTS branch simultaneously**. Follow the [backport workflow](#backport-workflow): open a tracking issue, then one cherry-pick PR per target branch. Merged together when possible. Patch number bumps independently per branch.

**Example:** A security fix lands on `main` and ships as `0.4.5`. The same fix is cherry-picked to `release/0.3` and tagged as `0.3.7` (whatever the next patch on that line is). Two patch releases ship in the same window.

**Backports never replay to `main`.** The original fix is already on `main`; the backport PR exists only to land that fix on an older LTS line.

## Lane 3 — Planned

Two modes. A repo picks one and sticks with it.

### Mode A — Drafted (manual)

Release happens when a human says so. Maintainer:

1. Inspects the standing release-please PR. Decides "ready" based on what's accumulated.
2. Chooses the cut:
   - **Continue on the current prerelease line** (e.g. another `-alpha.N+1`): just merge the standing PR as-is.
   - **Graduate the prerelease counter to the next base** (e.g. `0.3.0-alpha.5` → `0.4.0-alpha.0`): seed `.release-please-manifest.json` directly. See [PR #37 on `poly-kit`](https://github.com/hop-top/poly-kit/pull/37) for a worked example.
   - **Cut a stable release (no suffix)**: requires both *either* (a) `Release-As: X.Y.Z` footer on a triggering commit *or* (b) flipping `prerelease: false` in `release-please-config.json` for the affected packages. Without one of those, merging the standing PR produces another `-alpha.N`, not stable.
3. Merge the release-please PR.
4. Publish workflow fires automatically on the resulting tag.

No fixed schedule. No feature freeze (you control commit flow directly).

Suited for: low-volume repos, single-maintainer projects, repos where release pacing is naturally bursty.

### Mode B — Cadenced

Release happens on a fixed cadence: **second Tuesday of every
month**. The cadence itself triggers side-effects on a waterfall
schedule:

| Days before release | Event | Action |
|---|---|---|
| **T-7** | Feature freeze | Stop merging `feat:` commits to `main`. Only `fix:`, `docs:`, `test:`, `ci:`, `chore:` allowed. Open an issue tagged `release-freeze` to track the window. |
| **T-7** | Documentation sweep starts | Maintainer reviews CHANGELOG drafts, ensures every `feat:` since the last release has a doc/migration note. |
| **T-5** | Release notes draft | Maintainer writes the release-notes prose (the human-facing summary that lives in the GitHub release body, above the changelog). |
| **T-3** | RC cut | Tag `vX.Y.Z-rc.0` from the current `main`. Publish to all registries under `rc` channel. Smoke-test consumers. |
| **T-1** | Stakeholder notice | Post in `#releases` (or wherever): "vX.Y.Z ships tomorrow at <time>". Include link to CHANGELOG + release notes draft + RC version. |
| **T-0** | Release | Merge the release-please standing PR. The PR bumps from accumulated commits but never proposes a major (use `Release-As:` to bump major). Publish workflow tags + publishes. |
| **T+1** | LTS branch cut (if minor or major bump) | Cut `release/<base>` from the new release tag. Update LTS table in this doc. |

**Bump rules for the merge at T-0:**

- release-please uses commit types to compute the bump
  (`feat:` → minor, `fix:` → patch, `feat!:` → major).
- **release-please will never auto-propose a major bump.** A major
  cut requires an explicit `Release-As: X.0.0` footer on the
  triggering commit.
- The maintainer chooses to merge or hold. Holding skips this
  month's cadence — the work rolls into next month.

**RC churn:** if any test/bug fix lands between T-3 and T-0, cut a
new `vX.Y.Z-rc.N+1` from `main`. The final stable tag is cut from
the same commit as the last RC.

### Coordination across linked components (polyglot repos)

For repos with `linked-versions` in `release-please-config.json` (e.g. `poly-kit` links kit, kit-ts, kit-py, kit-rs, kit-php).

**How release-please's `linked-versions` actually behaves:** when any commit triggers a bump in one linked component, every other linked component also gets a release PR with the same *kind* of bump (patch / minor / major), applied to its own current version. It does **not** snap all components to a single shared version number — `kit` at `0.3.1` and `kit-ts` at `0.3.5` would, on a coordinated minor bump, go to `0.4.0` and `0.4.5` respectively, not both to `0.4.0`.

To force all linked components to a shared version (e.g. resetting after a coordinated milestone), seed `.release-please-manifest.json` directly. This is the same mechanism used to graduate prerelease counters; see [PR #37 on `poly-kit`](https://github.com/hop-top/poly-kit/pull/37) for a worked example.

**Coordination rules for hop-top polyglot repos:**

| Current major | Coordination boundary | What's linked | What's independent |
|---|---|---|---|
| `0.x` | **Minor bumps** | All linked components bump minor together (each from its own current version) | Patch bumps land per-component |
| `≥1.x` | **Major bumps** | All linked components bump major together (each from its own current version) | Minor and patch bumps land per-component |

Rationale: in `0.x` the minor is the breaking-change boundary, so it's the coordination point. Post-1.0, major is the breaking boundary; minor and patch carry no breaking-change risk and don't need to march in lockstep.

**LTS branches in polyglot repos** track the source repo's `<base>`, not per-component. `poly-kit` cuts a single `release/0.4` covering kit, kit-ts, kit-py, kit-rs, kit-php together.

## Lane summary

| Lane | Cadence | Branch | Channel(s) | Triggers |
|---|---|---|---|---|
| Nightly | Daily 02:00 UTC | `main` | `-nightly.YYYYMMDD` | Cron, skip if no commits |
| Hotfix | Anytime | `release/<base>` | empty (stable patch) | Human, security/regression/data-loss |
| Planned Mode A | When ready | `main` → tags | alpha/beta/rc → empty | Human merges release-please PR |
| Planned Mode B | 2nd Tuesday | `main` → tags | alpha/beta/rc → empty | Calendar; T-7 freeze, T-3 RC, T-0 ship |

## Repos in scope

Repos using `hop-top/.github`'s release workflows. This includes
every repo that imports `publish-on-tag.yml@v0` from its
`publish.yml`.

Today:
- `hop-top/poly-kit`
- `hop-top/poly-uri`

To opt in, add a `publish.yml` that calls
`hop-top/.github/.github/workflows/publish-on-tag.yml@v0` and
configures the `ecosystems` map. See either repo for reference.

## Open questions (not yet decided)

- **Beta channel** is reserved in the channel table but no current
  repo uses it. When the first `0.x → 1.0` cut approaches, define
  the alpha-to-beta promotion rule (likely: feature freeze + N green
  RCs).
- **Concurrent RC channels** — if a hotfix RC and a planned RC are
  active simultaneously, the channel suffix needs disambiguation.
  Defer until it happens.
- **Mirror nightly housekeeping** — nightlies accumulate fast. After
  M days (suggest 30) prune nightly tags from mirror repos to keep
  `gh release list` readable. Keep them on the source `poly-*` repo
  for git history.
