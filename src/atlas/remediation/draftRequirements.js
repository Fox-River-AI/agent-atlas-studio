// Requirements drafter (Remediation / requirements-driven target generation).
//
// Drafts a CDI-product requirements document, structured by NIST AI RMF
// (Govern / Map / Measure / Manage), that the operator edits and then sends to the
// LLM generator to produce the anchored TARGET. It fuses two sources:
//   1. The RECOVERED current state (the real agents/systems/tools the scan found) —
//      interpolated so the draft names actual ids and the LLM is primed to REUSE them.
//   2. CDI_TARGET_TEMPLATE — the DESIRED functional product, distilled from the
//      project's authoritative CDI specs (ACDIS-anchored workflow, the worklist→query
//      loop, compliant-query generation, MIMIC + EDI 835/837 ingestion, SNOMED
//      maintenance, POA/HAC safety). Embedded as a constant because the generator
//      runs on the Linux backend and the studio build cannot read the Mac memory
//      files at runtime.
//
// The draft is a STARTING POINT the operator refines — not a finished spec. It is
// deliberately opinionated toward the Atlas Baseline (orchestration-first, governed)
// while keeping regimes (HIPAA/HITRUST) distinct from best-practice recommendations.

// Distilled from: project_cdi_workflow (ACDIS Intro-to-CDI), reference_cdi_workflow_spec
// (NOES-25a..k, the worklist→query loop + compliant-query practice),
// project_edi_payer_integration (835/837), reference_data_acquisition_paths (MIMIC-IV),
// project_drg_financial_impact (DRG/CMI), reference_poa_hac_safety_layer.
const CDI_TARGET_TEMPLATE = `
## Product intent (the desired functional state)
A locally-deployed Clinical Documentation Integrity (CDI) platform that consumes FHIR R4
patient records, reconstructs the clinical story, and surfaces high-impact conditions
that are clinically supported but not documented — with an evidence chain — so a CDI
specialist can act with minimal downstream rework. On-prem inference only; no PHI egress.

## GOVERN (accountability + policy — NIST AI RMF "Govern")
- A SINGLE control plane (orchestrator) sequences the whole CDI workflow and is the one
  place that enforces refusal, audit logging, and human-approval across every agent.
  (Atlas Baseline best-practice — not a regulatory mandate.)
- Every agent, tool, and system has a named accountable OWNER (a team/role, e.g.
  "Ontology Team", "Clinical Coding Team", "Interoperability Team", "Platform
  Engineering"), not an individual.
- Compliance regimes the whole system must satisfy: HIPAA (Security + Privacy Rules),
  HITRUST CSF. Declare these on the orchestrator's complianceRegimes.
- Human-in-the-loop is mandatory and non-bypassable: Noesis drafts a CANDIDATE query;
  the CDI specialist is always the sender of record. Noesis never documents for the
  provider, never sends autonomously, never selects the high-weight answer.

## MAP (the components + data flow — NIST AI RMF "Map")
Reuse every recovered component (listed under RECOVERED ESTATE above) and add the
net-new components a complete CDI product needs:
- Workflow tasks under the orchestrator: Ingestion → Clinical-concept extraction →
  SNOMED/ICD mapping → Gap detection (DRG/CC-MCC + HCC) → Compliant-query drafting →
  CDS review/approval → Re-group / realized-impact capture.
- New AGENTS the workflow needs (beyond what was recovered):
  - cdi-worklist: prioritizes the daily case queue by impact + answerability (display
    ordering only; never silently suppresses a gap).
  - compliant-query-drafter: generates a candidate provider query from rule-engine
    option_templates; each option declares required indicators; options whose
    indicators are absent are not offered (compliant-by-construction).
  - leading-language-detector: deterministic v1 guard (banned-phrase list,
    imperative-mood, single-option-emphasis, diagnosis-in-stem) on every drafted query;
    an LLM judge may augment but never replace it.
  - case-reviewer: reconstructs the clinical story for a case and flags supported-but-
    undocumented conditions with evidence.
  - poa-timeline: present-on-admission inference across the encounter timeline
    (paired with the HAC list — POA/HAC safety layer).
  - coding-audit: post-hoc check of assigned codes vs evidence.
- New SYSTEMS / JOBS:
  - mimic-loader (job): ingest MIMIC-IV clinical data from PhysioNet (credentialed,
    DUA-bound) for evaluation; never mixed with production PHI without controls.
  - edi-835-837-ingest (job/agent): consume EDI 837 (claims) + 835 (remittance/denials)
    to drive payer-specific rule prioritization and coverage-aware gap detection.
  - snomed-refresh (job): scheduled refresh of the SNOMED CT ontology from the
    quarterly RF2 release into the graph store; versioned snapshots.
  - cdi-gaps + cdi-queries (state in the relational store): cdi_gaps owns gap workflow
    state (FK to the analysis, idempotent unique); cdi_queries is version-pinned with
    send-state/response-state coherence and double-count protection.
- Edges: connect each agent to the tools/systems it actually uses (the data flow).
  Classify every datastore that holds patient data as regulated/PHI.

## MEASURE (telemetry + thresholds — NIST AI RMF "Measure")
- Every reasoning agent emits a structured telemetry span (agent id, confidence,
  refusal/escalation flags, tool calls, data sources, latency) — designed so Atlas
  Monitoring can diff a run against this declaration (conformance).
- Each clinical-assertion agent declares a grounding/confidence threshold and refuses +
  escalates below it (e.g. mapping/POA ~0.90, DRG/claim ~0.92). PHI is never in span
  payloads (redaction before indexing).

## MANAGE (response + control — NIST AI RMF "Manage")
- Refusal is a first-class output path with a declared escalation target (the CDS
  review queue / approval control).
- Overrides + CDS decisions are stored with attribution (reviewer, timestamp, rationale)
  in an append-only audit store; override storage keyed by SNOMED concept FK.
- POA/HAC safety: POA determinations and HAC interactions are surfaced for review, never
  auto-applied.
- Extensible by design: new rule packs, new payer policies, new data sources are added
  without re-architecting — the orchestrator + rule engine are the stable spine.
`.trim();

// One-line inventory of the recovered estate, by kind, naming real ids (primes reuse).
function recoveredInventory(objects) {
  const list = Object.values(objects || {});
  const byKind = (k) => list.filter((o) => o.kind === k && !o.data?._inferred);
  const lines = [];
  const section = (title, arr, field) => {
    if (!arr.length) return;
    lines.push(`### ${title}`);
    for (const o of arr) {
      const d = (o.data?.[field] || o.data?.description || o.data?.responsibility || '').toString().split('\n')[0];
      lines.push(`- ${o.id}${o.data?.systemKind ? ` (${o.data.systemKind})` : ''}: ${d || '(recovered)'}`);
    }
    lines.push('');
  };
  section('Agents (reuse these ids)', byKind('agent'), 'responsibility');
  section('Tools (reuse these ids)', byKind('tool'), 'description');
  section('Systems (reuse these ids)', byKind('system'), 'description');
  return lines.join('\n');
}

/**
 * Draft a CDI requirements document for target generation.
 * @param result the recovered estate { objects, edges, ... }
 * @param intake { sysName, residency, regimes:[] }
 * @returns Markdown string (the editable draft)
 */
export function draftCdiRequirements(result, intake = {}) {
  const name = (intake.sysName || 'Noesis Health').trim();
  const regimes = (intake.regimes && intake.regimes.length) ? intake.regimes.join(', ') : 'HIPAA, HITRUST';
  const residency = intake.residency || 'on-prem (no PHI egress)';
  const L = [];
  L.push(`# ${name} — Target architecture requirements (requirements-driven)`);
  L.push('');
  L.push(`Residency: ${residency}. Compliance regimes: ${regimes}.`);
  L.push('Generate an OPTIMAL target declaration for a complete, governed CDI product.');
  L.push('REUSE the recovered ids below for components that persist; add the net-new');
  L.push('components the product needs. Anchor to the current state; do not rename what exists.');
  L.push('');
  L.push('## RECOVERED ESTATE (current state — reuse these exact ids)');
  L.push(recoveredInventory(result?.objects));
  L.push(CDI_TARGET_TEMPLATE);
  return L.join('\n');
}

export { CDI_TARGET_TEMPLATE };
