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

The git-tag scheme is `<component>/v<version>` (e.g. `ts/v0.2.0`). The publish workflow keys off the prefix.

## 1. Org-level secrets

Create at `https://github.com/organizations/<org>/settings/secrets/actions`.

| Secret | Required for | Notes |
|---|---|---|
| `GH_MIRROR_PAT` | every release (mirror push) | Fine-grained PAT, `Administration: RW` + `Contents: RW` on every mirror repo |
| `RELEASE_BOT_APP_ID` | release-please standing PR | Numeric App ID of the hop-top release-bot GitHub App. The App must be installed on the source repo with `Contents: RW` + `Pull Requests: RW` + `Workflows: RW`. Paired with `RELEASE_BOT_PRIVATE_KEY`. |
| `RELEASE_BOT_PRIVATE_KEY` | release-please standing PR | PEM private key for the same App. Mint via the App's GitHub settings page. Paired with `RELEASE_BOT_APP_ID`. |
| `NPM_REGISTRY_TOKEN` | ts component | npm Granular Access Token, publish on your scope |
| `CARGO_REGISTRY_TOKEN` | rs component | crates.io API token. Account must have a **verified email**. |
| `PYPI_REGISTRY_TOKEN` | py component (token mode) | OPTIONAL — only if you're using `pypi-auth: token` instead of OIDC. PyPI API token (project-scoped after first publish; account-scoped for bootstrap). |
| `PACKAGIST_USERNAME` | php component | Packagist account username. Paired with `PACKAGIST_TOKEN`. Find at <https://packagist.org/profile/edit>. |
| `PACKAGIST_TOKEN` | php component | Packagist API token. Required for `publish-php`'s `update-package` API notify after each mirror push. Mint at <https://packagist.org/profile/edit>. |

**Why an App token (and NOT `GITHUB_TOKEN` or a long-lived PAT)?**
The default `GITHUB_TOKEN` can't open release PRs that trigger downstream workflows, and long-lived fine-grained PATs (the older approach this checklist used to teach) have unreliable delivery in practice — the preflight workflow now rejects them. The release-please job mints a short-lived installation token via `actions/create-github-app-token@v1` from `RELEASE_BOT_APP_ID` + `RELEASE_BOT_PRIVATE_KEY` and passes it as `token:` to `googleapis/release-please-action@v4`. The canonical `release-please.yml` snippet lives in [Quick-start](../references/quick-start.md); installing the App and granting scopes is covered in [Add the release-please preflight check](../references/how-to/add-preflight.md).

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

Nothing to pre-register if you own the scope. First `npm publish` claims the package name under your scope.

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
2. **Per-tag notify** (automated): `publish-php` POSTs to Packagist's `update-package` API on every subsequent tag, using `PACKAGIST_USERNAME` + `PACKAGIST_TOKEN`. Triggers an immediate re-index instead of waiting for Packagist's polling interval. Without these secrets, the job fails with `::error::PACKAGIST_USERNAME and PACKAGIST_TOKEN must be provided for php components`.

Composer-specific version constraint: the php package's pre-release suffix MUST be one of `dev` | `alpha` | `beta` | `RC` | `stable`. `experimental.N` (which is fine for npm/cargo/Go) breaks `composer install` with `Invalid version string`. Use `alpha.N` for the php package even if other ecosystems use `experimental.N`.

### Go module proxy

Nothing to pre-register. `proxy.golang.org` resolves on first fetch from the mirror's git tags. **Important**: once any version is fetched (by any consumer, anywhere), the proxy caches that exact zip permanently. Untagging or rewriting the tag does not evict the cache. **Treat go module versions as forever-immutable** the moment they're tagged on the mirror.

## 4. Install the publish + release-please workflows

Both files in `.github/workflows/` on the source repo. Templates in [Quick-start](../references/quick-start.md).

Critical: **install both BEFORE cutting any tags**. A tag pushed before `publish.yml` exists never triggers the workflow (the workflow file isn't in the tag's tree). If you migrate from a prior release flow, plan to retag anything cut under the old flow.

## 5. Configure release-please

`release-please-config.json` + `.release-please-manifest.json` at `.github/`. The shape is documented separately in the `custom-release-please` skill, but the minimum for a polyglot repo:

**No root `.` package, unless it's an aggregate with no registry target.** Every component listed here must also exist in the caller's `publish.yml` `ecosystems:` map (next step) — tags release-please cuts for a component not in that map fail the publish workflow with `Unknown component`. If you need a Go module at the repo root, give it the `go` component and place its sources under `go/` (matching the per-language layout) or extend the ecosystems map to include the root component name.

If you DO want a root `.` package purely to version-bump an
umbrella release across all components (e.g. `release-type: simple`,
no registry, just a tag + changelog marking "this batch of
components released together") — don't try to add it to
`ecosystems:` (it has nothing to publish, so there's no sensible
entry). Instead, exclude its tag pattern from `publish.yml`'s
trigger so the tag never invokes the reusable workflow at all:

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
    "ts":  { "release-type": "node",   "component": "ts",     "prerelease": true, "prerelease-type": "alpha.0", "versioning": "prerelease" },
    "py":  { "release-type": "python", "component": "py",     "package-name": "my-pkg", "extra-files": [{"type":"toml","path":"pyproject.toml","jsonpath":"$.project.version"}], "prerelease": true, "prerelease-type": "alpha.0", "versioning": "prerelease" },
    "rs":  { "release-type": "rust",   "component": "rs",     "prerelease": true, "prerelease-type": "alpha.0", "versioning": "prerelease" },
    "php": { "release-type": "php",    "component": "php",    "prerelease": true, "prerelease-type": "alpha.0", "versioning": "prerelease" },
    "go":  { "release-type": "go",     "component": "go",     "prerelease": true, "prerelease-type": "alpha.0", "versioning": "prerelease" }
  }
}
```

```json
// .release-please-manifest.json — LEAVE EMPTY for a true first release.
{}
```

**Do not seed the manifest with a version, even one that looks like
"nothing released yet."** A manifest entry like `{"go":
"0.1.0-alpha.0"}` is NOT a hint to release-please about where to
start — it's read as "this version was already released." The next
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

Three critical settings for prerelease counter behavior (`alpha.0 → alpha.1` rather than `alpha.0 → 0.1.0`):

- `"prerelease": true`
- `"prerelease-type": "alpha.0"` (the `.0` matters — without it, the counter starts at 1)
- `"versioning": "prerelease"`

All three must be set. See `custom-release-please` skill for full coverage.

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

## 6. Cut the first release

```bash
git commit -m "feat: initial public release"
git push origin main
```

release-please opens a standing PR per component (`separate-pull-requests: true`). Merge each PR you want to release. Each merge creates a `<component>/v<version>` tag and triggers `publish.yml`, which fans out to the right ecosystem.

For first publish on **PyPI specifically** (OIDC mode), the pending trusted publisher resolves on first successful publish and becomes a project-scoped publisher. After that, the pending entry can be deleted; subsequent publishes use the project-scoped binding.

### If your commit type is `chore:`, not `feat:`

`chore` is a hidden/non-releasing changelog section by default (see
the `changelog-sections` config). release-please skips a `chore:`-only
commit entirely — no candidate PR, no error, just
`✔ No user facing commits found since beginning of time - skipping`
for every package. This is a common trap for a genuinely "wipe
history to one clean commit" bootstrap, where `chore: initial public
release` is the natural message but produces zero PRs.

**Fix**: add a `Release-As: <version>` footer to that commit. In
manifest mode with multiple packages, ONE unscoped footer forces a
release for every package in the config simultaneously, at that
version:

```bash
git commit -m "chore: initial public release" -m "Release-As: 0.1.0-alpha.0"
git push origin main
```

There is no per-component `Release-As` syntax — see [how-to/prerelease-channel.md
§ Release-As is global across
components](../references/how-to/prerelease-channel.md#release-as-is-global-across-components-in-manifest-mode)
before reaching for anything fancier.

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
