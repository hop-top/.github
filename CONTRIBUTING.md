# Contributing

Each repo has its own `CONTRIBUTING.md` with project-specific guidance.
This file covers what applies org-wide.

## Conventional Commits

All commits and PR titles follow [Conventional Commits v1.0.0](https://www.conventionalcommits.org/en/v1.0.0/):

```
<type>(<scope>): <subject>
```

Types: `feat`, `fix`, `perf`, `refactor`, `chore`, `docs`, `test`, `ci`, `build`.

`feat`, `fix`, `perf` are user-facing (bump versions, appear in changelog).
The rest are hidden.

CI/workflow changes use `ci:` — never `fix(ci):`. CI noise doesn't bump
versions.

### Code spans for literal tokens

Put literal tokens in backticks wherever they appear in a commit: the
subject, the body, and any `BREAKING CHANGE:` footer. That covers:

- config keys and flags: `services.<svc>.cors.*`, `--format`
- environment variables and file paths: `GITHUB_TOKEN`,
  `.github/release-please-config.json`
- code identifiers, packages and namespaces: `cli.New`, `Hop\Cite`
- `<placeholder>` segments, and `*` as a wildcard or a literal
- HTTP header names, values and status codes used literally:
  `Access-Control-Allow-Origin: *`, `403`

release-please copies subjects and `BREAKING CHANGE:` footers verbatim
into `CHANGELOG.md` and the GitHub release notes. Left bare, `<svc>`
is dropped by GitHub as an unknown HTML tag, and markdownlint (MD037)
reads a pair of `*` as emphasis. In a code span both render literally
and lint clean, and a subject's spans show as code in the changelog.

Before:

```text
feat(cors)!: per-service CORS policy

BREAKING CHANGE: services.<svc>.cors.* replaces the global cors.* keys.
A "*" grant answers Access-Control-Allow-Origin: *
```

After:

```text
feat(cors)!: per-service CORS policy

BREAKING CHANGE: `services.<svc>.cors.*` replaces the global `cors.*`
keys. A `"*"` grant answers `Access-Control-Allow-Origin: *`.
```

PR titles count: a squash merge turns the title into the commit
subject, and a rebase merge lands each commit's own subject, so the
rule holds for both.

## Release model

See `RELEASING.md` in each repo. Org-wide pattern:

- **Stable cuts**: release-please opens a PR; merging it tags and publishes
- **Prereleases (`-alpha`, `-beta`, `-rc`)**: manual via
  `scripts/tag-prerelease.sh` — tag-push triggers `publish-on-tag.yml`

## Sign-offs

PRs need one approving review from a maintainer. No required sign-off
commit footer.
