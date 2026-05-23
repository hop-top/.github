# Re-trigger a failed publish

Make a tag pick up a newer workflow file.

## Use this when

- A tag was pushed but `publish.yml` had a bug and the run failed.
- You fixed `publish.yml` on main but `gh run rerun <id>` keeps using the old workflow.
- A tag was pushed before `publish.yml` existed in the repo.

## Result

The original tag is recreated at current `main`, triggering a fresh
workflow run that picks up the latest `publish.yml` and the latest
reusable workflow refs.

## Before you begin

Understand the snapshot semantics: **`publish.yml` runs against the
`publish.yml` at the tag's commit, NOT current `main`**. See
[concepts/mental-model.md § Snapshot semantics](../concepts/mental-model.md#snapshot-semantics).

Consequences:

- Fixing `publish.yml` on main doesn't help an already-pushed tag.
- `gh run rerun <id>` reuses the originally-resolved workflow refs (including `@main` and `@v0`) — it does NOT pick up newer reusable workflows.
- The reliable retry is to **delete the tag + recreate it at current `main`**.

## Steps

### 1. Delete the GitHub Release (if one was created)

```bash
gh release delete <component>/v<version> --repo <org>/<repo> --yes
```

### 2. Delete the tag

```bash
gh api -X DELETE repos/<org>/<repo>/git/refs/tags/<component>/v<version>
```

### 3. Recreate the tag at current `main`

```bash
SHA=$(gh api repos/<org>/<repo>/branches/main -q '.commit.sha')
gh api -X POST repos/<org>/<repo>/git/refs \
  -f ref="refs/tags/<component>/v<version>" -f sha="$SHA"
```

### 4. Verify a fresh run was triggered

```bash
gh run list --repo <org>/<repo> --workflow publish.yml --limit 1
```

The new run resolves the caller workflow at the new tagged commit
AND resolves the reusable workflow refs (`@main`, `@v0`) at run
time.

## When `gh run rerun` IS the right tool

Use `gh run rerun` only when the failure was transient (network
glitch, runner flake) and the workflow file itself hasn't changed.
For any logic/config fix, you must re-tag.

## What about Go module proxy ghost versions?

`proxy.golang.org` is content-addressed and **immutable**. Once a
version slot is filled, it can never be republished. The proxy's
`@v/list` also caches version names even after the underlying git
tags are deleted (these become "ghosts" — listed but unresolvable).

If a Go module's previous incarnation polluted the proxy with
ghost versions (e.g. a repo restructure), the new release must use
a version **strictly greater** than every ghost so `@latest`
resolves correctly:

```sh
curl -s 'https://proxy.golang.org/<module>/@v/list' | sort -V
# Pick a next version above the highest ghost
```

Use a `Release-As: <next-base>-alpha.0` footer or manifest reseed
to jump the base. See [how-to/prerelease-channel.md § Jump base
while staying prerelease](prerelease-channel.md#jump-base-while-staying-prerelease).

## Next steps

- [Re-trigger release-please](retrigger-release-please.md) — after sibling-PR conflicts.
- [troubleshooting/common-pitfalls.md](../troubleshooting/common-pitfalls.md).
