// Declared-model fixture for the Monitoring demo (DIAG-49).
//
// The conformance demo must be DETERMINISTIC and self-contained — a video demo
// can't depend on whatever model happens to be loaded, or on the user having
// generated a governed model first. So the Monitoring view diffs the CAUSEWAY_TRACE
// against THIS fixed declared model, which carries exactly the governance
// declarations the planted violations breach. (In production this declared side
// is the live ratified registry; here it's pinned so the demo always reads the same.)
//
// Shape matches the studio's node form {id, type, data} + edges, so it feeds the
// same runConformance() the live model would.

export const DECLARED_NODES = [
  {
    id: 'causeway-orchestrator', type: 'orchestrator',
    data: {
      id: 'causeway-orchestrator', owner: 'platform-team', version: '1.0.0',
      controlFlow: 'state-machine', stateStore: 'state-store',
      complianceRegimes: ['SOC 2', 'GDPR', 'HIPAA', 'EU AI Act'],
    },
  },
  // Agents — each carries the declarations the trace is checked against.
  {
    id: 'discovery-agent', type: 'agent',
    data: { id: 'discovery-agent', owner: 'data-engineering-team', version: '1.0.0',
      responsibility: 'Inventory legacy objects and dependencies.',
      groundingThreshold: 0.80, escalationTo: 'review-router-agent',
      telemetry: [{ name: 'discovery-agent-span' }],
      governance: { data_classification: 'confidential', residency: 'on-prem' } },
  },
  {
    id: 'parsing-agent', type: 'agent',
    data: { id: 'parsing-agent', owner: 'data-engineering-team', version: '1.0.0',
      responsibility: 'Parse a legacy object into an IR.',
      groundingThreshold: 0.80, escalationTo: 'review-router-agent',
      telemetry: [{ name: 'parsing-agent-span' }],
      governance: { data_classification: 'confidential', residency: 'on-prem' } },
  },
  {
    id: 'mapping-agent', type: 'agent',
    data: { id: 'mapping-agent', owner: 'data-engineering-team', version: '1.0.0',
      responsibility: 'Map source constructs to target with confidence scoring.',
      groundingThreshold: 0.80, escalationTo: 'review-router-agent',
      telemetry: [{ name: 'mapping-agent-span' }],
      governance: { data_classification: 'confidential', residency: 'on-prem' } },
  },
  {
    id: 'codegen-agent', type: 'agent',
    data: { id: 'codegen-agent', owner: 'data-engineering-team', version: '1.0.0',
      responsibility: 'Generate target-native code from IR and mapping.',
      groundingThreshold: 0.75, escalationTo: 'review-router-agent',
      // codegen only STAGES — it is prohibited from invoking deploy/emitter tools.
      prohibitedTools: ['tool-databricks-emitter', 'tool-snowflake-emitter', 'tool-bigquery-emitter', 'tool-aurora-emitter'],
      telemetry: [{ name: 'codegen-agent-span' }],
      governance: { data_classification: 'regulated', residency: 'on-prem' } },
  },
  {
    id: 'validation-agent', type: 'agent',
    data: { id: 'validation-agent', owner: 'data-engineering-team', version: '1.0.0',
      responsibility: 'Check semantic equivalence between source and target.',
      groundingThreshold: 0.95, escalationTo: 'review-router-agent',
      telemetry: [{ name: 'validation-agent-span' }],
      governance: { data_classification: 'confidential', residency: 'on-prem' } },
  },
  {
    id: 'review-router-agent', type: 'agent',
    data: { id: 'review-router-agent', owner: 'data-engineering-team', version: '1.0.0',
      responsibility: 'Route low-confidence/failed items to human review.',
      groundingThreshold: 0.80,
      telemetry: [{ name: 'review-router-agent-span' }],
      governance: { data_classification: 'confidential', residency: 'on-prem' } },
  },
  // Tools (leaves) — the ones the trace references.
  ...['tool-oracle-extractor', 'tool-ir-writer', 'tool-lineage-writer', 'tool-equivalence-checker',
      'tool-databricks-emitter'].map((id) => ({
    id, type: 'tool', data: { id, owner: 'platform-team', version: '1.0.0', effect: id.includes('emitter') ? 'write' : 'read' },
  })),
];

// Declared allowlist edges (agent → tool it MAY call). Note codegen-agent is NOT
// edged to any emitter — those are deploy tools it must not touch (and they're
// also in its prohibited_tools).
export const DECLARED_EDGES = [
  { id: 'e1', source: 'discovery-agent', target: 'tool-oracle-extractor' },
  { id: 'e2', source: 'parsing-agent', target: 'tool-ir-writer' },
  { id: 'e3', source: 'mapping-agent', target: 'tool-lineage-writer' },
  { id: 'e4', source: 'validation-agent', target: 'tool-equivalence-checker' },
  // codegen-agent: no tool edges — it stages output, it does not invoke emitters.
];

// Identity of the declaration the run is diffed against. An attestation's first
// audit question is "conformant against WHAT?" — drift is only evidence if the
// baseline is pinned. In production this is the registry version + content hash.
export const DECLARATION_META = {
  name: 'causeway registry',
  version: 'v1.0.0',
  ratifiedAt: '2026-06-11',
};
