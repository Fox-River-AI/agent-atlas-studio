// Language coverage census (DIAG-59) — the "no false fully-scanned" safety layer.
//
// THE RISK it closes: a repo may contain a language with NO scanner (Go/Rust/Java/
// Terraform/shell/COBOL…). Without a census, that code is silently unscanned yet the
// run reports success — a FALSE-COVERAGE attestation an audit can't tolerate. The
// census walks every repo, tallies files by language (incl. languages we can't scan),
// cross-references which languages were actually covered, and emits a LOUD estate
// coverage finding. Building a given language's scanner can wait — as long as its
// absence is reported, not hidden. (Randy 2026-06-13: "we can worry about that later
// as long as it is noticed loudly.")
//
// Host-aware, mirroring scanRepo: the file walk runs on the repo's host (studio-side
// Tauri FS for the Mac, the backend /census endpoint for HTTP hosts). Both return the
// same { counts: {language: nFiles}, total, truncated } shape; the framework maps +
// reports identically regardless of source.
import { languageForFile, languageLabel, NON_CODE_LANGS } from './languageMap';
import { scannableLanguages } from './scannerFramework';

const isTauri = () => typeof window !== 'undefined' && !!window.__TAURI_INTERNALS__;
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'out', '.next', 'coverage', '.turbo', 'target', 'venv', '.venv', '__pycache__', 'vendor']);
const MAX_CENSUS_FILES = 50000; // bounded; truncation is reported, never silent.

// Census ONE repo on its host. Returns { counts:{lang:n}, total, truncated }.
export async function censusRepo(repo, ctx = {}) {
  const hostKind = ctx.hostScanKind || 'http';
  if (hostKind === 'studio') return censusStudio(repo);
  return censusHttp(repo, ctx);
}

// --- studio-side (Mac host): walk via Tauri fs, count by language ---------------
async function censusStudio(repo) {
  if (!isTauri()) {
    // Browser dev can't read the FS — be honest rather than report 0.
    return { counts: {}, total: 0, truncated: false, unavailable: 'studio census needs the desktop app' };
  }
  const { readDir } = await import('@tauri-apps/plugin-fs');
  const counts = {};
  let total = 0, truncated = false;
  async function walk(dir) {
    if (total >= MAX_CENSUS_FILES) { truncated = true; return; }
    let entries = [];
    try { entries = await readDir(dir); } catch { return; }
    for (const e of entries) {
      if (total >= MAX_CENSUS_FILES) { truncated = true; return; }
      if (e.isDirectory) {
        if (SKIP_DIRS.has(e.name) || e.name.startsWith('.')) continue;
        await walk(`${dir.replace(/\/+$/, '')}/${e.name}`);
      } else {
        const lang = languageForFile(e.name);
        if (lang) { counts[lang] = (counts[lang] || 0) + 1; total++; }
      }
    }
  }
  await walk(repo.path);
  return { counts, total, truncated };
}

// --- http host (backend): ask the /census endpoint -----------------------------
async function censusHttp(repo, ctx) {
  const baseUrl = ctx.hostBaseUrl || (ctx.endpointUrl ? ctx.endpointUrl.replace(/generate-model\/?$/, '') : '');
  if (!baseUrl) return { counts: {}, total: 0, truncated: false, unavailable: 'no reachable backend' };
  const url = baseUrl.replace(/\/?$/, '/') + 'census';
  try {
    const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ root: repo.path }) });
    if (!res.ok) {
      // Older backend without /census → report unavailable, don't fake coverage.
      return { counts: {}, total: 0, truncated: false, unavailable: `backend census returned ${res.status}` };
    }
    const j = await res.json();
    // Backend returns raw extension counts {ext:n}; map ext→language here so the
    // language map stays in ONE place (the studio).
    const counts = {};
    let total = 0;
    for (const [ext, n] of Object.entries(j.counts || {})) {
      const lang = languageForFile('x.' + ext) || languageForFile(ext); // ext or bare name
      if (lang) { counts[lang] = (counts[lang] || 0) + n; total += n; }
    }
    return { counts, total, truncated: !!j.truncated };
  } catch (e) {
    return { counts: {}, total: 0, truncated: false, unavailable: `backend census error: ${e?.message || e}` };
  }
}

// Combine per-repo censuses + the set of languages actually SCANNED into a coverage
// finding (notes the merge appends to the estate). `perRepo` = [{repo, census}].
// `scannedLangs` = languages a scanner actually ran for (from the scan results).
export function coverageFinding(perRepo, scannedLangs) {
  const scannable = scannableLanguages();
  const agg = {}; // language → { files, repos:Set }
  let grandTotal = 0;
  const truncatedRepos = [], unavailableRepos = [];
  for (const { repo, census } of perRepo) {
    if (census.unavailable) { unavailableRepos.push(`${repo.label} (${census.unavailable})`); continue; }
    if (census.truncated) truncatedRepos.push(repo.label);
    for (const [lang, n] of Object.entries(census.counts)) {
      if (NON_CODE_LANGS.has(lang)) continue; // config/markup doesn't count toward code coverage
      (agg[lang] = agg[lang] || { files: 0, repos: new Set() }).files += n;
      agg[lang].repos.add(repo.label);
      grandTotal += n;
    }
  }

  // Partition detected languages into covered vs unscanned.
  const covered = [], unscanned = [];
  let coveredFiles = 0;
  for (const [lang, info] of Object.entries(agg)) {
    const wasScanned = scannedLangs.has(lang) || scannable.has(lang);
    const row = { lang, label: languageLabel(lang), files: info.files, repos: [...info.repos] };
    if (wasScanned) { covered.push(row); coveredFiles += info.files; }
    else unscanned.push(row);
  }
  covered.sort((a, b) => b.files - a.files);
  unscanned.sort((a, b) => b.files - a.files);

  const pct = grandTotal ? Math.round((coveredFiles / grandTotal) * 100) : 0;
  const notes = [];

  // The headline coverage line — always emitted (even at 100%, so the operator sees
  // the census ran and what it found).
  const detectedSummary = [...covered, ...unscanned]
    .sort((a, b) => b.files - a.files)
    .map((r) => `${r.label} ${r.files}`).join(', ');
  notes.push(`COVERAGE: code-source census ${pct}% scanned (${coveredFiles}/${grandTotal} code files). Detected languages: ${detectedSummary || 'none'}.`);

  // The loud gap — detected but no scanner ran.
  if (unscanned.length) {
    const list = unscanned.map((r) => `${r.label} (${r.files} file${r.files === 1 ? '' : 's'} in ${r.repos.join(', ')})`).join('; ');
    notes.push(`⚠ UNSCANNED LANGUAGES — these tiers were DETECTED but NOT assessed (no scanner): ${list}. Coverage is partial; a scanner for each is required before this can be called a complete assessment. «FILL: build/assign a scanner for each unscanned language, or document why it is out of scope».`);
  }
  if (unavailableRepos.length) {
    notes.push(`NOTE: census could not run on: ${unavailableRepos.join(', ')}. Those repos' language coverage is UNKNOWN, not zero.`);
  }
  if (truncatedRepos.length) {
    notes.push(`NOTE: census hit the ${MAX_CENSUS_FILES}-file cap in: ${truncatedRepos.join(', ')} — counts are partial.`);
  }

  return { notes, pct, covered, unscanned, grandTotal };
}
