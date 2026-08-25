# Generated doc regions

Any doc list that mirrors a fact the code already knows — supported
providers, registered commands, config keys, capability matrices —
drifts the moment someone adds an entry and forgets the docs. The fix
is structural: generate those regions from the code, and gate
staleness in CI.

## The pattern

Three layers, each replaceable on its own:

### 1. Source of truth in code

One metadata table next to the enum or registry it mirrors, pinned to
it by unit tests in both directions: registering a new entry fails the
suite until the table has a row, and a stale row fails when the code
drops one. Presentation strings (display names, description columns)
live in this table — never in the markdown.

### 2. Renderer in-repo

A tiny tool the repo already knows how to run, one subcommand per
fragment:

```bash
go run ./internal/tools/<x>md table
go run ./internal/tools/<x>md config-list
```

Ordering (alphabetical) and line-wrapping (the repo's markdown lint
limits) are the renderer's job, so they are guaranteed by
construction rather than asserted after the fact.

### 3. Injection via cog

[cog](https://github.com/nedbat/cog) (`cogapp` on PyPI) processes
marker pairs and replaces everything between them with the code's
output. Markers are HTML comments — invisible in rendered markdown —
and the output is raw markdown, so rendered tables and prose lists
both work (unlike fence-only injectors):

```markdown
<!-- [[[cog
import subprocess
cog.out(subprocess.check_output(
    ["go", "run", "./internal/tools/<x>md", "table"],
    text=True))
]]] -->
| Adapter | Transport | Purpose |
| ...     | generated, committed | ... |
<!-- [[[end]]] -->
```

Pin the exact version and run it dependency-free via uv:

```makefile
COG := uvx --from cogapp==3.6.0 cog
COG_FILES := README.md docs/<topic>.md

docs-gen: ## Regenerate generated doc regions.
	$(COG) -r $(COG_FILES)

docs-check: ## Fail when generated doc regions are stale.
	$(COG) --check $(COG_FILES)
```

Wire `docs-check` into the repo's lint aggregation target so CI gets
it for free. Generated output is committed: a fresh checkout must
pass `docs-check` without running any toolchain.

## Mechanics that bite

- **Markers cannot live inside a GFM table.** A comment line splits
  the table. Generate the whole table, or a paragraph adjacent to it
  — never a single row.
- **Lint applies to markers and output.** Keep the marker's Python
  multi-line and make the renderer wrap prose under the repo's
  line-length limit.
- **Not everything should be generated.** Surfaces that are judgment
  rather than enumeration — per-item prose sections, curated
  capability matrices — stay hand-written, guarded by a drift test
  that pins their name set and ordering to the same metadata table,
  with shrink-only allowlists for known coverage gaps.
- **Why cog and not the Go-native options:** `mdox` injects into code
  fences only (no rendered tables); `embedmd` embeds file contents
  only (no command output). cog emits arbitrary markdown and has a
  `--check` mode.

## Reference implementation

`hop-top/pod`:

| Piece | Where |
|-------|-------|
| Metadata table + enum-pinning tests | `internal/adapter/meta/` |
| Fragment renderer | `internal/tools/providersmd/` |
| Marked regions | `README.md`, `docs/configuration.md`, `docs/pod/cli-reference.md` |
| Drift gate for hand-written surfaces | `tests/docsync/` |
| Make targets | `docs-gen`, `docs-check` (in `lint`) |
