// Pluggable multi-language scanner framework (DIAG-50) — the foundation for
// reverse-engineering a POLYGLOT estate without re-architecting per system.
//
// THE CONTRACT (every scanner plugin emits this, regardless of language):
//   RecoveredDeclaration = {
//     objects: { <id>: { id, kind, parent, data } },   // same shape as a declaration
//     edges:   [ { id?, source, target, kind? } ],
//     notes:   [ "human-readable recovery note / gap" ],
//     meta?:   { language, scanner, root }              // provenance (optional)
//   }
//
// A PLUGIN is: { id, label, languages:[...], scan(repo, ctx) -> Promise<RecoveredDeclaration> }
//   - `languages` is what it handles (python | sql | spark | typescript | …).
//   - `scan` does the actual recovery for ONE repo. It may call a backend endpoint
//     (the Python scanner runs on Axiom), parse locally (the TS scanner runs in the
//     Studio), whatever — the framework only cares that it returns the contract.
//   - ctx carries shared inputs (endpointUrl, the sensitivity rule pack later, …).
//
// THE DISPATCHER routes a repo to a plugin BY LANGUAGE. Adding a language = register
// one plugin; the core (dispatch + merge) is untouched. (Architecture note: this
// framework is STUDIO-SIDE — backend scanners are just plugins that emit the
// contract. No heavyweight backend plugin-registry.)
import { normalizeGeneratedModel } from '../normalizeModel';

// ── Plugin registry ─────────────────────────────────────────────────────────
const _plugins = [];

/** Register a scanner plugin. Later plugins for the same language win (override). */
export function registerScanner(plugin) {
  if (!plugin || !plugin.id || typeof plugin.scan !== 'function') {
    throw new Error('Invalid scanner plugin: needs { id, scan() }.');
  }
  _plugins.unshift(plugin); // unshift so the most-recently-registered is found first
}

/** The plugin that handles a language, or null. */
export function pluginForLanguage(language) {
  if (!language) return null;
  return _plugins.find((p) => (p.languages || []).includes(language)) || null;
}

/**
 * The plugin that handles a (language, hostKind) pair, or null. A plugin is eligible
 * only if it BOTH claims the language AND runs on the repo's host runtime
 * (`runtimes`: 'http' = a backend endpoint, 'studio' = in-process studio-side). This
 * is what stops a Python repo on the Mac host from being routed to the backend HTTP
 * scanner — same language, WRONG runtime.
 */
export function pluginForLanguageOnHost(language, hostKind) {
  if (!language) return null;
  return _plugins.find((p) =>
    (p.languages || []).includes(language) &&
    (p.runtimes || ['http']).includes(hostKind)
  ) || null;
}

export function registeredScanners() {
  return _plugins.map((p) => ({ id: p.id, label: p.label, languages: p.languages }));
}

/** The set of languages SOME registered plugin can scan (any host). DIAG-59 uses
 *  this to decide which detected languages are "covered" vs "unscanned". */
export function scannableLanguages() {
  const out = new Set();
  for (const p of _plugins) for (const l of (p.languages || [])) out.add(l);
  return out;
}

// ── The contract normalizer ───────────────────────────────────────────────────
// Any plugin's raw output is run through the studio's normalizer (so a recovered
// declaration is renderable/validatable exactly like a generated one), then shaped
// into the RecoveredDeclaration contract.
export function asRecovered(raw, { notes = [], meta = null } = {}) {
  const { model, problems } = normalizeGeneratedModel(raw && raw.objects ? raw : (raw?.declaration || raw || {}));
  return {
    objects: model.objects,
    edges: model.edges,
    notes: [...notes, ...problems],
    meta,
  };
}

// ── Dispatch: scan ONE repo via its language's plugin ─────────────────────────
// `repo` = { label, path, language }. The language tag picks the plugin (and its
// runtime). If a language is EXPLICITLY tagged but no plugin handles it, fail with a
// clear message — do NOT silently fall back (e.g. routing a TypeScript repo to the
// Python scanner would produce garbage). Only when language is UNSET do we fall back
// to the default plugin (the backend scanner), preserving today's behavior.
export async function scanRepo(repo, ctx = {}) {
  // Dispatch is keyed by (language, host-runtime). A plugin is eligible only if it
  // claims the language AND runs on the repo's host runtime (hostKind). ctx.hostScanKind:
  // 'http' → a backend endpoint (the Python plugin); 'studio' → an in-process studio
  // runtime (the TS scanner, DIAG-51 — not built yet). The host-runtime gate is what
  // stops a Python-tagged repo on the Mac host from running the BACKEND scanner (same
  // language, wrong machine → POSTs a foreign path → 400).
  const hostKind = ctx.hostScanKind || 'http';
  let plugin = repo.language ? pluginForLanguageOnHost(repo.language, hostKind) : null;

  // No eligible plugin → say why precisely, by what's missing.
  if (!plugin) {
    if (!repo.language) {
      // Unset language only falls back to the backend when the host IS the backend.
      if (hostKind === 'http' && ctx.hostBaseUrl) plugin = pluginForLanguageOnHost('python', 'http') || _plugins.find((p) => (p.runtimes || ['http']).includes('http'));
      if (!plugin) throw new Error(`Set a language for "${repo.label}" so the right scanner can handle it.`);
    } else if (hostKind === 'studio') {
      // A studio-host repo with no studio-side scanner yet (the common case today).
      throw new Error(`No studio-side scanner for "${repo.label}" (${repo.language} on ${ctx.hostLabel || 'this Mac'}) yet — the in-app TypeScript/source scanner lands in DIAG-51. Until then, Mac repos browse but don’t scan.`);
    } else if (!ctx.hostBaseUrl) {
      throw new Error(`Can’t scan "${repo.label}" — its host (${ctx.hostLabel || 'unknown'}) has no reachable backend. Set the model endpoint, or move it to a reachable host.`);
    } else {
      throw new Error(`No scanner available for "${repo.label}" (${repo.language} on ${ctx.hostLabel || 'this host'}). That scanner isn’t built yet.`);
    }
  }
  const recovered = await plugin.scan(repo, ctx);
  // Stamp provenance so the merge can tag objects by repo + language.
  return { ...recovered, meta: { ...(recovered.meta || {}), repo: repo.label, language: plugin.languages?.[0] || repo.language || 'unknown', scanner: plugin.id } };
}

// ── Merge: accumulate plugin outputs into ONE recovered estate ────────────────
// Generalized from the original ReverseEngineeringView.mergeScan. Dedupe by id (the
// same datastore/tool/agent recovered from two repos OR two scanners is ONE object,
// tagged with every source); keep a SINGLE union orchestrator; re-parent rootless
// objects under it; accumulate edges + notes. Language-agnostic — works whether the
// inputs came from the Python, TS, SQL, or any future plugin.
export function mergeRecovered(prev, recovered, repoLabel) {
  const objects = { ...(prev?.objects || {}) };
  const edges = [...(prev?.edges || [])];
  const seenEdge = new Set(edges.map((e) => e.id || `${e.source}->${e.target}`));
  const scannedRepos = [...new Set([...(prev?.scannedRepos || []), repoLabel])];

  let orch = Object.values(objects).find((o) => o.kind === 'orchestrator');
  for (const o of Object.values(recovered.objects || {})) {
    if (o.kind === 'orchestrator') {
      if (!orch) {
        // Keep ONE union root. Preserve the _inferred flag + honest description — a
        // backend that found no control plane sent a synthetic node; the union root
        // is equally synthetic across repos. Don't overwrite it into a real-looking
        // "control plane" (that would re-introduce the false-picture problem).
        const inferred = o.data?._inferred;
        orch = { ...o, id: 'inferred-orchestrator', data: { ...o.data, id: 'inferred-orchestrator',
          _inferred: true,
          description: inferred
            ? 'INFERRED union root across the scanned codebases — the code declares NO single control plane. Synthetic; for tree layout only, no control edges drawn.'
            : (o.data?.description || 'Union root across the scanned codebases.') } };
        objects[orch.id] = orch;
      }
      continue; // drop per-source orchestrators; keep one union root
    }
    const tag = repoLabel;
    if (objects[o.id]) {
      // dedupe: keep the existing object, append this source to its _repo tag
      const ex = objects[o.id];
      const set = new Set([...(String(ex.data?._repo || '').split(',').filter(Boolean)), tag]);
      ex.data._repo = [...set].join(',');
    } else {
      objects[o.id] = { ...o, data: { ...o.data, _repo: tag } };
    }
  }
  // merge edges (dedupe by id/endpoints; drop edges whose endpoints we don't have)
  for (const e of (recovered.edges || [])) {
    const eid = e.id || `e-${e.source}-${e.target}`;
    const key = e.id || `${e.source}->${e.target}`;
    if (seenEdge.has(key)) continue;
    if (!objects[e.source] || !objects[e.target]) continue;
    seenEdge.add(key);
    edges.push({ id: eid, source: e.source, target: e.target, ...(e.kind ? { kind: e.kind } : {}) });
  }
  // re-parent rootless non-orchestrator objects under the union orchestrator
  if (orch) for (const o of Object.values(objects)) {
    if (o.kind !== 'orchestrator' && !o.parent) o.parent = orch.id;
  }
  const notes = [...(prev?.notes || []), ...(recovered.notes || []).map((n) => `[${repoLabel}] ${n}`)];
  return { objects, edges, notes, scannedRepos, orchestratorId: orch ? orch.id : null };
}
