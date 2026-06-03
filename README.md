# agent-atlas-studio

**Visual modeler for agentic AI systems — design your fleet, validate it live, export a registry.**

`agent-atlas-studio` is the visual front end for
[`agent-atlas`](https://github.com/Fox-River-AI/agent-atlas): lay out your agents
and tools on a canvas, draw the tool-allowlist edges between them, and export a
version-controlled registry that `agent-atlas`'s own validator accepts. It is the
*forward-engineering* half of an Erwin-style loop for agent fleets — design
visually, generate the spec.

## What it does today

- **Model** — drag Agent and Tool nodes onto a canvas; connect an agent to the
  tools it is allowed to call.
- **Validate live** — every node is checked in-browser against the `agent-atlas`
  JSON schema (single responsibility, pinned model, refusal as a first-class
  output, typed I/O, tool effect class). The status flips red the moment the
  model stops being valid.
- **Export** — produce the registry (`*.agent.yaml`, `*.tool.yaml`, `io/*.json`).
  The agent's `tools` allowlist and each tool's `reused_by` are computed from the
  same edges, so they are consistent by construction — which is what surfaces
  redundant, near-duplicate agents.

## How it relates to agent-atlas

`agent-atlas` is the open engine: the manifest **schema** (the single source of
truth) and the deterministic **validators**. This repo vendors it as a git
submodule and imports the schema directly — there is exactly one copy, so the UI
can never drift from the spec.

```
agent-atlas (engine: schema + validators)  ──submodule──▶  agent-atlas-studio (this: the UI)
```

## Run it

```bash
git clone --recurse-submodules https://github.com/Fox-River-AI/agent-atlas-studio.git
cd agent-atlas-studio
npm install
npm run dev          # web build, http://localhost:5173
```

(If you cloned without `--recurse-submodules`: `git submodule update --init`.)

The same React app is built to run as a Tauri desktop application (local-first,
filesystem access) — that shell is on the roadmap below.

## Roadmap

- **Forward** — model → registry + scaffolding. *(working)*
- **Build handoff** — generate the bundle a coding agent (e.g. Claude Code) needs
  to build the modeled system: registry + `CLAUDE.md` + enforcement hooks. *(next)*
- **Reverse + conformance** — recover the running agent/tool graph from
  OpenTelemetry traces and diff it against the declared registry, to show where
  reality has drifted from the design. *(planned)*

## License

Apache-2.0 © Fox River AI
