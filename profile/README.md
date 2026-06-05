# hop.top

Adopt AI agents reliably. Across every role, every department, every team.
Built for agents and humans from day one.

For solo builders shipping a side project, teams replacing manual
workflows, enterprises rolling out agents at scale — many primitives,
in one stack that scales with you.

Standalone packages. Optional composition. Polyglot libraries
(Go, TypeScript, Python, Rust, PHP). CLI apps in the best language
for the job.

**Protocols**: [MCP](https://modelcontextprotocol.io/specification) · [A2A](https://a2a-protocol.org/latest/) · [ACP](https://agentcommunicationprotocol.dev/) · [AGNTCY](https://docs.agntcy.org/) · [gRPC](https://grpc.io/docs/what-is-grpc/) · [REST](https://ics.uci.edu/~fielding/pubs/dissertation/rest_arch_style.htm) · [WebSocket](https://www.rfc-editor.org/rfc/rfc6455) · [SSE](https://html.spec.whatwg.org/multipage/server-sent-events.html) · [Webhook](https://www.standardwebhooks.com/)

**Vendors**: [Anthropic](https://www.anthropic.com), [OpenAI](https://openai.com),
[Google](https://ai.google), [Ollama](https://ollama.com) (models);
[GitHub](https://github.com), [GitLab](https://about.gitlab.com),
[Bitbucket](https://bitbucket.org), [Gitea](https://about.gitea.com) (repos);
[Linear](https://linear.app) (PM) — built in. BYOA: Bring Your Own
Adapter, every interface is yours to implement.

No lock-in.

---

## The stack

Split across seven disciplines — not steps to finish.

| Discipline | Packages |
|---|---|
| **Identity**  | `aps` |
| **Context**   | `ctxt`* · `ibr` · `crm` · `cxr` |
| **Project**   | `tlc` · `wsm` · `git-hop` · `rux` |
| **Quality**   | `ben` · `xrr` · `12fc` · `fit` |
| **Harness**   | `eva` · `rsx` |
| **Interop**   | `stem` · `nerv` · `vein`† · `aim` · `vstar` · `xat` |
| **Toolkit**   | `x402` · `mxhook`* · `xray`* · `foo` · `pod` · `gym` · `rlz` |

<sub>* Affiliated, not hop-top org — `ctxt` (context.help), `mxhook` (mxhook.com), `xray` (xray.codes). † `vein` planned, not yet released.</sub>

Every package is standalone. Adopt one. Adopt a row. Adopt the matrix.
Mix with what you already use; replace what you outgrow.

---

## What it replaces

Seven disciplines, seven incumbents. hop.top doesn't try to be all of them
in one product. It gives you the *piece*, you keep the rest.

| Discipline | Today, you use… | hop.top |
|---|---|---|
| **Identity** | scattered API keys, per-tool config, no agent identity at all | **aps** — verifiable agent profiles (Ed25519), workspace isolation, AGNTCY discovery |
| **Context** | Inkeep, Granola, hand-rolled RAG, OpenClaw's gateway | **ctxt · ibr · crm · cxr** — local-first knowledge, browser capture, contacts, context exchange |
| **Project** | Linear, Jira — your workflow trapped in their UI | **tlc · wsm · git-hop · rux** — tracks, workspaces, worktrees, reactive CLI UX |
| **Quality** | LangSmith, Braintrust, promptfoo — eval coupled to one framework | **ben · xrr · 12fc · fit** — benchmarks, cassette replay, 12-Factor CLI conformance, advisor-model steering |
| **Harness** | Pi, OpenAI Evals, DeepEval — opinionated runner, locked-in shape | **eva** — pluggable harness, BYO model, BYO scoring, BYO surface |
| **Interop** | MCP servers, LangChain adapters, Hermes gateways | **stem · nerv · vein · aim · vstar · xat** — polyglot protocol mirrors, agent-safe model calls, calendar/vCard state, cross-CLI conformance |
| **Toolkit** | PrintingPress, Smithery, MCP registries, Zapier | **x402 · mxhook · xray · foo · pod · gym · rlz** — payments, inbound email, code maps, LLM piping, remote compute, skills, releases |

**hop.top isn't an AI coding agent.** Claude Code, Codex, Gemini CLI,
OpenCode, Aider, Pi, Cline — those are the harness around your model.
hop.top is the *layer that manages them*: verifiable identities (`aps`),
real task workflows (`tlc`), call recording (`xrr`), evaluation (`eva`),
tool integrations (`x402`, `foo`, `pod`, ...).

Whole-stack monoliths — OpenClaw, Hermes, PrintingPress — bundle
opinions for *one* mode. hop.top gives you both: seven discrete packages
you compose à la carte, *and* **hop** — the all-in-one CLI when you want
the bundle. Compose. Or `brew install hop && hop init`. Your call.

---

## Polyglot

One spec. Five runtimes. Parity enforced, not promised.

| Library | Go | TS | Py | Rust | PHP | What it does |
|---|:-:|:-:|:-:|:-:|:-:|---|
| **cite**    | ✓ | ✓ | ✓ | ✓ | ✓ | Custom URI schemes — parse, validate, register |
| **xrr**     | ✓ | ✓ | ✓ | ✓ | ✓ | Multi-channel interaction recorder/replayer |
| **aim**     | ✓ | ✓ | ✓ | ✓ | ✓ | models.dev registry client — agent-safe model lookup |
| **agntcy**  | ✓ | ✓ | ✓ | ✓ | ✓ | SDKs for the AGNTCY identity + discovery standard |
| **c12n**    | ✓ | ✓ | ✓ | ✓ | ✓ | Request classification |
| **stem**    | ✓ | ◐ | ◐ | ◐ | ◐ | AI coding agent agnostic sessions¹ |

<sub>✓ full implementation · ◐ envelope I/O only at v0.1, full runtime planned</sub>
<sub>¹ stem's Go SDK is the reference runtime; other languages parse + serialize crtx envelopes so non-Go services can consume sessions produced by stem.</sub>

Parity is contractual:

- **Cross-language conformance tests** ship in `poly-*/tools/parity/`. Drift breaks CI, not your code.
- **Shared scenario fixtures** mean every SDK answers the same inputs identically — verified by `make test-parity`.
- See the receipts: [`poly-cite/tools/parity`](https://github.com/hop-top/poly-cite/tree/main/tools/parity), [`poly-aim/docs/sdk-parity.md`](https://github.com/hop-top/poly-aim/blob/main/docs/sdk-parity.md).

Framework for building new agent-first CLIs: **[kit](https://github.com/hop-top/poly-kit)** (Go). Use kit when you're starting a new agent-native CLI; use the libraries above when you're adding capability to an existing one.

---

## Catalog

**Libraries** — polyglot (Go, TypeScript, Python, Rust, PHP):
- **[cite](https://github.com/hop-top/poly-cite)** — Custom URI schemes — parse, validate, register
- **[xrr](https://github.com/hop-top/poly-xrr)** — Multi-channel interaction recorder/replayer
- **[aim](https://github.com/hop-top/poly-aim)** — models.dev registry client — agent-safe model lookup
- **[agntcy](https://github.com/hop-top/poly-agntcy)** — Polyglot SDK suite for the AGNTCY Agent Directory Service
- **[c12n](https://github.com/hop-top/poly-c12n)** — LLM request classification — route to right model by signal
- **[stem](https://github.com/hop-top/poly-stem)** — AI coding agent agnostic sessions

**Framework** — for building new agent-first CLIs:
- **[kit](https://github.com/hop-top/poly-kit)** — Polyglot framework for building agent-friendly CLIs

**CLI apps:**
- **[aps](https://github.com/hop-top/aps)** — Local-first agent profile system — isolated profiles for commands and workflows
- **[ben](https://github.com/hop-top/ben)** — General-purpose benchmarking — "which approach is better, and by how much?"
- **[crm](https://github.com/hop-top/crm)** — Customer relationship CLI — vCard contacts, vJournal interactions, pluggable sync
- **[cxr](https://github.com/hop-top/cxr)** — Domain-agnostic dispatch runtime — routes by capability/tool intersection
- **[eva](https://github.com/hop-top/eva)** — Behavioral contract enforcement on AI agent responses — declarative YAML specs
- **[fit](https://github.com/hop-top/fit)** — Train small advisor models to steer black-box LLMs without fine-tuning — polyglot serving + GRPO training, frontier model never modified
- **[foo](https://github.com/hop-top/foo)** — Pipe text through LLMs from the terminal — pattern-based prompts, streaming
- **[git-hop](https://github.com/hop-top/git)** — Multi-branch parallel worktrees — isolated environments, deterministic ports
- **[gym](https://github.com/hop-top/gym)** — Universal package manager for agentskills.io skills
- **[ibr](https://github.com/hop-top/ibr)** — AI-powered instruction parser — natural-language → Playwright actions
- **[inv](https://github.com/hop-top/inv)** — Invoicing-as-a-service — composer + lifecycle, multi-channel core, event-bus interop with fin
- **[pod](https://github.com/hop-top/pod)** — Session, model, and tooling layer on top of any remote compute
- **[rlz](https://github.com/hop-top/rlz)** — Case-YAML → per-AI release pack generator (changelogs, notes, social)
- **[rsx](https://github.com/hop-top/rsx)** — Repo signal extraction — trust, activity, dependency risk
- **[rux](https://github.com/hop-top/rux)** — Interactive Terminal Execution Runtime
- **[tlc](https://github.com/hop-top/tlc)** — Multi-agent task orchestration with Task Line Syntax
- **[upgrade](https://github.com/hop-top/upgrade)** — Self-upgrade library for hop family CLIs — Go package + @hop/upgrade (ESM) + @hop/upgrade-ts
- **[vstar](https://github.com/hop-top/vstar)** — Calendar/vCard-shaped data convention for agentic systems (RFC 5545 + 6350)
- **[wsm](https://github.com/hop-top/wsm)** — Workspace state manager — mutation history, access control, handoffs
- **[x402](https://github.com/hop-top/x402)** — Protocol-agnostic x402 payment module for agent-native wallets
- **[xat](https://github.com/hop-top/xat)** — Cross-Assistant Tester — cross-CLI conformance + regression harness for AI-assistant plugins (Claude Code, Gemini, Codex, OpenCode)
- **[hop](https://github.com/hop-top/hop)** — AI work toolkit

**GitHub Actions:**
- **[12fc](https://github.com/hop-top/spec-12fc)** — Verifies CLI conformance to the 12-Factor AI-CLI spec

**Affiliated** — separate orgs, vanity domains:
- **[ctxt](https://github.com/jadb/ContextHelp)** — Decentralized, local-first context engine *(context.help)*
- **[xray](https://github.com/ideacrafterslabs/oss-xray-codes)** — Codebase mapping *(xray.codes)*
- **[mxhook](https://github.com/mxhook/mxhook)** — Inbound email webhooks *(mxhook.com)*

---

## Governance

- **License** — Most packages MIT; some Apache 2.0; `rlz` under BSL-1.1. See each repo's LICENSE for specifics.
- **Releases** — release-please + Conventional Commits. Rolling major tags. Published to npm, PyPI, crates.io, Packagist, Go vanity.
- **Cadence** — Independent per-package. Each ships when ready; no linked-version coupling.
- **Stability** — Pre-1.0 packages carry visible warnings. v1+ packages follow semver strictly.
- **Security** — security@ideacrafters.com · [`SECURITY.md`](https://github.com/hop-top/.github/blob/main/SECURITY.md)

---

## Links

**[hop.top →](https://hop.top)** — full catalog, docs, install paths

Community: [Contributing](https://github.com/hop-top/.github/blob/main/CONTRIBUTING.md) · [Security](https://github.com/hop-top/.github/blob/main/SECURITY.md) · [Code of Conduct](https://github.com/hop-top/.github/blob/main/CODE_OF_CONDUCT.md)

hop.top is sponsored by [Idea Crafters](https://ideacrafters.com) & [Experts AI](https://lesexperts.ai).
