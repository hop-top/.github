# Quality gates before a release

What a repo released through these workflows runs before a tag exists:
the `make quality` targets, the tool behind each one in every
ecosystem, and which of them catch a publish failure at PR time.

## Use this when

- You're adding CI to a repo that releases through `publish-on-tag.yml`.
- A publish job failed on something a PR could have caught (invalid
  metadata, a missing file in the package, a rejected manifest).
- You're checking which tool a `make quality` target runs in a given
  ecosystem.

## Result

Your repo runs the same gates locally and in CI, and the registry
checks `publish-on-tag.yml` meets at tag time already ran on the PR.

## The targets

Every language directory carries the same Makefile targets. A polyglot
root delegates each target to every language directory.

| Target | Fails when | In `quality` |
|---|---|---|
| `audit` | a dependency has a known vulnerability | yes |
| `unused` | a dependency is unused or undeclared, or code is dead | yes |
| `pkgcheck` | the artifact that gets published is invalid | yes |
| `coverage` | line coverage is under `COVERAGE_MIN` | yes |
| `dupes` | copy-paste is over the jscpd threshold | yes |
| `mutation` | reports surviving mutants (weekly, report-only) | no |

Complexity fails `make lint`, not a separate target.

## Tools per ecosystem

| `ecosystem` | `audit` | `unused` | `pkgcheck` | `coverage` | `mutation` |
|---|---|---|---|---|---|
| `go` | govulncheck | `go mod tidy -diff`, deadcode | `goreleaser check` | `go test -coverprofile` | gremlins |
| `rs` | cargo-deny | cargo-machete | `cargo package --locked` | cargo-llvm-cov | cargo-mutants |
| `py` | pip-audit | deptry, vulture | `uv build` + `twine check --strict` | pytest-cov | mutmut |
| `ts` | `pnpm audit` | knip | `publint --strict` | `@vitest/coverage-v8` | Stryker |
| `php` | `composer audit` | composer-dependency-analyser | `composer validate --strict` | phpunit + pcov | Infection |

`dupes` runs jscpd in every ecosystem.

## `pkgcheck` is the publish job, run early

Each `pkgcheck` runs the check the matching publish path meets at tag
time, so a failure shows up on the PR rather than after the tag:

| `ecosystem` | Tag-time failure it previews |
|---|---|
| `py` | PyPI rejecting the upload over invalid metadata or an unrendered README |
| `rs` | `cargo publish` failing on a file missing from the packaged crate, or an unpublished path dependency |
| `ts` | an `exports`, `bin` or `files` entry pointing at a file the tarball lacks |
| `php` | a `composer.json` the mirror carries to Packagist with schema errors, or a `version` field that overrides the tag-derived version (see [troubleshooting/php.md](troubleshooting/php.md)) |
| `go` | `goreleaser-on-tag.yml` stopping on an invalid `.goreleaser.yaml`. `goreleaser check` also fails on deprecated keys, which `goreleaser release` only warns about ([how-to/ship-binaries.md](how-to/ship-binaries.md)) |

## Wire it into CI

A separate workflow, not a `test-command` override. The publish job
re-runs tests at tag time (see [ecosystems.md](ecosystems.md)), but a
new advisory must not block a tag that already passed review. Advisories
land without a code change, so the workflow also runs weekly:

```yaml
# .github/workflows/quality.yml
name: Quality

on:
  pull_request:
  push:
    branches: [main]
  schedule:
    - cron: "17 5 * * 1"

permissions:
  contents: read

jobs:
  quality:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
        with:
          persist-credentials: false
      - uses: jdx/mise-action@v5
      - run: mise exec -- make setup
      - run: mise exec -- make quality
```

For a php tree, add `shivammathur/setup-php` with `coverage: pcov`
before mise: `make coverage` needs a coverage driver. Pin each `uses:`
to a commit SHA, as for every other workflow ([pinning.md](pinning.md)).

To require the gate, follow
[docs/bootstrap-checklist.md § 6b](../docs/bootstrap-checklist.md#6b-make-checks-required-last):
make it required only after it has passed on the default branch.

## Next steps

- [ecosystems.md](ecosystems.md): what the publish job's own
  `test-command` and `build-command` run at tag time.
- [docs/bootstrap-checklist.md](../docs/bootstrap-checklist.md): where
  the quality workflow fits in first-time setup.
