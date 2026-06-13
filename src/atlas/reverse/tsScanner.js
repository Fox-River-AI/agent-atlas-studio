// Scanner plugin #2 (DIAG-51): the TypeScript/React UI scanner.
//
// The UI is NOT optional for a compliance assessment in ANY regulated domain — it
// renders regulated data (PHI in healthcare, cardholder data in finance, PII
// anywhere), often holds the human-approval / 4-eyes control, and is the entry point
// of the UI→service→datastore data flow. This scanner recovers that tier into the
// common declaration contract.
//
// RUNTIME: studio-side ('studio'). It parses with the TypeScript compiler API
// (ts.createSourceFile parses a STRING — no filesystem/project needed, webview-safe)
// and reads files via Tauri's fs plugin. It does NOT call a backend. That's why its
// `runtimes` is ['studio']: a Mac-host repo routes here, never to the Python backend.
//
// AST, not regex (per DIAG-51). Framework-specific recognition (which call is an API
// call, what's client storage, what's an approval control) lives in recognizers.js,
// so another front-end stack (Amplify/Next/Express) is a new recognizer, not a new
// scanner. Sensitive-data lexicon is reserved for the swappable rule pack (DIAG-57);
// until then the scanner records WHERE regulated data could surface (the UI entry
// point + the cross-tier edges) and flags structural governance gaps.
import { asRecovered } from './scannerFramework';
import { API_RECOGNIZERS, storageRecognizer, approvalSignal } from './recognizers';
// NOTE: `typescript` (the compiler) and `@tauri-apps/plugin-fs` are imported LAZILY
// inside scan() — the TS compiler is ~4MB, and loading it eagerly would bloat app
// startup for everyone even when no TS scan ever runs. Deferred so the cost is paid
// only on the first UI scan.

const isTauri = () => typeof window !== 'undefined' && !!window.__TAURI_INTERNALS__;

const SRC_EXT = /\.(tsx?|jsx?)$/;
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'out', '.next', 'coverage', '.turbo', 'target']);
const MAX_FILES = 1500; // backstop; large UIs are still bounded. Truncation is logged.

// Walk a repo for source files (bounded, skipping build/vendor dirs). `readDir` is
// passed in (lazily imported by scan()) so this module loads without pulling fs.
async function collectSourceFiles(root, readDir) {
  const files = [];
  let truncated = false;
  async function walk(dir) {
    if (files.length >= MAX_FILES) { truncated = true; return; }
    let entries = [];
    try { entries = await readDir(dir); } catch { return; }
    for (const e of entries) {
      if (files.length >= MAX_FILES) { truncated = true; return; }
      const full = `${dir.replace(/\/+$/, '')}/${e.name}`;
      if (e.isDirectory) {
        if (SKIP_DIRS.has(e.name) || e.name.startsWith('.')) continue;
        await walk(full);
      } else if (SRC_EXT.test(e.name) && !e.name.endsWith('.d.ts')) {
        files.push(full);
      }
    }
  }
  await walk(root);
  return { files, truncated };
}

// Derive a backend logical name from a fetch URL/path when it carries a recognizable
// base (so a raw fetch resolves to the same System an api-client call would).
function backendFromPath(path) {
  if (!path) return null;
  if (/\/api\/gw|gateway/i.test(path)) return 'gateway';
  if (/\/api\/core|axiom|\/core\//i.test(path)) return 'core';
  return null;
}

export const tsScanner = {
  id: 'studio-ts-ui',
  label: 'UI source scanner (TypeScript/React, studio-side)',
  languages: ['typescript', 'javascript'],
  runtimes: ['studio'], // parses in-process in the webview; never a backend call
  async scan(repo, _ctx) {
    if (!isTauri()) {
      throw new Error(`The UI scanner runs in the desktop app (it parses local source via Tauri). Open the Tauri app to scan "${repo.label}".`);
    }
    // Lazy-load the heavy deps only when a scan actually runs (see note up top).
    const tsmod = await import('typescript');
    const ts = tsmod.default || tsmod;
    const { readDir, readTextFile } = await import('@tauri-apps/plugin-fs');
    const root = repo.path;
    const { files, truncated } = await collectSourceFiles(root, readDir);
    if (!files.length) {
      throw new Error(`No TypeScript/JavaScript source found under "${repo.label}" (${root}).`);
    }

    // Recovered objects (array form; normalizeGeneratedModel coerces + adds an
    // orchestrator). The UI itself is the entry-point system.
    const uiId = slug(repo.label) + '-ui';
    const objects = [{
      id: uiId, kind: 'system', parent: null,
      data: {
        id: uiId, owner: '', version: '1.0.0',
        systemKind: 'external-api', // schema has no 'frontend' kind yet; closest is external-api/other
        description: `${repo.label} — front-end UI (recovered). Entry point of the UI→service→datastore flow; renders regulated data; holds any human-approval control.`,
        connection: '', authScope: '',
        governance: blankGov(),
        _uiEntryPoint: true,
      },
    }];
    const seenBackends = new Set();
    const edges = [];
    const seenEdge = new Set();
    const notes = [];
    const findings = []; // structured gaps for the notes list

    let apiCalls = 0, unresolvedApi = 0;
    const storageWrites = [];
    const approvalHits = [];

    for (const file of files) {
      let text;
      try { text = await readTextFile(file); } catch { continue; }
      const rel = file.startsWith(root) ? file.slice(root.length).replace(/^\/+/, '') : file;
      const kind = file.endsWith('.tsx') || file.endsWith('.jsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
      let sf;
      try { sf = ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true, kind); }
      catch { notes.push(`Could not parse ${rel} — skipped.`); continue; }

      // does this file carry an approval/sign-off control? (identifier/string scan
      // over the AST tokens, confirmed structurally below)
      let fileHasApproval = false;

      const visit = (node) => {
        // API calls
        if (ts.isCallExpression(node)) {
          for (const rec of API_RECOGNIZERS) {
            const hit = rec(ts, node, /*knownClients*/ KNOWN_CLIENTS);
            if (hit) {
              apiCalls++;
              const backend = hit.target && hit.target !== 'fetch' && hit.target !== 'axios'
                ? hit.target
                : backendFromPath(hit.path);
              if (backend) {
                const bid = ensureBackend(backend, objects, seenBackends);
                addEdge(edges, seenEdge, uiId, bid, 'calls');
              } else {
                unresolvedApi++;
              }
              break;
            }
          }
          // client storage
          const st = storageRecognizer(ts, node);
          if (st && st.isWrite) storageWrites.push({ rel, store: st.store, op: st.op });
        }
        // approval signal: identifiers and string literals
        if (ts.isIdentifier(node) && approvalSignal(node.getText())) fileHasApproval = true;
        if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) && approvalSignal(node.text)) fileHasApproval = true;
        ts.forEachChild(node, visit);
      };
      visit(sf);

      if (fileHasApproval) approvalHits.push(rel);
    }

    // ── Findings → objects + notes (regime-neutral gaps) ──────────────────────
    // 1) Client-side storage of (potentially regulated) data with no declared policy.
    if (storageWrites.length) {
      const byStore = groupBy(storageWrites, (w) => w.store);
      for (const [store, ws] of Object.entries(byStore)) {
        const filesList = [...new Set(ws.map((w) => w.rel))];
        notes.push(`GAP: client-side ${store} writes in ${filesList.length} file(s) (${filesList.slice(0, 4).join(', ')}${filesList.length > 4 ? '…' : ''}) — regulated data may be cached client-side with no declared retention/redaction policy. «FILL: client-storage policy for ${store}».`);
      }
      // tag the UI system's governance as having an open client-storage question
      objects[0].data.governance.data_tags = [...new Set([...(objects[0].data.governance.data_tags || []), 'client-side-storage'])];
    }

    // 2) Approval / 4-eyes control with no declared audit trail.
    if (approvalHits.length) {
      const ctrlId = uiId + '-approval-control';
      objects.push({
        id: ctrlId, kind: 'tool', parent: uiId,
        data: {
          id: ctrlId, owner: '', version: '1.0.0',
          description: `Human-approval / review control recovered in the UI (${approvalHits.slice(0, 3).join(', ')}${approvalHits.length > 3 ? '…' : ''}). A governed control — its audit trail is not declared in the UI code.`,
          governance: blankGov(),
        },
      });
      notes.push(`GAP: approval/sign-off control found in ${approvalHits.length} file(s) but no audit trail is declared. A 4-eyes/maker-checker control needs a tamper-evident audit record. «FILL: audit-trail declaration for the approval control».`);
    }

    // 3) UI→service edges carry data with no declared transport assertion.
    if (edges.length) {
      notes.push(`${edges.length} UI→service call edge(s) recovered (${apiCalls} API call site(s)). Each crosses a trust boundary carrying request/response data — declare TLS + auth per edge. «FILL: transport (TLS) + auth assertion for UI→service calls».`);
    }
    if (unresolvedApi) {
      notes.push(`NOTE: ${unresolvedApi} fetch/API call(s) could not be resolved to a known backend (dynamic URL or unrecognized client). Not silently dropped — review these manually; add a recognizer if a framework pattern is missing.`);
    }
    if (truncated) notes.push(`NOTE: file scan hit the ${MAX_FILES}-file cap — coverage is partial. Some source was not parsed.`);

    notes.unshift(`Scanned ${files.length} source file(s) in ${repo.label}. Recovered the UI as an entry-point system, ${seenBackends.size} backend edge target(s), ${storageWrites.length} client-storage write(s), ${approvalHits.length} file(s) with an approval control.`);

    return asRecovered({ objects, edges }, { notes, meta: { root, files: files.length } });
  },
};

// Known API client identifiers in this estate's UI (the Noesis pattern). Empty =
// accept any `<id>.<verb>()`; we keep it permissive but resolve the backend by name.
const KNOWN_CLIENTS = new Set(['core', 'gateway']);

// ── helpers ───────────────────────────────────────────────────────────────────
function ensureBackend(name, objects, seen) {
  const id = slug(name) + (name === 'core' || name === 'gateway' ? '-service' : '-backend');
  if (!seen.has(id)) {
    seen.add(id);
    objects.push({
      id, kind: 'system', parent: null,
      data: {
        id, owner: '', version: '1.0.0',
        systemKind: 'external-api',
        description: `Backend service "${name}" — inferred from UI API calls. The UI sends data here across a trust boundary.`,
        connection: '', authScope: '',
        governance: blankGov(),
      },
    });
  }
  return id;
}
function addEdge(edges, seen, source, target, kind) {
  const key = `${source}->${target}`;
  if (seen.has(key)) return;
  seen.add(key);
  edges.push({ id: `e-${source}-${target}`, source, target, kind });
}
function slug(s) { return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'x'; }
function blankGov() { return { data_classification: '', data_tags: [], residency: '', retention: '', redaction: [] }; }
function groupBy(arr, fn) {
  const out = {};
  for (const x of arr) { const k = fn(x); (out[k] = out[k] || []).push(x); }
  return out;
}
