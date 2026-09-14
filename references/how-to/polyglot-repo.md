# Add a language tree to a `poly-<name>` repo

Wire a new `ts/` `py/` `rs/` `php/` (or `go/`) tree into an existing
polyglot repo so its first tag publishes and mirrors without a
name mismatch, a stray release PR, or a manifest fight.

## Use this when

- You're adding a TS/PY/RS/PHP tree to a `poly-<name>` repo that already ships at least one language.
- You need the registry / import / component names for a new tree and don't want to reverse-engineer a sibling repo.
- You're deciding whether the repo needs a root `.` umbrella package.
- The first release PR for a new tree looks wrong (redundant `extra-files`, umbrella tag, sibling-PR conflicts).

## Before you begin

You need:

- `publish.yml` + `release-please.yml` already wired per [quick-start.md](../quick-start.md).
- The bare `<name>` (`cite`, `c12n`, `axon`) — everything below derives from it.

## Result

The new tree has one identity per surface, its release-please
package and `ecosystems` entry line up with the mirror slug, and
its first tag publishes clean.

## Package identities

One bare `<name>` fans out into a fixed identity per surface. Fill
this table once; every file below copies from it.

| Surface | Value | Where it lives |
|---|---|---|
| Source repo | `hop-top/poly-<name>` | — |
| release-please component | `<name>-ts` \| `<name>-py` \| `<name>-rs` \| `<name>-php`; bare `<name>` for Go | `release-please-config.json` → `packages.<dir>.component` |
| Tag | `<component>/v<version>` | cut by release-please |
| Mirror slug | `hop-top/<name>-<lang>`; `hop-top/<name>` for Go | `publish.yml` → `ecosystems.<component>.mirror` |
| npm | `@hop-top/<name>` | `ts/package.json` → `name` |
| PyPI | install slug `hop-top-<name>`; import `<name>` | `py/pyproject.toml` → `[project].name`; `[tool.hatch.build.targets.wheel].packages = ["src/<name>"]` |
| crates.io | crate `hop-top-<name>`; lib `hop_top_<name>` | `rs/Cargo.toml` → `[package].name` (`[lib].name` defaults to the crate name with `-` → `_`) |
| Packagist | `hop-top/<name>`; namespace `HopTop\<Name>` | `php/composer.json` → `name`, `autoload.psr-4` |
| Go | `hop.top/<name>` | `go/go.mod` → `module`; resolves through the bare-name mirror ([vanity imports](../concepts/vanity-imports.md)) |

Rules that fall out of the table:

- Component == `ecosystems` key == mirror basename — [SKILL.md § Three-way name alignment](../../SKILL.md#three-way-name-alignment).
- `package-name` (release-please) and `package` (`ecosystems`) both carry the **registry slug** (`hop-top-<name>`, `@hop-top/<name>`, `hop-top/<name>`), never the import name.
- A second tree in the same language gets a suffix on both the component and the slug: `<name>-core` → crate `hop-top-<name>-core`, mirror `hop-top/<name>-core`.

Precedents: `poly-cite` (all five languages), `poly-c12n` (extra `core` crate).

## Steps

### 1. Land the scaffold as a non-releasing commit

Commit the tree, its manifest, and the config edits below under
`build:` or `chore:` — both are hidden changelog sections in the
standard config, so release-please opens no PR for the new
component until its first `feat:` / `fix:`. You can finish the
scaffold across several PRs without shipping a half-built alpha.

Fresh repo with nothing to release at all: a `chore:`-only history
produces zero release PRs — see [bootstrap-checklist § If your
commit type is `chore:`](../../docs/bootstrap-checklist.md#if-your-commit-type-is-chore-not-feat).

### 2. Add the release-please package

```jsonc
// .github/release-please-config.json
"packages": {
  "ts": {
    "release-type": "node",            // python | rust | php | go per tree
    "component": "<name>-ts",
    "package-name": "@hop-top/<name>", // registry slug
    "changelog-path": "CHANGELOG.md",
    "bump-minor-pre-major": true
    // + the prerelease trio if the repo is in a channel —
    //   see how-to/prerelease-channel.md
  }
}
```

**No `extra-files`, for any of the four.** `node`, `python`, `rust`
and `php` each update their own manifest natively (`package.json`,
`pyproject.toml`, `Cargo.toml`, `composer.json`). An `extra-files`
entry for that same file is redundant at best; for python it
bypasses PEP 440 normalization and breaks `pip install` —
[version-strings § Don't break the normalization](../concepts/version-strings.md#dont-break-the-normalization).
The preflight rejects only the `pyproject.toml` case
(`release-please-preflight.yml`, check 5b); keeping the other three
out is on you.

**Manifest seed**: if the repo has — or is gaining — a
`release-type: python` package, every component must be seeded at
`0.1.0-alpha.0` and first tags land at `alpha.1`; pure go/ts repos
leave `{}`. Rules and why: [bootstrap-checklist § 5](../../docs/bootstrap-checklist.md#5-configure-release-please).

### 3. Add the `ecosystems` entry

Key = component. Registry slug in `package`, mirror per the table.

```yaml
ecosystems: |
  <name>-ts:  { dir: ts,  ecosystem: ts,  package: "@hop-top/<name>", mirror: hop-top/<name>-ts }
  <name>-py:  { dir: py,  ecosystem: py,  package: hop-top-<name>,    mirror: hop-top/<name>-py }
  <name>-rs:  { dir: rs,  ecosystem: rs,  package: hop-top-<name>,    mirror: hop-top/<name>-rs }
  <name>-php: { dir: php, ecosystem: php, package: hop-top/<name>,    mirror: hop-top/<name>-php }
  <name>:     { dir: go,  ecosystem: go,                              mirror: hop-top/<name> }
```

Go in a polyglot repo is **mirror-only**: no `package`, no publish
job — proxy.golang.org pulls from the mirror's tags. Two things
matter:

- `dir: go`, never `.`. A root-dir component takes
  `mirror-subtree.yml`'s root-component path, which ships the whole
  tree minus `.github/workflows/` — `docs/`, `Makefile`, and every
  other language tree land on `hop-top/<name>`. `dir: go` takes the
  normal `git subtree split --prefix=go` path and the mirror gets
  only the module.
- The mirror repo is created by the first `<name>/v*` tag if it
  doesn't exist (`mirror-subtree.yml` runs `gh repo view || gh repo
  create`). Don't pre-seed it by hand — [SKILL.md § Bootstrap-mirror
  gotcha](../../SKILL.md#bootstrap-mirror-gotcha).

Per-language overrides (`test-command`, `pypi-auth`, …):
[ecosystems.md](../ecosystems.md).

### 4. Decide on a root umbrella package (optional)

A `"."` package (`poly-cite`, `c12n-poly`) versions repo-level
changes — README, specs, CI — with no registry target. `poly-xrr`
and `poly-vstar` ship without one; `poly-cite` and `poly-c12n` have
one. If you add it:

```jsonc
".": {
  "release-type": "simple",
  "component": "poly-<name>",
  "changelog-path": "CHANGELOG.md",
  "exclude-paths": ["go", "ts", "py", "rs", "php"]   // every language dir
}
```

- `exclude-paths` must list **every** language dir, or a `feat(ts):`
  commit bumps the umbrella too and you get two release PRs per
  change.
- Its tag matches `publish.yml`'s `*/v*` trigger. `publish-on-tag`
  skips an unknown component with a `::notice::` and green-skipped
  jobs, so nothing breaks — but excluding it saves a no-op run:

  ```yaml
  on:
    push:
      tags: ['*/v*', '!poly-<name>/v*']
  ```

  Never add the umbrella to `ecosystems:` —
  [SKILL.md § Umbrella / meta-component tags](../../SKILL.md#umbrella--meta-component-tags).

### 5. Merge release PRs one at a time

`separate-pull-requests: true` opens one PR per component, all
editing the same `.release-please-manifest.json`. Merging one makes
the rest CONFLICTING. Merge → wait for release-please to rebase
the siblings (or rebase by hand) → merge the next. Batch-merging
is what produces the close+retrigger churn in
[retrigger-release-please.md](retrigger-release-please.md).

## Common issues

| Problem | Cause | Fix |
|---|---|---|
| `Unknown component '<name>-ts'` at parse | Component, `ecosystems` key, or mirror basename drifted | Align all three to the identity table above |
| Release PR opened for a tree that only has scaffolding | Scaffold landed as `feat:` | Land scaffolds as `build:` / `chore:`; close the PR, it regenerates on the first real `feat:` |
| Umbrella PR opens on every `feat(<lang>):` | Root package missing that dir in `exclude-paths` | List every language dir |
| `hop-top/<name>` mirror contains `docs/`, `ts/`, `py/` … | Go entry uses `dir: .` | Set `dir: go`; the next tag pushes only the module |
| `pip install` fails on the release PR's `pyproject.toml` | `extra-files` entry for `pyproject.toml` | Remove it; the python strategy owns the file |
| Sibling release PRs CONFLICTING after one merge | Shared manifest | Merge serially — [retrigger-release-please.md](retrigger-release-please.md) |
| Python release PR proposes stable `0.1.0` | Empty manifest with a python package | Seed every component — [bootstrap-checklist § 5](../../docs/bootstrap-checklist.md#5-configure-release-please) |

## Next steps

- [ecosystems.md](../ecosystems.md) — field-by-field `ecosystems` reference.
- [troubleshooting/ts.md](../troubleshooting/ts.md), [py.md](../troubleshooting/py.md), [rs.md](../troubleshooting/rs.md), [php.md](../troubleshooting/php.md), [go.md](../troubleshooting/go.md) — first-publish gotchas per language.
- [how-to/prerelease-channel.md](prerelease-channel.md) — the prerelease trio and manifest seeding.
- [SKILL.md § First publish of a new package](../../SKILL.md#first-publish-of-a-new-package) — the local bootstrap publish each registry needs once.
