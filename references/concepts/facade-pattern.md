# Facade pattern

Why secret names follow a canonical convention instead of mirroring upstream tool names.

## Use this when

- You're wondering why `NPM_REGISTRY_TOKEN` isn't called `NODE_AUTH_TOKEN`.
- You're tempted to add a fallback chain (e.g. read either `MIRROR_PAT` or `GH_MIRROR_PAT`).
- You're designing a new shared workflow.

## Result

You understand why consumers reference only canonical names and the
workflows do the translation internally.

## The pattern

Consumers see one set of names; the workflows internally adapt those
to whatever env-var names upstream tools demand.

Canonical secret names follow the
`<NAMESPACE>_<PURPOSE>_<TYPE>` convention this repo authors. The
shared workflows do the translation so consumers never reference
upstream-specific identifiers.

| Canonical (what you set) | Adapter env (internal) | Read by |
|---|---|---|
| `NPM_REGISTRY_TOKEN` | `NODE_AUTH_TOKEN` | `actions/setup-node` for `pnpm publish` |
| `GH_MIRROR_PAT` | `GH_TOKEN` | `gh` CLI |
| `CARGO_REGISTRY_TOKEN` | `CARGO_REGISTRY_TOKEN` | `cargo` (name happens to match) |

## Why

- **Insulation from upstream churn**: if `setup-node` renames `NODE_AUTH_TOKEN`, every consumer would need to rename their secret. The facade keeps the consumer surface stable.
- **Consistency across registries**: every registry token follows the same `<REGISTRY>_REGISTRY_TOKEN` shape, so the secret name is grep-able and predictable.
- **One name, one purpose**: no aliases, no fallbacks. The shared workflows expect exactly one canonical name. If it's not set, the job fails visibly — not silently fallback to a wrong-but-present value.

## `GITHUB_TOKEN` is not used

`GITHUB_TOKEN` is GitHub's auto-injected per-job token. It is **not**
used by these workflows. release-please needs a higher-privilege
token specifically because PRs opened by `GITHUB_TOKEN` don't
trigger downstream workflows.

The canonical pattern: mint a short-lived installation token from
the **release-bot GitHub App** (`RELEASE_BOT_APP_ID` +
`RELEASE_BOT_PRIVATE_KEY` org secrets) via
`actions/create-github-app-token@v1`. See [quick-start.md](../quick-start.md).

Avoid long-lived PATs (`GH_RELEASE_PLEASE_PAT`); delivery to fresh
repos has proved unreliable, and PR authorship as the human owner
trips CODEOWNERS self-approval on the changelogs.

## What this means for consumers

Reference only canonical names in `secrets:` blocks at the call site:

```yaml
secrets:
  NPM_REGISTRY_TOKEN: ${{ secrets.NPM_REGISTRY_TOKEN }}
  GH_MIRROR_PAT: ${{ secrets.GH_MIRROR_PAT }}
```

The adapter names are an internal implementation detail — **never
set them yourself** in your repo's secrets settings.

## What this means for shared-workflow authors

If you're modifying the shared workflows (i.e. you're in this repo,
not consuming it):

- Pick a canonical name following the convention.
- Add it to the workflow's `secrets:` block.
- If an upstream tool reads a different env var, set it inside the workflow's `env:` block from the canonical secret.
- Document the adapter mapping in [references/secrets.md](../secrets.md).

## Next steps

- [references/secrets.md](../secrets.md) — full reference for all canonical names.
- [concepts/mental-model.md](mental-model.md) — where the facade sits in the bigger picture.
