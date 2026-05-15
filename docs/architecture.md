# Architecture

Control and data flow for hop-top's publish/mirror layer.

Diagrams are inline mermaid blocks that GitHub renders natively. The
same diagram sources also exist as standalone `.mmd` files under
[`docs/diagrams/`](diagrams/) for use outside GitHub.

## Scope

This repo owns "**from tag to published package**":

- Parse `<component>/v<version>` tag pushes
- Dispatch to ecosystem-specific publish workflows
- Push subtree splits to read-only mirror repos

It does NOT own "**from commit to tag**" — that's release-please's
job, configured per-consumer.

## Single pipeline, single entry point

The pipeline runs on tag-push only. Whether the tag was created by
release-please merging a stable release or a prerelease (alpha/beta/rc)
makes no difference here — same path either way.

```mermaid
flowchart TB
    Dev([Developer])
    Commits[Conventional commits on main]
    Dev --> Commits

    subgraph ReleasePleaseScope ["Consumer-side (release-please)"]
        direction TB
        RP[release-please.yml<br/>opens standing PR]
        PR[chore release X.Y.Z<br/>PR open on main]
        Merge[Merge PR]
        Tag[release-please creates tag<br/>vX.Y.Z]
        RP --> PR --> Merge --> Tag
    end

    Commits --> RP

    Push((git push --tags))
    Tag --> Push

    subgraph DotGithubScope ["dotgithub (this repo)"]
        direction TB
        Router[publish-on-tag.yml<br/>parses tag prefix]
        Router -->|ts/v*| PubTS[publish-ts.yml]
        Router -->|py/v*| PubPY[publish-py.yml]
        Router -->|rs/v*| PubRS[publish-rs.yml]
        Router -->|php/v*| NoOp1[no publish<br/>Packagist auto-syncs]
        Router -->|go/v*| NoOp2[no publish<br/>proxy.golang.org<br/>pulls from tag]
        Router --> Mirror[mirror-subtree.yml<br/>git subtree split + push]
    end

    Push --> Router

    PubTS --> NPM[(npm)]
    PubPY --> PyPI[(PyPI<br/>OIDC trusted)]
    PubRS --> Crates[(crates.io)]
    Mirror --> MirrorRepo[(read-only mirror repo)]
```

Source: [`diagrams/release-flow.mmd`](diagrams/release-flow.mmd)

## Tag push routing

The router parses any `<component>/v<version>` tag and dispatches to
the right ecosystem workflow plus the mirror. **The mirror always
runs**; the publish job runs only if the ecosystem requires one (php
and go skip — Packagist auto-syncs, go module proxy pulls from tags).

```mermaid
sequenceDiagram
    participant Tag as Tag push<br/>(ts/v0.3.0-alpha.0)
    participant Router as publish-on-tag.yml
    participant Parse as parse job
    participant Publish as publish-ts (reusable)
    participant Mirror as mirror-subtree (reusable)
    participant NPM as npm
    participant Source as hop-top/poly-uri
    participant Mirror_repo as hop-top/uri-ts

    Tag->>Router: triggers on tags ['*/v*']
    Router->>Parse: extract component, version, dir, ecosystem, mirror_slug
    Parse-->>Router: component=ts, dir=ts, ecosystem=ts, mirror=hop-top/uri-ts

    par publish + mirror in parallel
        Router->>Publish: working-directory=ts
        Publish->>Publish: pnpm test
        Publish->>Publish: pnpm build
        Publish->>NPM: pnpm publish --access public
        NPM-->>Publish: 200 OK
    and
        Router->>Mirror: prefix=ts, target=hop-top/uri-ts, tag=v0.3.0-alpha.0
        Mirror->>Source: git subtree split --prefix=ts HEAD
        Mirror->>Mirror_repo: git push (refs/heads/main + tag)
        Mirror->>Mirror_repo: gh release create v0.3.0-alpha.0
    end
```

Source: [`diagrams/router-dispatch.mmd`](diagrams/router-dispatch.mmd)

## Control flow within a publish job

Each per-ecosystem reusable workflow follows the same shape.

```mermaid
flowchart LR
    Checkout[checkout<br/>persist-credentials: false] --> Setup[setup ecosystem<br/>node/python/rust]
    Setup --> Test[run tests<br/>working-directory: ts]
    Test --> Build[build artifact]
    Build --> Publish[publish to registry]

    Test -.fail.-> Stop1[stop]
    Build -.fail.-> Stop2[stop]
    Publish -.fail.-> Stop3[stop]

    classDef fail fill:#f8d7da,stroke:#721c24,color:#000
    class Stop1,Stop2,Stop3 fail
```

Source: [`diagrams/publish-job.mmd`](diagrams/publish-job.mmd)

**Fail-fast.** Any step's failure halts the job. The mirror job has
`if: always() && needs.publish-*.result != 'failure'` so a publish
failure also blocks the mirror push.

## Secret flow

Reusable workflows declare what they expect; callers map explicitly
(no fallback chains). Canonical secret names follow
`<NAMESPACE>_<PURPOSE>_<TYPE>`.

```mermaid
flowchart TB
    subgraph OrgLevel ["Org-level secrets (Settings → Org → Actions)"]
        GH_MIRROR_PAT[(GH_MIRROR_PAT)]
        NPM_REGISTRY_TOKEN[(NPM_REGISTRY_TOKEN)]
        CARGO[(CARGO_REGISTRY_TOKEN)]
    end

    subgraph RepoLevel ["Repo-level secrets"]
        GH_RP_PAT[(GH_RELEASE_PLEASE_PAT)]
    end

    subgraph ConsumerRepo ["Consuming repo (publish.yml)"]
        Inherit[secrets: inherit<br/>or explicit per-secret mapping<br/>canonical names ONLY]
    end

    OrgLevel --> Inherit
    RepoLevel --> ReleasePleaseJob[release-please job]

    Inherit --> Router[publish-on-tag.yml]

    Router -->|NPM_REGISTRY_TOKEN| PubTS[publish-ts]
    Router -->|CARGO_REGISTRY_TOKEN| PubRS[publish-rs]
    Router -->|GH_MIRROR_PAT| Mirror[mirror-subtree]
    Router -->|no secret needed| PubPY[publish-py]

    PubTS -->|NODE_AUTH_TOKEN env| NPM[(npm)]
    PubRS -->|CARGO_REGISTRY_TOKEN env| Crates[(crates.io)]
    Mirror -->|GH_TOKEN env| Targets[(mirror repos)]
    PubPY -->|id-token: write<br/>OIDC trusted| PyPI[(PyPI)]

    classDef secret fill:#fff3cd,stroke:#856404,color:#000
    classDef registry fill:#f8d7da,stroke:#721c24,color:#000
    classDef consumer fill:#e8f4f8,stroke:#0a6,color:#000
    class GH_MIRROR_PAT,NPM_REGISTRY_TOKEN,CARGO,GH_RP_PAT secret
    class NPM,Crates,Targets,PyPI registry
    class ConsumerRepo consumer
```

Source: [`diagrams/secret-flow.mmd`](diagrams/secret-flow.mmd)

**PyPI uses OIDC, not a secret.** The trusted-publisher config lives
on PyPI's side; the workflow proves identity via `id-token: write`.

## Why this shape

| Decision | Alternative considered | Why we chose this |
|---|---|---|
| Tag push as single trigger | Workflow dispatch / release-please outputs only | One trigger, one pipeline. release-please-created tags AND any other tag (manual, scripted) hit the same path. |
| Org-default repo for reusable workflows | Per-repo workflow duplication | N consumer repos; fixes propagate via `@v1` pin instead of N repo PRs |
| Don't manage versions here | Bundle release-please into dotgithub | release-please is per-repo by design (manifest, config). The PR-opening workflow stays per-consumer; only the publish side is shared. |
| `persist-credentials: false` | Custom token reset step | Cleanest idiomatic fix; documented in `actions/checkout` README. Without it, runner extraheader silently overrides PAT-based pushes. |
| One workflow per ecosystem | Monolithic `publish.yml` with conditionals | Per-ecosystem keeps each file small and lintable; conditionals in YAML are hard to follow |
| Inline mermaid in docs | Pre-rendered PNGs | GitHub renders mermaid natively. No render pipeline, no cross-platform PNG drift, no CI Chrome dependency. |
