// Normalize a provider-returned model into the studio's exact internal shape,
// degrading gracefully rather than crashing (DIAG-37). A generated model is a
// DRAFT TO REFINE, never a source of truth: this function makes whatever the
// provider returned RENDERABLE and EDITABLE; the existing validity + id-uniqueness
// gates then make it ratifiable. We do NOT silently "fix" intent — we surface what
// was dropped/defaulted as `problems` for the human to confirm.
//
// Internal shape (matches seedModel.js):
//   objects = { id: { id, kind, parent, data } }
//   edges   = [ { id, source, target } ]
//   subjectAreas = [ { id, name, memberIds, hiddenIds } ]
import { blankData } from './blankData';

const KINDS = new Set(['orchestrator', 'task', 'agent', 'tool', 'job', 'system', 'router']);

export function normalizeGeneratedModel(raw) {
  const problems = [];
  const model = raw && typeof raw === 'object' ? raw : {};

  // objects: accept a keyed map OR an array; coerce to a keyed map.
  const rawObjects = model.objects;
  let entries = [];
  if (Array.isArray(rawObjects)) entries = rawObjects;
  else if (rawObjects && typeof rawObjects === 'object') entries = Object.values(rawObjects);
  else problems.push('No objects returned — starting from an orchestrator only.');

  const objects = {};
  for (const o of entries) {
    if (!o || typeof o !== 'object') { problems.push('Dropped a non-object entry.'); continue; }
    const id = (o.id || o.data?.id || '').toString().trim();
    if (!id) { problems.push('Dropped an object with no id.'); continue; }
    if (!KINDS.has(o.kind)) { problems.push(`Dropped “${id}” — unknown kind “${o.kind}”.`); continue; }
    if (objects[id]) { problems.push(`Duplicate id “${id}” returned — kept the first, dropped a later one.`); continue; }
    // Fill required-field defaults UNDER the returned data, so a partial object
    // renders as an invalid-but-editable node rather than crashing. Keep data.id
    // in sync with the object id.
    const data = { ...blankData(o.kind), ...(o.data && typeof o.data === 'object' ? o.data : {}), id };
    objects[id] = { id, kind: o.kind, parent: o.parent ?? null, data };
  }

  // Guarantee a single orchestrator root (defensive — mirrors the hydrate path).
  if (!Object.values(objects).some((o) => o.kind === 'orchestrator')) {
    objects['orchestrator'] = { id: 'orchestrator', kind: 'orchestrator', parent: null, data: { ...blankData('orchestrator'), id: 'orchestrator' } };
    if (entries.length) problems.push('No orchestrator returned — inserted a blank root.');
  }

  // Repair parent pointers that reference a dropped/missing object.
  for (const o of Object.values(objects)) {
    if (o.parent && !objects[o.parent]) { problems.push(`“${o.id}” referenced a missing parent “${o.parent}” — detached it.`); o.parent = null; }
  }

  // edges: keep only those whose endpoints both exist; synthesize ids.
  const rawEdges = Array.isArray(model.edges) ? model.edges : [];
  const edges = [];
  const seenEdge = new Set();
  for (const e of rawEdges) {
    if (!e || !objects[e.source] || !objects[e.target]) { problems.push('Dropped an edge with a missing endpoint.'); continue; }
    const eid = e.id || `e-${e.source}-${e.target}`;
    if (seenEdge.has(eid)) continue;
    seenEdge.add(eid);
    edges.push({ id: eid, source: e.source, target: e.target });
  }

  // subjectAreas: default empty; keep only members/hidden that resolve.
  const rawSAs = Array.isArray(model.subjectAreas) ? model.subjectAreas : [];
  const subjectAreas = rawSAs.filter((s) => s && s.id && s.name).map((s) => ({
    id: s.id,
    name: s.name,
    memberIds: (Array.isArray(s.memberIds) ? s.memberIds : []).filter((m) => objects[m]),
    hiddenIds: (Array.isArray(s.hiddenIds) ? s.hiddenIds : []).filter((h) => objects[h]),
  }));

  return { model: { objects, edges, subjectAreas }, problems };
}
