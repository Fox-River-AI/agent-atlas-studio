# Status & Roadmap

_Last updated: 2026-06-03_

A snapshot of what `agent-atlas-studio` does today and where it's going. The
README has the pitch; this is the honest engineering state.

## The loop

The studio is the visual front of an Erwin-style loop for agentic platforms:

```
        ┌─────────── MODEL ───────────┐
        │  design the platform        │   ✅ working
        ▼                             │
   registry (source of truth)         │
        │                             │
        ▼                             │
   BUILD HANDOFF                       │   🔜 next
   registry → CLAUDE.md + hooks → code │
        │                             │
        ▼                             │
   running system                     │
        │                             │
        ▼                             │
   REVERSE + CONFORMANCE  ────────────┘   📋 planned
   recover the graph, diff vs the model
```

The model is the **spec**, `CLAUDE.md` is the **contract**, the hooks are the
**enforcement**, and conformance proves the model is *true* — not just drawn.

## ✅ Working today

**One unified, collapsible model.** Seven first-class object types in a single
hierarchical graph (not separate canvases): drill in by expand/collapse; leaves
(tool/job/system/router) terminate; selecting any object shows its typed
properties.

| Object | Role | What it becomes when built |
|---|---|---|
| **Orchestrator** | the single control plane — decides which task/agent runs, in what order, on what condition; externalizes run state | the control-flow code (state machine / DAG) |
| **Task** | a stage of the workflow that groups the agents carrying it out | a step *within* the orchestrator's flow |
| **Agent** | single-responsibility worker; pinned model; refusal as a first-class output; declared telemetry | an agent module honoring its manifest |
| **MCP Tool** | the typed, audited call boundary (effect: read / write / external) | a tool integration |
| **Job** | long-running / async work (queue, timeout, retries) | a queued task definition |
| **Router** | dynamic model selection — candidate models + a routing policy (complexity / quality / cost) | the model-selection policy |
| **System** | datastores & external systems agents touch (DB, vector store, graph/ontology store, FHIR, interface engine) | a client / connection config |

- **Create-then-connect** (Erwin-style): create an object, then draw an edge —
  the edge establishes the relationship *and* the nesting. Connections are
  rule-checked (e.g. an orchestrator connects to tasks; an agent to tools / jobs
  / routers / systems; leaves have no outgoing).
- **Subject Areas** — saved views that filter the whole platform down to one
  slice (the orchestrator is context, hidden inside an SA). Switch back to "All"
  for the whole model.
- **Live validation** — every object is checked against the open `agent-atlas`
  JSON schema as you edit; invalid objects are flagged in the tree, and a
  plain-language issue list names what's missing and jumps you to it.
- **Registry export** — versioned manifests (`*.orchestrator.yaml`,
  `*.agent.yaml`, `*.tool.yaml`, `*.job.yaml`, `*.router.yaml`,
  `*.system.yaml`). Tasks are orchestration-level grouping and are not exported
  as standalone manifests.
- **Runs two ways** — a static **web build** (try it in a browser, no install)
  and a **Tauri 2 desktop app** (local-first; writes the registry to disk via a
  native save dialog). Themes (dark / high-contrast / light) and scalable type.

## 🔜 Next — Build handoff (registry → CLAUDE.md → code)

Generate the bundle a coding agent (e.g. Claude Code) needs to *build* the
modeled system:

- The **registry** of manifests (exported today).
- A generated **`CLAUDE.md`** — the contract: "the registry is the source of
  truth; for each agent manifest build `src/agents/<id>` implementing its
  responsibility, calling only its allowlisted tools, pinned to its model, with
  its refusal conditions and telemetry."
- **`PreToolUse` enforcement hooks** — so a coding agent *cannot* write an agent
  with no manifest, or give it a tool outside its allowlist. (The `agent-atlas`
  engine already ships these governance templates.)

This is the "model → platform" payoff: design visually, hand a coding agent a
contract it's structurally prevented from violating.

## 📋 Planned — Reverse engineering & conformance

Point the tool at a *running* system, recover its actual agent/tool graph from
its telemetry (OpenTelemetry GenAI traces), and **diff it against the declared
registry** — surfacing where reality has drifted from the design. This is what
turns a one-time generator into a system of record: it proves the model is true.

## Smaller backlog

- Stubs + "Show Stubs" — a shared object referenced from outside a Subject Area
  renders as a hoverable foreign-reference.
- Multi-select + drag-move, for rearranging large models.

## Architecture notes

- **`agent-atlas` is the engine** (the manifest schema + deterministic
  validators); this repo vendors it as a git submodule and imports the schema
  directly, so the modeler can never drift from the spec.
- Stack: **Vite + React 19**, packaged with **Tauri 2**, no cloud dependency.
- The web demo is the full modeler minus desktop-only capabilities (writing
  registries to disk, and the local Claude Code build handoff) — the standard
  free-demo-vs-local-tool split.
