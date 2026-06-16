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

const KINDS = new Set(['orchestrator', 'task', 'agent', 'tool', 'job', 'system', 'router', 'gate']);
const SEMVER = /^\d+\.\d+\.\d+$/;

// Repair the handful of fields that have HARD schema constraints, in place.
// These are the shapes a generator most often drifts on (observed: non-semver
// version on every object; agent `model` not matching the pinned-OR-router
// oneOf). We coerce to a valid default and record what changed — fixing shape,
// not inventing intent. Everything else stays as returned (editable, validatable).
function sanitizeData(kind, data, id, problems) {
  // version: schema requires ^\d+\.\d+\.\d+$ on every kind except task.
  if (kind !== 'task') {
    if (typeof data.version !== 'string' || !SEMVER.test(data.version)) {
      const bad = data.version;
      // "1.0" → "1.0.0"; "v2" / garbage → "1.0.0"
      const m = typeof data.version === 'string' && data.version.match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
      data.version = m ? `${m[1]}.${m[2] || 0}.${m[3] || 0}` : '1.0.0';
      if (bad !== data.version) problems.push(`“${id}”: version “${bad ?? '(missing)'}” → “${data.version}” (must be MAJOR.MINOR.PATCH).`);
    }
  }
  // agent model: exactly one of a pinned-model object {provider,name,pinned} OR a
  // router reference {router}. Generators often emit a fuller/looser object.
  if (kind === 'agent') {
    const m = data.model;
    const hasRouterRef = m && typeof m === 'object' && typeof m.router === 'string' && m.router;
    const hasPinned = m && typeof m === 'object' && m.provider && m.name && m.pinned;
    if (hasRouterRef && !hasPinned) {
      data.model = { router: m.router }; // strip any extra keys the schema forbids
    } else if (hasPinned) {
      // keep only the allowed pinned-model keys (drop additionalProperties)
      const clean = { provider: m.provider, name: m.name, pinned: m.pinned };
      if (m.parameters && typeof m.parameters === 'object') clean.parameters = m.parameters;
      data.model = clean;
    } else {
      // Couldn't tell — fall back to the blank default model; the human refines it.
      // (blankData already seeded a valid model; this catches a returned-but-broken one.)
      if (m !== undefined) problems.push(`“${id}”: model was neither a complete pinned model nor a {router} ref — reset to the default model; set it in the panel.`);
      data.model = { ...blankData('agent').model };
    }
  }
  // router: candidates must be an array of {provider,name[,pinned]}; policy an object.
  if (kind === 'router') {
    if (!Array.isArray(data.candidates)) {
      problems.push(`“${id}”: router candidates were not a list — reset to defaults; set them in the panel.`);
      data.candidates = [...blankData('router').candidates];
    }
    // policy fields in the studio's data shape are optimizeFor/rules/fallback;
    // a generator may emit a nested `policy` object — flatten the known keys.
    if (data.policy && typeof data.policy === 'object') {
      const p = data.policy;
      if (Array.isArray(p.optimize_for) && !data.optimizeFor) data.optimizeFor = p.optimize_for;
      if (Array.isArray(p.rules) && !data.rules) data.rules = p.rules;
      if (typeof p.fallback === 'string' && !data.fallback) data.fallback = p.fallback;
      delete data.policy;
      problems.push(`“${id}”: router policy was nested — flattened to the editable fields.`);
    }
    // optimize_for is a STRICT enum: quality | cost | latency. Map common
    // near-misses ("output-quality"→"quality") and drop anything off-list, so a
    // generated router validates instead of failing on every stray value.
    if (Array.isArray(data.optimizeFor)) {
      const ALLOWED = new Set(['quality', 'cost', 'latency']);
      const MAP = { 'output-quality': 'quality', 'output_quality': 'quality', accuracy: 'quality', speed: 'latency', price: 'cost' };
      const cleaned = [];
      const dropped = [];
      for (const v0 of data.optimizeFor) {
        const v = MAP[v0] || v0;
        if (ALLOWED.has(v)) { if (!cleaned.includes(v)) cleaned.push(v); }
        else dropped.push(v0);
      }
      if (dropped.length) problems.push(`“${id}”: optimize_for dropped invalid value(s) ${dropped.join(', ')} (allowed: quality, cost, latency).`);
      data.optimizeFor = cleaned;
    }
  }
}

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
    // Defensive field guards: a generator (any backend) can drift from the schema.
    // Coerce the few HARD-constrained fields back to valid so a draft lands clean
    // instead of as dozens of identical validation errors. Each repair is surfaced
    // in `problems` — we fix shape, never invent intent.
    sanitizeData(o.kind, data, id, problems);
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
    // CONTRADICTION GUARD: an agent must not be ALLOWED (an edge) a tool it also
    // PROHIBITS. The prohibition is the stronger, intentional negative declaration,
    // so it wins — drop the allow-edge. (e.g. codegen-agent declared "prohibited:
    // emitters" because it only stages, but the generator also edged it to them.)
    const src = objects[e.source];
    if (src?.kind === 'agent' && (src.data?.prohibitedTools || []).includes(e.target)) {
      problems.push(`“${e.source}” was both allowed and prohibited from “${e.target}” — kept the prohibition, dropped the allow-edge.`);
      continue;
    }
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
