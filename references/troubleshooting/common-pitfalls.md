# Common pitfalls

The full symptom → cause → fix table.

## Use this when

- A release pipeline misfired and you need to triage fast.
- You want to scan for known traps before shipping the first tag.

## Result

You either find the exact failure mode you're hitting, or you've
ruled out every known pitfall — at which point the issue is novel
and worth filing.

## The table

Entries linked to [docs/failure-modes.md](../../docs/failure-modes.md)
have extended treatment there (workflow log symptoms, verification
commands, escape hatches). The rest are summarized in this table
only.

| Issue | Cause | Fix |
|---|---|---|
| Tag push doesn't trigger publish (silent) | 3-segment tag (e.g. `sdk/ts/v...`) — `*` in `tags: ['*/v*']` doesn't match `/` | Rename `component` in release-please-config.json so it's a single segment (`kit-ts`, not `sdk/ts`). See [SKILL.md § Tag-shape glob trap](../../SKILL.md#tag-shape-glob-trap). |
| `Unknown component '<name>'` at publish parse step | `ecosystems` map key in `publish.yml` doesn't match the `component` in release-please-config.json | Make all three names match: release-please `component` == `ecosystems` key == mirror repo basename. See [SKILL.md § Three-way name alignment](../../SKILL.md#three-way-name-alignment). |
| Tag push doesn't trigger publish (no error) | `release-please` used default `GITHUB_TOKEN`, which can't trigger downstream | Mint an App token via `actions/create-github-app-token@v1` against `RELEASE_BOT_APP_ID` + `RELEASE_BOT_PRIVATE_KEY`, pass to `token:` on the release-please action. See [Quick-start](../quick-start.md). |
| release-please run fails immediately: `Input required and not supplied: token` | `secrets.GH_RELEASE_PLEASE_PAT` reference resolves empty on a fresh repo (deprecated path) | Switch to the App-token pattern. The org-level `GH_RELEASE_PLEASE_PAT` secret has not proven reliably reachable for new repos; the `release-bot` App is the supported path. |
| Tag pushed before `publish.yml` existed → no publish run | Actions reads workflows from the tag's tree, not main | Force-update the tag to a commit containing `publish.yml`; see [docs/failure-modes.md](../../docs/failure-modes.md) |
| release-please proposes stable when you wanted prerelease | Missing `versioning: "prerelease"` and/or manifest seed is stable | Add all four pieces of the prerelease combo. See [how-to/prerelease-channel.md](../how-to/prerelease-channel.md). |
| First release skips `alpha.0` and starts at `alpha.1` | `prerelease-type: "alpha"` instead of `"alpha.0"` | Use `"alpha.0"` so the counter has a starting digit |
| `feat:` from `0.0.0` jumps to `1.0.0` | release-please's "0.0.0 trap" — treats `0.0.0` as "no prior release" | Bootstrap with `Release-As: 0.1.0` footer on the first commit |
| Fixed `publish.yml` on main, retry still fails | `publish.yml` snapshots from the tag's commit; `gh run rerun` reuses the original workflow refs | Delete + recreate the tag at current main. See [how-to/retrigger-failed-publish.md](../how-to/retrigger-failed-publish.md). |
| Mirror push fails with `denied to github-actions[bot]` | `actions/checkout` planted an extraheader that overrides the PAT | The shared `mirror-subtree.yml` already sets `persist-credentials: false`. If you're customizing, ensure that's set. |
| Mirror push rejected: `workflow ... without 'workflow' scope` | Root component (`dir: "."`) push includes `.github/workflows/*` | Resolved at `mirror-subtree.yml@v0.4.2+` — `.github/workflows/` is stripped from root-component pushes. Pin to `@v0` or `@v1` rolling tag. |
| Mirror step fails: `fatal: . does not exist; use git subtree add` | Root-component (`dir: "."`) on `mirror-subtree.yml@v0.4.0` or older | Resolved at `mirror-subtree.yml@v0.4.1+`. Pin to `@v0` or `@v1` rolling tag. |
| `&&` in `test-command` produces pip/cargo arg-parsing errors | Resolved at `publish-{py,rs,ts}.yml@v0.4.3+` (was `run: $TEST_CMD`, now `run: bash -c "$TEST_CMD"`) | Pin to `@v0` or `@v1` rolling tag. |
| Build step fails with `ERR_PNPM_SPEC_NOT_SUPPORTED_BY_ANY_RESOLVER "&&"` | `run: $CMD` doesn't re-parse shell operators in env-var commands (tracked in [#9](https://github.com/hop-top/.github/issues/9)) | Move the pipeline into a package.json script (`ci:build`) so the workflow command is single-token. [Details](../../docs/failure-modes.md#err_pnpm_spec_not_supported_by_any_resolver-on-build-step) |
| pnpm install fails with `ERR_PNPM_IGNORED_BUILDS` | pnpm 11 `strictDepBuilds: true` default | Declare offending deps in `pnpm-workspace.yaml` `allowBuilds:` (NOT package.json — that's deprecated in pnpm 11). [Details](../../docs/failure-modes.md#pnpm-11-strictdepbuilds-blocks-install-on-transitive-postinstalls) |
| PyPI publish fails with `invalid-publisher` despite correct claims | Pending-publisher table drift, OR caller-vs-reusable workflow_ref confusion | Verify the **caller workflow filename** matches the trusted-publisher config (not the reusable's). If still failing, switch to `pypi-auth: token` as escape hatch. See [references/secrets.md § PyPI auth modes](../secrets.md#pypi-auth-modes) and [docs/failure-modes.md](../../docs/failure-modes.md#pypi-oidc-invalid-publisher-despite-correct-looking-claims). |
| PyPI publish fails with `403 You're not allowed to upload to project '<name>'` | Bare PyPI name (e.g. `eva`, `uri`) is already owned by a third party | Prefix the install slug — rename `[project].name` to `hop-top-<name>` and update `package:` in `publish.yml`'s ecosystems block + `package-name` in `release-please-config.json`. Import name (`packages` in `[tool.hatch.build.targets.wheel]`) can stay clean. See [concepts/install-model.md § py: package naming](../concepts/install-model.md#py-package-naming-install-slug-vs-import-name). |
| `uv pip install -e .` fails with `references a workspace in tool.uv.sources but is not a workspace member` | `[tool.uv.sources]` key and/or `[dependency-groups].dev` entry references the old `[project].name` after renaming | Update `[tool.uv.sources].<name>` AND `[dependency-groups].dev` AND `[project.optional-dependencies].all` to match the new `[project].name`. All four point at the install slug, not the import name. See [concepts/install-model.md § py: package naming](../concepts/install-model.md#py-package-naming-install-slug-vs-import-name). |
| PyPI publish fails with `invalid-token-bad-audience` | OIDC trusted-publisher config doesn't match | Verify on PyPI: org name, repo name, workflow filename, environment name |
| PyPI version doesn't match git tag | PEP 440 normalization (`0.2.0-alpha.1` → `0.2.0a1`) | Cosmetic; pip accepts both forms in specs. [Details](../../docs/failure-modes.md#pypi-version-doesnt-match-git-tag-pep-440-normalization) |
| GitHub Environment binding fails | `pypi` environment doesn't exist on caller repo | `gh api -X PUT repos/<org>/<repo>/environments/pypi` |
| crates.io publish fails with `verified email required` | The CARGO_REGISTRY_TOKEN's account has no verified email | Verify email at <https://crates.io/settings/profile>, then re-issue the token |
| crates.io publish fails: `1 files in the working directory contain changes` | `cargo test` mutates `target/` and the crate has no `.gitignore`, or `target/` files are tracked | Add `.gitignore` ignoring `/target/` + `git rm -r --cached <crate>/target/`. See [troubleshooting/rs.md](rs.md). |
| Rust test fails: `unresolved import <crate>::<feature_module>` under default features | Test file under `tests/` depends on a feature-gated module; cargo compiles all test files unconditionally | Add `#![cfg(feature = "<name>")]` at the top of the test file. See [troubleshooting/rs.md § feature-gated test files](rs.md#feature-gated-test-files). |
| TS test fails: `Could not locate the bindings file` | Native-binding dep needs build scripts that `--ignore-scripts` blocks | Either exclude the test or drop `--ignore-scripts`. See [troubleshooting/ts.md](ts.md). |
| `go get <module>@latest` returns a pseudo-version after a real release | Ghost versions cached in proxy.golang.org from a prior incarnation outrank the new tag | Bump the next release to a version strictly greater than every ghost. See [troubleshooting/go.md § ghost versions](go.md#ghost-versions). |
| Packagist returns 404 even after the mirror has a tag | First version requires manual one-time submit | Submit once at <https://packagist.org/packages/submit>; subsequent tags auto-notify via `publish-php`. See [troubleshooting/php.md § Packagist notify](php.md#packagist-notify-the-per-tag-flow). |
| PHP tag push runs green but Packagist shows no new version | `publish-php` job was `skipped` (pre-v0.9.1 of dotgithub: `if:` lacked `always()` and got short-circuited by GHA's transitive-needs rule) OR consumer `publish.yml` doesn't forward `PACKAGIST_USERNAME` / `PACKAGIST_TOKEN` | Bump `publish.yml` to `@v0` (rolling) — already fixed at `v0.9.1+`. Confirm the consumer `publish.yml` lists both secrets in its `secrets:` block. See [troubleshooting/php.md](php.md). |
| `composer install` fails: `Invalid version string "0.4.0-experimental.1"` | Composer's parser only accepts `dev`/`alpha`/`beta`/`RC`/`stable` as pre-release identifiers | Rename the php package's pre-release suffix to `alpha.N` (in `composer.json`, the release-please manifest, and `prerelease-type`). Other ecosystems can keep `experimental.N`. See [troubleshooting/php.md § Composer rejects experimental.N](php.md#composer-rejects-experimentaln-pre-release-identifiers). |
| Packagist still shows package as `"abandoned": true` after re-notify | The `abandoned` flag is Packagist-side, set via web UI; not in `composer.json`; not cleared by re-indexing | Unmark in the package's edit page on packagist.org (maintainer-only). p2 metadata reflects the change immediately; legacy `/packages/<vendor>/<pkg>.json` CDN can lag up to 12h. See [troubleshooting/php.md § Abandoned flag](php.md#abandoned-flag-is-sticky-and-packagist-side-only). |
| PHP tag publish fails at `parse`: `ecosystem=php requires enable-mirror=true` | Caller set `enable-mirror: false` for a php component, which would silently skip `publish-php` (it `needs: mirror`) | Set `enable-mirror: true` (default) for any caller that ships a php component. See [troubleshooting/php.md § PHP requires the mirror](php.md#php-requires-the-mirror). |
| Sibling release-please PRs go CONFLICTING after merging one | Shared manifest; merging A advances it, B's branch is stale | Close the conflicting PR + retrigger release-please via `workflow_dispatch`. See [how-to/retrigger-release-please.md](../how-to/retrigger-release-please.md). |
| release-please PR shows `mergeStateStatus: DIRTY` | Main moved between PR creation and merge attempt | Close PR + delete branch; release-please regenerates on next push. [Details](../../docs/failure-modes.md#release-please-pr-goes-dirty-after-main-moves) |
| Created `homebrew-<binary>` or `scoop-<binary>` tap/bucket repo per binary | Misread convention — taps are org-wide, not per-binary | Use `<org>/homebrew-tap` + `<org>/scoop-bucket` (single repos serving every org binary). Delete the per-binary tap/bucket; point goreleaser's `brews[].repository.name` at `homebrew-tap` and `scoops[].repository.name` at `scoop-bucket`. See [how-to/ship-binaries.md § Org-wide tap/bucket convention](../how-to/ship-binaries.md#org-wide-tapbucket-convention). |

## Next steps

- [troubleshooting/ts.md](ts.md), [py.md](py.md), [rs.md](rs.md), [php.md](php.md), [go.md](go.md) — language-specific deep dives.
- [docs/failure-modes.md](../../docs/failure-modes.md) — extended log-excerpt + root-cause-analysis guide.
- [docs/browser-playbooks.md](../../docs/browser-playbooks.md) — web-side setup walkthroughs.
