# Browser playbooks

Verbal step-by-step walkthroughs for each web-side setup. Each playbook is structured so an AI assistant with browser access (e.g. via [`ibr`](https://github.com/...) with cookies from a logged-in chrome session) can drive the flow.

**Convention used below**: each playbook gives (a) the URL, (b) the literal field values, (c) an ibr-style prompt you can copy-paste, and (d) verification commands to run after.

## PyPI: add pending trusted publisher

Use when bootstrapping OIDC trusted publishing for a project that doesn't exist on PyPI yet.

**URL**: `https://pypi.org/manage/account/publishing/`

**Auth**: requires a logged-in PyPI session. ibr with `--cookies chrome` if you're logged in via Chrome.

**Form values**:

| Field | Value | Source |
|---|---|---|
| PyPI Project Name | the PyPI distribution name | `[project] name` in `pyproject.toml` |
| Owner | GitHub org/user that owns the source repo | e.g. `hop-top` |
| Repository name | source repo name (NOT mirror) | e.g. `poly-uri` |
| Workflow filename | filename of the **caller** workflow | `publish.yml` (NOT `publish-py.yml`) |
| Environment name | the GitHub Environment name | `pypi` (or whatever you set `pypi-environment` to) |

**ibr prompt**:

```
ibr --cookies chrome "url: https://pypi.org/manage/account/publishing/
instructions:
  - verify the page heading is 'View publishing' (proves logged in)
  - find the section titled 'Add a new pending publisher'
  - select 'GitHub' as the publisher type
  - fill 'PyPI Project Name' with <project-name>
  - fill 'Owner' with <owner>
  - fill 'Repository name' with <repo>
  - fill 'Workflow name' with publish.yml
  - fill 'Environment name' with pypi
  - click the 'Add' button
  - verify the new entry appears in the Pending publishers list
"
```

**Critical correctness notes**:

- "Workflow name" wants the **caller**'s filename. The OIDC `workflow_ref` claim is always set from the caller, not the reusable. If you put `publish-py.yml` (the reusable), publish will fail with `invalid-publisher`.
- "Environment name" must literally exist on the source repo as a GitHub Environment. Create it via `gh api -X PUT repos/<owner>/<repo>/environments/pypi` before this step.
- The owner/repo fields must point at the source repo, not the mirror. The mirror never runs workflows; the OIDC token comes from the source.

**Verify after**:

```bash
# Should show your new pending publisher
ibr --cookies chrome "url: https://pypi.org/manage/account/publishing/
instructions:
  - extract the list of pending publishers
  - for each entry capture project name, repository, workflow filename, environment"
```

Or just visually confirm on the page.

**Verify on first publish**: the workflow log should show a successful Trusted publishing exchange. If it fails with `invalid-publisher`, check the claim dump in the log against your pending publisher row character-by-character. If they match exactly and it still fails, you've hit the pending-publisher matching drift bug — see [failure-modes.md § PyPI OIDC invalid-publisher](failure-modes.md#pypi-oidc-invalid-publisher-despite-correct-looking-claims).

## PyPI: switch from pending to project-scoped trusted publisher

Use **after** the first successful publish (under OIDC OR token mode). Once the project exists on PyPI, project-scoped trusted publishers are more reliable and don't suffer the pending-matcher drift bug.

**URL**: `https://pypi.org/manage/project/<project-name>/settings/publishing/`

**Auth**: requires logged-in PyPI session with project-owner role.

**ibr prompt**:

```
ibr --cookies chrome "url: https://pypi.org/manage/project/<project-name>/settings/publishing/
instructions:
  - find the section 'Add a new GitHub publisher'
  - fill 'Owner' with <owner>
  - fill 'Repository name' with <repo>
  - fill 'Workflow name' with publish.yml
  - fill 'Environment name' with pypi
  - click 'Add'
  - verify the new publisher appears in the 'Trusted publishers' table
"
```

After this, delete the matching pending publisher to avoid two entries fighting:

```
ibr --cookies chrome "url: https://pypi.org/manage/account/publishing/
instructions:
  - find the entry matching project <project-name>
  - click its Remove button
  - confirm the removal
"
```

## PyPI: mint API token

Use for `pypi-auth: token` mode, or for non-OIDC-capable workflows.

**URL**: `https://pypi.org/manage/account/token/`

**Auth**: requires logged-in PyPI session.

**Notes on token scope**:

- For the **first publish** of a brand-new project: scope MUST be **account-wide** (the project doesn't exist yet, so you can't scope to it).
- For **subsequent publishes**: re-mint a **project-scoped** token. Far smaller blast radius if the token leaks. Delete the account-wide token after the first publish lands.

**ibr prompt (account-wide for bootstrap)**:

```
ibr --cookies chrome "url: https://pypi.org/manage/account/token/
instructions:
  - fill 'Token name' with <name like 'github-actions-bootstrap'>
  - in 'Scope', select 'Entire account (all projects)'
  - click 'Add token'
  - extract the token value shown (starts with 'pypi-')
  - save the value — it is shown only once
"
```

After extraction, set the org-level secret on GitHub:

```bash
gh secret set PYPI_REGISTRY_TOKEN --org <org> --visibility all --body "pypi-AgEI..."
```

**ibr prompt (project-scoped, post-first-publish)**:

```
ibr --cookies chrome "url: https://pypi.org/manage/account/token/
instructions:
  - fill 'Token name' with <name>
  - in 'Scope', select 'Project: <project-name>'
  - click 'Add token'
  - extract the token value
"
```

## Packagist: submit package

Use when bootstrapping php registration. One-time per package.

**URL**: `https://packagist.org/packages/submit`

**Auth**: requires logged-in Packagist session (Packagist accepts GitHub OAuth).

**Form values**:

| Field | Value |
|---|---|
| Repository URL | URL of the **mirror** repo (e.g. `https://github.com/<org>/<basename>-php`) |

**ibr prompt**:

```
ibr --cookies chrome "url: https://packagist.org/packages/submit
instructions:
  - fill 'Repository URL' with https://github.com/<org>/<basename>-php
  - click 'Check'
  - if Packagist reports any issues with composer.json, surface them
  - if Packagist reports the package is OK, click 'Submit'
  - verify the package detail page loads with version 'dev-main' (or your default branch)
"
```

**Notes**:

- Packagist auto-polls the mirror every few minutes once registered. New tags appear as versions within ~10 minutes; no CI push needed.
- The mirror repo must contain a valid `composer.json` at the root (the `mirror-subtree.yml` job already extracts the php/ subtree as the root of the mirror, so this works automatically).
- Packagist accepts GitHub webhook configuration to nudge polling. Optional; for hop-top repos, polling is fine.
- If you registered the source repo by mistake instead of the mirror, Packagist will see ALL the polyglot dirs and fail. Use the mirror URL.

**Verify**:

```bash
curl -s https://repo.packagist.org/p2/<vendor>/<pkg>.json \
  | jq '.packages."<vendor>/<pkg>"[].version'
```

## GitHub: create environment for OIDC

Required for PyPI OIDC mode. Prefer the API over the browser — deterministic and scriptable.

**API command (preferred)**:

```bash
gh api -X PUT repos/<org>/<repo>/environments/pypi
```

No body needed. Creates the environment with no protection rules. Verify:

```bash
gh api repos/<org>/<repo>/environments --jq '.environments[].name'
```

**Browser path** (if you want protection rules):

**URL**: `https://github.com/<org>/<repo>/settings/environments/new`

**ibr prompt**:

```
ibr --cookies chrome "url: https://github.com/<org>/<repo>/settings/environments/new
instructions:
  - fill 'Name' with pypi
  - click 'Configure environment'
  - (optional) under 'Deployment branches and tags', select 'Selected branches and tags' and add a pattern like '*/v*'
  - click 'Save protection rules' if any were added
  - verify the environment is created
"
```

Tag-pattern protection (`*/v*`) restricts the environment to deployment from tag-push runs, which is the only flow that should reach it.

## crates.io: verify account email

Required before the first `cargo publish` (else opaque failure). One-time.

**URL**: `https://crates.io/settings/profile`

**Auth**: requires logged-in crates.io session (GitHub OAuth).

**ibr prompt**:

```
ibr --cookies chrome "url: https://crates.io/settings/profile
instructions:
  - find the 'Email' field
  - if no email is set, fill it with <email>
  - if email is set but not verified, click 'Resend verification email'
  - report current state: email present, email verified
"
```

After clicking resend, check the email inbox and click the verification link. Then re-issue the API token (existing tokens minted before verification may not work).

**Verify** (no API for "is email verified" exposed; check by attempting a `cargo publish --dry-run` from a runner with the token, or visually on the profile page).

## See also

- [SKILL.md](../SKILL.md) — main consumer guide
- [bootstrap-checklist.md](bootstrap-checklist.md) — order of operations
- [failure-modes.md](failure-modes.md) — what to do when something breaks
