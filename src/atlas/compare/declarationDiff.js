// Declaration-to-declaration diff (DIAG / Compare) — the MEASUREMENT INSTRUMENT.
//
// Compares a BASELINE declaration against a TARGET declaration, object-by-object and
// field-by-field, by shared id. This is model-vs-model (NOT model-vs-runtime — that's
// Monitoring). It serves two callers (see project_agent_atlas_remediation):
//   • recovered (current code)  vs  intended (authored)        — "are we aligned?"
//   • recovered (current)       vs  synthesized target (Path 3) — "what to remediate"
//
// Category vocabulary (the diff IS the change set):
//   • shadow   — in BASELINE, absent in TARGET   (exists but undeclared/unwanted: declare or remove)
//   • unbuilt  — in TARGET, absent in BASELINE    (declared/desired, not present yet: build/add)
//   • drifted  — in BOTH but a field differs       (present but diverged: change)
//   • aligned  — in both, identical                (no action)
//   • moved    — in both but parent changed         (re-parent: a structural change)
//
// Which side is "baseline" vs "target" is the CALLER's framing. For remediation:
//   baseline = recovered(current), target = optimized. Then unbuilt = "to add",
//   drifted = "to change", shadow = "in code but not in the target (declare or drop)".

// Governance fields we care about diffing on a per-object basis (the substance of a
// remediation finding). Kept explicit so a field appearing/changing is legible.
const GOV_FIELDS = ['owner', 'systemKind', 'controlFlow', 'stateStore'];
const GOV_NESTED = {
  governance: ['data_classification', 'data_tags', 'residency', 'retention', 'redaction'],
  model: ['provider', 'name', 'pinned'],
};
const GOV_LIST = ['refusalConditions', 'complianceRegimes'];

const norm = (v) => {
  if (v == null) return '';
  if (Array.isArray(v)) return [...v].map((x) => (x && typeof x === 'object' ? JSON.stringify(x) : String(x))).sort().join('|');
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
};

// Compare one object's fields → list of { field, baseline, target } that differ.
function fieldDiffs(baseObj, targetObj) {
  const out = [];
  const bd = baseObj.data || {}, td = targetObj.data || {};
  const cmp = (field, b, t) => { if (norm(b) !== norm(t)) out.push({ field, baseline: b, target: t }); };
  for (const f of GOV_FIELDS) cmp(f, bd[f], td[f]);
  for (const [parent, kids] of Object.entries(GOV_NESTED)) {
    const bp = bd[parent] || {}, tp = td[parent] || {};
    for (const k of kids) cmp(`${parent}.${k}`, bp[k], tp[k]);
  }
  for (const f of GOV_LIST) cmp(f, bd[f], td[f]);
  return out;
}

/**
 * Diff two declarations.
 * @param baseline { objects:{id:{id,kind,parent,data}}, edges:[] }
 * @param target   same shape
 * @returns { categories: {shadow,unbuilt,drifted,moved,aligned: [rows]}, summary }
 *   each row: { id, kind, ...category-specific (fields[], from/to parent) }
 */
export function diffDeclarations(baseline, target) {
  const b = baseline?.objects || {};
  const t = target?.objects || {};
  const ids = new Set([...Object.keys(b), ...Object.keys(t)]);

  const shadow = [], unbuilt = [], drifted = [], moved = [], aligned = [];
  for (const id of ids) {
    const bo = b[id], to = t[id];
    if (bo && !to) { shadow.push({ id, kind: bo.kind }); continue; }
    if (!bo && to) { unbuilt.push({ id, kind: to.kind }); continue; }
    // in both
    const fields = fieldDiffs(bo, to);
    const reparented = norm(bo.parent) !== norm(to.parent);
    if (reparented) moved.push({ id, kind: bo.kind, fromParent: bo.parent || '(root)', toParent: to.parent || '(root)' });
    if (fields.length) drifted.push({ id, kind: bo.kind, fields });
    if (!fields.length && !reparented) aligned.push({ id, kind: bo.kind });
  }

  // Edge diff (by source->target key) — cross-tier/control edges added or removed.
  const ekey = (e) => `${e.source}->${e.target}`;
  const bEdges = new Set((baseline?.edges || []).map(ekey));
  const tEdges = new Set((target?.edges || []).map(ekey));
  const edgesAdded = [...tEdges].filter((k) => !bEdges.has(k));   // in target, not baseline
  const edgesRemoved = [...bEdges].filter((k) => !tEdges.has(k)); // in baseline, not target

  const summary = {
    shadow: shadow.length, unbuilt: unbuilt.length, drifted: drifted.length,
    moved: moved.length, aligned: aligned.length,
    edgesAdded: edgesAdded.length, edgesRemoved: edgesRemoved.length,
    total: ids.size,
    // a single "distance" number: how many objects need ANY action.
    actionable: shadow.length + unbuilt.length + drifted.length + moved.length,
  };

  return {
    categories: { shadow, unbuilt, drifted, moved, aligned },
    edges: { added: edgesAdded, removed: edgesRemoved },
    summary,
  };
}

// Human-readable one-liners for a diff result (used by the view + any export).
export function diffNotes(diff, { baselineLabel = 'baseline', targetLabel = 'target' } = {}) {
  const s = diff.summary;
  const notes = [`Compared ${baselineLabel} → ${targetLabel}: ${s.actionable} object(s) need action (${s.aligned} aligned of ${s.total}).`];
  if (s.unbuilt) notes.push(`${s.unbuilt} declared in ${targetLabel} but NOT in ${baselineLabel} — to add/build.`);
  if (s.shadow) notes.push(`${s.shadow} in ${baselineLabel} but NOT in ${targetLabel} — declare it or remove it.`);
  if (s.drifted) notes.push(`${s.drifted} present in both but a governance field DIVERGED — to change.`);
  if (s.moved) notes.push(`${s.moved} re-parented (structural change).`);
  if (s.edgesAdded || s.edgesRemoved) notes.push(`Edges: +${s.edgesAdded} / -${s.edgesRemoved}.`);
  return notes;
}
