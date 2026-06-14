// Target-synthesis (DIAG / Remediation) — build the OPTIMAL TARGET declaration from
// a RECOVERED one, deterministically. This is the missing middle between Path 2
// (recover) and Path 1 (build): it turns the poorly-structured recovered estate +
// the governance review's suggestions + operator intake + the Atlas Baseline into a
// conformant, EXPORT-VALID target, ANCHORED to the recovered ids so Compare can diff
// baseline→target and the diff IS the change set.
//
// DETERMINISTIC by design (see project_agent_atlas_remediation): no new LLM call. The
// governance review (already run) supplied the per-agent/per-system judgment as
// «FILL: … suggested: X» tokens; synthesis PARSES those suggestions and APPLIES them,
// plus the intake (regimes/residency) estate-wide, plus the Atlas Baseline (a real
// control plane, owners, refusal, classification, telemetry). Governance-strict
// (fill every required field so allValid→export works); STRUCTURE-ADVISORY (the added
// control plane is marked PROPOSED for the operator to ratify — never silently
// imposed). Everything it changes is recorded as a tagged change in `changes`.
import { ATLAS_BASELINE, ATLAS_SOURCE } from './atlasBaseline.js';

// Pull a suggested value out of a «FILL: … suggested: X» token. Returns the first
// suggestion's value, trimmed, or '' if none. The review writes them as
// «FILL: <label> — suggested: <value>» (em-dash) or «FILL: … suggested: <value>».
export function suggestionFor(text) {
  if (!text) return '';
  const m = String(text).match(/suggested:\s*([^»]+)»?/i);
  if (!m) return '';
  // Stop at the first sentence/clause boundary so a chained multi-object suggestion
  // ("postgres = suggested: A; neo4j classification = suggested: B") doesn't bleed
  // B (and the next object's name) into A. Then take the first option of an "A | B"
  // menu. Boundaries: » ; newline, or a "; <word> classification/=" continuation.
  let v = m[1];
  v = v.split('»')[0];
  v = v.split(/;\s/)[0];        // chained clauses
  v = v.split('\n')[0];
  v = v.split('|')[0];          // option menu → first
  return v.replace(/[».;]+$/, '').trim();
}

// Heuristic: does a recommendation's text mention this object id? Used to route a
// review suggestion to the right object. The review references objects by id
// (e.g. "snomed-mapper refuses when …", "postgres classification = …").
function mentions(text, id) {
  if (!text || !id) return false;
  return new RegExp(`\\b${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(text);
}

// Extract a numeric grounding floor (0–1) from a recommendation for an agent.
function floorFor(text, id) {
  if (!mentions(text, id)) return '';
  // look for "<id> … < 0.NN" or "suggested: 0.NN" near the id
  const m = text.match(new RegExp(`${id}[^.]*?(?:<|suggested:\\s*)\\s*(0?\\.\\d+)`, 'i'))
        || text.match(/suggested:\s*(0?\.\d+)/i);
  return m ? m[1] : '';
}

const REGIME_LABEL = { 'HIPAA': 'HIPAA', 'SOC 2': 'SOC 2', 'GDPR': 'GDPR', 'PCI-DSS': 'PCI-DSS', 'FedRAMP': 'FedRAMP', 'EU AI Act': 'EU AI Act', 'HITRUST': 'HITRUST', 'ISO 27001': 'ISO 27001' };

/**
 * Synthesize the optimal target from the recovered estate.
 * @param recovered { objects:{id:{id,kind,parent,data}}, edges:[] } (the merged estate)
 * @param intake { sysName, residency, regimes:[], orchId } operator facts
 * @param review { summary, recommendations:[{area,finding,suggestion,severity}] }
 * @returns { target:{objects,edges,subjectAreas}, changes:[{id,field,kind,from,to,source,severity,proposed}], notes:[] }
 */
export function synthesizeTarget(recovered, intake = {}, review = {}) {
  const objects = JSON.parse(JSON.stringify(recovered?.objects || {}));
  const edges = JSON.parse(JSON.stringify(recovered?.edges || []));
  const changes = [];
  const notes = [];
  const recs = (review && Array.isArray(review.recommendations)) ? review.recommendations : [];
  const recText = recs.map((r) => `${r.area || ''} ${r.suggestion || r.finding || ''}`).join('\n');

  // strip UI-only tags (the _repo provenance) — the target is a clean declaration.
  for (const o of Object.values(objects)) { if (o.data && '_repo' in o.data) delete o.data._repo; }

  const record = (id, field, kind, from, to, source, severity = 'medium', proposed = false) => {
    if (norm(from) === norm(to)) return;
    changes.push({ id, field, kind, from, to, source, severity, proposed });
  };
  const list = () => Object.values(objects);

  // ── 1) Atlas Baseline: control plane (STRUCTURE-ADVISORY → PROPOSED) ──────────
  // Replace the inferred placeholder with a REAL proposed orchestrator, or add one
  // if none exists. Re-parent rootless agents/tools/systems under it. Marked
  // _proposed so the UI/Compare shows it as an operator-ratifiable structural change.
  const cpRule = ATLAS_BASELINE.find((r) => r.id === 'control-plane');
  let orch = list().find((o) => o.kind === 'orchestrator');
  const hadInferred = !!(orch && orch.data?._inferred);
  const cpId = intake.sysName ? `${slug(intake.sysName)}-orchestrator` : 'control-plane';
  if (!orch || hadInferred) {
    // remove the inferred placeholder; mint a proposed real control plane
    if (orch) delete objects[orch.id];
    orch = {
      id: cpId, kind: 'orchestrator', parent: null,
      data: {
        id: cpId, owner: '', version: '1.0.0',
        _proposed: true, _source: ATLAS_SOURCE,
        description: `${intake.sysName ? intake.sysName + ' — ' : ''}control plane (PROPOSED by Atlas Baseline). Sole entry point that enforces refusal thresholds, audit logging, and human-approval routing across all agents. ${cpRule.rationale}`,
        controlFlow: 'dag', stateStore: '', complianceRegimes: [],
      },
    };
    objects[cpId] = orch;
    record(cpId, '(object)', 'orchestrator', hadInferred ? 'inferred placeholder' : 'none', 'proposed control plane', ATLAS_SOURCE, 'high', true);
    notes.push(`PROPOSED (Atlas Baseline, ratify): introduce a control plane "${cpId}" over the agents. ${cpRule.consequence}`);
  }
  // re-parent rootless non-orchestrator objects under the control plane
  for (const o of list()) {
    if (o.kind !== 'orchestrator' && !o.parent) {
      o.parent = orch.id;
    }
  }

  // ── 2) Intake applied estate-wide (operator-declared, so ASSERTED not proposed) ─
  if (Array.isArray(intake.regimes) && intake.regimes.length) {
    const regimes = intake.regimes.map((r) => REGIME_LABEL[r] || r);
    const before = orch.data.complianceRegimes || [];
    orch.data.complianceRegimes = regimes;
    record(orch.id, 'complianceRegimes', orch.kind, before, regimes, 'INTAKE', 'high');
  }
  if (intake.residency) {
    for (const o of list()) {
      if (o.kind === 'task') continue;
      const g = o.data.governance || (o.data.governance = {});
      record(o.id, 'governance.residency', o.kind, g.residency || '', intake.residency, 'INTAKE');
      g.residency = intake.residency;
    }
  }
  if (intake.sysName && orch) {
    // name carried on the control plane description already; nothing else to set.
  }

  // ── 3) Atlas Baseline governance fields + review suggestions, per object ───────
  for (const o of list()) {
    const g = o.data.governance || (o.data.governance = {});

    // owner everywhere (Baseline). We can't know the team from code → leave a
    // declared placeholder the operator edits, but RECORD it as a required change.
    // Only take a suggested owner from a clause that actually concerns ownership
    // (keyword-scoped) — never from a classification/refusal clause.
    if (!o.data.owner) {
      const ownerClause = clauseFor(recText, o.id, 'owner');
      const ownerSug = (/owner|team|steward/i.test(ownerClause) ? suggestionFor(ownerClause) : '') || 'TBD — assign owning team';
      record(o.id, 'owner', o.kind, '', ownerSug, ATLAS_SOURCE, 'medium');
      o.data.owner = ownerSug;
    }

    if (o.kind === 'agent') {
      // refusal + grounding threshold (Baseline + review suggestion)
      const floor = floorFor(recText, o.id);
      if (floor && !o.data.groundingThreshold) {
        record(o.id, 'groundingThreshold', 'agent', o.data.groundingThreshold || '', floor, ATLAS_SOURCE, 'high');
        o.data.groundingThreshold = floor;
      }
      if (!(o.data.refusalConditions && o.data.refusalConditions.length)) {
        const rc = floor
          ? [`Refuse and escalate when confidence_score < ${floor}.`]
          : ['Refuse and escalate when grounding/confidence is below the declared threshold.'];
        record(o.id, 'refusalConditions', 'agent', [], rc, ATLAS_SOURCE, 'high');
        o.data.refusalConditions = rc;
      }
      // audit telemetry span (Baseline)
      if (!(o.data.telemetry && o.data.telemetry.some((t) => t.name))) {
        o.data.telemetry = [{ name: `${o.id}-span`, attributes: [] }];
        record(o.id, 'telemetry', 'agent', 'none', `${o.id}-span`, ATLAS_SOURCE);
      }
    }

    if (o.kind === 'system') {
      // data classification (Baseline + review suggestion). Default conservative.
      if (!g.data_classification) {
        const sug = suggestionFor(clauseFor(recText, o.id, 'classification')) || defaultClassification(o.id);
        record(o.id, 'governance.data_classification', 'system', '', sug, ATLAS_SOURCE, 'high');
        g.data_classification = sug;
      }
    }
  }

  // ── 4) summary note ───────────────────────────────────────────────────────────
  const proposed = changes.filter((c) => c.proposed).length;
  notes.unshift(`Synthesized an optimal target from the recovered estate: ${changes.length} change(s) (${proposed} structural/PROPOSED — ratify; the rest governance fields applied from intake + the governance review + Atlas Baseline). The target is anchored to the recovered ids — Compare it against the recovered estate to see the change set, then export the build bundle.`);

  return { target: { objects, edges, subjectAreas: [] }, changes, notes };
}

// Isolate the CLAUSE about a specific id from review text (recommendations often
// chain objects: "postgres = suggested: A; neo4j = suggested: B"). We split on
// clause boundaries (; and newline) and return the segment that mentions the id —
// so a value parsed from it belongs to THAT object, not a neighbor.
function clauseFor(recText, id, keyword = null) {
  const clauses = recText.split(/[;\n]/);
  // prefer a clause that mentions the id AND the keyword
  if (keyword) {
    for (const c of clauses) if (mentions(c, id) && c.toLowerCase().includes(keyword.toLowerCase())) return c;
  }
  // else the first clause mentioning the id AND carrying a suggestion
  for (const c of clauses) if (mentions(c, id) && /suggested:/i.test(c)) return c;
  // last resort: any clause mentioning the id
  for (const c of clauses) if (mentions(c, id)) return c;
  return '';
}

// Conservative default when the review gave no classification for a store.
function defaultClassification(id) {
  if (/neo4j|ontology|graph/i.test(id)) return 'Internal (non-PHI ontology) — confirm';
  if (/postgres|fhir|pgvector/i.test(id)) return 'Confidential/Regulated (PHI) — confirm';
  return 'Confidential — confirm';
}

function slug(s) { return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'system'; }
function norm(v) { return Array.isArray(v) ? v.join('|') : (v == null ? '' : String(v)); }
