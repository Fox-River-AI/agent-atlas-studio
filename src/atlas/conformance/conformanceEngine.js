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

// Each check returns { id, rule, severity, status:'pass'|'violation', detail, agentId?, spanId? }.
// The RULE string is the human-readable declaration being enforced (what an
// auditor reads); DETAIL is the specific observed fact.

export function runConformance(nodes, edges, trace) {
  const { byId, allow } = indexModel(nodes, edges);
  const spans = trace.spans || [];
  const checks = [];
  let n = 0;
  const add = (c) => checks.push({ id: `chk-${n++}`, ...c });

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
        severity: 'critical', status: 'violation', agentId: s.agentId, spanId: s.spanId,
        detail: `Observed a tool-call to ${s.target} — a declared prohibited action.`,
      });
    } else if (!allowed.has(s.target)) {
      add({
        rule: `${s.agentId} may only call tools on its declared allowlist`,
        severity: 'high', status: 'violation', agentId: s.agentId, spanId: s.spanId,
        detail: `Called ${s.target}, which is not in ${s.agentId}'s allowlist.`,
      });
    } else {
      add({
        rule: `${s.agentId} → ${s.target} is a declared, allowed call`,
        severity: 'info', status: 'pass', agentId: s.agentId, spanId: s.spanId,
        detail: `Tool call stayed inside the declared graph.`,
      });
    }
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
          severity: 'critical', status: 'violation', agentId: s.agentId, spanId: s.spanId,
          detail: `confidence=${s.confidence} < ${t} but the agent proceeded instead of refusing.`,
        });
      } else if (escTarget && s.escalatedTo !== escTarget) {
        add({
          rule: `${s.agentId} must escalate to ${escTarget} on refusal (escalation_to)`,
          severity: 'high', status: 'violation', agentId: s.agentId, spanId: s.spanId,
          detail: `Refused (good) but escalated to ${s.escalatedTo || 'nowhere'}, not the declared ${escTarget}.`,
        });
      } else {
        add({
          rule: `${s.agentId} refused below threshold ${t} and escalated to ${escTarget}`,
          severity: 'info', status: 'pass', agentId: s.agentId, spanId: s.spanId,
          detail: `confidence=${s.confidence} < ${t} → refused + escalated as declared.`,
        });
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
          severity: 'critical', status: 'violation', agentId: s.agentId, spanId: s.spanId,
          detail: `Routed ${dataClass} data to a ${s.modelHosting} model (${s.model}) — a residency breach.`,
        });
      } else {
        add({
          rule: `${s.agentId} routed ${dataClass} data to a local model (residency=on-prem)`,
          severity: 'info', status: 'pass', agentId: s.agentId, spanId: s.spanId,
          detail: `Model ${s.model} is local — residency honored.`,
        });
      }
    }
  }

  // ── 4. Declared telemetry present ─────────────────────────────────────
  // Each agent that declares telemetry.emits should actually emit a span of that
  // name during the run. Missing declared telemetry is a measurability gap.
  const emittedNames = new Set(spans.filter((s) => s.kind === 'telemetry').map((s) => s.name));
  const ranAgents = new Set(spans.filter((s) => s.agentId).map((s) => s.agentId));
  for (const node of nodes) {
    if (node.type !== 'agent' || !ranAgents.has(node.id)) continue;
    const declared = (node.data?.telemetry || []).map((t) => t.name).filter(Boolean);
    for (const name of declared) {
      if (emittedNames.has(name)) {
        add({
          rule: `${node.id} emits declared telemetry "${name}"`,
          severity: 'info', status: 'pass', agentId: node.id,
          detail: `Declared telemetry span observed.`,
        });
      } else {
        add({
          rule: `${node.id} must emit declared telemetry "${name}" (telemetry.emits)`,
          severity: 'medium', status: 'violation', agentId: node.id,
          detail: `The run produced no "${name}" span — declared telemetry is missing, so this decision isn't auditable.`,
        });
      }
    }
  }

  const violations = checks.filter((c) => c.status === 'violation');
  const passes = checks.filter((c) => c.status === 'pass');
  return { checks, violations, passes };
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
  return {
    model: orch?.data?.id || 'model',
    generatedAt: stampISO || null,
    runId: trace.runId,
    regimes,
    verdict,
    counts: {
      checks: result.checks.length,
      passed: result.passes.length,
      violations: result.violations.length,
      critical: sev('critical'), high: sev('high'), medium: sev('medium'),
    },
    violations: result.violations,
  };
}
