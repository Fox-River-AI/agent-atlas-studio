# The Agentic Architecture Rules (DRAFT v0.1)

**Status:** DRAFT for external validation. Authored by Randy Shane / Fox River AI (Atlas session, 2026-07-21).
**Purpose:** Define the regime-independent STRUCTURAL invariants that every governed agentic-AI system
must satisfy — the "basic compliance floor" that holds even when no named regime (HIPAA, PCI, GDPR…)
applies. These are the rules Agent Atlas ENFORCES on the systems it governs, and — per the governing
principle below — that Atlas itself must obey.

> **GOVERNING PRINCIPLE — "take our own medicine."** Atlas is a governance tool. A governance tool that
> does not conform to its own rules is not trustworthy. Therefore every rule here is SELF-APPLICABLE:
> it must be satisfiable by, and applied to, Atlas and Almanac and Noesis and every future system alike.
> Any rule Atlas itself cannot satisfy is either wrong, or aspirational-and-must-be-marked. No exceptions
> carved for the authors.

---

## 0. Scope and layering

This rule set is the **STRUCTURAL / regime-independent layer.** It sits BENEATH the regime packs already
defined for Atlas (HIPAA, SOC 2, PCI-DSS, GDPR, FedRAMP, EU AI Act, HITRUST, ISO 27001 — see
`regime_architecture`). Those packs add domain controls; THESE rules are the floor every agentic system
owes regardless of domain. "Schema encodes the control; tags name the standard" — these rules ARE controls,
expressed structurally, nameable by no standard yet mandatory anyway.

Two things this document is NOT:
- NOT a maturity model or a style guide — every rule is a hard PASS/FAIL check against a declaration.
- NOT enforcement mechanics — HOW Atlas enforces (block at author time / flag at review / gate at runtime)
  is a SEPARATE, deliberately-deferred decision (see §4). First we agree WHAT is true; then HOW to enforce.

**The object kinds referenced** (from the shared Declaration Spec): orchestrator, task, agent, tool, router,
job, system (component axis) + gate (control axis). Definitions are in Almanac requirements §2 / the spec.

---

## 1. The hard structural rules (candidate — for validation)

Each rule: the invariant, WHY it exists (the failure it prevents), and how it's checked.

### R1 — Exactly one orchestrator per BOUNDED SYSTEM; systems compose orchestrator-to-orchestrator.
Every bounded system has ONE orchestrator that is its root; it owns that system's tasks and gates and is the
single chokepoint for refusal/audit/approval WITHIN the system. Systems compose HIERARCHICALLY: a parent
system's orchestrator may invoke a CHILD system's orchestrator (a governed handoff), but MUST NOT reach past
the child's root into the child's internals (its agents/tasks/tools). There is NO single god-orchestrator
over an estate — there is a TREE of systems, each with one root, composing upward.
- **Check:** `count(kind=orchestrator) == 1` PER system; each is the root of its system; cross-system edges
  are orchestrator→orchestrator only — NEVER orchestrator→foreign-agent/task/tool.
- **Prevents:** ad-hoc uncoordinated execution (0 orchestrators) AND tenant-boundary violation — one system
  reaching into another's internals (the isolation failure: Numerai management must not touch Noesis). This
  is R2's "never bypass a control root" lifted one level: agent→agent skips a task/gate; orchestrator→foreign
  -agent skips the foreign system's whole control plane.
- **Worked example (Randy's):** Almanac = an MLOps PLATFORM hosting many pipelines. Almanac-platform is one
  system (governs tenancy/isolation). "Numerai account mgmt" (600+ models) is a distinct system with its own
  orchestrator. "Noesis model-building" (Propensity-to-Pay, Next-Best-Action) is a THIRD. The platform
  orchestrator calls the Numerai/Noesis INSTANCE orchestrators; it never calls their agents directly — that
  orchestrator-to-orchestrator boundary IS the isolation mechanism.
- **⚠ WHAT "BOUNDED SYSTEM" MEANS (candidate test — validators must attack this hardest):** a system is a
  unit with its own GOVERNANCE BOUNDARY: its own owner, its own compliance-regime set, its own attestation
  log. By this test Numerai-instance / Noesis-instance / Almanac-platform are 3 systems. KNOWN SOFT SPOTS to
  resolve: (1) "own attestation log" may be too strong — physically separate, or logically partitioned? (2)
  "own regime set" can be EMPTY (Numerai has no named regime) — does empty disqualify it as a system? It
  should NOT (the structural floor applies regardless of regime), so the test likely keys on owner + boundary
  + log, with regimes optional. This definition is the load-bearing primitive of the whole rule set — pin it.

### R2 — Agents cannot call agents.
An AGENT is an LLM reasoner whose only role is PROPOSE (emit an action + rationale). An agent MUST NOT invoke
another agent. Agent→agent chaining puts one LLM upstream of another with no deterministic checkpoint between
them, collapsing the control hierarchy and defeating the proof spine.
- **Check:** no edge `(source.kind=agent) → (target.kind=agent)`.
- **Prevents:** un-gated LLM→LLM chains; hidden control flow; loss of the propose/prove separation.

### R3 — Tasks sequence agents; the orchestrator owns the tasks.
Control flows **orchestrator → task → agent**, never agent → agent and never orchestrator → agent directly.
A task is the unit that organizes the calling of agents/tools. An agent is a leaf of the control tree.
- **Check:** every agent's parent is a task (or the orchestrator via a task); no agent is a control-parent of
  anything.
- **Prevents:** the hierarchy collapse R2 addresses, from the structural side.

### R4 — Every consequential transition passes a Gate (the PROVE leg). No LLM upstream of a proof.
Any state change that is costly/irreversible (promote, deploy, expose, act, retrain, admit) MUST be guarded
by a gate whose reasoner is DETERMINISTIC (ASP/SMT), never an LLM and never owned by an agent. The gate is
owned by the orchestrator.
- **Check:** each declared consequential transition references a gate; no gate's reasoner is an LLM; no gate
  is owned by an agent.
- **Prevents:** plausible-guess authorization; an LLM in the authorization path.

### R5 — Every object has an owner + governance metadata. Undeclared = flagged gap, never silent.
Every object (gate included) declares owner + version + kind-appropriate governance fields. Absence is a
FLAGGED gap, not a silent default. (This is the two-axis governance model: per-object block + model-level
regimes.)
- **Check:** no object with `owner=∅` or missing required governance fields passes silently.
- **Prevents:** ungoverned objects hiding in a system that claims to be governed.

### R6 — Every LLM agent declares refusalConditions (the baseline-compliance floor).
Refusal is a first-class output. Every agent declares the conditions under which it MUST decline to propose
(missing grounding, over budget, out of policy). An agent with `refusalConditions=∅` is ungoverned at the
propose leg — the LLM will always answer, even when it should refuse. This is the regime-INDEPENDENT floor:
true whether or not HIPAA/PCI apply.
- **Check:** `count(agent.refusalConditions) >= 1` for every agent.
- **Prevents:** an LLM that never refuses; the "it answered when it should have declined" failure.

### R7 — PGPA completeness for every consequential action (candidate — see open questions).
Every consequential action traces a full **Propose → Ground → Prove → Attest** chain: an agent proposes,
facts ground it, a gate proves it, an attestation records it. A consequential action missing any leg is a
governance gap. (Non-consequential/deterministic-plumbing stages are exempt — but see Q3.)
- **Check:** each consequential action has all four legs present + linked.
- **Prevents:** silent actions; unattested decisions; proof-less authorization.

### R8 — Every consequential transition is attested (immutable, tamper-evident).
The ATTEST leg is mandatory: proposal + facts + rules + verdict + (on refusal) named violation are appended
to an append-only, tamper-evident log. A refused action is attested exactly as a permitted one.
- **Check:** each consequential transition emits an attestation record; the log is append-only.
- **Prevents:** decisions with no audit trail; the inability to replay a decision.

### R9 — All actionable OR decision-informing code is OBSERVABLE; consequential code is ORCHESTRATED.
The declared architecture must be a COMPLETE, faithful map of what the system DOES — not only its AI parts.
"What is your code doing?" must be answerable from the DECLARATION, not by reading the code. So every unit
whose output either **(a) produces an EFFECT** (reads/writes data, calls a service, consumes resources,
changes state) **OR (b) INFORMS A GOVERNED DECISION** (its result is consumed by a task, gate, agent, or
another declared unit) is a DECLARED, OBSERVABLE object with owner + data lineage + I/O, LLM or not.
CONSEQUENTIAL actionable units additionally sit in the ORCHESTRATED control tree (R1). This is regime-
independent and NOT agentic-specific — it is a software-systems-engineering discipline: the system is
SELF-DESCRIBING and the description is VERIFIED true (the scan flags any actionable-but-undeclared code as a
shadow object).
- **The key distinction (corrected 2026-07-21):** observability keys on INFORMS-A-DECISION, not on immediate
  EFFECT. "Effect-free" ≠ "doesn't matter." A PURE CALCULATION whose result feeds a governed decision is part
  of the governed reasoning and MUST be visible. WORKED EXAMPLE (Randy's): Almanac's **feature-divergence**
  step (how similar feature sets are) writes nothing and has no immediate effect — but its output drives model
  choice, target selection, and which feature sets get tuned/trained/ensembled. It is effect-free yet
  DECISION-BEARING → it MUST be a visible step. Exempting it would break decision provenance ("why these
  feature sets?" would point into undeclared code).
- **Exempt ONLY:** truly local throwaway computation whose result NEVER leaves the function that made it
  (a formatting helper, a loop counter, a local intermediate that dies in place) — and UI presentation.
  If a value crosses a boundary to inform something, it is declarable.
- **Check:** every unit with I/O or a consumed output has a declared object; the scan flags actionable code
  with no declaration (shadow). Consequential ones are in the orchestrated tree.
- **Prevents:** the "what does the code actually do?" gap; invisible decision inputs; provenance chains with
  undeclared links. THIS is the self-describing-system property that is the product's moat: a conventional
  codebase answers "what does it do" by reading it; an Atlas-governed system answers from the map AND proves
  the map complete.
- **⚠ GRANULARITY CAVEAT (Q3b for validators):** observability makes the object set large (feature-divergence
  over 2,643 features × 40 targets is 105,720 comparisons — you do NOT declare each). You declare the STEP as
  ONE observable object with its I/O + lineage contract, not each arithmetic op. Where the "step" boundary
  sits is a real open question; the principle holds: the decision-informing COMPUTATION is a visible step.

---

## 2. SELF-APPLICATION — take our own medicine (the honesty table)

Every rule applied to BOTH systems. This is the credibility test: if Atlas can't pass its own rules, the
rule is wrong or Atlas has work to do — mark which. (Almanac column from the 2026-07-21 RE-compare;
Atlas column is the harder, less-examined one and MUST be filled honestly.)

| Rule | Almanac (as-built, per RE-compare) | Atlas (self — HONEST) |
|---|---|---|
| R1 one orchestrator | ❌ 0 real (only synthetic `inferred-orchestrator`); 4 agents ad-hoc | ❓ TBD — does the Studio have a declared orchestrator over its own scan/compare/generate flow? Likely NO. |
| R2 no agent→agent | ❌ `almanac-data` → `target-analysis` | ❓ TBD — does Atlas's own LLM-calling code chain calls? |
| R3 task-sequences-agent | ❌ no tasks recovered wiring the agents | ❓ TBD |
| R4 gate-on-transition | ⚠️ gates declared (6) but NOT recovered from code; enforcement thin (R-OBJ-5) | ❓ TBD — does Atlas gate its own consequential actions (e.g. "adopt as declaration", "export bundle")? |
| R5 owner + governance | ❌ all diverged objects `owner=∅` | ❓ TBD — are Atlas's own objects owned/governed? |
| R6 refusalConditions | ❌ both proposers `refusalConditions=∅` | ❓ TBD — do Atlas's LLM calls (generate/review) declare refusal conditions? |
| R7 PGPA completeness | ⚠️ partial; promote is logged not proven | ❓ TBD |
| R8 attestation | ✅ 4,019 hash-chained attestations (real) | ❓ TBD — does Atlas attest its own governance actions? |
| R9 observable/orchestrated | ⚠️ jobs recovered-then-dropped; feature-divergence + scoring steps not yet declared objects | ❓ TBD — is the Studio's own scan/compare/generate flow declared + observable, or just code? |

**The uncomfortable finding this table forces:** we have measured Almanac against these rules but NOT yet
measured Atlas. Filling the right column honestly is a required deliverable — running the RE scan on Atlas
ITSELF (`agent-atlas-studio`) is how the right column gets real answers, not guesses.

---

## 3. What the rules turn the UI into (the two-column reconcile view)

Randy's UI ask: a two-column **Designed (declaration) | Built (RE)** view that shows what aligns, what
doesn't, and drives them toward alignment — Erwin-style, not a 56-line change-list to read and interpret.

The rules above are what make that view READABLE instead of raw:
- Left column = intended declaration's objects (grouped by kind/hierarchy).
- Right column = recovered objects.
- **Matched pairs linked** (requires the id-anchoring pass — abstract declared names ↔ concrete code names).
- **Gaps shown** where one side has no counterpart (the work to reconcile).
- **Rule violations flagged inline** with the rule id: "❌ R1: 0 orchestrators", "❌ R2: almanac-data →
  target-analysis", "❌ R6: act-proposer-agent refusalConditions ∅".
- Objective = MAKE THEM ALIGN: anchor (same object, different name → link), fix the build (real gap → task),
  or ratify (undeclared decision → update the declaration).

So the sequence is: **rules first → conformance report per rule → THEN the two-column view renders the
report visually.** The view is the rules made visible, not a separate interpretation.

---

## 4. Open questions / deliberately deferred (for the validators to weigh in on)

- **Q1 — Enforcement mechanics (DEFERRED by Randy 2026-07-21):** author-time BLOCK vs review-time FLAG vs
  runtime GATE — per rule. Decided after the rules are agreed. Some rules suit hard blocks (R1, R2); others
  suit flags (R5 completeness). Validators: which rules are block-worthy vs advisory?
- **Q2 — RESOLVED 2026-07-21 into R1 (validate the resolution):** "one orchestrator per BOUNDED SYSTEM;
  systems compose orchestrator-to-orchestrator, never reaching past a child's root." The LOAD-BEARING open
  piece is the DEFINITION of "bounded system" (owner + regime set + attestation log) — attack this hardest;
  the two soft spots (own-log physical-vs-logical; empty-regime-set) are called out in R1. This definition
  is the primitive everything else rests on.
- **Q3 — RESOLVED 2026-07-21 into R9 (validate the resolution):** all actionable OR decision-informing code
  is OBSERVABLE (declared), consequential code is additionally ORCHESTRATED; exemption = local-throwaway +
  UI only. The corrected axis is INFORMS-A-DECISION not EFFECT (feature-divergence is effect-free but
  decision-bearing → must be visible). Validators: is the observable/orchestrated split right, or should ALL
  actionable code be orchestrated (Randy's literal "even when it's just code")? Is the exemption too narrow?
- **Q3b — Declaration GRANULARITY (new):** R9 makes the object set large. You declare the STEP (one object +
  I/O + lineage), not each operation (feature-divergence = one object, not 105,720 comparisons). Where does
  the "step" boundary sit? What's the rule for when a computation is one observable object vs several?
- **Q4 — Agent→tool→agent:** R2 forbids agent→agent. Is agent→tool→agent (an agent whose tool's output
  feeds another agent, mediated by a task) permitted? Presumably yes if a task sits between. Confirm.
- **Q5 — Router's place:** a router (model-selection) sits under an agent. Does it need its own governance,
  or inherit the agent's? (RE'd Almanac has `act-proposer-router`.)
- **Q6 — Self-application edge:** if a rule is genuinely infeasible for Atlas today, is it removed, or kept
  as aspirational-with-a-ticket? (Governing principle says: kept + marked, never silently exempted.)

---

## 5. Validation protocol (for Fable 5 / ChatGPT review)

These rules are Randy's architecture; other LLMs CRITIQUE, they do not AUTHOR. Requested from each reviewer:
1. For each rule R1–R8: is it CORRECT, TOO STRICT, TOO LOOSE, or MISSING A CASE? Give the failure scenario.
2. What rule is MISSING? (What can an agentic system do wrong that R1–R8 don't catch?)
3. Answer the open questions Q1–Q6 with reasoning, especially Q2 (one-orchestrator-per-system) and Q3
   (pure-code orchestration).
4. Stress-test SELF-APPLICATION: is any rule one that a governance tool like Atlas would itself fail? If so,
   is the rule wrong or is the honest answer "Atlas has work to do"?
5. Keep the regime-independence: these are the FLOOR beneath HIPAA/PCI/etc., not a replacement. Flag any rule
   that smuggles in a domain assumption.

Reviewers to date: (pending) Fable 5, ChatGPT. Record each reviewer's deltas below with attribution.
