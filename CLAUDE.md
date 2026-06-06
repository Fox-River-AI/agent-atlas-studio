# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

`agent-atlas-studio` is an Erwin-style visual modeler for agentic AI systems. You lay out a whole platform — orchestrator, tasks, agents, MCP tools, jobs, routers, and systems (datastores) — as **one unified, collapsible graph**, validate each object live against the `agent-atlas` JSON schema, and export a versioned registry of YAML manifests.

It runs identically as a static **web build** (GitHub Pages) and a local-first **Tauri 2 desktop app**. No backend, no auth, no cloud dependency.

## Commands

```bash
npm install                 # requires submodule: git submodule update --init
npm run dev                 # web dev server → http://localhost:5173
npm run build               # static build → dist/
npm run preview             # serve the production build
npm run lint                # eslint .
npm run tauri dev           # desktop app (runs `npm run dev` first, loads localhost:5173)
npm run tauri build         # package the desktop app (runs `npm run build` first)
```

There is **no test runner** configured. `npm run lint` (ESLint flat config in `eslint.config.js`) is the only automated check.

The GitHub Pages build sets `BASE_PATH=/agent-atlas-studio/` so assets resolve on the project-pages subpath; dev and the Tauri build use `base: '/'` (see `vite.config.js`).

## The submodule is the source of truth — do not duplicate the schema

`vendor/agent-atlas` is a git **submodule** ([Fox-River-AI/agent-atlas](https://github.com/Fox-River-AI/agent-atlas)) holding the canonical manifest **schema** and deterministic **validators**. The point of vendoring it is that there is exactly **one** copy of the spec, so the UI can never drift from it.

- `src/atlas/schema.js` imports schemas and compiles Ajv validators. The `tool` schema is imported **straight from the submodule** (`vendor/agent-atlas/registry/schema/tool.schema.json`). The `agent`, `job`, `system`, `router`, and `orchestrator` schemas live in `src/atlas/schemas/*.json` — these are **prototyped in-studio for fast iteration and meant to be upstreamed to agent-atlas once proven.** When changing object shapes, edit the studio schema, but treat the submodule tool schema as canonical.
- Schemas declare **JSON Schema draft 2020-12**, so `schema.js` imports `ajv/dist/2020` (the default Ajv export only knows draft-07 and will throw at `compile()`).
- The registry export (`src/atlas/model.js`) is built to satisfy agent-atlas's own `governance/ci/validate_registry.py`, so the same checks that gate the OSS repo gate what this UI produces.

## Architecture

`App.jsx` → `ThemeProvider` → `UnifiedModeler` (the whole app). The unified collapsible graph **is** the product.

### The model lives in `UnifiedModeler.jsx` (the single source of UI state)

`src/atlas/UnifiedModeler.jsx` holds all model state and wires the three panes (`ModelTree`, `UnifiedGraph`, `PropertiesPanel`). Key state shapes:

- `objects` — a **map keyed by id**: `{ [id]: { id, kind, parent, data } }`. `kind` is the object type; `parent` is the nesting/containment established by edges; `data` holds the editable fields.
- `edges` — React-Flow-style `{ id, source, target }`. **Edges encode relationships AND nesting.** Drawing source→target makes the target a child of the source (`parent`). The model layer reads semantics off edges: agent→tool = allowlist, agent→router = dynamic model selection, agent→job / agent→system = uses.
- `expanded` — `{ [id]: bool }` expand/collapse state per node.
- `subjectAreas` — saved views: `{ id, name, taskIds }`. Selecting one filters the whole model down to those tasks + their descendants. `null`/`'all'` = whole model.
- `layouts` — **per-view** node positions: `layouts[viewId][objId] = {x,y}`. Positions live here (not on the object) so selecting a node never re-lays-out the graph. `viewId` is `'all'` or an SA id.
- `viewports` — **per-view** `{x,y,zoom}` pan/zoom, restored on view switch and restart.

### Connection rules — `relationships.js`

`ALLOWED_TARGETS` defines which kinds may connect (orchestrator→task, task→agent/task, agent→tool/job/router/system; tool/job/system/router are **leaves** with no outgoing edges). `connect()` in `UnifiedModeler` rejects invalid edges and shows `connectionReason()`.

### Manifest generation — `model.js`

`manifestFor(node, nodes, edges)` dispatches by type to per-kind builders that read the graph: e.g. `agentManifest` resolves `tools` via `toolsForAgent` (outgoing tool edges), picks `{ router }` over a pinned `model` if a router edge exists; `toolManifest` computes `reused_by` (the inverse — agents whose allowlist includes it) so bidirectional consistency holds by construction. `buildRegistry` returns a `{ path: contents }` map (`registry/agents/*.agent.yaml`, `registry/tools/*.tool.yaml`, `registry/io/*.json` stubs, etc.). **Tasks are orchestration-level grouping and are NOT exported as standalone manifests** — `asNodes` filters out `kind === 'task'`. `validateModel`/`crossChecks` mirror the CI validator (per-node schema + unique ids).

The node shape `manifestFor`/`buildRegistry` expect is `{ id, type, data }` (note `type`, not `kind`) — `UnifiedModeler` adapts objects to that shape via `asNodes` and inline maps.

### Persistence — `persistence.js`

The **whole** model (objects, edges, expanded, subjectAreas, layouts, viewports) is auto-saved (debounced 400ms) and restored on launch.

- **Tauri**: writes a real file `state/model.json` in AppData via `@tauri-apps/plugin-fs`. This is deliberate — WKWebView does **not** reliably persist `localStorage` for the `http://localhost:5173` dev origin across restarts, so localStorage-only persistence silently lost the model. The write target is a subdir (`state/`) so a recursive `mkdir` also creates the AppData base folder, which Tauri does not auto-create.
- **Web**: `localStorage` under key `agent-atlas:model:v1`.
- All IO is **async**. The UI renders the demo seed (`seedModel.js`) first, then hydrates the saved model on mount. A `hydrated` ref gates auto-save so the initial seed render can't clobber a saved file. "Reset to demo" (`clearModel`) wipes the store so the seed loads fresh.

### Tauri-specific gotchas (already worked around — don't reintroduce)

- `window.prompt()` returns `null` in the Tauri webview — use in-app modals instead (the SA editor is a modal for this reason).
- Registry export uses the native Save dialog + `writeFile` in Tauri; the `<a download>` trick is web-only.
- Detect Tauri at runtime via `window.__TAURI_INTERNALS__`. Tauri plugins are imported **dynamically** (`await import(...)`) so the web build never pulls them in.

## Object types (7)

orchestrator (control plane), task (workflow stage / grouping), agent (single-responsibility worker, pinned model or router, refusal + telemetry), tool (typed MCP call boundary, effect read/write/external), job (async work), router (dynamic model selection), system (datastore/external system). `blankData.js` holds the default field values for each; `CREATABLE_KINDS` is the create menu (orchestrator is seeded, not in the menu).

## Roadmap context

Phase 1 (Model — export the registry) is working. Next is **Build handoff**: generate a `CLAUDE.md` contract + `PreToolUse` enforcement hooks from the registry so a coding agent can build the modeled system without violating it. Then **reverse/conformance**: recover the running graph from OpenTelemetry traces and diff vs the registry. See `docs/STATUS.md` for the honest current state.
