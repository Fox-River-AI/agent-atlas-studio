# Object Semantics — what each kind *is*, and what it *does*

**Status:** Authoritative reference (updated 2026-06-17). Defines the meaning of the seven
**component** object kinds (the SYSTEM) **and the separate CONTROLS layer — the `gate`**
(controls over the system's consequential transitions) — and the hierarchy between them.
This is the contract that **DIAG-15 (codegen)**, **DIAG-37 (requirements→model generation)**,
and the modeling UX (the "Add child" menu, the create parent-picker, field help) build
against. If the rules in `src/atlas/relationships.js` and this doc ever disagree,
reconcile them — they must stay in sync.

> **Two axes.** The seven component kinds describe the *system* (what runs). The controls
> layer (gates) describes *controls over the system's transitions* (what must be proven before
> a consequential change takes effect) — the same way a compliance framework separates *assets*
> from *controls*. A gate is **not** an eighth component kind; it is a different axis.

---

## The one distinction everything rests on

**An Agent is the only object that reasons.** It has an LLM, takes input, makes a
decision, and can refuse. Everything else is something an agent (or the orchestrator)
*uses, runs, touches, or chooses* — none of them think.

> If the work has a right answer computable without judgment, it is **not** an Agent
> (it's a Tool or a Job). If it requires reasoning over context, it is an Agent.

## The seven kinds

| Kind | What it IS | What it DOES | What it does NOT do | Becomes (codegen) |
|---|---|---|---|---|
| **Orchestrator** | the single control plane / root | sequences tasks/agents — order, conditions, handoff, retry/fallback, interrupt/resume; externalizes run state | not a worker; doesn't do domain work itself | control-flow code (state machine / DAG) |
| **Task** | a stage of the workflow | groups the agents that carry out a stage; may sequence other tasks; may hold stage-shared Systems and workflow-dispatched Jobs | does not reason; is not a deployable by itself | a step *inside* the orchestrator's flow (not a standalone module) |
| **Agent** | the reasoning unit | reasons with an LLM; decides; calls its allowlisted tools/jobs; reads/writes its systems; **refuses** when a condition is met; emits typed output | — (it's the actor) | an agent module: prompt/loop, pinned model or router call, allowlist enforcement, refusal logic, telemetry |
| **MCP Tool** | a typed, audited call boundary | one deterministic capability — query a DB, call an API, run a function. Same input → same output. Effect class (read/write/external) + auth scope | does **not** reason or decide; runs only when an agent calls it | a typed integration function (no LLM) |
| **Job** | long-running / async work | queued background work — a batch run, a 50–80k-object conversion; queue, timeout, retries, checkpointing | does not reason; does not run in the agent's request loop | a queued task definition (e.g. Celery) |
| **Router** | dynamic model selection | a *policy* that picks which model an agent uses, by complexity / quality / latency / cost | does no work; only selects | a model-selection policy function |
| **System** | a datastore / external system | exists to be touched — relational/vector/graph store, FHIR, external API, state store, file drop | does nothing on its own; it is acted upon, not an actor | a client / connection config |

## The controls layer — Gate

A **Gate** is a control over a *consequential transition* — a separate layer from the seven
component kinds. It is the home of the **proof spine** (the differentiator): no consequential
change (promote a model, deploy, expose an endpoint, take the action, retrain, admit regulated
data) takes effect until the gate's reasoner **proves** it permitted against declared rules.

| Kind | What it IS | What it DOES | What it does NOT do | Becomes (codegen) |
|---|---|---|---|---|
| **Gate** | a control over one consequential transition | binds the transition + a **pluggable deterministic reasoner** (engine/impl/version) + the rules & fact-schema it proves against + a mode (shadow/live); grounds a proposal, proves it, attests | does **not** reason with an LLM (its reasoner is a logic/constraint solver — ASP/SMT, never a language model); does not propose | a proof-gate: invoke the reasoner via `evaluate(facts,rules)→verdict+violations`, attest |

**The safety invariant (why a gate is its own layer):** the prover must have **no LLM and no
agent in its ownership path** — that is exactly what makes a proof authoritative rather than a
plausible guess. A prover is therefore neither an Agent (an agent IS an LLM) nor an agent-owned
Tool. It is the gate's reasoner, and the **gate is owned by the orchestrator** (a deterministic
control plane). The gate schema enforces this: a gate's `reasoner` is `{engine, impl, version}`
with `additionalProperties:false`, so an LLM-shaped reasoner (provider/name) is rejected.

- An **analytical computation an agent relies on** (e.g. a Kelly sizer that computes a candidate
  magnitude the agent then *proposes*) is an agent-owned **Tool**, not a gate and not an agent.
- A **gated stage references its gate by id** (a task→gate edge); the stage does not own the reasoner.
- The controls layer is the **conformance-evidence surface**: "enumerate every consequential
  transition with its engine, rules, version, and mode" is `list gates` — the assessment artifact,
  alongside the attestation log.

## Hierarchy (must match `relationships.js`)

```
orchestrator → task, gate
task         → agent, task, system, job
agent        → tool, job, router, system
gate         → (leaf — referenced by a gated task via edge; reasoner is a field, not a child)
tool / job / system / router → (leaves — no children)
```

- **Task and Gate sit directly under the orchestrator.** (Tasks = the system's stages; gates =
  the controls over consequential transitions. The orchestrator owns both.)
- **Tools belong to an agent OR the orchestrator.** Usually an agent-owned capability the agent
  *calls* (e.g. a sizer/optimizer that informs a proposal). A deterministic capability that must
  NOT have an LLM in its path parents to the orchestrator's control plane. (A stage-level
  deterministic op with no reasoning is still a **Job** if it's long-running/queued.)
- **A prover is NOT a Tool and NOT an Agent** — it is a Gate's reasoner (controls layer above).
- **Job parent = the dispatcher:** agent-dispatched → under the Agent; workflow/
  orchestrator-dispatched → under the Task. (A Job is not a kind of tool-call; don't put
  it under a Tool.)
- **System parent:** the owning Agent, or the Task when the datastore is shared across
  the stage's agents.
- **Router is Agent-only** — it selects exactly one agent's model.

## Agents in detail

### An Agent may be childless
An agent with **no children is valid and complete** — it reasons over its input and emits
output using only its model, calling nothing. The schema requires `model`,
`responsibility`, `refusal`, typed I/O, and `telemetry`; the **tool allowlist may be
empty**. Children describe an agent's *reach* (what it may touch), not a precondition for
its existence. (Modeling smell: an agent that does no reasoning and just calls one API
should be a **Tool**, not an Agent — judgment is what earns the "agent" label and the LLM
cost.)

### Refusal is a first-class output
**Refusal conditions** are the situations where the agent should **decline rather than
guess.** "I shouldn't answer" is a valid, desirable output in a high-stakes system — it
converts a silent wrong answer into a visible refusal that downstream control flow (and a
human) can act on. `refusalEmits` is the value that *signals* a refusal (e.g. `refused`,
`needs-review`) so the orchestrator can branch on it. This is the agent-level expression
of the Pillar-2 fence (see `architecture-first-and-the-failure-partition.md`).

### The agent loop (what an Agent does that a Tool can't)
1. Receive input.
2. **Reason** — recognize what's needed ("I need this record / this row count / context").
3. **Call** an allowlisted Tool (or dispatch a Job) to get it — the deterministic fetch.
4. **Re-reason** over the result.
5. **Answer** (typed output) **or refuse** (if a refusal condition is now met).

The Tool is the deterministic fetch; the Agent is the judgment about *whether* to fetch,
*which* tool, and *what the result means*. A Tool cannot decide it needs more information.

## RAG is a pattern, not a kind

Retrieval-augmented generation is **composed of objects you already have**, not a new
object kind:
- the **vector store** is a **System** (`systemKind: vector-store`),
- the **retrieval step** is an **MCP Tool** (effect: read),
- the **Agent** *does* RAG: it reasons it needs context, calls the retrieval tool (which
  reads the vector-store system), and folds the result into its reasoning before answering.

So "RAG" = **Agent + retrieval Tool + vector-store System**, wired by the allowlist/edges.
The registry shows *which* agents do RAG against *which* store via *which* tool — the
pattern is recoverable from the model with no special kind. For codegen, an agent whose
allowlist contains a retrieval tool + a vector-store system is the signal to scaffold the
RAG plumbing (embed query → search → inject context).
