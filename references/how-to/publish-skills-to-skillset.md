# Publish skills to the `hop-top/skillset` marketplace

List a repo's agent skills in the shared Claude Code plugin marketplace,
so users install them with one command and get updates on release.

**Pending:** the marketplace catalog tooling (`entries/`, `bin/assemble`)
described here is unmerged in `hop-top/skillset`; the poly-kit side that
generates entries is unmerged too. Flow below is what those changes do.
Check the `skillset` README for the merged form before relying on it.

## Use this when

- A `poly-<name>` repo has skills ([poly-agent-skills.md](poly-agent-skills.md))
  and they should be installable as plugins.
- A release changed a skill's name, description, source path or mirror.

## Before you begin

- Skills laid out per [poly-agent-skills.md](poly-agent-skills.md):
  each skill dir has `.claude-plugin/plugin.json`, name == directory.
- Mirrors already published: the marketplace points at mirror repos, not
  the monorepo.
- Public clone works without credentials (marketplace sources are
  `https://`).

## Result

- `entries/<project>.json` in `hop-top/skillset` lists each skill as a
  plugin; `.claude-plugin/marketplace.json` is rebuilt from it.
- Users run:

  ```sh
  claude plugin marketplace add hop-top/skillset
  claude plugin install <skill>@hop-top
  claude plugin update <skill>@hop-top
  ```

## Model

One catalog (`hop-top`) for every hop-top project. No project repo and
no mirror is a marketplace; each project contributes entries.

- Entry: points at `git-subdir` = mirror URL + `skills/<name>`.
- Plugin manifest in the skill dir owns `version`. Entries carry no
  `version`, `ref` or `sha`, so **a release changes nothing in
  `skillset`**; users get it via `plugin update`.
- Entry changes only when name, description, path or mirror changes.

## Steps

### 1. Generate entries from the project

Entries are generated from the skill frontmatter and per-port config,
never typed twice. poly-kit: `make skills-sync` writes
`claude-marketplace-entries.json` at the repo root.

Entry shape:

```json
{
  "name": "<skill>",
  "description": "Use when ...",
  "source": {
    "source": "git-subdir",
    "url": "https://github.com/<org>/<mirror>.git",
    "path": "skills/<skill>"
  },
  "homepage": "https://github.com/<org>/<mirror>/blob/main/skills/<skill>/SKILL.md",
  "license": "<spdx>",
  "category": "development",
  "keywords": ["<org>", "<name>", "agent-skill"]
}
```

Optional: `repository`, `tags`, `author`, `displayName`.

### 2. Add the member file in `skillset`

Copy the generated file to `entries/<project>.json` (an array of
entries), then:

```sh
bin/assemble                  # rewrite .claude-plugin/marketplace.json
bin/assemble --check          # CI: committed catalog current?
bin/assemble --check-member <project> <generated-file>
                              # CI: entries file equals the project's
bin/validate                  # claude plugin validate --strict
```

Commit `entries/` and the rebuilt `.claude-plugin/marketplace.json`.
Never edit the latter by hand. Open a PR against `hop-top/skillset`.

### 3. Check the rules `bin/assemble` enforces

- `name` unique across all members; not starting `claude-`,
  `anthropic-`, `anthropics-`, `cc-plugin-` (reserved).
- Manifest `name` == entry `name`.
- `source` an object (`github`, `url`, `git-subdir`); no relative paths.
- Git URLs `https://`.
- No `version` / `ref` / `sha`; no component keys (`skills`, `hooks`,
  `commands`, …) — components live in the plugin.

### 4. Smoke install

```sh
bin/smoke-install <skill>...   # scratch config; clones over the network
```

Exits 2 if `claude` isn't on `PATH`. Never touches your own Claude Code
config.

## After a release

- Version bump only: nothing to do in `skillset`.
- Renamed / re-described / moved skill: regenerate in the project, then
  repeat steps 2-3. A drift check in the project CI (`check-skills-sync`)
  catches stale entries; `--check-member` in `skillset` CI catches a
  member file that no longer matches.
- Each skill's generated `Versions` block tells users how to update:
  `claude plugin marketplace update hop-top`, then
  `claude plugin update <skill>@hop-top`.

## Common mistakes

| Symptom | Cause | Fix |
|---|---|---|
| `bin/assemble` rejects a source | relative path or `http://` | `git-subdir` object with `https://` mirror URL |
| Install pulls the monorepo | entry `url` points at `poly-<name>` | point at the mirror |
| Update doesn't arrive | entry pins `version`/`ref`/`sha` | remove; manifest owns the version |
| Two skills collide | duplicate `name` across members | rename; prefix with org + project |
| Entry stale after rename | member file not regenerated | re-run the generator; `--check-member` |

## See also

- [poly-agent-skills.md](poly-agent-skills.md)
- [release-free-monorepo.md](release-free-monorepo.md)
- `hop-top/skillset` README
