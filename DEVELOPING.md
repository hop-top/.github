# Developing hop-top/.github

Working on the shared workflows themselves.

## Recommended: devcontainer

Open this repo in a devcontainer (VS Code: `Reopen in Container`, or
GitHub Codespaces). Everything you need is preinstalled and the git
hooks are wired up by `postCreateCommand`:

- `actionlint` — workflow linter
- `gh` — GitHub CLI
- `pre-commit` — git hook runner
- `make` — task runner
- `mermaid-cli` — diagram renderer
- VS Code extensions: vscode-github-actions, redhat.vscode-yaml,
  actionlint, copilot

Just open the repo in the container and run `make lint`.

## Manual setup (without devcontainer)

```sh
brew install actionlint pre-commit gh make
npm install -g @mermaid-js/mermaid-cli
make install-hooks
```

For non-brew users:

- actionlint: <https://github.com/rhysd/actionlint/blob/main/docs/install.md>
- pre-commit: <https://pre-commit.com/#install>
- gh: <https://github.com/cli/cli#installation>

## Local checks

```sh
make lint            # runs actionlint + diagrams-check
make diagrams        # re-render PNGs from .mmd sources
```

CI runs the same on every PR. If you skip hooks locally, CI catches
it — but the loop is slower.

## Layout

- `.github/workflows/` — reusable workflows. Callable as
  `hop-top/.github/.github/workflows/<name>.yml@<ref>` from consuming
  repos
- `docs/` — architecture + consuming docs, Mermaid sources

## Adding a new reusable workflow

1. Drop the YAML in `.github/workflows/`
2. Use `workflow_call` as the only `on:` trigger
3. Declare `inputs:` and `secrets:` explicitly
4. **Always** set `persist-credentials: false` on `actions/checkout` —
   prevents the runner's default token from blocking PAT-based git pushes
5. **Never** inline `${{ inputs.X }}` directly in `run:` lines. Use:
   ```yaml
   env:
     X: ${{ inputs.X }}
   run: do_something "$X"
   ```
   This avoids command injection from untrusted-input scenarios.
6. Run `make lint` before committing

## Releasing this repo

The org-default repo isn't versioned via release-please. Cut releases
by moving the major tag:

```sh
# After landing breaking changes, cut v2:
git tag -fa v2 -m "v2"
git push origin v2 --force

# Or for non-breaking work, move v1 forward:
git tag -fa v1 -m "v1.x"
git push origin v1 --force
```

Consuming repos pin to `@v1`, `@v2`, etc. — `git tag -f` lets us slide
the major tag along the main branch as new patches land.
