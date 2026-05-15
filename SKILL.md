---
name: hop-top-dotgithub
description: Author and modify reusable GitHub Actions workflows, composite actions, and scripts in hop-top/.github. Use when adding/changing release pipelines, mirror logic, publish jobs, or the prerelease/stable cut model consumed by hop-top org repos.
---

# hop-top/.github

This repo holds the reusable release and publish pipeline for the entire
`hop-top` org. Consuming repos call these workflows via `uses:` and
inherit one canonical pipeline. Changes here ripple to every consumer —
treat as critical infrastructure.

## See first

[`docs/architecture.md`](docs/architecture.md) — diagrams for control
flow (router + dispatch), data flow (tag → publish → mirror), secret
flow, and the alpha→beta→rc→stable state machine. Skim these before
modifying any workflow.

## When to use this skill

- Adding a new reusable workflow
- Modifying any existing workflow under `.github/workflows/`
- Adding a new ecosystem to the router (`publish-on-tag.yml`)
- Onboarding a new consumer repo

For anything related to release-please configuration, version
computation, or the alpha/beta/rc/stable model itself, see the
**`custom-release-please` skill** instead — that's the consumer-side
concern.

## Core conventions

### What this repo does (and doesn't)

**Does:**

- Provides reusable workflows for publishing to npm / PyPI / crates.io
- Provides a reusable workflow for subtree mirror push
- Routes `<component>/v<version>` tag pushes to the right ecosystem
  job

**Does NOT:**

- Manage versions (release-please does)
- Generate changelogs (release-please does)
- Open release PRs (release-please does)
- Run on commits — only on tag pushes

The dividing line: **release-please owns "commit to tag"; this repo
owns "tag to published package"**.

### Release model (single path)

```
commits to main
   ↓
release-please opens/updates standing PR
   ↓
merge PR → release-please creates tag <component>/v<version>
   ↓
tag push triggers consumer publish.yml
   ↓
publish.yml calls this repo's publish-on-tag.yml
   ↓
router dispatches → publish-{ts,py,rs}.yml + mirror-subtree.yml
   ↓
published to registry + pushed to mirror
```

**Prereleases AND stable cuts both flow through this path.** The
prerelease counter (`alpha.0 → alpha.1`) is handled by release-please
when the consuming repo's config has the three-key combo:

```json
{
  "prerelease": true,
  "prerelease-type": "alpha.0",
  "versioning": "prerelease"
}
```

See the consumer-side `custom-release-please` skill for that. This
repo's workflows don't care about prerelease vs stable — they just
parse the tag and publish.

### Tag format

Always `<component>/v<version>`, separator `/`:

- ✓ `ts/v0.3.0-alpha.0`
- ✓ `rs/v1.0.0`
- ✗ `v0.3.0-alpha.0` (no component prefix — collides in monorepo)
- ✗ `ts-v0.3.0` (wrong separator — `git subtree` expects `/`)

The router (`publish-on-tag.yml`) parses this exact format. Changing
it breaks every consumer.

## Workflow authoring rules

These are non-negotiable. Past incidents have wasted significant time on
each one.

### 1. `persist-credentials: false` on every `actions/checkout`

```yaml
- uses: actions/checkout@v4
  with:
    persist-credentials: false
```

Without this, the runner plants `http.extraheader: AUTHORIZATION: basic
***` with the default `github-actions[bot]` token. Any subsequent
PAT-based `git push` is silently overridden by that header, producing
"Permission denied to github-actions[bot]" — even when the PAT is
correct.

**Audit:** the only exception is the `release-please` job itself, which
needs the default token to create PRs.

### 2. No `${{ inputs.X }}` inline in `run:` lines

```yaml
# BAD — command injection vector
run: do_thing ${{ inputs.cmd }}

# GOOD — env var
env:
  CMD: ${{ inputs.cmd }}
run: do_thing "$CMD"
```

Reusable workflows trust their callers, but the pattern still matters:
actionlint flags it, the security hook flags it, and a future caller
might pass user-controlled input through.

### 3. Always declare `secrets:` explicitly in `workflow_call`

```yaml
on:
  workflow_call:
    secrets:
      NPM_REGISTRY_TOKEN:
        required: true
        description: npm publish token; must allow `publish` on the package
```

`secrets: inherit` works in the caller but the callee should still
declare what it expects. Makes the contract explicit and fails fast on
missing secrets.

**Document every secret AND env var.** Adding a new secret or step env
without updating [`docs/consuming.md`](docs/consuming.md) leaves
downstream users guessing. The doc has two tables:

- **Secrets reference** — what consuming repos must define and where
- **Env vars exported inside workflow steps** — what's available to
  `test-command` / `build-command` overrides

If you add `secrets.X` or `env: X:` anywhere, add a row to one of these
tables in the same commit.

### 4. Set `permissions:` minimally

Default to `contents: read`. Add only what's needed:
- `id-token: write` for OIDC (PyPI trusted publishing, npm provenance)
- `contents: write` only on the workflow that creates tags/releases
- `pull-requests: write` only on the release-please workflow

### 5. Lint before commit

`make lint` runs actionlint + diagram-freshness. CI runs the same on
every PR; running locally is faster.

```sh
make lint
```

If you skip the pre-commit hook, CI will catch the failure. The hook is
the faster loop.

### 6. Diagrams: edit `.mmd`, render PNGs, commit both

Source of truth lives in [`docs/diagrams/*.mmd`](docs/diagrams/).
Rendered PNGs in `docs/diagrams/rendered/` are checked in so they
appear in README, npm pages, and other places that don't render
mermaid.

When changing a diagram:

```sh
$EDITOR docs/diagrams/release-flow.mmd
make diagrams        # regenerates PNGs
git add docs/diagrams/   # both .mmd and rendered/*.png
```

CI's `diagrams-check` fails if you commit `.mmd` without re-rendering
PNGs.

## Adding a new ecosystem

Example: adding Java/Maven publishing.

1. Create `.github/workflows/publish-java.yml` following the shape of
   `publish-rs.yml` (minimal — no test matrix, single Java version)
2. Add a route in `publish-on-tag.yml`:
   ```yaml
   publish-java:
     needs: parse
     if: needs.parse.outputs.ecosystem == 'java'
     uses: hop-top/.github/.github/workflows/publish-java.yml@v1
     secrets:
       MAVEN_PASSWORD: ${{ secrets.MAVEN_PASSWORD }}
     with:
       working-directory: ${{ needs.parse.outputs.dir }}
   ```
3. Add the `mirror` job's `needs:` list to include the new publish job
4. Document in `docs/consuming.md`
5. Bump major tag (consumers pin to `@v1`/`@v2` — adding an ecosystem
   is technically backward-compatible, but cut a new minor on `v1` to
   signal it)

## Versioning this repo

The org-default repo isn't versioned via release-please (no manifest,
no CHANGELOG.md). Releases are made by moving the `vN` major tag:

```sh
# Patch/minor — slide v1 forward
git tag -fa v1 -m "v1.x"
git push origin v1 --force

# Breaking — cut v2
git tag v2
git push origin v2
```

Consumer repos pin to `@v1`, `@v2` etc. — never `@main`.

## Adding a new consumer repo

1. Set required secrets on the consuming repo (or inherit from org):
   `NPM_REGISTRY_TOKEN`, `CARGO_REGISTRY_TOKEN`, `GH_MIRROR_PAT`
   (all org-level), and `GH_RELEASE_PLEASE_PAT` (repo-level). See
   `docs/consuming.md` for the full table and the
   `custom-release-please` skill's `setup/` docs for per-secret
   generation steps.
2. Create `.github/workflows/publish.yml` and
   `.github/workflows/release-please.yml` from the templates in the
   `custom-release-please` skill (`templates/publish.yml`,
   `templates/release-please.yml`).
3. Copy `release-please-config.json` + `.release-please-manifest.json`
   from the skill's `templates/` and customize.
4. Three-key prerelease combo (`prerelease: true`, `prerelease-type:
   "alpha.0"`, `versioning: "prerelease"`) is REQUIRED per package
   for counter-increment behavior. See the skill's
   `references/three-keys.md`.
5. Smoke-test with a probe branch + dry-run before pushing to main.

## Common mistakes

- **Inlining inputs in run lines** → security hook + actionlint flag
- **Forgetting `persist-credentials: false`** → silent push failures
  with `github-actions[bot]` denied
- **Tag format other than `<component>/v<version>`** → router fails to
  parse
- **Pinning consumers to `@main`** → next breaking change to this repo
  silently breaks them
- **Adding version/changelog logic here** → belongs in release-please
  config on the consumer side, not in dotgithub workflows

## Verification checklist before pushing

- [ ] `make lint` clean
- [ ] No `${{ inputs.X }}` in `run:` lines
- [ ] All `actions/checkout` have `persist-credentials: false`
- [ ] New reusable workflows declare `secrets:` explicitly
- [ ] Permissions are minimal
- [ ] If a new ecosystem was added, `docs/consuming.md` is updated
- [ ] If a breaking change, major tag is bumped (`v1 → v2`)
