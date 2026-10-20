# Bootstrap checklist for a new polyglot hop-top repo

Order matters. Do these in sequence; some steps depend on prior ones.

## 0. Decide the component layout

Pick which ecosystems ship and the directory layout. Conventional hop-top shape:

```
my-repo/
  ts/        # @org/my-pkg on npm
  py/        # org-my-pkg on PyPI
  rs/        # org-my-pkg on crates.io
  php/       # org/my-pkg on Packagist
  go/        # github.com/org/my-pkg via proxy.golang.org
```

Each component directory contains its own manifest (`package.json`, `pyproject.toml`, `Cargo.toml`, `composer.json`, `go.mod`).

The git-tag scheme is `<component>/v<version>` (e.g. `my-pkg-ts/v0.2.0`). The publish workflow keys off the prefix. Component, registry slug, import name and mirror slug per language are fixed by the bare name — copy them from [how-to/polyglot-repo.md § Package identities](../references/how-to/polyglot-repo.md#package-identities).

## 1. Org-level secrets

Create at `https://github.com/organizations/<org>/settings/secrets/actions`.

| Secret | Required for | Notes |
|---|---|---|
| `GH_MIRROR_PAT` | every release (mirror push) | Fine-grained PAT, `Administration: RW` + `Contents: RW` on every mirror repo |
| `RELEASE_BOT_APP_ID` | release-please standing PR | Numeric App ID of the hop-top release-bot GitHub App. The App must be installed on the source repo with `Contents: RW` + `Pull Requests: RW` + `Workflows: RW`. Paired with `RELEASE_BOT_PRIVATE_KEY`. |
| `RELEASE_BOT_PRIVATE_KEY` | release-please standing PR | PEM private key for the same App. Mint via the App's GitHub settings page. Paired with `RELEASE_BOT_APP_ID`. |
| `NPM_REGISTRY_TOKEN` | ts component | npm Granular Access Token, publish on your scope — needed once for the FIRST publish; bind a [trusted publisher](../references/how-to/npm-trusted-publishing.md) right after and the token goes unused |
| `CARGO_REGISTRY_TOKEN` | rs component | crates.io API token. Account must have a **verified email**. |
| `PYPI_REGISTRY_TOKEN` | py component (token mode) | OPTIONAL — only if you're using `pypi-auth: token` instead of OIDC. PyPI API token (project-scoped after first publish; account-scoped for bootstrap). |
| `PACKAGIST_USERNAME` | php component | Packagist account username. Paired with `PACKAGIST_TOKEN`. Find at <https://packagist.org/profile/edit>. |
| `PACKAGIST_TOKEN` | php component | Packagist API token. Required for `publish-php`'s `update-package` API notify after each mirror push. Mint at <https://packagist.org/profile/edit>. |

**Why an App token (and NOT `GITHUB_TOKEN` or a long-lived PAT)?**
The default `GITHUB_TOKEN` can't open release PRs that trigger downstream workflows, and long-lived fine-grained PATs (the older approach this checklist used to teach) have unreliable delivery in practice — the preflight workflow now rejects them. The release-please job mints a short-lived installation token from `RELEASE_BOT_APP_ID` + `RELEASE_BOT_PRIVATE_KEY` and passes it as `token:` to `googleapis/release-please-action`. `release-please-on-push.yml` does this for you; the canonical `release-please.yml` caller lives in [Quick-start](../references/quick-start.md). A hand-rolled job mints it via `actions/create-github-app-token@v3` with `client-id: ${{ secrets.RELEASE_BOT_APP_ID }}` (the App ID works as the client ID) and `private-key: ${{ secrets.RELEASE_BOT_PRIVATE_KEY }}`; installing the App and granting scopes is covered in [secrets.md § GitHub App permissions](../references/secrets.md#github-app-permissions).

**Secrets you DON'T need** despite documentation in older guides:

- `PYPI_API_TOKEN` (or any PyPI-specific secret in default mode) — OIDC trusted publishing replaces the need.

## 2. Create the read-only mirror repos

One per ecosystem that ships separately. Convention: `<org>/<basename>-<lang>`:

```bash
gh repo create <org>/<basename>-ts  --public --description "READ-ONLY MIRROR of <org>/<basename> ts"
gh repo create <org>/<basename>-py  --public --description "READ-ONLY MIRROR of <org>/<basename> py"
gh repo create <org>/<basename>-rs  --public --description "READ-ONLY MIRROR of <org>/<basename> rs"
gh repo create <org>/<basename>-php --public --description "READ-ONLY MIRROR of <org>/<basename> php"
gh repo create <org>/<basename>     --public --description "READ-ONLY MIRROR of <org>/<basename> go"   # note: no -go suffix; go module URL = repo path
```

The mirror jobs (`mirror-subtree.yml`) auto-flip these to read-only after the first sync. Don't push to them manually.

## 3. Register the package on each external registry

### npm

Nothing to pre-register if you own the scope. First `npm publish` claims the package name under your scope — but it must be a LOCAL maintainer publish: neither trusted publishing nor the org-scoped CI token can create a new name (see `scripts/bootstrap-first-publish.sh npm`).

Immediately after the first publish:

1. Bind a trusted publisher so later publishes use OIDC (no token, no OTP, provenance included): [references/how-to/npm-trusted-publishing.md](../references/how-to/npm-trusted-publishing.md)
2. Ensure `package.json` declares `repository` (source repo URL + `directory` for monorepos) — provenance validation rejects the publish without it (`E422`).

### crates.io

Same — nothing pre-register if the crate name is free. Verify your account email at `https://crates.io/settings/profile` BEFORE the first publish; the failure mode is opaque otherwise.

### PyPI

Two paths, pick one:

- **OIDC (preferred)**: add a **pending trusted publisher** at `https://pypi.org/manage/account/publishing/`. See [browser-playbooks.md](browser-playbooks.md#pypi-add-pending-trusted-publisher).
- **Token (fallback)**: mint an API token at `https://pypi.org/manage/account/token/`. See [browser-playbooks.md](browser-playbooks.md#pypi-mint-api-token).

For OIDC: also create the matching GitHub Environment on your source repo:

```bash
gh api -X PUT repos/<org>/<repo>/environments/pypi
```

Environment name must match `pypi-environment` in your ecosystem config (default `pypi`).

### Packagist

Two-step:

1. **One-time package submit** (manual): after the **first** tag lands on the `-php` mirror, submit at `https://packagist.org/packages/submit` with the mirror repo URL. See [browser-playbooks.md](browser-playbooks.md#packagist-submit-package). This tells Packagist the package exists.
2. **Per-tag notify** (automated): `publish-php` POSTs to Packagist's `update-package` API on every subsequent tag, using `PACKAGIST_USERNAME` + `PACKAGIST_TOKEN`. Triggers an immediate re-index instead of waiting for Packagist's polling interval. Without these secrets the job logs `::notice::PACKAGIST_USERNAME and/or PACKAGIST_TOKEN not provided; skipping Packagist notify` and exits 0: the run stays green and Packagist hears about the tag only on its own polling schedule ([troubleshooting/php.md](../references/troubleshooting/php.md#packagist-credentials-missing-clean-skip-green-run)).

Composer-specific version constraint: the php package's pre-release suffix MUST be one of `dev` | `alpha` | `beta` | `RC` | `stable`. `experimental.N` (which is fine for npm/cargo/Go) breaks `composer install` with `Invalid version string`. Use `alpha.N` for the php package even if other ecosystems use `experimental.N`.

### Go module proxy

Nothing to pre-register. `proxy.golang.org` resolves on first fetch from the mirror's git tags. **Important**: once any version is fetched (by any consumer, anywhere), the proxy caches that exact zip permanently. Untagging or rewriting the tag does not evict the cache. **Treat go module versions as forever-immutable** the moment they're tagged on the mirror.

## 4. Install the publish + release-please workflows

Both files in `.github/workflows/` on the source repo. Templates in [Quick-start](../references/quick-start.md).

Critical: **install both BEFORE cutting any tags**. A tag pushed before `publish.yml` exists never triggers the workflow (the workflow file isn't in the tag's tree). If you migrate from a prior release flow, plan to retag anything cut under the old flow.

## 5. Configure release-please

`release-please-config.json` + `.release-please-manifest.json` at `.github/`. The shape is documented separately in the `custom-release-please` skill, but the minimum for a polyglot repo:

**Recommended: [target versioning](../references/how-to/target-versioning.md).**
Every package on `"versioning": "target"`, the caller on
`versioning-extension: true`, triggered on `main`, `next` and
`release/*`: lines start at `alpha.0`, `main` cuts stable from an rc,
an SDK family links only on a new major (or a pre-1.0 minor), and no
version is ever pinned. The example below is the stock
`versioning: "prerelease"` shape, for a repo that has not opted in
([prerelease channel](../references/how-to/prerelease-channel.md)).

**No root `.` package, unless it's an aggregate with no registry target.** Every component listed here must also exist in the caller's `publish.yml` `ecosystems:` map (next step) — a tag release-please cuts for a component not in that map publishes nothing: the publish run logs `::notice::Component '<component>' has no ecosystem entry; skipping publish` and finishes green. If you need a Go module at the repo root, give it the bare-name component (`my-pkg`) and place its sources under `go/` (matching the per-language layout) or extend the ecosystems map to include the root component name.

If you DO want a root `.` package purely to version repo-level
changes — README, specs, CI (e.g. `release-type: simple`, no
registry, just a tag + changelog) — give it `exclude-paths` listing
every language dir and every nested Go module (rule below the config;
polyglot shape in [how-to/polyglot-repo.md § Root umbrella
package](../references/how-to/polyglot-repo.md#4-decide-on-a-root-umbrella-package-optional))
and don't try to add it to `ecosystems:` (it has nothing to publish,
so there's no sensible entry). Optionally exclude its tag pattern
from `publish.yml`'s trigger so the tag never invokes the reusable
workflow at all (the workflow green-skips it either way):

```yaml
# publish.yml
on:
  push:
    tags:
      - '*/v*'
      - '!my-poly/v*'   # root aggregate component — no registry target
```

```json
{
  "$schema": "https://raw.githubusercontent.com/googleapis/release-please/main/schemas/config.json",
  "separate-pull-requests": true,
  "pull-request-title-pattern": "chore(release): ${component} ${version}",
  "include-component-in-tag": true,
  "tag-separator": "/",
  "packages": {
    "ts":  { "release-type": "node",   "component": "my-pkg-ts",  "prerelease": true, "prerelease-type": "alpha.0", "versioning": "prerelease", "bump-minor-pre-major": true },
    "py":  { "release-type": "python", "component": "my-pkg-py",  "package-name": "org-my-pkg", "prerelease": true, "prerelease-type": "alpha.0", "versioning": "prerelease", "bump-minor-pre-major": true },
    "rs":  { "release-type": "rust",   "component": "my-pkg-rs",  "prerelease": true, "prerelease-type": "alpha.0", "versioning": "prerelease", "bump-minor-pre-major": true },
    "php": { "release-type": "php",    "component": "my-pkg-php", "prerelease": true, "prerelease-type": "alpha.0", "versioning": "prerelease", "bump-minor-pre-major": true },
    "go":  { "release-type": "go",     "component": "my-pkg",     "prerelease": true, "prerelease-type": "alpha.0", "versioning": "prerelease", "bump-minor-pre-major": true }
  }
}
```

Component names carry the bare name (`my-pkg-ts`, not `ts`) because
the component must equal the mirror repo basename — see [SKILL.md §
Three-way name alignment](../SKILL.md#three-way-name-alignment).

**A root `.` package lists every nested package in `exclude-paths`.**
release-please gives the root package every commit in the repository,
minus what its `exclude-paths` drops. Without the entry, a `fix(ts):`
also bumps the root, and a nested Go module (a directory with its own
`go.mod`, versioned on its own tags) ships in the root's changelog and
version. So every directory released as its own package, and every
nested Go module, goes in the root's `exclude-paths`:

```json
".": { "release-type": "simple", "component": "my-poly",
       "exclude-paths": ["ts", "py", "rs", "php", "go", "extensions/mcp"] }   // extensions/mcp: own go.mod
```

Side effect: an empty commit (`git commit --allow-empty`) never
reaches a package with `exclude-paths`, so an empty `Release-As:`
commit releases nothing for the root
([prerelease channel § What a pin reaches](../references/how-to/prerelease-channel.md#what-a-pin-reaches)).

**`extra-files` names every release-version literal release-please
does not rewrite natively — and never `pyproject.toml`.** Each
strategy already writes its own file (`package.json`,
`pyproject.toml`, `Cargo.toml`, `composer.json`), so an `extra-files`
entry for that file is redundant for three of them and breaking for
python: `release-type: python` writes PEP 440-normalized strings
(`0.1.0a1`) into `pyproject.toml` (and `setup.py`, `_version.py`),
while a generic `{"type": "toml", "path": "pyproject.toml"}` entry
bypasses that normalization and writes raw SemVer (`0.1.0-alpha.1`),
invalid PEP 440, failing `pip install` / `twine check`. The preflight
rejects that one case — see [concepts/version-strings.md § Don't break
the normalization](../references/concepts/version-strings.md#dont-break-the-normalization).
Every other version literal in the tree (a `version.ts` constant, an
exact-pin example in a README) *is* an `extra-files` entry of its
package, on a line annotated `x-release-please-version`; the
`version-check` workflow guards the pair — see
[concepts/version-strings.md § Where `extra-files` is
right](../references/concepts/version-strings.md#where-extra-files-is-right).

```json
// .release-please-manifest.json — pure go / pure ts: LEAVE EMPTY.
{}
```

```json
// .release-please-manifest.json — poly-* or ANY repo with a python
// component: seed EVERY component. Accept that the first tag is alpha.1.
{
  ".":  "0.1.0-alpha.0",
  "go": "0.1.0-alpha.0",
  "ts": "0.1.0-alpha.0",
  "py": "0.1.0-alpha.0"
}
```

**Which one depends on whether the repo has a python component.**

| Repo | Manifest | First tag |
|---|---|---|
| Pure go, pure ts (no python) | `{}` | `alpha.0` |
| `poly-*`, or any repo with a `release-type: python` package | Seed every component at `0.1.0-alpha.0` | `alpha.1` |

An empty manifest makes the **python** strategy compute a *stable* first
version even with `prerelease: true` set — the release PR proposes
`0.1.0`, writes `{"py": "0.1.0"}` and a stable `version` into
`pyproject.toml`, and `release-please-preflight` fails it with
"package py declares prerelease but manifest seed '0.1.0' is stable".
The go and node strategies honor `initial-version` from the same config
and propose `0.1.0-alpha.0` correctly, so a polyglot repo left empty gets
three good components and one broken one. Observed on `poly-axon`
2026-09-09; `poly-kit` seeded every component from its first commit and
its python channel has shipped through `kit-py/v0.5.0-alpha.5`.

Seed **all** components, not just the python one — mixed seeded/absent
gives inconsistent first versions across a single repo.

The rest of this section explains why seeding costs you `alpha.0`. That
cost is real and accepted for python repos; it is avoidable for pure
go/ts, which is why they stay empty.

**What a seed actually means (and why pure go/ts should skip it).** A
manifest entry like `{"go": "0.1.0-alpha.0"}` is NOT a hint to
release-please about where to start — it's read as "this version was
already released." The next
release bumps the prerelease *counter* from that seed
(`0.1.0-alpha.0 → 0.1.0-alpha.1`), it does not simply "use" the
seeded value as the first tag. If your `initial-version` in the
config also says `0.1.0-alpha.0`, you'll never actually see
`alpha.0` land — the first real release becomes `alpha.1`, silently
off-by-one from what the config appears to promise. `initial-version`
only takes effect when the manifest key is **absent** for that
package (`{}`, not present-at-any-value). Verified empirically — see
[how-to/prerelease-channel.md § Manifest presence vs
initial-version](../references/how-to/prerelease-channel.md#manifest-presence-vs-initial-version).

Four settings for prerelease counter behavior (`alpha.0 → alpha.1`),
all required by `release-please-preflight` on every package with
`prerelease: true`:

- `"prerelease": true`
- `"prerelease-type": "alpha.0"` (the `.0` matters — with `"alpha"` the first release has no counter, the next is `alpha.1`)
- `"versioning": "prerelease"` (or `"target"` with target versioning)
- `"bump-minor-pre-major": true` (without it a breaking change before 1.0 jumps to `1.0.0-…`)

What each one does without the others:
[prerelease channel § Why each piece matters](../references/how-to/prerelease-channel.md#why-each-piece-matters).

## 5b. Create required repo labels

`release-please-config.json`'s `label` / `release-label` fields (if
set) name GitHub labels that must exist on the repo before the first
run — they are NOT part of GitHub's default set and nothing
auto-creates them.

```bash
gh label create "status:release-pending" --repo <org>/<repo> --color ededed
gh label create "status:release-tagged" --repo <org>/<repo> --color ededed
```

Skip this and the first release-please run computes candidate PRs
successfully, then fails at the labeling API call with a
`Validation Failed` error — which reads as unrelated to labels
unless you check the error body closely. Worse: this failure can
silently break release-please's ability to rebase sibling PRs after
you merge one, producing repeated CONFLICTING states that look like
a manifest problem but are actually this. See
[troubleshooting/common-pitfalls.md § Required repo
labels](../references/troubleshooting/common-pitfalls.md#required-repo-labels-for-release-please).

**Especially important if you recreated the repo** (deleted +
`gh repo create` to reset PR/issue numbering to 1 before the first
real release). Recreating drops any custom labels the old repo had,
along with branch protection rules and merge-method settings — see
[Fresh-repo recreate
checklist](../references/troubleshooting/common-pitfalls.md#fresh-repo-recreate-checklist)
for the full list of what needs reapplying and in what order.

## 5c. Spec trees: commit rules, status lines, the version guard

Skip unless the repo carries a spec version directory (`specs/v0.1/`
in a spec repo, `spec/v1.0/` next to the ports in a product repo).
Full guide: [how-to/spec-versioning.md](../references/how-to/spec-versioning.md).

1. Declare the directory as a release-please package: path
   `<root>/vX.Y`, `release-type: simple`, a single-segment
   `component`, a prerelease-shaped manifest seed. The preflight fails
   a spec package with no directory or no manifest key.
2. Put `**Status:** Draft` (bold, exactly) in the first fifteen lines
   of every spec document. `spec-status-line` rewrites it from the
   channel on each release PR; a plain `Status:` line is never managed.
3. Add the three callers, pinned `@v0`: `spec-commit-rules.yml`
   (`paths:` on the spec root), `spec-status-line.yml` (with
   `RELEASE_BOT_APP_ID` / `RELEASE_BOT_PRIVATE_KEY`),
   `version-check.yml`.
4. Add the [preflight caller](../references/how-to/add-preflight.md)
   if step 4 above did not; its path filter covers the config, the
   manifest and `release-please.yml`.
5. Annotate every other release-version literal
   (`x-release-please-version` + `extra-files`, per § 5), then run
   the guard locally once before the first PR — the snippet is in the
   how-to's step 7.

## 6. Cut the first release

```bash
git commit -m "feat: initial public release"
git push origin main
```

release-please opens a standing PR per component (`separate-pull-requests: true`). Merge each PR you want to release. With target versioning, push this commit to `next`: `main` skips a package with no release yet (it cuts only rcs), `next` opens it at its `initial-version`. Each merge creates a `<component>/v<version>` tag and triggers `publish.yml`, which fans out to the right ecosystem.

For first publish on **PyPI specifically** (OIDC mode), the pending trusted publisher resolves on first successful publish and becomes a project-scoped publisher. After that, the pending entry can be deleted; subsequent publishes use the project-scoped binding.

### If your commit type is `chore:`, not `feat:`

`chore` is a hidden/non-releasing changelog section by default (see
the `changelog-sections` config). release-please skips a `chore:`-only
commit entirely — no candidate PR, no error, just
`✔ No user facing commits found since beginning of time - skipping`
for every package. This is a common trap for a genuinely "wipe
history to one clean commit" bootstrap, where `chore: initial public
release` is the natural message but produces zero PRs.

**Fix (stock versioning)**: add a `Release-As: <version>` footer to
that commit; the footer makes even a `chore:` commit visible. In
manifest mode with multiple packages, ONE unscoped footer forces a
release, at that version, for every package the commit reaches. An
initial commit touches every package's files, so it reaches all of
them; an empty commit would skip every package with `exclude-paths`
(the root, typically):

```bash
git commit -m "chore: initial public release" -m "Release-As: 0.1.0-alpha.0"
git push origin main
```

There is no per-component `Release-As` syntax — see [how-to/prerelease-channel.md
§ Release-As is global across
components](../references/how-to/prerelease-channel.md#release-as-is-global-across-components-in-manifest-mode)
before reaching for anything fancier.

**With target versioning** the footer is ignored (the log says
`ignoring "Release-As: …"`), so a `chore:`-only first commit opens
nothing. Make it a `feat:` (or `fix:`): on `next`, each package with no
release yet opens at its `initial-version`.

### If you want a single, clean initial commit (no intermediate history)

Squashing local history to one commit and pushing normally still
leaves that commit's SHA permanently on `main` and in the reflog of
anyone who already cloned. If the actual goal is "public GitHub
history starts at exactly one commit, PR/issue numbers start at #1,
nothing before that is visible" — not just "one commit locally" —
delete and recreate the GitHub repo rather than force-pushing over
existing history:

```bash
# 1. Squash local history to one commit (adjust for your situation)
git reset --soft <first-commit-sha>
git commit --amend -m "chore: initial public release" -m "Release-As: 0.1.0-alpha.0"

# 2. Delete + recreate the repo (drops PR/issue numbers, labels, branch
#    protection — see the Fresh-repo recreate checklist above)
gh repo delete <org>/<repo> --yes
gh repo create <org>/<repo> --public --description "..." --homepage "..."
gh api repos/<org>/<repo> -X PATCH -f allow_squash_merge=true -f allow_merge_commit=true -f allow_rebase_merge=true

# 3. Recreate labels BEFORE pushing (see § 5b above) — release-please's
#    first run needs them
gh label create "status:release-pending" --repo <org>/<repo> --color ededed
gh label create "status:release-tagged" --repo <org>/<repo> --color ededed

# 4. Push
git push origin main
```

Do steps in this exact order — labels before push, not after. A
push that fires release-please before labels exist produces the
`Validation Failed` symptom from § 5b, and by the time you notice
and fix it, you may already be dealing with the sibling-PR
close+retrigger churn described in [docs/failure-modes.md § Sibling
PRs and the close+retrigger
trap](failure-modes.md#sibling-prs-and-the-closeretrigger-trap).

## 6b. Make checks required last

A required status check blocks every pull request into a branch where
it never reports. GitHub leaves it at `Expected — Waiting for status to
be reported` when the workflow file is not in the PR's merge commit (a
`next` or `release/x.y` cut before the workflow landed, and a PR
branch cut from it), or when a trigger-level `paths:` / `branches:`
filter skips it (a job skipped by its own `if:` reports success
instead) —
[GitHub: handling skipped but required checks](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/collaborating-on-repositories-with-code-quality-features/troubleshooting-required-status-checks#handling-skipped-but-required-checks).

So, per check (preflight, spec gates, any reusable caller):

1. Land the caller workflow on **every** branch the ruleset will cover
   (`main`, `next`, each `release/x.y`), and watch it report once on a
   PR into each.
2. Only then add it to the ruleset's required checks, under the name
   GitHub shows: a reusable workflow reports as
   `<caller job> / <reusable job>` (`preflight / preflight`), not by
   the reusable's file name.
3. Before requiring a path-filtered workflow, move the filter inside
   the job (`if:`), so a run that has nothing to check still reports.

Renaming the caller job renames the check: update the ruleset in the
same change.

## 7. Verify on each registry

```bash
# ts
npm view @<org>/<pkg> versions

# py
curl -s -H 'Accept: application/vnd.pypi.simple.v1+json' https://pypi.org/simple/<pkg>/ \
  | python3 -c "import sys,json;d=json.load(sys.stdin);print([f['filename'] for f in d['files']])"

# rs
curl -s https://crates.io/api/v1/crates/<pkg> | jq '.versions[].num'

# php
curl -s https://repo.packagist.org/p2/<vendor>/<pkg>.json | jq '.packages."<vendor>/<pkg>"[].version'

# go
curl -s https://proxy.golang.org/github.com/<org>/<repo>/@v/list
```

If any are missing despite a successful workflow run: check the [failure modes](failure-modes.md) doc for the matching symptom.

## See also

- [SKILL.md](../SKILL.md) — main consumer guide
- [failure-modes.md](failure-modes.md) — what to do when something breaks
- [browser-playbooks.md](browser-playbooks.md) — web-side setup steps
