// Local model persistence (Erwin saves to a file; we auto-save the whole model).
// The WHOLE model — objects, edges, subject areas, per-view layouts, per-view
// viewports — is serialized so a restart restores exactly what the user left.
//
// CRITICAL (Tauri gotcha): in `tauri dev` the webview loads http://localhost:5173,
// and WKWebView does NOT reliably persist localStorage for an http dev origin
// across app restarts — so localStorage-only persistence silently lost the model
// on quit. Inside Tauri we therefore write a real file in the app-data dir via
// plugin-fs (works in BOTH dev and prod, and is closer to Erwin's model file).
// The web build (GitHub Pages) keeps using localStorage. All IO is async.
//
// The seed (seedModel.js) is the demo content; it only loads on a truly empty
// first run. A "Reset to demo" action clears the store so the seed loads again.

const KEY = 'agent-atlas:model:v1';
const RECOVERY_KEY = 'agent-atlas:recovery:v1';
// Write into a subdir (not the AppData root) so a recursive mkdir of the subdir
// also creates the app's AppData base folder — which Tauri does NOT auto-create.
const DIR = 'state';
const FILE = 'state/model.json';
const RECOVERY_FILE = 'state/recovery.json';
const VERSION = 1;

const isTauri = () =>
  typeof window !== 'undefined' && !!window.__TAURI_INTERNALS__;

function lsStore() {
  try {
    if (typeof window !== 'undefined' && window.localStorage) return window.localStorage;
  } catch { /* access can throw under strict privacy settings */ }
  return null;
}

function normalize(data) {
  if (!data || data.version !== VERSION || typeof data.objects !== 'object') return null;
  // Migrate Subject Areas to the general-membership shape: SAs used to be defined
  // by taskIds (tasks + descendants); they're now defined by memberIds (any
  // objects). Old saves with taskIds load unchanged (taskIds → memberIds).
  const subjectAreas = (Array.isArray(data.subjectAreas) ? data.subjectAreas : []).map((s) => ({
    id: s.id,
    name: s.name,
    memberIds: s.memberIds ?? s.taskIds ?? [],
    hiddenIds: s.hiddenIds ?? [],
  }));
  return {
    objects: data.objects,
    edges: Array.isArray(data.edges) ? data.edges : [],
    expanded: data.expanded || {},
    subjectAreas,
    layouts: data.layouts || {},
    viewports: data.viewports || {},
    // Requirements doc (DIAG-38): { name, text } or null. Older saves lack it.
    requirements: data.requirements && typeof data.requirements === 'object' ? data.requirements : null,
  };
}

// Load the saved model, or null if nothing valid is stored. Async — callers
// render the seed first, then swap in the saved model when this resolves.
export async function loadModel() {
  if (isTauri()) {
    try {
      const { readTextFile, exists, BaseDirectory } = await import('@tauri-apps/plugin-fs');
      const opts = { baseDir: BaseDirectory.AppData };
      if (!(await exists(FILE, opts))) return null;
      const raw = await readTextFile(FILE, opts);
      return normalize(JSON.parse(raw));
    } catch (e) {
      console.error('[persistence] load failed:', e);
      return null; // missing/corrupt → fall back to seed, never trap the user
    }
  }
  const s = lsStore();
  if (!s) return null;
  try {
    const raw = s.getItem(KEY);
    return raw ? normalize(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

export async function saveModel(model) {
  const payload = JSON.stringify({ version: VERSION, ...model });
  if (isTauri()) {
    try {
      const { writeTextFile, mkdir, BaseDirectory } = await import('@tauri-apps/plugin-fs');
      const opts = { baseDir: BaseDirectory.AppData };
      // Recursive mkdir of the subdir also creates the AppData base folder
      // (Tauri does not auto-create it). Idempotent — safe to call every save.
      try { await mkdir(DIR, { ...opts, recursive: true }); } catch { /* exists */ }
      await writeTextFile(FILE, payload, opts);
    } catch (e) {
      console.error('[persistence] save failed:', e);
    }
    return;
  }
  const s = lsStore();
  if (!s) return;
  try { s.setItem(KEY, payload); } catch { /* quota — best-effort */ }
}

export async function clearModel() {
  if (isTauri()) {
    try {
      const { remove, exists, BaseDirectory } = await import('@tauri-apps/plugin-fs');
      const opts = { baseDir: BaseDirectory.AppData };
      if (await exists(FILE, opts)) await remove(FILE, opts);
    } catch (e) {
      console.error('[persistence] clear failed:', e);
    }
    return;
  }
  const s = lsStore();
  if (!s) return;
  try { s.removeItem(KEY); } catch { /* ignore */ }
}

// ── Crash recovery ──────────────────────────────────────────────────────────
// A SEPARATE snapshot written on (nearly) every change, INCLUDING the live draft
// and selection that the committed model file doesn't hold. If the app crashes
// or is force-quit mid-edit, on next launch we detect this file and offer to
// restore. On a clean save/exit we clear it, so its mere presence == "unclean".

export async function saveRecovery(snapshot) {
  const payload = JSON.stringify({ version: VERSION, savedAt: snapshot.savedAt, ...snapshot });
  if (isTauri()) {
    try {
      const { writeTextFile, mkdir, BaseDirectory } = await import('@tauri-apps/plugin-fs');
      const opts = { baseDir: BaseDirectory.AppData };
      try { await mkdir(DIR, { ...opts, recursive: true }); } catch { /* exists */ }
      await writeTextFile(RECOVERY_FILE, payload, opts);
    } catch (e) { console.error('[persistence] recovery save failed:', e); }
    return;
  }
  const s = lsStore();
  if (!s) return;
  try { s.setItem(RECOVERY_KEY, payload); } catch { /* best-effort */ }
}

export async function loadRecovery() {
  if (isTauri()) {
    try {
      const { readTextFile, exists, BaseDirectory } = await import('@tauri-apps/plugin-fs');
      const opts = { baseDir: BaseDirectory.AppData };
      if (!(await exists(RECOVERY_FILE, opts))) return null;
      const data = JSON.parse(await readTextFile(RECOVERY_FILE, opts));
      return data && data.version === VERSION ? data : null;
    } catch (e) { console.error('[persistence] recovery load failed:', e); return null; }
  }
  const s = lsStore();
  if (!s) return null;
  try { const raw = s.getItem(RECOVERY_KEY); return raw ? JSON.parse(raw) : null; } catch { return null; }
}

export async function clearRecovery() {
  if (isTauri()) {
    try {
      const { remove, exists, BaseDirectory } = await import('@tauri-apps/plugin-fs');
      const opts = { baseDir: BaseDirectory.AppData };
      if (await exists(RECOVERY_FILE, opts)) await remove(RECOVERY_FILE, opts);
    } catch (e) { console.error('[persistence] recovery clear failed:', e); }
    return;
  }
  const s = lsStore();
  if (!s) return;
  try { s.removeItem(RECOVERY_KEY); } catch { /* ignore */ }
}
