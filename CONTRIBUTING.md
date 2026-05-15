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

## Release model

See `RELEASING.md` in each repo. Org-wide pattern:

- **Stable cuts**: release-please opens a PR; merging it tags and publishes
- **Prereleases (`-alpha`, `-beta`, `-rc`)**: manual via
  `scripts/tag-prerelease.sh` — tag-push triggers `publish-on-tag.yml`

## Sign-offs

PRs need one approving review from a maintainer. No required sign-off
commit footer.
