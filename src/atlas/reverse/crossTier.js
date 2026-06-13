// Cross-tier edge resolution (DIAG-54) — where N per-tier scans become ONE assessment.
//
// Each language plugin recovers its OWN tier in isolation: the TS scanner finds the UI
// calling `gateway`/`core` (and invents placeholder gateway-service/core-service system
// nodes for those targets); the Python scanner recovers the REAL backend tiers (the
// gateway's agents + its datastores, the axiom service's tools + postgres/neo4j/…). They
// don't know about each other. This pass RECONCILES them into the end-to-end data-flow:
//   UI → (resolved) Gateway service → its datastores
//   UI → (resolved) Axiom/core service → its datastores
// by matching on shared identifiers (route prefixes, connection hints, repo provenance)
// with CONFIDENCE scoring. Low-confidence joins are FLAGGED for human confirmation
// (declare-or-flag), never silently asserted — the same honesty contract as the census.
//
// THE DELIVERABLE (project_agent_atlas_monetization path 1): the full PHI/PII path across
// tiers, in one declaration, with every ungoverned hop visible. Nobody has this diagram.
//
// Input: the merged estate { objects, edges, notes, scannedRepos } + an optional
// repoRoles map { repoLabel -> 'gateway'|'core'|'ui'|... } the operator can supply
// (we also INFER roles from what each repo recovered). Output: estate with cross-tier
// edges added, placeholder service nodes resolved/merged, and resolution notes.

// Route-prefix → logical service the UI is calling. Extensible (data, not logic).
const ROUTE_SERVICE = [
  { prefix: '/api/gw', service: 'gateway' },
  { prefix: '/api/core', service: 'core' },
];

// The TS scanner's placeholder ids for the services the UI calls (see tsScanner.js).
const UI_PLACEHOLDER = { gateway: 'gateway-service', core: 'core-service' };

// Signals that a recovered backend TIER (the set of objects from one repo) plays a
// given service role. We match on what the tier recovered + its repo label.
const ROLE_SIGNALS = {
  gateway: { repo: /gateway|gw/i, objects: /gateway|fhir|identity|analysis|resolver|poa/i },
  core: { repo: /core|axiom|agent/i, objects: /snomed|rules|ontology|drg|validation|axiom/i },
};

// Group merged objects by their source repo (the _repo tag the merge stamped).
function objectsByRepo(objects) {
  const byRepo = {};
  for (const o of Object.values(objects)) {
    const repos = String(o.data?._repo || '').split(',').filter(Boolean);
    for (const r of repos) (byRepo[r] = byRepo[r] || []).push(o);
  }
  return byRepo;
}

// Score how strongly a repo's recovered objects fit a service role [0..1].
function roleConfidence(role, repoLabel, repoObjects) {
  const sig = ROLE_SIGNALS[role];
  if (!sig) return 0;
  let score = 0;
  if (sig.repo.test(repoLabel)) score += 0.5; // repo name names the service
  const hit = repoObjects.some((o) => sig.objects.test(o.id) || sig.objects.test(String(o.data?.description || o.data?.responsibility || '')));
  if (hit) score += 0.5; // recovered objects look like that service's internals
  return score;
}

// The datastore systems a tier owns (edge targets for "service → store").
function tierDatastores(repoObjects) {
  return repoObjects.filter((o) => o.kind === 'system' && !o.data?._uiEntryPoint);
}

/**
 * Resolve cross-tier edges over a merged estate.
 * @param estate { objects, edges, notes, scannedRepos, orchestratorId }
 * @param opts.repoRoles optional { repoLabel: role } operator overrides
 * @returns { ...estate, crossTier: { resolved:[], flagged:[] } }
 */
export function resolveCrossTier(estate, opts = {}) {
  if (!estate || !estate.objects) return estate;
  const objects = { ...estate.objects };
  const edges = [...(estate.edges || [])];
  const notes = [...(estate.notes || [])];
  const seenEdge = new Set(edges.map((e) => e.id || `${e.source}->${e.target}`));
  const addEdge = (source, target, kind) => {
    if (!objects[source] || !objects[target]) return false;
    const key = `${source}->${target}`;
    if (seenEdge.has(key)) return false;
    seenEdge.add(key);
    edges.push({ id: `e-${source}-${target}`, source, target, kind });
    return true;
  };

  const byRepo = objectsByRepo(objects);
  const repoRoles = opts.repoRoles || {};
  const resolved = [], flagged = [];

  // Find the UI entry-point system (placeholder targets hang off it).
  const ui = Object.values(objects).find((o) => o.kind === 'system' && o.data?._uiEntryPoint);

  // For each logical service the UI calls, find the best-matching recovered tier.
  for (const service of ['gateway', 'core']) {
    const placeholderId = UI_PLACEHOLDER[service];
    const placeholder = objects[placeholderId];
    // No UI reference to this service → nothing to resolve.
    if (!placeholder && !ui) continue;

    // Candidate tiers (repos) ranked by role confidence (operator override wins).
    let best = null;
    for (const [repoLabel, repoObjects] of Object.entries(byRepo)) {
      let conf = repoRoles[repoLabel] === service ? 1 : roleConfidence(service, repoLabel, repoObjects);
      if (conf > 0 && (!best || conf > best.conf)) best = { repoLabel, repoObjects, conf };
    }

    if (!best) {
      if (placeholder) flagged.push(`UI calls "${service}" but no recovered tier matched it — left as an unresolved placeholder. «FILL: which scanned repo IS the ${service} service?»`);
      continue;
    }

    // Resolve: connect the UI to this tier's datastores (the real data-flow), and
    // fold the placeholder into the tier. High vs low confidence → assert vs flag.
    const stores = tierDatastores(best.repoObjects);
    const target = ui ? ui.id : null;
    let added = 0;
    for (const s of stores) {
      // UI → service → store: the UI reaches these stores THROUGH the service tier.
      if (target && addEdge(target, s.id, `via-${service}`)) added++;
    }
    if (best.conf >= 0.75) {
      resolved.push(`UI→${service}: resolved to repo "${best.repoLabel}" (confidence ${pct(best.conf)}). Connected UI to ${stores.length} datastore(s) it reaches via ${service}.`);
    } else {
      flagged.push(`UI→${service}: best match is repo "${best.repoLabel}" but confidence is only ${pct(best.conf)} — CONFIRM this is the ${service} service before relying on the ${added} cross-tier edge(s). «FILL: confirm ${best.repoLabel} = ${service}».`);
    }

    // Retire the placeholder node: it was a stand-in for the now-resolved tier.
    if (placeholder) {
      delete objects[placeholderId];
      // rewrite any edges that pointed at the placeholder to the UI (its source)
      for (const e of edges) {
        if (e.target === placeholderId && target) e.target = target;
        if (e.source === placeholderId && target) e.source = target;
      }
      notes.push(`Resolved placeholder "${placeholderId}" into recovered tier "${best.repoLabel}" (${service}).`);
    }
  }

  // Drop any now-dangling edges (endpoints removed) + de-self-loop.
  const cleanEdges = edges.filter((e) => objects[e.source] && objects[e.target] && e.source !== e.target);

  // Headline note so the operator sees the reconciliation ran.
  notes.push(`CROSS-TIER: ${resolved.length} edge group(s) resolved, ${flagged.length} flagged for confirmation. ${resolved.length || flagged.length ? 'The end-to-end data-flow is partially recovered; flagged joins need human confirmation.' : 'No cross-tier links inferred (single tier, or no shared identifiers found).'}`);
  for (const f of flagged) notes.push(`⚠ ${f}`);

  return { ...estate, objects, edges: cleanEdges, notes, crossTier: { resolved, flagged } };
}

function pct(x) { return `${Math.round(x * 100)}%`; }
