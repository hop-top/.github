# Secrets reference

All secrets the shared workflows expect, in one place.

## Use this when

- You're setting up org-level secrets for the first time.
- A workflow run failed with `secret X is not available`.
- You're auditing which secrets a particular component needs.

## Result

You know exactly which secrets to provision, where to scope them, and what each one is consumed by.

## Naming convention

All secret names follow `<NAMESPACE>_<PURPOSE>_<TYPE>`. The shared
workflows expect **exact** names — no fallback chains, no aliases.
Either:

1. Create org/repo secrets with the canonical names, OR
2. Explicitly map at the call site: `CANONICAL: ${{ secrets.YOUR_NAME }}`

If `GH_MIRROR_PAT` isn't set, the mirror job fails — visibly and
immediately. No silent fallback to `GITHUB_TOKEN`.

## Secrets the shared workflows expect

| Secret | Required by | Scope | Notes |
|---|---|---|---|
| `GH_MIRROR_PAT` | `mirror-subtree` (always) | Org | Fine-grained PAT with `Administration: RW` + `Contents: RW` on every mirror repo |
| `RELEASE_BOT_APP_ID` | release-please job (via `actions/create-github-app-token@v1`) | Org | GitHub App ID for the hop-top release-bot. Paired with `RELEASE_BOT_PRIVATE_KEY`. See [GitHub App permissions](#github-app-permissions). |
| `RELEASE_BOT_PRIVATE_KEY` | release-please job (via `actions/create-github-app-token@v1`) | Org | GitHub App private key. Paired with `RELEASE_BOT_APP_ID`. |
| `NPM_REGISTRY_TOKEN` | `publish-ts` (if shipping TS) | Org | npm Granular Access Token with publish on your scope |
| `CARGO_REGISTRY_TOKEN` | `publish-rs` (if shipping Rust) | Org | crates.io API token. Account must have a verified email. |
| `PYPI_REGISTRY_TOKEN` | `publish-py` (if `pypi-auth: token`) | Org | OPTIONAL — only when using token mode instead of OIDC. PyPI API token. |
| `PACKAGIST_USERNAME` | `publish-php` (if shipping PHP) | Org | Packagist account username. Paired with `PACKAGIST_TOKEN`. Find at <https://packagist.org/profile/edit>. URL-encoded into the `update-package` query string; `::add-mask::`-registered inside the job. |
| `PACKAGIST_TOKEN` | `publish-php` (if shipping PHP) | Org | Packagist API token. Mint at <https://packagist.org/profile/edit>. URL-encoded into the `update-package` query string; `::add-mask::`-registered inside the job. |

### GitHub App permissions

The hop-top release-bot App must be installed on every source repo
that ships releases, **plus** every package-manager target repo
passed via `goreleaser-on-tag.yml` inputs:

| Target repo input | Repo name |
|---|---|
| `homebrew-tap-repo` | `<org>/homebrew-tap` |
| `scoop-bucket-repo` | `<org>/scoop-bucket` |
| `winget-fork-repo` | `<org>/winget-pkgs` (org's fork of `microsoft/winget-pkgs`) |

Required scopes: `Contents: RW` + `Pull Requests: RW` + `Workflows: RW`.

**Default `GITHUB_TOKEN` doesn't work** — its PRs don't trigger
downstream workflows. **Legacy `GH_RELEASE_PLEASE_PAT` is
deprecated** — PAT delivery proved unreliable on fresh repos, and
PRs authored by the human owner trip CODEOWNERS self-approval on
`.release-please-manifest.json`.

## Secrets the shared workflows DO NOT need

| What | Why not |
|---|---|
| **PyPI token (default mode)** | `publish-py` uses [PyPI trusted publishing](https://docs.pypi.org/trusted-publishers/) (OIDC) by default. Configure on PyPI's side bound to your repo + `pypi-environment` (default: `pypi`). If OIDC won't work, see [PyPI auth modes](#pypi-auth-modes) for the token escape hatch. |
| **Go module token** | proxy.golang.org pulls from git tags. |

## PyPI auth modes

`publish-py` supports two authentication modes, picked via the
`pypi-auth` field in your ecosystem entry:

| `pypi-auth` | Mechanism | Requires |
|---|---|---|
| `oidc` (default) | PyPI trusted publishing via short-lived OIDC token | Trusted publisher configured on PyPI matching the **caller workflow filename** (NOT the reusable's); GitHub Environment named per `pypi-environment` must exist on the caller repo |
| `token` | Long-lived PyPI API token uploaded via twine | `PYPI_REGISTRY_TOKEN` secret available to the caller (no environment binding, no OIDC permissions needed) |

`oidc` is preferred (no long-lived secret, automatic rotation).
Use `token` when:

- PyPI trusted publishing isn't matching despite correct claims (rare; pending-publisher table drift).
- You're publishing from a forked workflow that can't set `id-token: write`.
- You need to bootstrap-publish before a pending publisher can be configured.

Example caller using token auth for py:

```yaml
jobs:
  publish:
    uses: hop-top/.github/.github/workflows/publish-on-tag.yml@v0
    secrets:
      PYPI_REGISTRY_TOKEN: ${{ secrets.PYPI_REGISTRY_TOKEN }}
      # ... other secrets
    with:
      ecosystems: |
        py:
          dir: py
          ecosystem: py
          package: hop-top-uri
          mirror: hop-top/uri-py
          pypi-auth: token
```

**OIDC trap — `workflow_ref` is the CALLER, not the reusable.**
When configuring a PyPI trusted publisher for a repo that calls
into `hop-top/.github`, the "Workflow filename" field on PyPI must
be the filename of YOUR workflow (e.g. `publish.yml`), not the
reusable's (`publish-py.yml`). GitHub's OIDC `workflow_ref` claim
is always set from the calling workflow.

## Scoping: org vs repo vs environment

- **Org secrets**: tokens used across multiple repos (`GH_MIRROR_PAT`, `RELEASE_BOT_APP_ID`, `RELEASE_BOT_PRIVATE_KEY`, `NPM_REGISTRY_TOKEN`, `CARGO_REGISTRY_TOKEN`, `PACKAGIST_USERNAME`, `PACKAGIST_TOKEN`).
- **Repo secrets**: rarely needed once the org App is set up; reserved for one-off credentials a single repo owns.
- **Environment secrets**: high-stakes scoping with optional manual approval. Used only for the `pypi` environment (no secret, just OIDC binding).
- **`GITHUB_TOKEN`** (auto): not used by the shared workflows. Doesn't trigger downstream — hence why release-please needs the App token.

## Org-secrets gotcha on the free plan

Org-level secrets with `visibility: all` are **not** available to
private repos on the free GitHub plan — they reach public repos
only. Symptoms: release-please fails with
`Error: Input required and not supplied: app-id`.

Three fixes:

1. **Make the source repo public** (cheapest; org secrets propagate).
2. **Upgrade the org to Team / Enterprise** (org secrets propagate to private repos).
3. **Set the same secrets at repo level** on the private repo, duplicating the org-level entries.

Documented at <https://docs.github.com/en/actions/security-guides/using-secrets-in-github-actions#using-secrets-in-a-workflow>.

## Adapter mappings (internal facade — FYI only)

The workflows translate canonical secret names into whatever env
vars upstream tools demand. Consumers reference only the canonical
names. The adapter names are an internal implementation detail —
**never set them yourself**.

| Canonical secret | Adapter env (internal) | Where | Why |
|---|---|---|---|
| `NPM_REGISTRY_TOKEN` | `NODE_AUTH_TOKEN` | `publish-ts` publish step | `actions/setup-node` reads this |
| `CARGO_REGISTRY_TOKEN` | `CARGO_REGISTRY_TOKEN` | `publish-rs` publish step | cargo reads this (name matches by coincidence) |
| `GH_MIRROR_PAT` | `GH_TOKEN` | `mirror-subtree` all steps | `gh` CLI reads this |

See [concepts/facade-pattern.md](concepts/facade-pattern.md) for the rationale.

## Aliasing legacy secret names

If your org has legacy secret names (e.g. `MIRROR_PAT` from a prior
convention), DO NOT rename them via fallback chains in workflows.
Instead, create a new secret with the canonical name using the
underlying PAT value, then remove the legacy secret.

The shared workflows accept ONE name only. No fallback.

## Next steps

- [Quick-start](quick-start.md) — copy-paste the two workflow files.
- [Bootstrap checklist](../docs/bootstrap-checklist.md) — full first-time setup.
- [concepts/facade-pattern.md](concepts/facade-pattern.md) — why the canonical names exist.
