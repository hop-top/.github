# Write agent skills for a `poly-<name>` repo

Lay out, write and keep true one router skill plus one skill per language
port, so a coding agent can pick a port and then use it.

Reference implementation: `hop-top/poly-kit`, PR "agent skills for kit, a
router and one skill per port" (**pending**: unmerged when this page was
written; layout below is what that PR does, not a settled contract).

## Use this when

- A `poly-<name>` repo ships 2+ language ports and agents must choose one.
- You're adding a skill for a new port tree.
- You're reviewing a skill change.

## Before you begin

- Repo already wired per [polyglot-repo.md](polyglot-repo.md): each port
  has a component, an `ecosystems` entry and a read-only mirror.
- Skill format: [agentskills.io](https://agentskills.io) directory
  (`SKILL.md` + optional `references/`, `scripts/`, `assets/`).
- Authoring craft (triggers, concision, testing the skill): the
  `writing-skills` guidance of your agent harness. This page covers only
  what is specific to polyglot repos.

## Result

- One router skill + one skill per port, each linking the others.
- Each skill lives beside the code it describes, so the existing mirror
  split carries it. No mirror-workflow change.
- Facts an agent decides on are generated or tested, so they can't drift.

## Directory layout

A skill lives beside its component. Router + Go (bare-name mirror) sit at
the repo root; each other port sits inside its tree.

| Skill | In `poly-<name>` | In the mirror |
|---|---|---|
| `hop-top-<name>` (router) | `skills/hop-top-<name>/` | `hop-top/<name>`: `skills/hop-top-<name>/` |
| `hop-top-<name>-go` | `skills/hop-top-<name>-go/` | `hop-top/<name>`: `skills/hop-top-<name>-go/` |
| `hop-top-<name>-ts` | `ts/skills/hop-top-<name>-ts/` | `hop-top/<name>-ts`: `skills/hop-top-<name>-ts/` |
| `hop-top-<name>-py` | `py/skills/…-py/` | `hop-top/<name>-py`: `skills/…-py/` |
| `hop-top-<name>-rs` | `rs/skills/…-rs/` | `hop-top/<name>-rs`: `skills/…-rs/` |
| `hop-top-<name>-php` | `php/skills/…-php/` | `hop-top/<name>-php`: `skills/…-php/` |

Inside one skill:

```text
<skill>/
  SKILL.md
  references/<topic>.md        flat
  scripts/<name>.sh            flat, POSIX sh, read-only, no network
  assets/snippets/<name>/      code + <name>.expected
  .claude-plugin/plugin.json   generated
  gym.json                     generated
```

Nothing else, nothing deeper. In poly-kit the PR places SDK trees under
`sdk/<lang>/`; use your repo's own tree dirs, from the `ecosystems`
`dir` field ([ecosystems.md](../ecosystems.md)).

## Naming

- Skill name == directory name == plugin name.
- Router: `<org>-<name>`. Port: `<org>-<name>-<lang>`.
- Lowercase letters, digits, hyphens; at most 64 chars.
- One name, one repo path, one mirror path. The name is what
  `claude plugin install <name>@<marketplace>` takes.

## Router vs port skill

| | Router | Port skill |
|---|---|---|
| Question answered | which port fits this task | how to use this port |
| Content | ordered selection rules, capability matrix, "only in the reference port" list, install pointers, port detection script | install, default path, area references, runnable snippets |
| Never | teaches code of any port | tells the agent to pick another language by itself |
| Hand-off | names the chosen port's skill + absolute mirror URL | links the router and sibling ports (generated `other-ports` reference) |

Router rules, ordered, first match wins (poly-kit's, as a model):

1. Existing project: detect its language; stay if the matrix covers the
   task.
2. Task needs the reference port or a reference-only capability: use it.
   A project in another language keeps its port and runs the binary as a
   sidecar for that part.
3. Otherwise pick by support tier; experimental ports last.
4. Language with no port: sidecar binary over a documented interface.

Mark immature ports honestly: an experimental port's skill is thin and
says so first.

## `SKILL.md`

Frontmatter keys: `name`, `description`, `license`, `compatibility`,
`metadata`, `allowed-tools` only; block-style YAML.

```text
---
name: <org>-<name>-<lang>
description: <what it does>. Use when <triggers>. Not for <neighbours>.
license: <spdx>
metadata:
  version: "<release>" # x-release-please-version
  min_version: "<oldest release the copy works with>"
---
```

Rules:

- `description`: one line after `description:` (no folded `>` / literal
  `|` block, no continuation) — some readers parse frontmatter by line.
  At most 1024 chars. Contains `Use when`. Triggers only (what the user
  asks, what code imports, what error shows); never a workflow summary.
  Name the neighbour skill in a `Not for …` clause so router and ports
  don't both fire.
- `SKILL.md` at most 120 lines; each reference at most 200. Outgrown
  reference: split by topic, don't trim.
- Body: when to use / not; default path (few commands); one
  `Open when` table cueing every deeper file.
- Every file under `references/`, `scripts/`, `assets/snippets/` appears
  in `Open when` with a concrete cue. "More details" is not a cue.
- State a fact once. What `--help` or a docs page already states: link,
  don't copy.
- Code over 15 lines: a file under `assets/snippets/<name>/`, executed by
  the port's own test suite against `<name>.expected`. No test, no
  snippet.
- Scripts: `#!/bin/sh`, read-only, no network, exit codes in header.

## Links

- Within a skill directory: relative.
- Everything else: absolute. An installer copies one skill alone; a
  relative link to a sibling or a docs page is dead after install.
- Another skill: `https://github.com/<org>/<mirror>/blob/main/skills/<name>/SKILL.md`
  (the mirror that publishes it).
- Docs page: `https://github.com/<org>/poly-<name>/blob/<default-branch>/docs/<path>`.
  One branch for every docs link.

## Keep content true to code

A skill that names a capability the port lacks, a command that no longer
exists or a 404 link is worse than none. Move facts into one source and
derive.

| Fact | Single source | Mechanism |
|---|---|---|
| capability tables, statuses, tiers | the repo's parity / tiers docs | generated into managed blocks and references |
| per-port install, upgrade, version-read commands, `min_version`, toolchain floor | one hand-written config (poly-kit: `ports.yaml`) | generated |
| component dir, mirror, package name | `publish.yml` `ecosystems` | generated |
| module / subpath / feature names a skill mentions | the port's source tree | lint checks they exist |
| code samples | snippets | run by the port's test suite |
| plugin manifest, `gym.json`, catalog entries | `SKILL.md` frontmatter + config | generated, never hand-edited |

Generated regions sit between marker lines; edit the source, regenerate:

```text
<!-- skills-sync:begin <id> -->
…generated…
<!-- skills-sync:end <id> -->
```

poly-kit gates (all **pending** merge):

- `make skills-sync` generates; `make check-skills-sync` fails on drift,
  writes nothing.
- `make lint-skills` checks frontmatter, line caps, layout, that every
  deeper file is named, links, versions, plugin manifests, that named
  modules exist in source.
- `make check-skills` runs both. Not yet in CI there.

A repo without that tool: still derive tables from one source, run
snippets in tests, and review by the checklist below.

## Versions and release sync

Each skill states two releases in `metadata`:

| Key | Meaning | Written by |
|---|---|---|
| `version` | release the copy was written for | release tooling, via the `# x-release-please-version` annotation |
| `min_version` | oldest release the copy works with | a maintainer, in the config; release tooling never touches it |

Raise `min_version` when the skill starts relying on newer API. Never
newer than `version`.

Generated `Versions` block in every skill: the release written for, the
minimum, the command that reads the installed version, what to do when
installed is older (upgrade) or newer (skill may be stale; update the
skill), and how to update the skill per install channel.

Version numbers appear only on annotated or generated lines; elsewhere
say "the current release" and link the source. Plugin manifest `version`
is written once at creation; release tooling owns it after.

On a release, the skill's `version` must move with the component, and
the catalog entries must be republished (see
[publish-skills-to-skillset.md](publish-skills-to-skillset.md)).
**Pending:** poly-kit's PR defers the release-please wiring that stamps
skill versions; until it lands, check the stamp by hand on each release.

## How mirrors receive the skill

Nothing extra. The skill sits inside the component directory, so the
existing mirror split ([mental-model.md](../concepts/mental-model.md))
pushes it to `skills/<name>/` in the mirror on tag. Consequences:

- A mirror's `skills/<name>/` is read-only like the rest of it; edit in
  `poly-<name>` only.
- Install channels all read the mirror: the `gym` skill manager,
  `npx skills add <org>/<mirror>`, manual copy of `skills/<name>`, or the
  Claude Code plugin from the shared marketplace.
- Each skill dir is one Claude Code plugin whose root is the skill dir:
  no nested `skills/`, no `skills`/`commands`/`hooks`/`mcpServers` key in
  the manifest, no `bin/`, no `CLAUDE.md`, no marketplace file in the
  repo or mirror. The marketplace is separate.
- Packaging for registries: confirm the skill dir doesn't bloat or break
  the package. poly-kit's PR notes the Python wheel and Rust crate carry
  no skill files; the sdist and Composer dist do (harmless).

## Never in a skill

Skills are public and installed far from the repo. No tracker ids, paths
outside the repo, machine or account names, names of downstream
projects, decision-record numbers, pre-stable breaking-change notes, or
authorship / tool attribution. Applies to generated output too.

## Review checklist

- [ ] Layout matches the table; nothing extra, nothing deeper
- [ ] `name` == directory == plugin name
- [ ] `description`: one line, `Use when`, triggers only, `Not for`
- [ ] `SKILL.md` <= 120 lines; references <= 200
- [ ] Every deeper file has a concrete `Open when` cue
- [ ] Router rules ordered; each port skill links router + siblings
- [ ] Cross-skill and docs links absolute, one branch; no relative link
      leaves the skill
- [ ] Facts derived from a source, not retyped; drift check clean
- [ ] Snippets run by the port's tests; expected output committed
- [ ] `version` annotated; `min_version` justified; `Versions` block present
- [ ] Scripts: POSIX sh, read-only, no network
- [ ] Nothing from "Never in a skill"
- [ ] Fresh-agent check: with only this skill installed, a realistic task
      routes correctly and runs
- [ ] Catalog entry regenerated and submitted
      ([publish-skills-to-skillset.md](publish-skills-to-skillset.md))

## See also

- [polyglot-repo.md](polyglot-repo.md): the port trees these skills sit in
- [publish-skills-to-skillset.md](publish-skills-to-skillset.md)
- [version-strings.md](../concepts/version-strings.md)
