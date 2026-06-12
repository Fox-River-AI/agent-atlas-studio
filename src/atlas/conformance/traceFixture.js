// Scripted trace fixture for the Monitoring conformance demo (DIAG-49).
//
// This is a CAPTURED RUN of the Causeway platform — OTel-shaped spans for one
// conversion batch — with four PLANTED violations, so the conformance engine has
// real drift to catch on screen. It is demo data: no live platform needed, the
// diff logic is identical to production. Span ids/agent ids match the Causeway
// model so the engine resolves them against the declared registry.
//
// The four planted violations (one per engine rule family):
//   V1 (critical) codegen-agent calls a PROHIBITED emitter tool (direct deploy).
//   V2 (critical) mapping-agent runs below its grounding threshold and does NOT refuse.
//   V3 (critical) the router sends REGULATED data to a cloud model (residency breach).
//   V4 (medium)   validation-agent's declared telemetry span is missing.
// Everything else is conformant — so the demo shows mostly-green with sharp red.

export const CAUSEWAY_TRACE = {
  runId: 'run-2026-06-12-batch-0007',
  label: 'Causeway conversion batch #0007 (1,000 objects)',
  spans: [
    // ── discovery-agent: clean ──
    { spanId: 's1', kind: 'agent-step', agentId: 'discovery-agent', stage: 'discover', confidence: 0.97, refused: false },
    { spanId: 's2', kind: 'tool-call', agentId: 'discovery-agent', target: 'tool-oracle-extractor' },
    { spanId: 's3', kind: 'telemetry', agentId: 'discovery-agent', name: 'discovery-agent-span' },

    // ── parsing-agent: clean ──
    { spanId: 's4', kind: 'agent-step', agentId: 'parsing-agent', stage: 'parse', confidence: 0.93, refused: false },
    { spanId: 's5', kind: 'tool-call', agentId: 'parsing-agent', target: 'tool-ir-writer' },
    { spanId: 's6', kind: 'telemetry', agentId: 'parsing-agent', name: 'parsing-agent-span' },

    // ── mapping-agent: a low-confidence step that should have refused → V2 ──
    { spanId: 's7', kind: 'model-route', agentId: 'mapping-agent', dataClass: 'internal', model: 'claude-haiku', modelHosting: 'local' },
    { spanId: 's8', kind: 'agent-step', agentId: 'mapping-agent', stage: 'map', confidence: 0.61, refused: false }, // V2: 0.61 < 0.80, did not refuse
    { spanId: 's9', kind: 'tool-call', agentId: 'mapping-agent', target: 'tool-lineage-writer' },
    { spanId: 's10', kind: 'telemetry', agentId: 'mapping-agent', name: 'mapping-agent-span' },

    // ── the router routes a REGULATED object to a cloud model → V3 ──
    { spanId: 's11', kind: 'model-route', agentId: 'codegen-agent', dataClass: 'regulated', model: 'gpt-4o (cloud)', modelHosting: 'cloud' }, // V3

    // ── codegen-agent: a clean step, then a PROHIBITED deploy → V1 ──
    { spanId: 's12', kind: 'agent-step', agentId: 'codegen-agent', stage: 'generate', confidence: 0.88, refused: false },
    { spanId: 's13', kind: 'tool-call', agentId: 'codegen-agent', target: 'tool-databricks-emitter' }, // V1: emitter = prohibited (deploy, not stage)
    { spanId: 's14', kind: 'telemetry', agentId: 'codegen-agent', name: 'codegen-agent-span' },

    // ── validation-agent: runs, but its declared telemetry span is MISSING → V4 ──
    { spanId: 's15', kind: 'agent-step', agentId: 'validation-agent', stage: 'validate', confidence: 0.99, refused: false },
    { spanId: 's16', kind: 'tool-call', agentId: 'validation-agent', target: 'tool-equivalence-checker' },
    // (no telemetry span named 'validation-agent-span' → V4)

    // ── review-router-agent: clean HITL handoff ──
    { spanId: 's17', kind: 'agent-step', agentId: 'review-router-agent', stage: 'review', confidence: 0.95, refused: false },
    { spanId: 's18', kind: 'telemetry', agentId: 'review-router-agent', name: 'review-router-agent-span' },
  ],
};
