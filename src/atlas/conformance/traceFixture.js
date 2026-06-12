// Scripted trace fixture for the Monitoring conformance demo (DIAG-49).
//
// A CAPTURED RUN of the Causeway platform — OTel-shaped spans across ~100 objects
// in one conversion batch — so the Monitoring view looks operational (a stream of
// real activity), not a toy. Most objects convert cleanly; a handful drift
// (declared-rule violations) and a couple fail operationally (errors). Demo data:
// no live platform, the diff logic is identical to production. Ids match the
// Causeway declared model so the engine resolves them against the registry.
//
// Planted findings, spread across the batch so filters/scroll are meaningful:
//   VIOLATIONS (broke a declared rule):
//     • codegen-agent calls a PROHIBITED emitter (object 7)            [GOVERN]
//     • mapping-agent runs below grounding threshold, no refuse (obj 23)[MEASURE]
//     • regulated data routed to a CLOUD model (object 41)             [MANAGE]
//     • validation-agent declared telemetry missing (object 58)        [MEASURE]
//   ERRORS (broke operationally, no rule needed):
//     • tool-oracle-extractor timeout (object 12)
//     • codegen-agent crash / malformed output (object 77)

const AGENTS = [
  { id: 'discovery-agent', stage: 'discover', tool: 'tool-oracle-extractor', conf: 0.96 },
  { id: 'parsing-agent', stage: 'parse', tool: 'tool-ir-writer', conf: 0.93 },
  { id: 'mapping-agent', stage: 'map', tool: 'tool-lineage-writer', conf: 0.90 },
  { id: 'codegen-agent', stage: 'generate', tool: null, conf: 0.89 }, // stages, no tool edge
  { id: 'validation-agent', stage: 'validate', tool: 'tool-equivalence-checker', conf: 0.99 },
  { id: 'review-router-agent', stage: 'review', tool: null, conf: 0.95 },
];

const N_OBJECTS = 100;

function buildSpans() {
  const spans = [];
  let sid = 0;
  const next = () => `s${sid++}`;
  for (let obj = 1; obj <= N_OBJECTS; obj++) {
    const objId = `obj-${String(obj).padStart(4, '0')}`;
    for (const a of AGENTS) {
      // model-route happens for the reasoning agents
      if (a.id === 'mapping-agent' || a.id === 'codegen-agent') {
        // V3: object 41 routes REGULATED data to a cloud model on codegen
        const v3 = obj === 41 && a.id === 'codegen-agent';
        spans.push({
          spanId: next(), kind: 'model-route', objId, agentId: a.id,
          dataClass: v3 ? 'regulated' : 'internal',
          model: v3 ? 'gpt-4o (cloud)' : 'claude-haiku (local)',
          modelHosting: v3 ? 'cloud' : 'local',
        });
      }

      // the agent reasoning step
      let confidence = a.conf;
      let refused = false;
      // V2: object 23 mapping-agent runs below its 0.80 threshold and does NOT refuse
      if (obj === 23 && a.id === 'mapping-agent') { confidence = 0.61; refused = false; }
      const step = { spanId: next(), kind: 'agent-step', objId, agentId: a.id, stage: a.stage, confidence, refused };

      // ERROR: object 77 codegen-agent crashes / emits malformed output
      if (obj === 77 && a.id === 'codegen-agent') {
        step.error = 'malformed-output';
        step.errorSeverity = 'high';
        step.errorDetail = 'codegen-agent produced output that failed schema parse; retries exhausted.';
      }
      spans.push(step);

      // tool call (if the agent uses one)
      if (a.tool) {
        const tc = { spanId: next(), kind: 'tool-call', objId, agentId: a.id, target: a.tool };
        // ERROR: object 12 oracle extractor times out
        if (obj === 12 && a.id === 'discovery-agent') {
          tc.error = 'tool-timeout';
          tc.errorSeverity = 'high';
          tc.errorDetail = 'tool-oracle-extractor exceeded its timeout connecting to the source.';
        }
        spans.push(tc);
      }

      // V1: object 7 codegen-agent calls a PROHIBITED emitter (deploys instead of staging)
      if (obj === 7 && a.id === 'codegen-agent') {
        spans.push({ spanId: next(), kind: 'tool-call', objId, agentId: a.id, target: 'tool-databricks-emitter' });
      }

      // declared telemetry span — EXCEPT V4: object 58 validation-agent omits it
      const omitTelemetry = obj === 58 && a.id === 'validation-agent';
      if (!omitTelemetry) {
        spans.push({ spanId: next(), kind: 'telemetry', objId, agentId: a.id, name: `${a.id}-span` });
      }
    }
  }
  return spans;
}

export const CAUSEWAY_TRACE = {
  runId: 'run-2026-06-12-batch-0007',
  label: `Causeway conversion batch #0007 (${N_OBJECTS} objects)`,
  objectCount: N_OBJECTS,
  spans: buildSpans(),
};
