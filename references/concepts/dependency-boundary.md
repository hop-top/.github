# Dependency boundary: stdlib-only vs `hop.top/kit`

Every new `hop-top` project MUST explicitly evaluate whether to stay
**stdlib-only**, build on **`hop.top/kit`**, or adopt a **hybrid** boundary
before writing implementation code, and MUST record the decision with the
pros and cons considered for each option in an ADR (`docs/adr/0001-*.md`).

Do not treat either option as an unexamined default. Both are first-class
patterns across `hop-top`; picking the wrong one late causes painful rewrites
or accidental dependency bloat for library consumers.

## The three shapes

| Shape | Core library | CLI / app surface | Precedent |
|---|---|---|---|
| **Stdlib-only** | Go/language stdlib only | Stdlib-only (or no CLI) | Pure leaf libraries (`hop.top/uri`, `hop.top/cite`, `hop.top/uma` core) |
| **`hop.top/kit`-based** | Uses `hop.top/kit` primitives | Built on `hop.top/kit/go/console/cli` + `output` + `toolspec` | Standalone CLIs & apps (`hop.top/pod`, `hop.top/tlc`) |
| **Hybrid** | Stdlib-only root module (enforced by a `deps_test.go` check) | Separate `cmd/<tool>` module on `hop.top/kit` (+ optional `contrib/kit` bridge) | Embeddable engines with a first-class CLI (`hop.top/kyx`, `hop.top/uma`) |

## Trade-off matrix (evaluate all three)

### Option A — Stdlib-only everywhere

- **Pros:**
  - Zero third-party transitive dependencies; trivial supply-chain vetting and
    fast cold builds.
  - Maximum embeddability into third-party services with strict dependency
    policies.
  - Decoupled from `hop.top/kit` prerelease cadence and minimum toolchain floor.
- **Cons:**
  - Any CLI must hand-roll flags, help layout, `--format`, `--dry-run`,
    `status`, `capabilities`/toolspec introspection, and structured error
    envelopes — drifting from sibling `hop-top` tools.
  - Harder to pass `hop-top/spec-12fc` (`12fcc`) conformance without
    re-implementing `kit`'s contract layer.
  - Duplicates cross-cutting plumbing (XDG paths, secret stores, policy hooks,
    structured output) that `hop.top/kit` centralizes.

### Option B — `hop.top/kit`-based throughout

- **Pros:**
  - Immediate compliance with the org CLI contract: `status`, `toolspec`
    manifests, `--format table|json|yaml`, tier-driven `--dry-run`,
    `-C`/`-c`/`--offline`, structured `*output.Error` envelopes, deterministic
    exit codes, and `12fcc` grading readiness.
  - Shared runtime building blocks (`xdg`, `secret`, `policy`, `bus`, `blob`)
    with zero glue code.
  - Single module and uniform toolchain version across the repo.
- **Cons:**
  - Pulls `hop.top/kit`'s transitive dependency tree (`cobra`, `viper`,
    `lipgloss`, etc.) and Go version floor into every consumer that imports the
    root module.
  - Poor fit for core packages intended to be embedded inside minimal services
    or strict zero-dependency libraries.

### Option C — Hybrid (stdlib-only core + `hop.top/kit` CLI module)

- **Pros:**
  - Library embedders import the root module with zero external dependencies
    (pinned by a `deps_test.go` guard) and zero `init()` side effects.
  - CLI users and agents still get full `hop.top/kit` ergonomics, `status`,
    `toolspec` capabilities, and `12fcc` conformance from the separate
    `cmd/<tool>` module.
  - Matches `go.work` multi-module isolation already used for optional storage
    and provider adapters (`store/*`, `adapter/*`, `contrib/kit`).
- **Cons:**
  - Multi-module `go.work` setup adds module-tidying and release coordination
    overhead.
  - CLI and `contrib/kit` modules may sit on a newer Go toolchain floor than
    the root library module.
  - Unnecessary ceremony for a standalone CLI application that is never
    imported as a third-party Go library (prefer Option B there).

## Required ADR before scaffolding

Record the choice in `docs/adr/0001-<slug>.md` (linked from `README.md` and
`docs/architecture.md`) during repo bootstrap. The ADR MUST include:

1. **Context & decision drivers** — who consumes the repo (library embedders,
   human CLI operators, AI agents, or both).
2. **Considered options** — explicit **Pros** and **Cons** for **stdlib-only**,
   **`hop.top/kit`-based**, and (when applicable) **hybrid**.
3. **Decision** — the chosen option and the exact module boundary.
4. **Consequences** — enforcement checks (e.g., `deps_test.go` for stdlib-only
   core, `.github/workflows/12fcc.yaml` for `kit` CLIs), Go version floor, and
   upgrade/maintenance trade-offs.

Minimal template:

```markdown
# 0001 — Dependency boundary (<stdlib-only | hop.top/kit | hybrid>)

- Status: Accepted
- Date: YYYY-MM-DD

## Context
<Who consumes this project: Go embedders, standalone CLI operators, agents?>

## Decision drivers
- <embeddability / transitive dependency budget>
- <CLI surface & 12fcc conformance requirements>
- <maintenance & toolchain coupling>

## Considered options

### Option 1 — Stdlib-only
- Pros: ...
- Cons: ...

### Option 2 — `hop.top/kit`-based
- Pros: ...
- Cons: ...

### Option 3 — Hybrid (stdlib-only core + `hop.top/kit` CLI module)
- Pros: ...
- Cons: ...

## Decision
<Chosen option and explicit module/package boundary.>

## Consequences
- <Enforcement: e.g., `deps_test.go`, `12fcc.yaml`, `docs/dependencies.md`>
```

## See also

- [docs/bootstrap-checklist.md](../../docs/bootstrap-checklist.md#0-decide-the-component-layout)
- [docs/adr/0001-release-please-rebase-automation.md](../../docs/adr/0001-release-please-rebase-automation.md) — example ADR shape in this repo
- [CONTRIBUTING.md](../../CONTRIBUTING.md#architecture-decisions-stdlib-only-vs-hoptopkit)
