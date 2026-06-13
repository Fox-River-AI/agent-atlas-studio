// Studio-side directory lister (the Mac host's /list-dir).
//
// The Axiom host browses via the backend's HTTP /list-dir; the Studio-Mac host has
// no server — it browses the LOCAL filesystem through Tauri's fs plugin. This module
// emits the SAME shape the backend /list-dir returns, so the existing folder-browser
// modal renders either host with no special-casing:
//   { path, parent, entries: [ { name, path, isRepo, language } ] }
//
// Language auto-detection mirrors the backend's _detect_language (markers only, no
// file contents): the two listers must agree so a repo tags the same on either host.
// Reachable here = anything the Mac OS can open under the fs capability scope
// ($HOME/** today). An SMB mount outside that scope is intentionally NOT reachable —
// the Linux repos are scanned ON Linux (the Axiom host), not through a Mac mount.
import { readDir } from '@tauri-apps/plugin-fs';
import { homeDir, join } from '@tauri-apps/api/path';

export const isTauri = () => typeof window !== 'undefined' && !!window.__TAURI_INTERNALS__;

// Repo markers (any one present in a dir → it's a repo root worth offering).
const REPO_MARKERS = ['.git', 'package.json', 'pyproject.toml', 'requirements.txt', 'Cargo.toml', 'go.mod', 'pom.xml', 'build.gradle'];

// Home-dir clutter that is never source code — hidden from the browser so the
// operator sees their code workspace, not OS/cloud-sync folders. Matched on the dir
// name (case-insensitive, prefix for the cloud-sync folders that append an account).
const NOISE_DIRS = ['library', 'applications', 'movies', 'music', 'pictures', 'public', 'desktop'];
const NOISE_PREFIXES = ['creative cloud files', 'onedrive', 'dropbox', 'google drive', 'icloud'];
const isNoiseDir = (name) => {
  const n = name.toLowerCase();
  return NOISE_DIRS.includes(n) || NOISE_PREFIXES.some((p) => n.startsWith(p));
};

// Best-effort language from a directory's immediate children's NAMES (cheap; the
// scanner refines it). Kept in lockstep with backend scan.py:_detect_language.
function detectLanguage(names) {
  const has = (n) => names.includes(n);
  const hasExt = (ext) => names.some((n) => n.toLowerCase().endsWith(ext));
  if (has('package.json') || has('tsconfig.json') || hasExt('.tsx') || hasExt('.ts')) {
    // a python repo can carry a JS build tool; require a TS/JS signal AND no python marker to call it TS
    if (!(has('pyproject.toml') || has('requirements.txt') || has('setup.py'))) return 'typescript';
  }
  if (has('pyproject.toml') || has('requirements.txt') || has('setup.py') || hasExt('.py')) {
    if (names.some((n) => n.toLowerCase().endsWith('.ipynb')) || has('databricks.yml')) return 'spark';
    return 'python';
  }
  if (hasExt('.sql')) return 'sql';
  return null;
}

// When the repo ROOT has no language markers (a monorepo), look one level into the
// usual source subdirs and take the first language we can name. Cheap + bounded.
const SUBDIR_HINTS = ['app', 'src', 'frontend', 'ui', 'web', 'client', 'core', 'backend', 'server', 'api', 'services'];
async function detectMonorepoLanguage(repoPath, rootNames) {
  const candidates = rootNames.filter((n) => SUBDIR_HINTS.includes(n.toLowerCase()));
  for (const sub of candidates) {
    try {
      const subPath = await joinPath(repoPath, sub);
      const names = (await readDir(subPath)).map((c) => c.name);
      const lang = detectLanguage(names);
      if (lang) return lang;
      // one more level (e.g. app/genai-workshop-tauri/package.json)
      for (const inner of names) {
        try {
          const innerNames = (await readDir(await joinPath(subPath, inner))).map((c) => c.name);
          const l2 = detectLanguage(innerNames);
          if (l2) return l2;
        } catch { /* skip */ }
      }
    } catch { /* skip unreadable subdir */ }
  }
  return null;
}

// List one directory. `path` undefined → start at the Mac home dir.
export async function listDirStudio(path) {
  if (!isTauri()) {
    throw new Error('Folder browsing on this host requires the desktop app (Tauri). In browser dev, add the repo by typed path.');
  }
  const home = await safeHome();
  const dir = path || home;
  const atHome = dir === home; // only filter OS/cloud clutter at the top level
  const raw = await readDir(dir); // [{ name, isDirectory, isFile, ... }]
  const entries = [];
  for (const e of raw) {
    if (!e.isDirectory) continue;
    if (e.name.startsWith('.') && e.name !== '.') continue; // hide dotdirs at the browse level
    if (atHome && isNoiseDir(e.name)) continue;             // hide Library / cloud-sync folders
    const full = await joinPath(dir, e.name);
    let childNames = [];
    try { childNames = (await readDir(full)).map((c) => c.name); } catch { /* unreadable; skip detection */ }
    const isRepo = REPO_MARKERS.some((m) => childNames.includes(m));
    let language = detectLanguage(childNames);
    // Monorepo fallback: the root may have no language markers (e.g. an app/ +
    // core/ + tools/ layout). Peek into common source subdirs to recover a tag so
    // the operator isn't left with an unset language they must fix by hand. The
    // scanner refines it; this just gets the dispatch axis right.
    if (isRepo && !language) language = await detectMonorepoLanguage(full, childNames);
    entries.push({ name: e.name, path: full, isRepo, language });
  }
  entries.sort((a, b) => (b.isRepo - a.isRepo) || a.name.localeCompare(b.name));
  return { path: dir, parent: parentOf(dir, home), entries };
}

function parentOf(dir, home) {
  // don't navigate above home (matches the fs capability scope)
  if (!dir || dir === home || dir === '/') return null;
  const idx = dir.replace(/\/+$/, '').lastIndexOf('/');
  if (idx <= 0) return null;
  const up = dir.slice(0, idx);
  return up.startsWith(home) ? up : home;
}

// --- path helpers that tolerate plugin-path being unavailable -----------------
async function safeHome() {
  try { return (await homeDir()).replace(/\/+$/, ''); }
  catch { return ''; }
}
async function joinPath(a, b) {
  try { return await join(a, b); }
  catch { return `${a.replace(/\/+$/, '')}/${b}`; }
}
