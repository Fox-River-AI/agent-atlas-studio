// Conformance engine (DIAG-49): the declared-vs-running diff.
//
// This is the heart of the "attest" layer (Pillar 3 of the failure partition):
// it takes the DECLARED model (the registry the human ratified) and a TRACE of
// what actually ran, and reports where runtime DRIFTED from the declaration.
// It is a pure function — identical whether the trace is a canned fixture (demo)
// or real OTel spans (production). The rules below check exactly the declarations
// the governance work made first-class: tool allowlists, prohibited tools,
// grounding thresholds, escalation targets, data residency, and declared telemetry.
//
// "You can only measure conformance against a declaration." Every check names the
// declared rule it enforces, so the output reads as evidence, not opinion.

// Build a quick lookup of the declared model from the studio's node shape
// ({id, type, data}) + edges (agent→tool/router/system allowlist).
function indexModel(nodes, edges) {
  const byId = {};
  for (const n of nodes) byId[n.id] = n;
  // agent → set of allowlisted target ids (tools/systems/routers it MAY use)
  const allow = {};
  for (const e of edges) {
    (allow[e.source] ||= new Set()).add(e.target);
  }
  return { byId, allow };
}

// Each check returns { id, rule, severity, status, detail, nist, regime, agentId?, spanId? }.
// - status: 'pass' | 'violation' | 'error'
//     violation = broke a DECLARED rule (a compliance concern)
//     error     = broke operationally, independent of any rule (an SRE concern)
// - nist: the NIST AI RMF function the rule implicates (GOVERN/MAP/MEASURE/MANAGE).
//   Asserted because it's STRUCTURAL — derived from what the rule checks, not a
//   legal judgment.
// - regime: ALWAYS the same placeholder. Atlas does NOT auto-assert specific regime
//   citations (HIPAA §x / GDPR Art. y): that is a legal conclusion + the paid
//   deliverable. The placeholder makes the absent layer visible.
const REGIME_PLACEHOLDER = 'available under assessment scope';

export function runConformance(nodes, edges, trace) {
  const { byId, allow } = indexModel(nodes, edges);
  const spans = trace.spans || [];
  // At batch scale (100+ objects) we list only the INTERESTING findings
  // (violations + errors) individually and COUNT the conformant checks — otherwise
  // the result is thousands of pass-rows. pass() just increments; add() records a
  // finding.
  const checks = [];
  let n = 0;
  let passCount = 0;
  const add = (c) => checks.push({ id: `chk-${n++}`, regime: REGIME_PLACEHOLDER, ...c });
  const pass = () => { passCount++; };

  // ── 1. Tool allowlist + prohibited tools ──────────────────────────────
  // For every tool/system call span, the calling agent must (a) have the target
  // in its declared allowlist, and (b) NOT have it in prohibited_tools.
  for (const s of spans) {
    if (s.kind !== 'tool-call') continue;
    const agent = byId[s.agentId];
    if (!agent) continue;
    const allowed = allow[s.agentId] || new Set();
    const prohibited = new Set(agent.data?.prohibitedTools || []);
    if (prohibited.has(s.target)) {
      add({
        rule: `${s.agentId} is PROHIBITED from calling ${s.target} (prohibited_tools)`,
        severity: 'critical', status: 'violation', nist: 'GOVERN', agentId: s.agentId, spanId: s.spanId,
        detail: `Observed a tool-call to ${s.target} — a declared prohibited action.`,
      });
    } else if (!allowed.has(s.target)) {
      add({
        rule: `${s.agentId} may only call tools on its declared allowlist`,
        severity: 'high', status: 'violation', nist: 'GOVERN', agentId: s.agentId, spanId: s.spanId,
        detail: `Called ${s.target}, which is not in ${s.agentId}'s allowlist.`,
      });
    } else {
      pass();
    }
  }

  // ── 1b. Operational errors (NOT rule violations) ──────────────────────
  // A span can fail operationally regardless of any declared rule — a tool
  // timeout, an agent crash, a malformed output, retry exhaustion. These are an
  // SRE concern ('broke, period'), distinct from a compliance violation ('broke a
  // declared rule'). Surfaced so the view is an operational console, not a
  // compliance toy.
  for (const s of spans) {
    if (!s.error) continue;
    add({
      rule: `${s.agentId || s.kind} operational failure: ${s.error}`,
      severity: s.errorSeverity || 'high', status: 'error', nist: null, regime: null,
      agentId: s.agentId, spanId: s.spanId,
      detail: s.errorDetail || `The ${s.kind} span failed at runtime (${s.error}).`,
    });
  }

  // ── 2. Grounding threshold + escalation ───────────────────────────────
  // When an agent's reasoning span reports a confidence below its declared
  // grounding_threshold, it MUST refuse and escalate to its declared target.
  for (const s of spans) {
    if (s.kind !== 'agent-step' || s.confidence == null) continue;
    const agent = byId[s.agentId];
    const threshold = agent?.data?.groundingThreshold;
    if (threshold == null || threshold === '') continue;
    const t = Number(threshold);
    if (s.confidence < t) {
      const escTarget = agent.data?.escalationTo;
      if (!s.refused) {
        add({
          rule: `${s.agentId} must REFUSE when confidence < ${t} (grounding_threshold)`,
          severity: 'critical', status: 'violation', nist: 'MEASURE', agentId: s.agentId, spanId: s.spanId,
          detail: `confidence=${s.confidence} < ${t} but the agent proceeded instead of refusing.`,
        });
      } else if (escTarget && s.escalatedTo !== escTarget) {
        add({
          rule: `${s.agentId} must escalate to ${escTarget} on refusal (escalation_to)`,
          severity: 'high', status: 'violation', nist: 'MANAGE', agentId: s.agentId, spanId: s.spanId,
          detail: `Refused (good) but escalated to ${s.escalatedTo || 'nowhere'}, not the declared ${escTarget}.`,
        });
      } else {
        pass();
      }
    }
  }

  // ── 3. Data residency on model routing ────────────────────────────────
  // A router/agent span that processes regulated/confidential data must select a
  // local model — declared via the agent's governance.residency = on-prem (and
  // the §8.5 rule: no frontier/cloud routing on confidential/regulated).
  for (const s of spans) {
    if (s.kind !== 'model-route') continue;
    const agent = byId[s.agentId];
    const residency = agent?.data?.governance?.residency;
    const dataClass = s.dataClass; // observed on the span
    const regulated = dataClass === 'regulated' || dataClass === 'confidential';
    if (regulated && residency === 'on-prem') {
      if (s.modelHosting && s.modelHosting !== 'local') {
        add({
          rule: `${s.agentId} must route ${dataClass} data to a LOCAL model (residency=on-prem)`,
          severity: 'critical', status: 'violation', nist: 'MANAGE', agentId: s.agentId, spanId: s.spanId,
          detail: `Routed ${dataClass} data to a ${s.modelHosting} model (${s.model}) — a residency breach.`,
        });
      } else {
        pass();
      }
    }
  }

  // ── 4. Declared telemetry present (per object processed) ──────────────
  // For each (object, agent-step) the agent declares telemetry.emits for, a
  // telemetry span of that name should exist for that object. Missing declared
  // telemetry on a processed object is a measurability gap (the decision isn't
  // auditable). Per-object so a single omission in a 100-object batch is caught.
  const declaredByAgent = {};
  for (const node of nodes) {
    if (node.type !== 'agent') continue;
    declaredByAgent[node.id] = (node.data?.telemetry || []).map((t) => t.name).filter(Boolean);
  }
  // index emitted telemetry by (objId, name)
  const emitted = new Set(spans.filter((s) => s.kind === 'telemetry').map((s) => `${s.objId}::${s.name}`));
  for (const s of spans) {
    if (s.kind !== 'agent-step') continue;
    for (const name of (declaredByAgent[s.agentId] || [])) {
      if (emitted.has(`${s.objId}::${name}`)) {
        pass();
      } else {
        add({
          rule: `${s.agentId} must emit declared telemetry "${name}" (telemetry.emits)`,
          severity: 'medium', status: 'violation', nist: 'MEASURE', agentId: s.agentId, spanId: s.spanId,
          detail: `Object ${s.objId} produced no "${name}" span — declared telemetry is missing, so this decision isn't auditable.`,
        });
      }
    }
  }

  const violations = checks.filter((c) => c.status === 'violation');
  const errors = checks.filter((c) => c.status === 'error');
  // checks now holds only findings (violations + errors); passes are counted.
  const totalChecks = passCount + violations.length + errors.length;
  return { checks, violations, errors, passCount, totalChecks };
}

// Roll the conformance result into an attestation summary — the evidence artifact
// a compliance buyer hands an auditor. Maps violations/passes to the declared
// compliance regimes so the report speaks the buyer's framework language.
export function buildAttestation(nodes, edges, trace, result, stampISO) {
  const orch = nodes.find((n) => n.type === 'orchestrator');
  const regimes = orch?.data?.complianceRegimes || [];
  const sev = (s) => result.violations.filter((v) => v.severity === s).length;
  const verdict = result.violations.length === 0
    ? 'CONFORMANT'
    : (sev('critical') > 0 ? 'NON-CONFORMANT (critical drift)' : 'CONFORMANT WITH EXCEPTIONS');
  // NIST AI RMF functions implicated by the violations (deduped).
  const nistFns = [...new Set(result.violations.map((v) => v.nist).filter(Boolean))];
  return {
    model: orch?.data?.id || 'model',
    generatedAt: stampISO || null,
    runId: trace.runId,
    regimes,
    nistFunctions: nistFns,
    verdict,
    counts: {
      checks: result.totalChecks,
      passed: result.passCount,
      violations: result.violations.length,
      errors: (result.errors || []).length,
      critical: sev('critical'), high: sev('high'), medium: sev('medium'),
    },
    violations: result.violations,
    errors: result.errors || [],
  };
}
