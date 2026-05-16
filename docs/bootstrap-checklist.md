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
| `GH_RELEASE_PLEASE_PAT` | release-please standing PR | Fine-grained PAT, `Contents: RW` + `Pull Requests: RW` + `Workflows: RW` on the source repo. NOT `GITHUB_TOKEN` (its PRs don't trigger downstream workflows). |
| `NPM_REGISTRY_TOKEN` | ts component | npm Granular Access Token, publish on your scope |
| `CARGO_REGISTRY_TOKEN` | rs component | crates.io API token. Account must have a **verified email**. |
| `PYPI_REGISTRY_TOKEN` | py component (token mode) | OPTIONAL — only if you're using `pypi-auth: token` instead of OIDC. PyPI API token (project-scoped after first publish; account-scoped for bootstrap). |

**Secrets you DON'T need** despite documentation in older guides:

- `PACKAGIST_TOKEN`, `PACKAGIST_USERNAME` — no shared workflow reads them. Packagist auto-syncs from the mirror via webhook polling. If you find these in your org secrets, they're dead weight (probably from a prior workflow generation).
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

Submit your **mirror** repo URL at `https://packagist.org/packages/submit`. See [browser-playbooks.md](browser-playbooks.md#packagist-submit-package). Packagist polls the mirror; tags appear as versions automatically. No CI work.

### Go module proxy

Nothing to pre-register. `proxy.golang.org` resolves on first fetch from the mirror's git tags. **Important**: once any version is fetched (by any consumer, anywhere), the proxy caches that exact zip permanently. Untagging or rewriting the tag does not evict the cache. **Treat go module versions as forever-immutable** the moment they're tagged on the mirror.

## 4. Install the publish + release-please workflows

Both files in `.github/workflows/` on the source repo. Templates in [SKILL.md § Quick-start](../SKILL.md#quick-start).

Critical: **install both BEFORE cutting any tags**. A tag pushed before `publish.yml` exists never triggers the workflow (the workflow file isn't in the tag's tree). If you migrate from a prior release flow, plan to retag anything cut under the old flow.

## 5. Configure release-please

`release-please-config.json` + `.release-please-manifest.json` at `.github/`. The shape is documented separately in the `custom-release-please` skill, but the minimum for a polyglot repo:

```json
{
  "$schema": "https://raw.githubusercontent.com/googleapis/release-please/main/schemas/config.json",
  "separate-pull-requests": true,
  "pull-request-title-pattern": "chore(release):${component} ${version}",
  "include-component-in-tag": true,
  "tag-separator": "/",
  "packages": {
    ".":   { "release-type": "go",     "component": "my-pkg", "exclude-paths": ["ts","py","rs","php","go"], "prerelease": true, "prerelease-type": "alpha.0", "versioning": "prerelease" },
    "ts":  { "release-type": "node",   "component": "ts",     "prerelease": true, "prerelease-type": "alpha.0", "versioning": "prerelease" },
    "py":  { "release-type": "python", "component": "py",     "package-name": "my-pkg", "extra-files": [{"type":"toml","path":"pyproject.toml","jsonpath":"$.project.version"}], "prerelease": true, "prerelease-type": "alpha.0", "versioning": "prerelease" },
    "rs":  { "release-type": "rust",   "component": "rs",     "prerelease": true, "prerelease-type": "alpha.0", "versioning": "prerelease" },
    "php": { "release-type": "php",    "component": "php",    "prerelease": true, "prerelease-type": "alpha.0", "versioning": "prerelease" },
    "go":  { "release-type": "go",     "component": "go",     "prerelease": true, "prerelease-type": "alpha.0", "versioning": "prerelease" }
  }
}
```

```json
// .release-please-manifest.json — seed values prevent the "0.0.0 trap"
{
  ".": "0.1.0-alpha.0",
  "go": "0.1.0-alpha.0",
  "ts": "0.1.0-alpha.0",
  "py": "0.1.0-alpha.0",
  "rs": "0.1.0-alpha.0",
  "php": "0.1.0-alpha.0"
}
```

Three critical settings for prerelease counter behavior (`alpha.0 → alpha.1` rather than `alpha.0 → 0.1.0`):

- `"prerelease": true`
- `"prerelease-type": "alpha.0"` (the `.0` matters — without it, the counter starts at 1)
- `"versioning": "prerelease"`

All three must be set. See `custom-release-please` skill for full coverage.

## 6. Cut the first release

```bash
git commit -m "feat: initial public release"
git push origin main
```

release-please opens a standing PR per component (`separate-pull-requests: true`). Merge each PR you want to release. Each merge creates a `<component>/v<version>` tag and triggers `publish.yml`, which fans out to the right ecosystem.

For first publish on **PyPI specifically** (OIDC mode), the pending trusted publisher resolves on first successful publish and becomes a project-scoped publisher. After that, the pending entry can be deleted; subsequent publishes use the project-scoped binding.

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
