# hop-top/.github

Org-default repo for [hop-top](https://github.com/hop-top). Hosts the
**publish/mirror layer** of the release pipeline: the workflows that
run *after* release-please cuts a tag.

## What this is, and is not

**This repo is**:

- Reusable GitHub Actions workflows that publish to npm / PyPI /
  crates.io and push subtree splits to read-only mirror repos
- Triggered by `<component>/v<version>` tag pushes
- Org-level community files (CODE_OF_CONDUCT, SECURITY, CONTRIBUTING)
- Profile rendered at <https://github.com/hop-top>

**This repo is not**:

- A version manager — release-please does that
- A changelog generator — release-please does that
- A release-PR opener — release-please does that
- A replacement for release-please

The split: **release-please owns "from commit to tag"; dotgithub owns
"from tag to published package"**. They compose; you need both.

## The pipeline at a glance

![Release flow](docs/diagrams/rendered/release-flow.png)

1. Consuming repo configures release-please. Conventional commits
   land on `main`. release-please opens (and keeps updating) a
   standing PR titled `chore(release): <component> <version>`.
2. You merge the PR when ready. release-please creates the tag
   `<component>/v<version>` and a GitHub Release.
3. The tag push triggers the consumer's `publish.yml`, which
   delegates to `hop-top/.github/.github/workflows/publish-on-tag.yml@main`.
4. Dotgithub's router parses the tag, dispatches to the right
   ecosystem workflow (`publish-ts.yml`, `publish-py.yml`,
   `publish-rs.yml`), and runs `mirror-subtree.yml` to push the
   subtree to the read-only mirror.

See [`docs/architecture.md`](docs/architecture.md) for full diagrams
(router dispatch, secret flow).

## Consuming a workflow

```yaml
# in your repo: .github/workflows/publish.yml
on:
  push:
    tags: ['*/v*']

jobs:
  publish:
    permissions:
      contents: read
      id-token: write  # required for PyPI OIDC trusted publishing
    uses: hop-top/.github/.github/workflows/publish-on-tag.yml@main
    secrets:
      NPM_REGISTRY_TOKEN: ${{ secrets.NPM_REGISTRY_TOKEN }}
      CARGO_REGISTRY_TOKEN: ${{ secrets.CARGO_REGISTRY_TOKEN }}
      GH_MIRROR_PAT: ${{ secrets.GH_MIRROR_PAT }}
    with:
      ecosystems: |
        ts:  { dir: ts,  ecosystem: ts,  package: "@org/pkg",     mirror: org/pkg-ts }
        py:  { dir: py,  ecosystem: py,  package: org-pkg,         mirror: org/pkg-py }
        rs:  { dir: rs,  ecosystem: rs,  package: org-pkg,         mirror: org/pkg-rs }
        php: { dir: php, ecosystem: php, package: org/pkg,         mirror: org/pkg-php }
        go:  { dir: go,  ecosystem: go,                            mirror: org/pkg }
```

See [`docs/consuming.md`](docs/consuming.md) for full reference
(secret table, env vars exported, overrides per ecosystem).

## Versioning

Pin to a major tag (`@v1`, `@v2`) for stable consumption. `main` is
the working branch. Breaking changes bump the major tag.

## Layout

```
.github/
  workflows/
    publish-on-tag.yml       reusable: router (parses tag → dispatches)
    publish-ts.yml           reusable: npm publish
    publish-py.yml           reusable: PyPI publish (OIDC)
    publish-rs.yml           reusable: crates.io publish
    mirror-subtree.yml       reusable: subtree split + mirror push
    ci.yml                   self-CI: lint workflows + diagrams freshness
docs/
  architecture.md            full pipeline diagrams + design rationale
  consuming.md               full input reference
  diagrams/                  Mermaid sources
profile/
  README.md                  org-page content
```
