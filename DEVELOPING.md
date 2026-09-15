# Developing hop-top/.github

Working on the shared workflows themselves. If you're a consumer
wiring these workflows into your own repo, see [`SKILL.md`](SKILL.md).

## Recommended: devcontainer

Open this repo in a devcontainer (VS Code: `Reopen in Container`, or
GitHub Codespaces). Preinstalled:

- `actionlint` — workflow linter
- `gh` — GitHub CLI
- `pre-commit` — git hook runner
- `make` — task runner

Run `make lint` after opening.

## Manual setup

```sh
brew install actionlint pre-commit gh make
make install-hooks
```

For non-brew users:

- actionlint: <https://github.com/rhysd/actionlint/blob/main/docs/install.md>
- pre-commit: <https://pre-commit.com/#install>
- gh: <https://github.com/cli/cli#installation>

## Local checks

```sh
make lint   # actionlint on all workflows
```

CI runs the same on every PR.

## Layout

- `.github/workflows/` — reusable workflows. Callable as
  `hop-top/.github/.github/workflows/<name>.yml@<ref>` from
  consuming repos
- `docs/` — architecture diagrams + consumer-facing reference
- `SKILL.md` — consumer-facing skill (how to USE the workflows)
- `DEVELOPING.md` — this file (how to MODIFY the workflows)

## Workflow authoring rules

These are non-negotiable. Past incidents wasted significant time on
each one.

### 1. `persist-credentials: false` on every `actions/checkout`

```yaml
- uses: actions/checkout@v4
  with:
    persist-credentials: false
```

Without this, the runner plants
`http.extraheader: AUTHORIZATION: basic ***` with the default
`github-actions[bot]` token. Any subsequent PAT-based `git push` is
silently overridden by that header, producing "Permission denied to
github-actions[bot]" — even when the PAT is correct.

### 2. No `${{ inputs.X }}` inline in `run:` lines

```yaml
# BAD — command injection vector
run: do_thing ${{ inputs.cmd }}

# GOOD — env var
env:
  CMD: ${{ inputs.cmd }}
run: do_thing "$CMD"
```

Reusable workflows trust their callers, but the pattern still
matters: actionlint flags it, the security hook flags it, and a
future caller might pass user-controlled input through.

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
declare what it expects. Makes the contract explicit and fails fast
on missing secrets.

**Document every secret AND env var.** Adding a new secret or step
env without updating [`SKILL.md`](SKILL.md) leaves consumers
guessing. SKILL.md has two tables:

- **Secrets reference** — what consuming repos must define and where
- **Env vars exported inside workflow steps** — what's available to
  `test-command` / `build-command` overrides

If you add `secrets.X` or `env: X:` anywhere, add a row to one of
these tables in the same commit.

### 4. Set `permissions:` minimally

Default to `contents: read`. Add only what's needed:
- `id-token: write` for OIDC (PyPI trusted publishing, npm provenance)
- `contents: write` only on the workflow that creates tags/releases
- `pull-requests: write` only on the release-please workflow

### 5. Lint before commit

`make lint` runs actionlint. CI runs it on every PR; running locally
is faster.

### 6. Diagrams: inline mermaid in markdown

Diagrams are inline ` ```mermaid ` code blocks inside markdown
files (README.md, docs/architecture.md). GitHub renders them
natively. Standalone `.mmd` files under `docs/diagrams/` are kept
for use outside GitHub.

When changing a diagram, edit BOTH the markdown block AND the
corresponding `.mmd` file. No automated drift check — small repo,
duplication intentional for portability.

## Adding a new ecosystem

Example: adding Java/Maven publishing.

1. Create `.github/workflows/publish-java.yml` following the shape
   of `publish-rs.yml` (minimal — no test matrix, single Java
   version)
2. Add a route in `publish-on-tag.yml`:
   ```yaml
   publish-java:
     needs: parse
     if: needs.parse.outputs.ecosystem == 'java'
     uses: hop-top/.github/.github/workflows/publish-java.yml@main
     secrets:
       MAVEN_REGISTRY_TOKEN: ${{ secrets.MAVEN_REGISTRY_TOKEN }}
     with:
       working-directory: ${{ needs.parse.outputs.dir }}
   ```
3. Add the `mirror` job's `needs:` list to include the new publish
   job
4. Document the secret in [`SKILL.md`](SKILL.md)
5. Bump major tag (consumers pin to `@v1`/`@v2` — adding an
   ecosystem is technically backward-compatible, but cut a new
   minor on `v1` to signal it)

## Adding a well-known publisher resource

The well-known publisher is a composite action whose generators
register via a Python decorator. To add a new generator, see its
README — recap below.

1. Add `.github/actions/well-known-publisher/generator/src/well_known_publisher/resources/<name>.py`
   with an `@register('<name>')`-decorated function returning
   `GeneratorResult`.
2. Append a `$defs/<name>` schema entry to
   `.github/actions/well-known-publisher/schema/well-known.schema.json`.
3. Append a `properties.resources.<name>` reference
   (`{"$ref": "#/$defs/<name>"}`) in the same schema.

Schema uses strict `additionalProperties: false` at every level —
typos in resource keys fail loudly. Don't relax it.

Tests: pytest fixtures live under
`.github/actions/well-known-publisher/generator/tests/fixtures/`.
Add a fixture per resource.

Canonical extension reference:
[`.github/actions/well-known-publisher/README.md`](.github/actions/well-known-publisher/README.md).

## Releasing this repo

dotgithub uses its own release-please setup. Plain semver, no
prerelease channels by default.

Day-to-day:

1. Conventional commits land on `main`
2. release-please opens a standing PR titled
   `chore(release): X.Y.Z`
3. Merge the PR → release-please creates tag `vX.Y.Z` and a GitHub
   Release with auto-generated changelog

Bump rules (pre-1.0, set via `bump-minor-pre-major`):

| Commit | Bump |
|---|---|
| `fix:` | patch (`0.1.0` → `0.1.1`) |
| `feat:` | minor (`0.1.0` → `0.2.0`) |
| `feat!:` / `refactor!:` | minor — capped pre-1.0 |

Post-1.0, `feat!:` bumps major.

### Want a prerelease for a specific cut?

Use `Release-As: X.Y.Z-rc.0` on the commit body. The next standing
PR will propose that exact version. Cut stable via `Release-As: X.Y.Z`
(no suffix). See the `custom-release-please` skill for full
prerelease modes.

## Common mistakes

- **Inlining inputs in run lines** → security hook + actionlint flag
- **Forgetting `persist-credentials: false`** → silent push failures
  with `github-actions[bot]` denied
- **Tag format other than `<component>/v<version>`** → router fails
  to parse
- **Pinning consumers to `@main`** → next breaking change here
  silently breaks them
- **Adding version/changelog logic here** → belongs in release-please
  config on the consumer side, not in dotgithub workflows

## Verification checklist before pushing

- [ ] `make lint` clean
- [ ] No `${{ inputs.X }}` in `run:` lines
- [ ] All `actions/checkout` have `persist-credentials: false`
- [ ] New reusable workflows declare `secrets:` explicitly
- [ ] Permissions are minimal
- [ ] If new secret/env added, [`SKILL.md`](SKILL.md) tables updated
- [ ] If new ecosystem added, SKILL.md ecosystems section updated
