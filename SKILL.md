---
name: hop-top-dotgithub
description: Use hop-top/.github's reusable workflows to publish releases (npm/PyPI/crates.io/Packagist) and push subtree mirrors. Use when wiring a hop-top repo's release pipeline to call publish-on-tag.yml on `<component>/v<version>` tag pushes, adding the release-please-preflight check, mapping registry secrets, troubleshooting why a tag didn't trigger a publish, registering a new package on PyPI/Packagist (via OIDC trusted publishing or API tokens), creating GitHub Environments, or debugging pnpm 11 strict-mode install failures.
---

# Using hop-top/.github

Wire your hop-top repo's release pipeline into the shared
publish/mirror/artifacts workflows in `hop-top/.github`.

## Use this when

- You're setting up release automation for a new polyglot repo.
- You're adding a new ecosystem (ts/py/rs/php/go) to an existing repo.
- A release pipeline misfired and you need to diagnose it.
- You're picking between OIDC and API-token modes for PyPI/Packagist.

This skill is for **consumers**. If you're modifying the
workflows themselves, see [`DEVELOPING.md`](DEVELOPING.md).

## Result

After applying this skill, every merge of a release-please standing
PR cuts a `<component>/v<version>` tag, which triggers:

- The matching language-registry publish (npm / PyPI / crates.io / Packagist notify). Go has no publish-from-source step — proxy.golang.org pulls from the tag directly.
- A read-only mirror push to `<org>/<name>-<lang>` (or `<org>/<name>` for Go, which takes the bare-name slot — see [Repo naming convention](#repo-naming-convention) below).
- (Optionally) language-specific installable artifacts via `<lang>-on-tag.yml`.

## Find your intent

| What you're trying to do | Go to |
|---|---|
| Set up a brand-new repo's release pipeline | [references/quick-start.md](references/quick-start.md) |
| Run the full first-time-setup checklist | [docs/bootstrap-checklist.md](docs/bootstrap-checklist.md) |
| Publish a brand-new package for the first time | [First publish of a new package](#first-publish-of-a-new-package) |
| Diagnose a first-publish CI failure | [Diagnosing first-publish failures](#diagnosing-first-publish-failures) |
| Catch misconfigurations at PR time | [references/how-to/add-preflight.md](references/how-to/add-preflight.md) |
| Configure a single-language repo (no polyglot split) | [references/how-to/single-language-repo.md](references/how-to/single-language-repo.md) |
| Stay in an alpha/beta/rc channel | [references/how-to/prerelease-channel.md](references/how-to/prerelease-channel.md) |
| Keep a monorepo Release-free (Releases only on mirrors) | [references/how-to/release-free-monorepo.md](references/how-to/release-free-monorepo.md) |
| Re-trigger a failed publish | [references/how-to/retrigger-failed-publish.md](references/how-to/retrigger-failed-publish.md) |
| Re-trigger release-please after sibling-PR conflicts | [references/how-to/retrigger-release-please.md](references/how-to/retrigger-release-please.md) |
| Ship installable binaries (Homebrew, Scoop, WinGet, …) | [references/how-to/ship-binaries.md](references/how-to/ship-binaries.md) |
| Look up a secret name | [references/secrets.md](references/secrets.md) |
| Publish to npm without tokens (trusted publishing) | [references/how-to/npm-trusted-publishing.md](references/how-to/npm-trusted-publishing.md) |
| Look up an `ecosystems` field | [references/ecosystems.md](references/ecosystems.md) |
| Pick the right `@v0` / `@v0.x.y` / `@main` pin | [references/pinning.md](references/pinning.md) |
| Understand the overall flow | [references/concepts/mental-model.md](references/concepts/mental-model.md) |
| Understand why secret names are canonical | [references/concepts/facade-pattern.md](references/concepts/facade-pattern.md) |
| Understand the install model | [references/concepts/install-model.md](references/concepts/install-model.md) |
| Understand how `hop.top/<x>` vanity URLs resolve | [references/concepts/vanity-imports.md](references/concepts/vanity-imports.md) |
| Understand SemVer ∩ PEP 440 ∩ Composer constraints | [references/concepts/version-strings.md](references/concepts/version-strings.md) |
| Understand why release PRs come from release-bot | [references/concepts/release-bot.md](references/concepts/release-bot.md) |
| Understand when releases ship (lanes, channels, cadence) | [docs/release-schedule.md](docs/release-schedule.md) |
| Generate doc lists from code (kill stale enumerations) | [docs/generated-docs.md](docs/generated-docs.md) |
| Triage a release-pipeline failure | [references/troubleshooting/common-pitfalls.md](references/troubleshooting/common-pitfalls.md) |
| ts-specific failure | [references/troubleshooting/ts.md](references/troubleshooting/ts.md) |
| py-specific failure | [references/troubleshooting/py.md](references/troubleshooting/py.md) |
| rs-specific failure | [references/troubleshooting/rs.md](references/troubleshooting/rs.md) |
| php-specific failure | [references/troubleshooting/php.md](references/troubleshooting/php.md) |
| go-specific failure | [references/troubleshooting/go.md](references/troubleshooting/go.md) |

## Two essentials you need before anything else

The two pieces below are recognition-critical: without them, every
other doc reads wrong. Everything else is in `references/`.

## Repo naming convention

Polyglot repos in the hop-top org follow a strict shape:

| Shape | Pattern | Example |
|---|---|---|
| Polyglot source | `poly-<name>` | `hop-top/poly-kit` |
| Go mirror (or single-language Go repo) | `<name>` (bare) | `hop-top/kit`, `hop-top/uri`, `hop-top/tlc` |
| TS mirror | `<name>-ts` | `hop-top/kit-ts` |
| Py mirror | `<name>-py` | `hop-top/kit-py` |
| Rust mirror | `<name>-rs` | `hop-top/kit-rs` |
| PHP mirror | `<name>-php` | `hop-top/kit-php` |

**Go ALWAYS takes the bare-name slot.** Vanity imports like
`hop.top/kit` resolve to `github.com/hop-top/kit` by default; a
`hop-top/kit-go` repo would break that resolution. `<name>-go`
does NOT exist in this org — ever. See [vanity imports
concept](references/concepts/vanity-imports.md) for the resolver
mechanism and how to override per-name.

**Tag shape is `<component>/v<version>` everywhere**, including
single-language repos (e.g. `tlc/v1.4.2`, not `v1.4.2`). The
`tags: ['*/v*']` glob in `publish.yml` requires this — bare
`v...` tags would never trigger publish.

## Tag-shape glob trap

The `tags: ['*/v*']` filter is **single-segment**: `*` does NOT
match `/`. Tags like `sdk/ts/v0.2.0-alpha.0` (3-segment) silently
fail to trigger `publish.yml`. The release-please-action's
`component` field is what produces the tag prefix, so component
names with `/` in them are the trap.

✅ Good: `component: kit-ts` → tag `kit-ts/v0.2.0-alpha.0` → publish fires.
✗ Bad: `component: sdk/ts` → tag `sdk/ts/v0.2.0-alpha.0` → publish silent.

The `path` (manifest key) can contain `/` — only the `component`
must be a single segment.

## Three-way name alignment

For each shipping component, three names must match exactly:

```
release-please-config.json:packages.<path>.component
        ==
publish.yml:ecosystems.<KEY>
        ==
mirror repo basename (org/<name>)
```

If they drift, `publish-on-tag.yml`'s `ecosystems[<component>]`
lookup fails with `Unknown component '<tag-prefix>'` at parse
time, before any publish work happens.

## Quick start (TL;DR)

Two workflow files in your repo. Full snippets:
[references/quick-start.md](references/quick-start.md).

```yaml
# .github/workflows/publish.yml
on:
  push:
    tags: ['*/v*']

jobs:
  publish:
    permissions:
      contents: read
      id-token: write
    uses: hop-top/.github/.github/workflows/publish-on-tag.yml@v0
    secrets:
      NPM_REGISTRY_TOKEN:   ${{ secrets.NPM_REGISTRY_TOKEN }}
      CARGO_REGISTRY_TOKEN: ${{ secrets.CARGO_REGISTRY_TOKEN }}
      PACKAGIST_USERNAME:   ${{ secrets.PACKAGIST_USERNAME }}
      PACKAGIST_TOKEN:      ${{ secrets.PACKAGIST_TOKEN }}
      GH_MIRROR_PAT:        ${{ secrets.GH_MIRROR_PAT }}
    with:
      ecosystems: |
        ts:  { dir: ts,  ecosystem: ts,  package: "@org/pkg",  mirror: org/pkg-ts }
        # … py / rs / php / go as needed
```

## First publish of a new package

Scoped registry tokens grant "publish update" on existing packages
but not "create new package in scope". The first publish of any
new `<scope>/<name>` MUST be done with a higher-privilege
credential — usually a local interactive session. After that first
publish lands, the standard CI token works for every subsequent
version bump.

Use the helper:

```sh
scripts/bootstrap-first-publish.sh npm   # @scope/name
scripts/bootstrap-first-publish.sh pypi  # new PyPI project
scripts/bootstrap-first-publish.sh cargo # new crates.io crate
```

It runs the right local build, verifies auth state, and publishes
with the equivalent of `--access public`. Run from the package
directory.

### npm

Automation tokens scoped to an org/scope can `publish` versions of
packages that already exist in the scope, but cannot create the
first one. First publish of a new `@scope/name`:

1. `npm login` locally as a user with `publish` on the scope.
2. `pnpm publish --access public` from the package dir
   (`--access public` is required for the very first publish; npm
   defaults new scoped packages to restricted).
3. Subsequent versions auto-publish via `publish-on-tag.yml` +
   `NPM_REGISTRY_TOKEN`. No further `--access public` needed —
   access is now a server-side property of the package.

### PyPI

Project-scoped API tokens cannot create new projects — by
definition they can only act on projects that already exist. The
first publish of a brand-new PyPI name has two options:

1. **Account-scoped token** (recommended for one-shot bootstrap):
   mint a token with scope "Entire account" at
   <https://pypi.org/manage/account/token/>, use it locally:

   ```sh
   uv build
   uv run twine upload dist/*
   ```

   After the project exists on PyPI, **delete the account-wide
   token** and mint a per-project token for CI.

2. **OIDC trusted publishing**: works for first publish too, but
   requires pre-registering the workflow on pypi.org via
   <https://pypi.org/manage/account/publishing/> with the future
   project name. PyPI ties the trusted publisher to a name string
   — you can register one before the project exists. After first
   publish, the entry becomes scoped to the now-claimed project.

   Cross-ref: `publish-py.yml` accepts `pypi-auth: oidc` or
   `pypi-auth: token`. OIDC requires the GitHub Environment
   binding (`pypi-environment`, default `pypi`).

### crates.io

Post-2023, crates.io API tokens carry crate-name scope restrictions
(`crates: <name>` or unrestricted). A scoped token cannot publish
a name it doesn't already include. First publish of a new crate
requires an **unrestricted** token OR a local `cargo login`
session.

Recommended:

1. Keep an unrestricted "bootstrap" token in your personal keyring
   (1Password, macOS Keychain) — NEVER in CI secrets.
2. `cargo login <bootstrap-token>` locally, then
   `cargo publish` from the crate dir.
3. After first publish, mint a name-scoped token for CI's
   `CARGO_REGISTRY_TOKEN` secret.

The reasoning for "not in CI secrets": an unrestricted token can
publish to ANY crate name on the account. CI secrets are accessible
to anyone with `pull_request` against the repo via malicious
workflow edits in a branch. Keep blast radius small.

## Diagnosing first-publish failures

### npm 2FA in "Auth and writes" mode breaks CI publish

Symptom: CI publish fails with `ERR_PNPM_OTP_NON_INTERACTIVE` even
when `NPM_REGISTRY_TOKEN` is valid and the package already exists.
Often preceded by `OIDC skipped: 404` in the same log — that line
is informational (we're not using OIDC for npm) and easy to misread
as a token / registry / scope issue.

Cause: the npm account's 2FA mode is set to "Auth and writes",
which requires an OTP on every publish. CI has no interactive
session and cannot supply an OTP — no amount of token rotation
will fix this.

Fix: switch the account's 2FA mode to "Auth only" at
<https://www.npmjs.com/settings/~/profile>. Tokens still work; the
OTP requirement only applies to interactive web/CLI logins. After
the change, the next CI publish succeeds without code changes.

### Expired npm token returns HTTP 404, not 401/403

Symptom:
`pnpm: 404 Not Found - PUT https://registry.npmjs.org/@scope%2fname - Not found`.

This looks identical to "package doesn't exist in scope" or
"token lacks publish permission". It's actually "token expired" —
npm returns 404 instead of 401/403 to avoid leaking package
existence to unauthenticated callers.

Diagnostic: before assuming scope / permission issues, check the
token's expiry at
<https://www.npmjs.com/settings/~/tokens>. If expired, mint a
replacement, update the `NPM_REGISTRY_TOKEN` secret, and re-run
the failed workflow run.

## See also

- [`docs/bootstrap-checklist.md`](docs/bootstrap-checklist.md) — order of operations for a brand-new polyglot repo.
- [`docs/failure-modes.md`](docs/failure-modes.md) — extended symptom→cause→fix guide; covers each entry in the Common Pitfalls table with workflow-log excerpts, root-cause analysis, and what does NOT work.
- [`docs/browser-playbooks.md`](docs/browser-playbooks.md) — verbal step-by-step walkthroughs for web-side setup (PyPI trusted publisher, PyPI API token mint, Packagist registration, Packagist token mint, Packagist unmark abandoned, GitHub Environment creation, crates.io email verification).
- [`docs/architecture.md`](docs/architecture.md) — full control/data flow diagrams + design rationale.
- [`docs/generated-docs.md`](docs/generated-docs.md) — generated doc regions: metadata source, in-repo renderer, cog markers, staleness gate.
- `custom-release-please` skill (separate) — the consumer-side release-please configuration concerns.
