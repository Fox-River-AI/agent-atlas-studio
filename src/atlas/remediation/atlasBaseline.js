// The Atlas Agentic Baseline (DIAG / Remediation) — Atlas's OPINIONATED reference
// architecture for a governed agentic system. CRITICAL FRAMING (see
// project_agent_atlas_remediation + _regime_architecture): this is ATLAS BEST
// PRACTICE, explicitly NOT a regulatory mandate. No standard (NIST AI RMF, ISO 42001,
// EU AI Act, HIPAA) requires a single orchestrator — they require governance be
// enforceable + auditable. The Baseline is ONE proven way to satisfy that, shipped as
// a toggleable, ratifiable profile, kept as a SEPARATE LAYER from the 8 regulatory
// regimes. Every Baseline-sourced change is tagged source:'ATLAS' so it never reads
// as "the law requires this".
//
// Each rule is data: { id, title, rationale, consequence, kind, severity, structural }.
// `structural:true` rules (e.g. "add a control plane") are STRUCTURE-ADVISORY — the
// synthesized target marks them PROPOSED for the operator to ratify, never silently
// imposed. Non-structural rules are governance-field defaults applied directly.

export const ATLAS_BASELINE = [
  {
    id: 'control-plane',
    title: 'A single control plane over all reasoning agents',
    rationale: 'One coordinator is the simplest place to guarantee refusal, audit, and human-approval hold for EVERY agent — not agent-by-agent.',
    consequence: 'Without it, each agent must independently enforce refusal/audit/approval; gaps are easy and estate-wide attestation is hard.',
    kind: 'orchestrator', severity: 'high', structural: true,
  },
  {
    id: 'owner-everywhere',
    title: 'Every component has a named owner',
    rationale: 'Accountability is a precondition for incident response and change control.',
    consequence: 'Unowned components have no one accountable for their risk posture.',
    kind: '*', severity: 'medium', structural: false,
  },
  {
    id: 'refusal-on-agents',
    title: 'Every reasoning agent declares refusal conditions + a grounding threshold',
    rationale: 'An agent that never declines is an agent that fabricates under uncertainty.',
    consequence: 'No declared floor means no defined behavior when the model is unsure.',
    kind: 'agent', severity: 'high', structural: false,
  },
  {
    id: 'classify-data-systems',
    title: 'Every datastore/system declares a data classification + residency',
    rationale: 'You cannot protect data you have not classified; residency drives where it may live.',
    consequence: 'Unclassified stores get default (often inadequate) protection.',
    kind: 'system', severity: 'high', structural: false,
  },
  {
    id: 'audit-telemetry',
    title: 'Every agent emits audit telemetry (a named span)',
    rationale: 'No trace, no audit; conformance and incident forensics both need it.',
    consequence: 'Silent agents cannot be audited or conformance-checked.',
    kind: 'agent', severity: 'medium', structural: false,
  },
];

// A finding tag so the UI/notes can attribute a change to the Baseline vs a regime.
export const ATLAS_SOURCE = 'ATLAS';
