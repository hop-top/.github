# hop.top

> **AI-native building blocks: composable, interoperable, event-driven, deterministic, and agnostic.**

hop.top started out of a practical problem: long before coding agents had loops, hooks, or standard tool protocols, teams struggled to adopt LLMs because every model provider, IDE, and agent CLI had its own config format, context rules, and lock-in. What began as a way to centralize conventions, context, and workflows across startup builds at [Idea Crafters](https://ideacrafters.com) expanded through real enterprise AI deployments at [Experts AI](https://lesexperts.ai) into a broader thesis: **when software and business operations become AI-native, you don't want another monolith — you want sharp, interoperable Legos built on shared contracts.**

- **Deterministic.** Agents are probabilistic; your workflow doesn't have to be. Behavioral contracts (`eva`), conformance gates (`spec-12fc`, `xat`), cassette replay (`xrr`), and statistically gated evolution (`evol`) keep agent work reproducible and reviewable.
- **Agnostic.** Not another coding agent, model provider, IDE, or issue tracker. Claude Code, Codex, Gemini CLI, OpenCode; Anthropic, OpenAI, Google, Ollama; GitHub, GitLab, Gitea, Linear — hop.top manages the layer around what you already run. BYOA: Bring Your Own Adapter.
- **Composable.** Adopt one brick, a layer, or the whole stack. Every tool keeps its own store and runs standalone; they connect through thin shared contracts (identities, custom URIs, events, and adapter ports), never a shared database.
- **Event-driven.** Tools publish and react to events instead of polling each other, so humans and agent teams coordinate across codebases and business systems without stepping on each other.
- **Interoperable & polyglot.** Build on [`poly-kit`](https://github.com/hop-top/poly-kit) and a tool inherits the entire shared runtime — CLI & console, layered config, logging, storage, secrets, event bus, guardrails, telemetry, conformance, and a 13-surface command bridge (CLI, REST, gRPC, MCP, WebSocket, SSE, Bus, Cron, Webhook, FaaS, and more). Shared primitives ship across Go, TypeScript, Python, Rust, and PHP with cross-language parity enforced in CI. Local-first: your data, your machine.

**Protocols:** [MCP](https://modelcontextprotocol.io/specification) · [A2A](https://a2a-protocol.org/latest/) · [ACP](https://agentclientprotocol.com/) · [AGNTCY](https://docs.agntcy.org/) · [gRPC](https://grpc.io/docs/what-is-grpc/) · [REST](https://ics.uci.edu/~fielding/pubs/dissertation/rest_arch_style.htm) · [WebSocket](https://www.rfc-editor.org/rfc/rfc6455) · [SSE](https://html.spec.whatwg.org/multipage/server-sent-events.html) · [CloudEvents](https://cloudevents.io/) · [Webhook](https://www.standardwebhooks.com/) · [RFC 5545 / 6350](https://github.com/hop-top/poly-vstar)

---

## Architecture: six composable layers

Every standalone building block sits in one of six layers — from shared specs at the base to agent-native workflows and operations at the top. **[`hop`](https://github.com/hop-top/hop)** sits above all six in a class of its own: the opinionated, all-in-one CLI that wraps and composes these blocks alongside best-in-class third-party tools.

| Layer | Role | Projects |
|---|---|---|
| **0 · Specs & Contracts** | Shared conventions so CLIs, sessions, workspaces, schedules, adapters, and admission gates interlock | `spec-12fc` · `spec-crtx` · `spec-owsf` · `spec-vstar` · `spec-pact` · `poly-deco` · `spec-accc` |
| **1 · Polyglot Substrate** | Shared primitives imported across languages (CLI/service runtime, URIs, cassette replay, model lookup, classification, trust, speech, payments) | `poly-kit` · `poly-cite` · `poly-xrr` · `poly-aim` · `poly-c12n` · `poly-pact` · `poly-agntcy` · `cxr` · `poly-stt` · `x402` |
| **2 · Identity, CLI Interop & Dev Env** | Isolated agent profiles, write-once cross-CLI hooks, skills packaging, portable sessions, isolated worktrees, terminal/desktop surfaces | `aps` · `poly-nerv` · `poly-axon` · `wsm` · `poly-stem` · `poly-vein` · `git-hop` · `tip` · `bar` · `rlz` · `gym` · `rux` · `hsd` · `pod` · `dek` · `stk` |
| **3 · Context & Signal** | Bounded, high-signal inputs instead of raw dumps — code maps, CLI doc harvesting, browser extraction, MCP response trimming, document normalization, knowledge graphs | `xray` · `ibr` · `foo` · `hdox` · `mdx` · `tab` · `cl0` · `yta` · `ytx` · `ctxt`* · `trimmcp`* |
| **4 · Quality, Routing & Self-Improvement** | Deterministic verification, dependency vetting, benchmarking, quality routing, advisor steering, and statistically gated evolution | `eva` · `ben` · `evol` · `fit` · `rsx` · `xat` · `par` · `mdl` · `routellm`* |
| **5 · Coordination, Comms & Ops** | Multi-agent tasks, durable workflows, omnichannel messaging, ledgers, invoicing, CRM, and org runtimes | `tlc` · `uma` · `heo` · `inv` · `flo` · `fin` · `crm` · `aom` · `orb` · `agr` · `mas` · `mxhook`* |

<sub>* Affiliated, separate org — `ctxt` ([ContextHelp](https://github.com/ContextHelp/ContextHelp), context.help), `mxhook` ([MXHook](https://github.com/MXHook/MXHook), mxhook.com), `routellm` ([IdeaCraftersHQ/RouteLLM](https://github.com/IdeaCraftersHQ/RouteLLM)), `trimmcp` ([TrimMCP](https://github.com/TrimMCP/TrimMCP), trimmcp.com).</sub>

---

## How the Legos snap together

Every brick works alone. Together, they remove the glue code teams otherwise rebuild over and over:

1. **Build an agent-native tool in any language.**
   Start on `poly-kit` (CLI, logging, layered config, storage, secrets, event bus, guardrails, telemetry, self-upgrade, conformance, and 13 transport surfaces), give records portable addresses with `poly-cite`, record/replay external calls in CI with `poly-xrr`, vet third-party dependencies with `rsx`, and gate PRs with `spec-12fc`. The same contract holds whether the tool is written in Go, TypeScript (`xray`, `ibr`), or Rust (`bar`, `fin`, `mdx`).

2. **Run and continuously improve a multi-CLI engineering team.**
   Give each agent an isolated identity, secrets, and sandbox with `aps`; install and progressively load reusable `agentskills.io` capabilities with `gym`; compile engagement-specific rules of engagement from `ctxt`/`aom` into per-role `SKILL.md` frames and matching `contract.eva.yaml` gates with `rlz`; enforce one set of guardrails across Claude Code, Codex, Gemini CLI, and OpenCode with `poly-nerv` + `poly-axon`; isolate parallel branches with `git-hop`; coordinate humans and agents through `tlc` (backed by `flo`'s workflow spec and `eva` gates); feed bounded codebase maps via `xray`; route calls and collect traces via `routellm`; then benchmark (`ben`), statistically evolve prompts/skills/configs (`evol`), train small advisor models to steer frontier LLMs (`fit`), and regression-test assistant plugins across CLIs (`xat`) — or compose the stack under `hop`.

3. **Connect agents to real communications, workflows, and business ops.**
   Handle email, chat, messaging, web widgets, and A2A through one embeddable engine (`uma` + `heo`, plus `mxhook` for inbound SMTP); prove *who* an agent acts for and *why* on top of existing auth with `poly-pact`; convert multi-format files and records into strict, permission-aware MDX for indexing with `mdx` and queryable semantic knowledge with `ctxt`; run durable workflows standalone or embedded inside tools like `tlc` and `ctxt` via `flo`; and handle calendar/contact semantics (`poly-vstar`), invoicing (`inv`), ledgers (`fin`), and contacts (`crm`) over shared events.

**hop.top isn't another coding agent or locked-in monolith.** Claude Code, Codex, Gemini CLI, OpenCode, and Aider are harnesses around your model. hop.top gives you both paths: compose the standalone bricks à la carte, or use **[`hop`](https://github.com/hop-top/hop)** — the opinionated all-in-one operating layer that wraps these blocks alongside third-party tools you already trust.

---

## Polyglot

One specification. Multiple runtimes. Parity enforced by CI, not promised in docs.

| Library | Go | TS | Py | Rust | PHP | What it does |
|---|:-:|:-:|:-:|:-:|:-:|---|
| **[kit](https://github.com/hop-top/poly-kit)** | ✓ | ✓ | ✓ | ✓ | ◐ | Polyglot CLI & multi-surface runtime framework (console, logging, config, storage, secrets, bus, guardrails, toolspec, telemetry, upgrade, conformance) |
| **[cite](https://github.com/hop-top/poly-cite)** | ✓ | ✓ | ✓ | ✓ | ✓ | Custom URI schemes — parse, validate, register, complete |
| **[xrr](https://github.com/hop-top/poly-xrr)** | ✓ | ✓ | ✓ | ✓ | ✓ | Multi-channel interaction recorder/replayer (exec, HTTP, gRPC, Redis, SQL, fs) |
| **[aim](https://github.com/hop-top/poly-aim)** | ✓ | ✓ | ✓ | ✓ | ✓ | `models.dev` registry CLI & SDK — agent-safe model lookup |
| **[c12n](https://github.com/hop-top/poly-c12n)** | ✓ | ✓ | ✓ | ✓ | ✓ | 20-signal LLM request classification for cost/capability routing |
| **[pact](https://github.com/hop-top/poly-pact)** | ✓ | ✓ | ✓ | ✓ | ✓ | Purpose-bound Access Control & Trust — agents prove who they act for and why |
| **[vstar](https://github.com/hop-top/poly-vstar)** | ✓ | ✓ | ✓ | ✓ | ✓ | Calendar/vCard (RFC 5545 + 6350) semantics for agentic time, people & schedules |
| **[agntcy](https://github.com/hop-top/poly-agntcy)** | ✓ | ✓ | ✓ | ✓ | ✓ | SDK suite for the AGNTCY Agent Directory Service (DIR) |
| **[fit](https://github.com/hop-top/fit)** | ✓ | ✓ | ✓ | ✓ | ✓ | Advisor-model serving & trace layer to steer black-box LLMs without fine-tuning (GRPO training in Python) |
| **[nerv](https://github.com/hop-top/poly-nerv)** | ✓ | ✓ | ✓ | ✓ | ✓ | Write one hook, run it on every AI coding CLI (+ Shell SDK) |
| **[stem](https://github.com/hop-top/poly-stem)** | ✓ | ◐ | ◐ | ◐ | ◐ | AI coding agent runtime implementing `crtx`¹ |
| **[axon](https://github.com/hop-top/poly-axon)** | ✓ | ✓ | ✓ | — | — | Host-CLI contract for AI-assistant hooks: event maps, envelopes, decision shapes |
| **[deco](https://github.com/hop-top/poly-deco)** | ✓ | ✓ | ✓ | — | — | Consumer-owned dependency contracts, adapters & verifiable replacement |
| **[stt](https://github.com/hop-top/poly-stt)** | ✓ | ✓ | — | — | — | OS-agnostic speech-to-text daemon & client contracts |

<sub>✓ implemented · ◐ experimental or envelope I/O only. ¹ `stem`'s Go SDK is the reference runtime; other languages parse/serialize `crtx` envelopes.</sub>

Parity is contractual:

- **Cross-language conformance tests** ship in `poly-*/tools/parity/` (and `poly-kit/contracts/parity/`). Drift breaks CI, not downstream consumers.
- **Shared scenario fixtures** guarantee every SDK answers identical inputs identically (`make test-parity`).
- Receipts: [`poly-cite/tools/parity`](https://github.com/hop-top/poly-cite/tree/main/tools/parity) · [`poly-aim/docs/sdk-parity.md`](https://github.com/hop-top/poly-aim/blob/main/docs/sdk-parity.md) · [`poly-kit/docs/adopters/reference/capability-parity.md`](https://github.com/hop-top/poly-kit/blob/main/docs/adopters/reference/capability-parity.md).

---

## Catalog

### All-in-One
- **[hop](https://github.com/hop-top/hop)** — Opinionated, local-first all-in-one operating layer that wraps and composes hop.top building blocks alongside best-in-class third-party tools into one coherent workflow

### Layer 0 — Specs & Contracts
- **[spec-12fc](https://github.com/hop-top/spec-12fc)** — 12-Factor AI-CLI specification and CI conformance GitHub Action
- **[spec-crtx](https://github.com/hop-top/spec-crtx)** — Language-agnostic specification for AI agent conversations (`crtx`, pronounced "cortex")
- **[spec-owsf](https://github.com/hop-top/spec-owsf)** — Open Workspace Schema Framework — portable, append-only workspace artifact model for continuity, replay, handoff, and forking
- **[spec-vstar](https://github.com/hop-top/spec-vstar)** — V\* specification: iCalendar (RFC 5545) + vCard (RFC 6350) conventions for agentic state (canonical source in [poly-vstar](https://github.com/hop-top/poly-vstar))
- **[spec-pact](https://github.com/hop-top/poly-pact/tree/main/spec/v1.0)** — PACT v1.0 gateway admission & trust specification (canonical source in [poly-pact](https://github.com/hop-top/poly-pact); standalone mirror planned)
- **[poly-deco](https://github.com/hop-top/poly-deco)** — Own the contract, choose the implementation: consumer-owned dependency contracts, adapters, and evidence-based replacement
- **[spec-accc](https://github.com/hop-top/spec-accc)** — Agent Companies conformance checks — implementation-neutral fixtures, adapter runner, and CI gate for `agentcompanies/v1`

### Layer 1 — Polyglot Substrate
- **[kit](https://github.com/hop-top/poly-kit)** — Polyglot framework for building agent-friendly CLIs and services across 6 capability domains:
  - *CLI & console:* command factory, flags, help, aliases, shell completions, autocorrect, structured output & exit taxonomy, logging, TUI/progress/wizards, Markdown rendering, URI dispatch
  - *Config, storage & secrets:* layered config, XDG paths, project registry, KV, blob, SQLite/JSON store, HTTP cache, secrets (9 backends)
  - *Serving & transports:* 13-surface command bridge (CLI, REST/OpenAPI, Connect/gRPC, MCP, Unix socket, WS, SSE, Bus, Cron, Library, Webhook, OAuth callback, Signed URL, FaaS), authn, observability
  - *Runtime & coordination:* event bus, background jobs, sync, policy, peer/domain primitives, provenance, side-effect guards, consenting telemetry, notifications
  - *Core & guardrails:* TypeIDs, identity, path scoping, egress redaction, netpolicy, circuit breakers, operating stages, consent/compliance, self-upgrade
  - *AI & conformance:* LLM routing (via `aim`), `toolspec` (machine-readable tool specs), prompt/judge/extension hooks, `xrr`-backed conformance harness, story & scenario DSLs, leak verification, 12-Factor badge generation, OS bridge protocol
  - *Extensions:* **[kit-bridges-shells](https://github.com/hop-top/kit-bridges-shells)** — native OS-side adapters (Share Extension, Shortcut, browser ext, tray) for the `kit/bridge` protocol
- **[cite](https://github.com/hop-top/poly-cite)** — Polyglot custom URI toolkit (`<scheme>://<namespace>/<id>`): parse, validate, register, complete
- **[xrr](https://github.com/hop-top/poly-xrr)** — Cross-Runtime Recorder: language-agnostic YAML cassette recorder/replayer for exec, HTTP, gRPC, Redis, SQL, and fs
- **[aim](https://github.com/hop-top/poly-aim)** — AI model registry CLI & polyglot SDKs querying `models.dev` with 12-factor agent-safe contracts
- **[c12n](https://github.com/hop-top/poly-c12n)** — Signal-based LLM request classification engine for routing to the right model
- **[pact](https://github.com/hop-top/poly-pact)** — Purpose-bound Access Control & Trust: AI agents prove who they act for and why on every request, layered over existing auth (HTTP Basic, OAuth, LDAP, Entra, Kubernetes, AWS)
- **[agntcy](https://github.com/hop-top/poly-agntcy)** — Polyglot SDK suite for the AGNTCY Agent Directory Service
- **[cxr](https://github.com/hop-top/cxr)** — Capability eXecution Router — domain-agnostic dispatch runtime routing by capability/tool intersection with transparent `xrr` record/replay
- **[stt](https://github.com/hop-top/poly-stt)** — OS-agnostic speech-to-text daemon, CLI, and polyglot client contracts
- **[x402](https://github.com/hop-top/x402)** — Protocol-agnostic x402 payment module for agent-native wallets across EVM, MCP, and A2A

### Layer 2 — Identity, Coding-CLI Interop & Dev Environment
- **[aps](https://github.com/hop-top/aps)** — Agent Profile System — isolated profiles, credentials, process/platform/container sandboxes, ACP server, and external-CLI bridging (Claude, Codex, Gemini, OpenCode)
- **[nerv](https://github.com/hop-top/poly-nerv)** — Universal Hooks Protocol — write one hook/guardrail, run it on every AI coding CLI
- **[axon](https://github.com/hop-top/poly-axon)** — Host-CLI contract for AI-assistant hooks: identity, event maps, envelope, and decision shapes per CLI
- **[wsm](https://github.com/hop-top/wsm)** — Workspace & Session Manager — IDE-agnostic session storage and workspace state across assistants
- **[stem](https://github.com/hop-top/poly-stem)** — Polyglot AI agent runtime implementing `crtx`
- **[vein](https://github.com/hop-top/poly-vein)** — Find any coding session across any AI assistant in one command
- **[git-hop](https://github.com/hop-top/git)** — Deterministic, isolated multi-branch git worktree wrapper with persistent per-branch ports and volumes
- **[tip](https://github.com/hop-top/tip)** — Shell observation layer feeding ambient, contextual CLI hints to humans and AI agents
- **[bar](https://github.com/hop-top/bar)** — Extensible Claude Code status line: drop any `bar-<name>` script on `PATH` and it becomes a cached placeholder
- **[rlz](https://github.com/hop-top/rlz)** — Rules-of-engagement pack assembler — compiles a case YAML (with blocks from filesystem, `ctxt`, or `aom`) into per-collaborator `SKILL.md` operating frames, handoff/task policies, and matching `contract.eva.yaml` contracts for `eva`
- **[gym](https://github.com/hop-top/gym)** — Universal package manager for `agentskills.io` skills — curated/URL installs, `skills-ref test` validation, scope-aware upgrades, and token-efficient progressive disclosure (`warmup`)
- **[rux](https://github.com/hop-top/rux)** — Deterministic Interactive Terminal Execution Runtime — abstracts PTY and tmux for programmatic control of terminal apps and AI CLIs
- **[hsd](https://github.com/hop-top/hsd)** — Harness session supervisor — owns session journal, API, and containment beside coding-agent harnesses
- **[pod](https://github.com/hop-top/pod)** — Session, model, and tooling layer on top of any remote compute
- **[dek](https://github.com/hop-top/dek)** — Agent-first desktop shell with tmux-style tiling panes — the agent proposes, the operator decides
- **[stk](https://github.com/hop-top/stk)** — Watches tmux panes for blocking AI-agent prompts and surfaces an interactive confirmation UI

### Layer 3 — Context & Signal Extraction
- **[xray](https://github.com/hop-top/xray)** — AST + PageRank codebase mapper generating ranked, chunked, context-window-sized maps across 17 languages, IaC, CI/CD, and frameworks
- **[ibr](https://github.com/hop-top/ibr)** — Intent Browser Runtime — translates natural-language instructions into resilient Playwright actions and structured extraction
- **[foo](https://github.com/hop-top/foo)** — Pipe text through LLMs from the terminal with pattern-based prompts, streaming, and plugins
- **[hdox](https://github.com/hop-top/hdox)** — CLI documentation harvester turning any installed binary's live `--help`, `man`, and providers into a structured knowledge base
- **[mdx](https://github.com/hop-top/mdx)** — Converts any file or record (PDF, Office, HTML, text, CSV, images, audio, video, email, meeting transcripts, CRM records) into one strict, permission-aware MDX document per item for human and agent indexing (with `pact` admission)
- **[tab](https://github.com/hop-top/tab)** — LLM-powered semantic browser tab grouping for context enrichment
- **[cl0](https://github.com/hop-top/cl0)** — Ground-truth discovery engine reconstructing `SurfaceSpec` contracts from web, binary, network, and MCP surfaces
- **[yta](https://github.com/hop-top/yta)** — Tracks topic mentions, links, and sentiment across YouTube creators over time
- **[ytx](https://github.com/hop-top/ytx)** — YouTube comment signal extraction

### Layer 4 — Quality, Routing & Self-Improvement
- **[eva](https://github.com/hop-top/eva)** — Enforcement & Validation for Agents — deterministic binary pass/fail enforcement of declarative YAML behavioral contracts (CLI + live gateway proxy)
- **[ben](https://github.com/hop-top/ben)** — General-purpose benchmarking — answers *"which approach is better, and by how much?"* across tools, implementations, deps, LLM calls, and agents
- **[evol](https://github.com/hop-top/evol)** — Statistically gated evolution of agent skills, prompts, commands, and tool configs — promotes only revisions clearing mean threshold and paired-bootstrap significance
- **[fit](https://github.com/hop-top/fit)** — Polyglot advisor-model serving + GRPO training pipeline — trains small advisors on scored traces to steer black-box frontier LLMs without fine-tuning
- **[rsx](https://github.com/hop-top/rsx)** — Repo Signal Extraction — assesses repository health, maintenance signals, adoption clues, and policy fit before adopting a dependency
- **[xat](https://github.com/hop-top/xat)** — Cross-Assistant Tester — cross-CLI conformance and regression harness for AI-assistant plugins, hooks, skills, and commands (Claude Code, Gemini, Codex, OpenCode)
- **[par](https://github.com/hop-top/par)** — Policy-driven parity auditor for containerized repositories (Dockerfiles, Compose, dev/prod drift, secrets)
- **[mdl](https://github.com/hop-top/mdl)** — Discover, compare, route, and benchmark AI models across providers

### Layer 5 — Coordination, Comms & Business Operations
- **[tlc](https://github.com/hop-top/tlc)** — Multi-agent task & recipe orchestration: human-editable `todo.txt` (Task Line Syntax) synced with SQLite, versioned YAML recipes (built on `flo/spec`) with `eva` gates and approvals, claiming/leases, and bidirectional GitHub/Linear/Jira sync
- **[flo](https://github.com/hop-top/flo)** — Standalone and embeddable durable workflow spec & engine: versioned flow bundles, triggers, human approvals, `eva` gates, LLM-assisted drafting, and sandboxed `xrr` dry-run/replay — runs independently or powers workflow/recipe execution inside tools like `tlc` and `ctxt`
- **[uma](https://github.com/hop-top/uma)** — Universal mailbox: embeddable Go messaging engine across email, Slack, Discord, Teams, Telegram, WhatsApp/SMS/relay, web widget, and A2A 1.0
- **[heo](https://github.com/hop-top/heo)** — Messaging CLI and daemon for `uma`: unified inbox, replies, and recovery from the terminal
- **[inv](https://github.com/hop-top/inv)** — Local-first, agent-native invoicing-as-a-service: composer + lifecycle (`draft → paid/credited`), multi-channel core, event-bus interop with `fin`
- **[fin](https://github.com/hop-top/fin)** — Terminal-first auditable financial ledger runtime with layered capability composition
- **[crm](https://github.com/hop-top/crm)** — Customer relationship CLI: vCard contacts, vJournal interactions, pluggable JSON/SQL/CalDAV sync
- **[aom](https://github.com/hop-top/aom)** — Adaptive Organizational Model Compiler — models organizations as directed graphs of actors, activities, assets, authority, constraints, flows, and knowhow
- **[orb](https://github.com/hop-top/orb)** — Graph-native, policy-driven runtime for modeling and operating organizations as living worlds of humans, AI agents, and processes
- **[agr](https://github.com/hop-top/agr)** — Agent Game Runtime — V\*-native, temporal, event-sourced multi-agent orchestration runtime
- **[mas](https://github.com/hop-top/mas)** — Mission-Aware AI Signal Agent — channel-agnostic design for continuous agent execution across operational and workflow signals

### Affiliated
Separate organizations and domains that integrate natively with the stack:
- **[ctxt](https://github.com/ContextHelp/ContextHelp)** — Decentralized, local-first semantic context engine and knowledge graph ([context.help](https://context.help))
- **[mxhook](https://github.com/MXHook/MXHook)** — Self-hosted inbound email processing: SMTP or Maildir in, signed JSON webhooks out ([mxhook.com](https://mxhook.com))
- **[routellm](https://github.com/IdeaCraftersHQ/RouteLLM)** — Probabilistic quality & intent-based LLM router (OpenAI-compatible) with auto-retry, circuit breakers, semantic caching, canary testing, `fit`-format trace collection, and `eva` hooks
- **[trimmcp](https://github.com/TrimMCP/TrimMCP)** — Transparent MCP proxy that reduces MCP response sizes by 60–85% while maintaining protocol compatibility ([trimmcp.com](https://trimmcp.com))

---

## Governance

- **License** — Open source; see each repository's `LICENSE` for specifics.
- **Releases** — release-please + Conventional Commits. Rolling major tags. Published to npm, PyPI, crates.io, Packagist, and Go vanity (`hop.top/<pkg>`).
- **Cadence** — Independent per-package: each ships when ready. A linked family (an SDK and its language ports) moves together only on a new major, and on a new minor while pre-1.0; patches, and minors from 1.0, ship per package.
- **Stability** — Active development across the board: usable today, with rough edges as features evolve. v1+ packages follow semver strictly.
- **Security** — security@hop.top · [`SECURITY.md`](https://github.com/hop-top/.github/blob/main/SECURITY.md)

---

## Links

**[hop.top →](https://hop.top)** — catalog, docs, Go vanity imports, install paths

Community: [Contributing](https://github.com/hop-top/.github/blob/main/CONTRIBUTING.md) · [Security](https://github.com/hop-top/.github/blob/main/SECURITY.md) · [Code of Conduct](https://github.com/hop-top/.github/blob/main/CODE_OF_CONDUCT.md)

hop.top is sponsored by [Idea Crafters](https://ideacrafters.com) & [Experts AI](https://lesexperts.ai).
