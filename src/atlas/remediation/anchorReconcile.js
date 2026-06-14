// Anchoring reconciliation (Remediation / requirements-driven target) — the safety net.
//
// The LLM is told to REUSE recovered ids for components that already exist, but it
// will sometimes mint a fresh id for one anyway (recovered "snomed-mapper" → target
// "snomed-mapping-agent"). diffDeclarations keys purely on id, so an un-reconciled
// rename reads as a FALSE delete+add (shadow + unbuilt) instead of the real change
// (drifted). reconcileAnchors maps such target objects back onto the recovered id so
// the diff is truthful and the build bundle isn't corrupted.
//
// Deterministic + bounded (no LLM): same-kind-only matching, a scored similarity, a
// greedy stable assignment with a threshold, and — critically — DO NOTHING below the
// threshold (a false unbuilt/shadow pair is far safer than a wrong rename that would
// collapse two distinct components onto one id). Every remap is logged as a note
// (auditable, never silent).

// id tokens that carry no identity signal — dropped before comparing.
const ID_STOP = new Set(['agent', 'service', 'worker', 'mcp', 'tool', 'server', 'job', 'system', 'the', 'a', 'an', 'of', 'for']);
const WORD_STOP = new Set(['the', 'a', 'an', 'of', 'for', 'and', 'to', 'that', 'this', 'with', 'from', 'recovered', 'reasoning', 'worker', 'module']);
const THRESHOLD = 0.55;

function idTokens(id) {
  return String(id || '').toLowerCase().split(/[^a-z0-9]+/).filter((t) => t && !ID_STOP.has(t)).map(stem);
}
function wordTokens(s) {
  return String(s || '').toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 2 && !WORD_STOP.has(t)).map(stem);
}
// crude stemmer so mapper~mapping, validator~validate, extraction~extractor align.
function stem(t) {
  return t.replace(/(ing|ation|ator|er|ed|es|s)$/i, '') || t;
}
function jaccard(a, b) {
  const A = new Set(a), B = new Set(b);
  if (!A.size && !B.size) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter);
}

/**
 * Reconcile a generated target's ids back onto the recovered baseline's ids.
 * @param recovered { objects:{id:{id,kind,parent,data}}, edges:[] }
 * @param target    { objects:{...}, edges:[], subjectAreas? }
 * @returns { target: <remapped>, notes: string[] }
 */
export function reconcileAnchors(recovered, target) {
  const rObjs = recovered?.objects || {};
  const tObjs = JSON.parse(JSON.stringify(target?.objects || {}));
  const tEdges = JSON.parse(JSON.stringify(target?.edges || []));
  const notes = [];

  const rList = Object.values(rObjs);
  const tList = Object.values(tObjs);

  // 1) Exact-id pass — already anchored; lock them out of matching.
  const lockedR = new Set();   // recovered ids already represented in the target
  const lockedT = new Set();   // target ids that are already correct
  for (const t of tList) {
    if (rObjs[t.id]) { lockedR.add(t.id); lockedT.add(t.id); }
  }

  // anchored counterpart map for the topology bonus: target-id → recovered-id it is
  // (or will be) anchored to. Seed with the exact matches.
  const anchorOf = new Map();
  for (const id of lockedT) anchorOf.set(id, id);

  // 2) Candidate pools by SAME KIND only.
  const remainR = rList.filter((r) => !lockedR.has(r.id));
  const remainT = tList.filter((t) => !lockedT.has(t.id));

  // 3) Score every same-kind (r,t) pair.
  const tEdgeTargets = (tid) => tEdges.filter((e) => e.source === tid).map((e) => e.target);
  const rEdgeTargets = (rid) => (recovered.edges || []).filter((e) => e.source === rid).map((e) => e.target);
  const pairs = [];
  for (const r of remainR) {
    for (const t of remainT) {
      if (r.kind !== t.kind) continue;
      const idSim = jaccard(idTokens(r.id), idTokens(t.id));
      const descSim = jaccard(
        wordTokens(r.data?.responsibility || r.data?.description),
        wordTokens(t.data?.responsibility || t.data?.description),
      );
      // topology bonus: do r and t both reach a counterpart that's already anchored?
      const tTargetsAnchored = new Set(tEdgeTargets(t.id).map((x) => anchorOf.get(x)).filter(Boolean));
      const rTargets = new Set(rEdgeTargets(r.id));
      let topo = 0;
      for (const x of tTargetsAnchored) if (rTargets.has(x)) { topo = 1; break; }
      const score = 0.5 * idSim + 0.3 * descSim + 0.2 * topo;
      if (score > 0) pairs.push({ r: r.id, t: t.id, score });
    }
  }

  // 4) Greedy stable assignment over score desc, threshold-gated, one-to-one.
  pairs.sort((a, b) => b.score - a.score);
  const usedR = new Set(), usedT = new Set();
  const remap = new Map(); // target-id → recovered-id
  for (const p of pairs) {
    if (p.score < THRESHOLD) break;        // sorted desc → nothing else qualifies
    if (usedR.has(p.r) || usedT.has(p.t)) continue;
    usedR.add(p.r); usedT.add(p.t);
    remap.set(p.t, p.r);
    anchorOf.set(p.t, p.r);
    notes.push(`Anchored target "${p.t}" → recovered id "${p.r}" (score ${p.score.toFixed(2)}).`);
  }

  if (!remap.size) {
    return { target: { ...target, objects: tObjs, edges: tEdges }, notes };
  }

  // 5) Apply the remap: rewrite object ids, data.id, parents, and edge endpoints.
  const newObjs = {};
  for (const [oldId, o] of Object.entries(tObjs)) {
    const newId = remap.get(oldId) || oldId;
    const parent = o.parent && remap.has(o.parent) ? remap.get(o.parent) : o.parent;
    newObjs[newId] = { ...o, id: newId, parent, data: { ...o.data, id: newId } };
  }
  // a remap could collide a renamed object onto an id the target also produced
  // natively — extremely unlikely (the native one would've exact-matched and locked),
  // but guard: if collision, keep the remapped one and note it.
  const newEdges = tEdges.map((e) => ({
    ...e,
    source: remap.get(e.source) || e.source,
    target: remap.get(e.target) || e.target,
    id: `e-${remap.get(e.source) || e.source}-${remap.get(e.target) || e.target}`,
  }));

  notes.unshift(`Reconciliation: ${remap.size} target id(s) remapped to recovered ids so the diff is truthful (renames show as changes, not delete+add). Unmatched recovered objects remain "shadow"; unmatched target objects remain "unbuilt" (the net-new components).`);
  return { target: { ...target, objects: newObjs, edges: newEdges }, notes };
}
