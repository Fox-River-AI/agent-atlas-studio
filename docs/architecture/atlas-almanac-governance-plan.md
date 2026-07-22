# Plan: Atlas Studio → Governed Almanac

**Status:** Implementation plan (2026-07-22). Ratified by Randy. Drives the DIAG Jira board.
**Goal (the acceptance test):** Atlas Studio can scan Almanac, evaluate it against the Agentic
Architecture Rules (R1–R9), and produce a **corrected target declaration + regenerated CLAUDE.md
contract** that transforms Almanac from a drifted build into a governed product.

---

## The correction this plan makes

The original intent: Atlas exports a registry + CLAUDE.md contract → Almanac is built from it (a
Noesis MLOps shell + a full Numerai management tool). What happened: **Almanac took on a life of its
own and drifted from the framework it was born from** — the 2026-07-21 RE-compare proved it (no real
orchestrator, agent→agent call, missing refusalConditions, 13 undeclared jobs). This plan closes the
loop that was skipped: RE-scan → evaluate against the rules → **produce a corrected declaration
Almanac rebuilds toward** — not a punch-list (a punch-list re-seeds drift; a ratified target does not).

## Two ratified decisions (Randy, 2026-07-21)

1. **R2/R3 stay HARD.** Atlas ENFORCES the hierarchy (one orchestrator per system; no agent→agent;
   task-mediated control) — it does not merely recommend it. The [S]-invariant framing from round-1
   review ("no stochastic→stochastic without a deterministic checkpoint") is kept as the *checkable
   mechanism* beneath the hard rule, NOT as a softening to "one topology among many." Reject the
   [A]/[S] reclassification that would make R2/R3 advisory.
2. **ATLAS IS FIXED FIRST, NOT ALMANAC.** Atlas cannot credibly evaluate Almanac while its scanner is
   blind to a third of the system (jobs, gates) and can't anchor names ("0 aligned of 50"). Fixing
   Atlas's engine is the PRECONDITION for the evaluation being true — not yak-shaving. Almanac's code
   is not touched until Atlas produces the corrected target (P4).

## Rule pack scope (Randy, 2026-07-21)

v1.0 conformance pack = **R1–R9**, with the 5 converged round-1 review FIXES folded in (reasoner-
property keying not kind-label; default-consequential; resolvable owners; testable refusal; R9
boundary corrections). **R10–R14 (governance-of-governance, least-authority, complete-mediation,
bounded-execution, trustworthy-inputs) → BACKLOG as a fast-follow.** HARD CONSTRAINT: the engine must
be built so adding R10–R14 is *appending rule objects to a list* — zero refactor. Each rule is a
self-contained ConformanceRule (id, category, `check(declaration)→findings`, severity, enforcement-
stage); the engine iterates a flat list; R1–R3 / R4–R6 / R7–R9 grouping is a REPORT tag, not a code
boundary. Extensibility-without-refactor is itself an acceptance criterion on the engine.

---

## The five phases

### P1 — Atlas can SEE Almanac completely  (Atlas engine; epics DIAG-4, DIAG-6)
The scan must recover what today it drops. Proven-necessary by the 2026-07-21 compare.
- **DIAG-67** (exists) — Job recognizer (Celery/cron/queue). 13 jobs recovered-then-dropped today.
- **DIAG-68** (exists) — upstream the expanded job.schema.json (unblocks a recovered job validating).
- **NEW P1-a — Gate recovery.** Scan Almanac's `.lp` reasoners + gate manifests → recover kind=gate
  objects. Noesis had no gates; this capability does not exist. Without it the entire controls layer
  (6 gates: g-act/admit/deploy/expose/promote/retrain) is invisible → reads as 6 false "missing".
- **NEW P1-b — ID-anchoring / alias pass (HIGHEST VALUE).** The compare showed "0 aligned of 50"
  because abstract declared names (`inference-endpoint`, `data-adapter-tool`, `almanac-orchestrator`)
  don't share ids with concrete code names (`llm-inference`, `sense-round`, `inferred-orchestrator`).
  Same object, double-counted (once "missing", once "extra"). Build a reconcileAnchors pass (like the
  Noesis import-path anchoring) that matches recovered↔declared by import path / role / signature so
  Compare keys correctly. WITHOUT THIS, NO evaluation is readable. Do this before P3.

### P2 — Atlas has a RULER  (Atlas engine; epics DIAG-6, DIAG-32)
- **NEW P2-a — Ratify the Agentic Architecture Rules v1.0.** Fold the 5 converged review fixes into
  R1–R9; keep R2/R3 hard; publish `agentic-architecture-rules.md` v1.0 (from the DRAFT + reviews).
  R10–R14 recorded as backlog. This is the spec the engine encodes.
- **NEW P2-b — Structural ConformanceRule engine + R1–R9 pack.** EXTEND DIAG-32's ConformanceRule
  interface (do NOT fork): DIAG-32 is `evaluate(observedActivity, declaredManifest)` (RUNTIME, trace
  vs manifest); this adds `evaluate(declaration)→findings` (STATIC, declaration shape). Shared
  interface + findings format; different inputs. Encode R1–R9 as self-contained rules behind it.
  ACCEPTANCE: adding a 10th rule requires no engine change. Runs on any declaration, domain-agnostic.

### P3 — Atlas passes its OWN rules  (Atlas; epic DIAG-4)
Take-our-own-medicine — the credibility precondition. A governance tool that fails its own rules is
untrustworthy.
- **NEW P3-a — Self-scan `agent-atlas-studio`.** Run P1's scanner + P2's rule pack on Atlas itself.
  Fill the honesty table's Atlas column with SCAN RESULTS, not guesses (round-1 flagged this as
  deliverable #1). Expect real findings: ungated "adopt as declaration"/"export bundle" (R4), the
  reconcile-view aggregation logic undeclared (R9), LLM calls without declared refusal (R6).
- **NEW P3-b — Remediate Atlas's own violations** (or declare + ticket them per the aspirational-
  marking discipline: owner + date, rendered as failures). Atlas need not be perfect before P4, but
  its own findings must be visible, not hidden — no exception carved for the authors.

### P4 — Evaluate Almanac → corrected target declaration  (Atlas → Almanac; epics DIAG-4, DIAG-25)
The actual goal. Runs only after P1–P3 (complete recovery + a ruler + self-credibility).
- **NEW P4-a — Almanac conformance run.** RE-scan Almanac (now job+gate-complete, anchored) → run the
  R1–R9 pack → per-rule PASS/FAIL report with offending objects ("❌ R1: 0 orchestrators", "❌ R2:
  almanac-data→target-analysis", "❌ R6: act-proposer-agent refusalConditions ∅").
- **NEW P4-b — Two-column reconcile view (the Erwin ask).** Designed (declaration) | Built (RE),
  matched pairs linked (needs P1-b anchoring), gaps shown, rule violations flagged inline by rule id.
  Parent DIAG-25 (bidirectional reconcile) — each difference resolvable reality→model or model→reality.
- **NEW P4-c — Emit the corrected TARGET DECLARATION + CLAUDE.md contract.** The deliverable of
  record: a new governed declaration (`almanac-vNext`) that is R1–R9-conformant, plus its regenerated
  CLAUDE.md contract, plus the human-readable remediation diff (falls out of Compare for free). This
  is what Almanac rebuilds toward — closes the forward loop properly (the step skipped the first time).

### P5 — Transform Almanac  (Almanac session; not Atlas's code)
- Almanac rebuilds toward `almanac-vNext`: build the real orchestrator, insert tasks between agents
  (kill agent→agent), add the missing refusalConditions, declare the jobs, wire the gates. Tracked in
  ALM, driven by the P4-c target. Atlas re-scans to verify convergence (the re-scan-and-diff loop).

---

## Backlog (real, but NOT on this critical path)
- **Runtime/live-telemetry conformance** — DIAG-16/29/30/31/35 (OTel/Langfuse ingestion, Observed-
  Activity schema). Almanac's evaluation is STATIC (code→declaration); live-trace conformance is a
  later, separate capability. Keep in backlog.
- **R10–R14** — the 5 new rules from round-1 review. Fast-follow after R1–R9 proves out; the engine is
  built so they append without refactor.
- **Additional scanners** — DIAG-52 (SQL), DIAG-53 (Spark). Almanac is Python; not needed yet.
- **Design-mode doc round-trip** — DIAG-39/40/41 (SSDD export/import/render). Not on the governed-
  Almanac path.
- **Canvas polish** — DIAG-2 children (view behavior). Real UX debt, not this goal.
- **Round-2 rule review** — adjudicate the residual v0.2 divergences (the [A]/[S] framing is already
  decided: R2/R3 hard). Lower priority than shipping the R1–R9 evaluation.

## Dependency spine (build order)
P1-b anchoring + P1-a gate recovery  →  P2-b engine + rules  →  P3 self-scan  →  P4 Almanac eval +
target  →  P5 Almanac rebuild. DIAG-67/68 land inside P1 alongside P1-a/b.
