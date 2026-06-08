# Telemetry → Conformance Architecture

**Status:** Direction-setting (2026-06-08). Architect all of this now; build Modules A–C
and the rule-pack interface (C′); stub the clinical rule pack and the evidence layer
(Module D) until a buyer conversation justifies the latter.

**Origin:** Randy Shane / Fox River AI design brief, "Agent Atlas × Langfuse / Telemetry
Integration," refined in discussion with the rule-pack seam (C′) and the OSS-wedge
monetization posture added.

Tracked under epic **DIAG-4 (Reverse Engineering & Conformance)**. Downstream:
**DIAG-25** (bidirectional reconcile), **DIAG-5** (NIST evidence).

---

## 1. Objective

Agent Atlas's core thesis is the **declared-vs-running diff**: the registry holds what
each agent is *declared and authorized* to do; conformance verifies whether an agent's
*actual runtime behavior* matched that declaration, and produces audit evidence from the
gap.

Conformance needs trustworthy runtime evidence — every model call, tool invocation,
retrieval, data access, and external egress. Langfuse (open-source, self-hostable LLM
observability, OTel-compatible) already solves that collection problem.

**Goal:** use telemetry (Langfuse *or* any OTel source) as the runtime-evidence feed for
the "running" half of conformance — **without** turning Atlas into an observability tool,
and **without** hardwiring Atlas to a single vendor.

## 2. Core principle — Atlas is the governance brain; telemetry is a pluggable source

Same pattern as the ASP/SMT wrapper in the Noesis validation layer: **build the wrapper
first, treat the engine as swappable behind it.**

- **Atlas owns:** the registry (declared state), the conformance engine (diff logic), the
  rule interface, and the audit/evidence output (interpretation).
- **The telemetry source provides:** the observed runtime trace (raw fact only).
- **Couple to OpenTelemetry, not to Langfuse.** Langfuse is *one adapter* behind a stable
  ingestion interface. Anything emitting OTel-compatible traces — Langfuse, LangSmith, a
  raw OTel collector, custom instrumentation — plugs into the same seam.

This protects vendor independence, a clean OSS pitch ("works with whatever you already
run"), and freedom to swap/add sources without touching the conformance core.

## 3. Data flow

```
Agent (instrumented w/ OTel or Langfuse SDK)
        │  emits traces: model calls, tool calls, retrieval, data access, egress
        ▼
Telemetry source  (Langfuse self-hosted | OTel collector | other)
        │  export / API / OTLP
        ▼
┌──────────────────────────── AGENT ATLAS ─────────────────────────────┐
│  [A. Ingestion Adapter]   Langfuse adapter | generic OTel adapter     │
│           ▼                                                           │
│  [B. Normalizer]          vendor trace → Atlas "Observed Activity"    │
│           ▼                                                           │
│  [C. Conformance Engine]  Observed Activity ⨯ Declared Manifest       │
│           │   via [C′. Rule packs]:                                   │
│           │     • universal pack (OSS): undeclared tool, unapproved   │
│           │       model, scope breach, undeclared egress              │
│           │     • domain packs (proprietary): e.g. Noesis clinical    │
│           ▼                                                           │
│  [D. Evidence / Reporting] conformance result + signed audit artifact │
└───────────────────────────────────────────────────────────────────────┘
```

## 4. Modules

The boundaries between modules are also the **open-core boundary** — do not let logic
bleed across them.

### A. Telemetry ingestion interface — *OSS core*
Source-agnostic `TelemetrySource` (`fetch_traces()` / `subscribe()`). Ship two adapters:
(1) generic OTel/OTLP consumer; (2) Langfuse adapter (pull from Langfuse's API or read its
export). Adapters only normalize — **no conformance logic here.**

### B. Observed-Activity normalizer + schema — *OSS core (the keystone)*
Maps heterogeneous traces into a stable internal schema: `agent_id`, `run_id`, model
invoked, tools called, resources/data accessed, external calls/egress, timestamps,
cost/latency. **Define this first — everything downstream reads it.**

This schema is the **running-state peer of the registry (declared-state) schema** — the
two halves the diff sits between. It belongs in the spec, alongside the manifest schemas
(`registry/schema/`), not in the studio. Keep it strictly vendor-neutral.

### C. Conformance engine — *OSS core*
Diffs Observed Activity against the agent's Declared Manifest. The engine itself is generic
plumbing; the actual checks live in **rule packs** (C′).

### C′. Rule-pack interface — *interface OSS; universal pack OSS; domain packs proprietary*
**This seam is the moat boundary.** A `ConformanceRule` interface:
`evaluate(observedActivity, declaredManifest) → violations[]`.

- **Universal pack (OSS), ships in Atlas** — pure structural diffs that need only the
  manifest + the trace, domain-agnostic:
  - *undeclared tool use* — a tool not in `agent.tools`
  - *unapproved model* — a model other than the pinned/router-allowed one
  - *scope breach* — a tool used outside its declared auth scope
  - *undeclared egress* — an external system not declared on the agent
- **Domain packs (proprietary), ship OUTSIDE Atlas** — checks that require a domain
  verifier and therefore *cannot* be expressed as a structural diff:
  - Noesis clinical: "every emitted diagnosis was SNOMED-grounded before output",
    "no PHI in an egress payload", "refusal fired when clinical evidence < threshold".
  - These call into Noesis's SNOMED/ICD verifier — which is the moat and must never enter
    the OSS repo. A banking buyer would write a SOX pack against the same interface.

**Why the seam is structural, not just licensing:** a clinical check isn't a field
comparison — it's a call into a clinical engine. It *physically cannot* live in Atlas
without dragging the verifier in. So the boundary is where the capability already is; it
also happens to be the perfect monetization boundary (proprietary value is structurally
outside the OSS repo — no "we open-sourced the moat by accident" risk).

**Build now:** the interface + the universal pack. **Stub** one trivial clinical rule
(in genai-agent-core) to prove the interface composes — same discipline as stubbing D.

### D. Evidence / audit artifact generation — *commercial-reserved (stub the interface now)*
Tamper-evident, signed, retained, regulator-ready conformance reports mapped to control
frameworks (NIST AI RMF Measure/Manage; EU AI Act logging & record-keeping). Keep the
*basic* human-readable diff open; reserve *attestable, signed, retained, framework-mapped*
evidence for the commercial layer. Build the interface now; leave the implementation
stubbed.

Note: signing/retention/mapping is itself a commodity mechanism. Module D is defensible
mainly **bundled with a domain pack** — i.e. "signed evidence *that the clinical rules
passed*." Sell D and the clinical pack together.

## 5. Monetization posture (working decision — revisit before outside contributors arrive)

**Atlas stays Apache-2.0 OSS; revenue is via Noesis.** Atlas is the wedge that makes the
Noesis conformance story credible and adoptable; the payable thing is **Noesis's signed
clinical-conformance evidence, built on Atlas.** You don't primarily monetize the modeler
or the collector (both commodity — Langfuse et al. give collection away). Matches the
standing guardrail: the moat is the SNOMED/ICD verifier, not the conformance mechanism.

Four monetizable surfaces, ranked by defensibility:
1. **Domain rule packs (strongest)** — the clinical pack needs the SNOMED verifier no OSS
   competitor has. Lives in genai-agent-core; never in the OSS repo.
2. **Signed/retained/framework-mapped evidence (Module D)** — strong *bundled with #1*.
3. **Enterprise gates (SSO/RBAC/multi-tenant/hosted)** — reliable revenue, no moat.
4. **The studio as a paid modeler (weakest)** — crowded category; keep it OSS as the
   credibility artifact + top-of-funnel.

**License:** Apache-2.0 core (maximize adoption + friendliness to regulated enterprise
buyers wary of AGPL reciprocity). The moat is the domain packs, which never enter the OSS
repo — so AGPL would buy little while costing adoption. (Langfuse went MIT core for the
same reason.)

## 6. Scope discipline / non-goals

- **Dogfood on Noesis first** — Atlas watching Noesis's own agents/graph, as the
  governance exhibit, before any horizontal ambition. A real regulated reference impl.
- **Do not absorb observability** — no trace visualization, dashboards, or metrics UI
  competing with Langfuse/LangSmith/Arize. **Atlas reads telemetry; it does not display
  it.** Staying out of that lane also avoids being absorbed by AI-SPM/security platforms
  (ARMO, Zenity) — our lane is governance + audit evidence, not security monitoring.
- **Do not build the commercial paywall now** — ship A–C + the rule interface + universal
  pack OSS and dogfoodable; stub the clinical pack and Module D behind their seams.

## 7. Implementation sequence

1. Define the **Observed-Activity schema** (Module B) — everything depends on it. Put it
   in `registry/schema/` as the running-state peer of the manifest schemas.
2. Build the **generic OTel ingestion adapter** (Module A) against that schema.
3. Add the **Langfuse adapter** (Module A) — proves the interface is truly vendor-neutral.
4. Build the **conformance engine + `ConformanceRule` interface + universal pack** (C/C′),
   diffing against existing registry manifests.
5. Wire end-to-end against a **Noesis agent/graph**; produce a basic conformance report;
   **stub one clinical rule** in genai-agent-core against the interface to prove C′.
6. **Stub** the Module D evidence interface (signing / retention / framework-mapping).

## 8. Open decisions

- **Core OSS license:** Apache-2.0 core + separately-licensed commercial modules
  *(decided — see §5; AGPL rejected for adoption reasons).*
- **Ingestion mode:** pull from Langfuse's API, or sit Atlas as an OTLP collector upstream
  of Langfuse? Direct OTLP is more vendor-neutral but more infrastructure. *(open)*
- **First framework to anchor the evidence artifact:** NIST AI RMF, EU AI Act, or both?
  *(open)*
