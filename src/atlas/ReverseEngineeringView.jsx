// Reverse Engineering view (R1 + R2): recover a declaration FROM existing code,
// take the few facts only the operator knows (intake), then surface the per-object
// governance gaps.
//
// The inverse of the Requirements front door. R1 scans the running backend and
// recovers the structural estate (MCP servers/tools, clinical workers, datastore/
// LLM systems) — structure, never governance. R2 then:
//   (a) INTAKE — a short Core-4 form for the Bucket-A facts that are NOT in code and
//       only the operator knows: system name, residency, compliance regimes, and the
//       control-plane/orchestration question. These apply estate-wide.
//   (b) REVIEW — runs the post-intake declaration through the SAME governance review
//       the Requirements front door uses (synthesized into a description), returning
//       the per-object «FILL: …» recommendations. The reverse-engineering gap list
//       IS that review output, in reverse.
// Adopt → loads it into the Declaration tab to ratify and govern.
//
// Demo-isolated: own component, own endpoints; touches no demo-path code.
import React, { useState, useEffect } from 'react';
import { scanRepo, mergeRecovered, registerScanner } from './reverse/scannerFramework';
import { backendScanner } from './reverse/backendScanner';
import { tsScanner } from './reverse/tsScanner';
import { listDirStudio, isTauri } from './reverse/studioLister';
import { censusRepo, coverageFinding } from './reverse/census';
import { resolveCrossTier } from './reverse/crossTier';

// Register the built-in scanner plugins once (DIAG-50). The backend Python/host
// scanner (plugin #1, runtimes:['http']) and the studio-side TS/React UI scanner
// (plugin #2, runtimes:['studio'], DIAG-51) register here; SQL/Spark plugins follow.
registerScanner(backendScanner);
registerScanner(tsScanner);

// Languages the operator can tag a repo with → routes it to a scanner plugin (and
// its runtime). Auto-detected on browse; overridable here. Extensible (DIAG-50).
const LANGUAGES = [
  { id: 'python', label: 'Python' },
  { id: 'typescript', label: 'TypeScript / React' },
  { id: 'sql', label: 'SQL' },
  { id: 'spark', label: 'Spark / Databricks' },
];

// HOSTS — a real estate's repos live on DIFFERENT machines/runtimes (Noesis: 2
// Python backends on the Axiom Linux host, the UI on this Mac; an enterprise: code
// on a CI checkout, a Bedrock account, an Amplify build…). A repo is dispatched by
// (host → which machine/runtime browses + scans it) AND (language → which parser).
// Each host owns:
//   - baseUrl:  where its /list-dir + /scan endpoints live (null = not reachable yet)
//   - browsable: can the folder-browser navigate this host's filesystem today
// The Axiom host's baseUrl is derived from the configured model endpoint. The
// Studio-Mac host scans/browses IN this studio process (Node-side) — that runtime
// is DIAG-51; until then it's declared (so the structure is production-correct) but
// its browse is disabled with a clear reason. Add AWS/Bedrock/Aurora hosts the same
// way later — no re-architecture, just another entry.
const HOST_AXIOM = 'axiom-linux';
const HOST_STUDIO = 'studio-mac';
// browseKind: 'http' → call this host's HTTP /list-dir; 'studio' → list the LOCAL
// filesystem in-process via Tauri fs (the Mac host has no server). browsable is set
// at runtime (the Mac host only browses inside the desktop app, not browser dev).
function hostsFor(endpointUrl, inTauri) {
  const axiomBase = endpointUrl ? endpointUrl.replace(/generate-model\/?$/, '') : '';
  return [
    { id: HOST_AXIOM, label: 'Axiom · Linux backend', baseUrl: axiomBase, browseKind: 'http', browsable: !!axiomBase,
      note: 'Python/SQL/Spark repos on the Axiom host. Browses + scans via the backend.' },
    { id: HOST_STUDIO, label: 'Studio · this Mac', baseUrl: null, browseKind: 'studio', browsable: inTauri,
      note: inTauri
        ? 'Repos on this machine (e.g. the UI). Browses the local filesystem; scan runs studio-side (the TS scanner lands in DIAG-51).'
        : 'Repos on this machine — folder browsing needs the desktop app (Tauri). In browser dev, add by typed path.' },
  ];
}

const RESIDENCY = [
  { v: 'on-prem', label: 'On-prem data center (nothing leaves the boundary)' },
  { v: 'in-region', label: 'Cloud, region-pinned (AWS/Azure/GCP, in-region)' },
  { v: 'any', label: 'Any / unconstrained' },
];
const REGIMES = ['HIPAA', 'SOC 2', 'GDPR', 'PCI-DSS', 'FedRAMP', 'EU AI Act', 'HITRUST', 'ISO 27001'];

export default function ReverseEngineeringView({ endpointUrl, onReviewText, onAdopt }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null); // framework estate: { objects, edges, notes, scannedRepos, orchestratorId }
  const [err, setErr] = useState(null);

  // Core-4 intake (Bucket-A facts not in the code).
  const [sysName, setSysName] = useState('');
  const [residency, setResidency] = useState('');
  const [regimes, setRegimes] = useState([]);
  const [orchId, setOrchId] = useState(''); // which recovered object IS the control plane

  // R2 review state.
  const [reviewBusy, setReviewBusy] = useState(false);
  const [review, setReview] = useState(null);

  // The operator DECLARES which codebases comprise the system — the tool pre-knows
  // NONE (no presets; that would be deployment-specific). A repo is { label, path }.
  // Discovery is purely: browse the workspace + type a path (+ git-URL clone later).
  const [repos, setRepos] = useState([]);          // the set to scan
  const [browseRoot, setBrowseRoot] = useState(''); // where the host browser starts
  const [pathInput, setPathInput] = useState('');   // free-text path being typed
  const [typedHost, setTypedHost] = useState(HOST_AXIOM); // host for the typed-path add
  // Host folder browser: navigate the workspace filesystem to pick repo folders.
  const [browse, setBrowse] = useState(null); // { path, parent, entries, hostId } | null
  const [browseBusy, setBrowseBusy] = useState(false);

  const HOSTS = hostsFor(endpointUrl, isTauri());
  const hostById = (id) => HOSTS.find((h) => h.id === id) || null;

  // Endpoint URLs are per-HOST: the browse (/list-dir, /scan-workspace) and scan
  // endpoints live on whichever machine owns the repo. base(suffix, hostId) builds
  // the URL on that host (defaults to the Axiom host, today's behavior).
  const base = (suffix, hostId = HOST_AXIOM) => {
    const h = hostById(hostId);
    return h && h.baseUrl ? h.baseUrl + suffix : '';
  };

  // Learn where the host browser should start (the workspace root).
  useEffect(() => {
    if (!endpointUrl) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(base('scan-workspace'));
        if (!res.ok) return;
        const j = await res.json();
        if (!cancelled) setBrowseRoot(j.browseRoot || '');
      } catch { /* optional */ }
    })();
    return () => { cancelled = true; };
  }, [endpointUrl]);

  // Open / navigate the folder browser FOR a given host. Only browsable hosts (a
  // reachable baseUrl) can be navigated; others tell the operator to use a typed path.
  const openBrowse = (hostId = HOST_AXIOM) => {
    const h = hostById(hostId);
    if (!h || !h.browsable) {
      setErr(`Can’t browse ${h ? h.label : 'that host'} yet — ${h?.note || 'no reachable endpoint'}. Add its repos by typed path.`);
      return;
    }
    // Axiom starts at its backend-reported workspace root; the Mac starts at $HOME.
    navigate(h.browseKind === 'http' ? (browseRoot || '') : '', hostId);
  };
  // Navigate ONE host. Axiom = HTTP /list-dir on the backend; Studio-Mac = local FS
  // via Tauri. Both return the SAME { path, parent, entries } shape, so the modal
  // renders either with no branching below this line.
  const navigate = async (path, hostId) => {
    const h = hostById(hostId);
    setErr(null); setBrowseBusy(true);
    try {
      let j;
      if (h?.browseKind === 'studio') {
        j = await listDirStudio(path || undefined);
      } else {
        const res = await fetch(base('list-dir', hostId), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path: path || undefined }) });
        if (!res.ok) { const t = await res.text().catch(() => ''); throw new Error(`Browse failed: ${res.status} ${t.slice(0, 120)}`); }
        j = await res.json();
      }
      setBrowse({ ...j, hostId });
    } catch (e) {
      setErr(`Could not browse ${h?.label || 'the host'}. [${e?.message || e}]`);
    } finally { setBrowseBusy(false); }
  };
  const addBrowsedRepo = (entry, hostId) => {
    // carry the auto-detected language + the host it was browsed on
    addRepo({ label: entry.name, path: entry.path, language: entry.language || '', host: hostId });
  };

  const addRepo = (repo) => {
    setRepos((rs) => rs.some((r) => r.path === repo.path && r.host === repo.host) ? rs : [...rs, repo]);
  };
  const removeRepo = (i) => setRepos((rs) => rs.filter((_, j) => j !== i));
  const setRepoLanguage = (i, language) => setRepos((rs) => rs.map((r, j) => j === i ? { ...r, language } : r));
  const setRepoHost = (i, host) => setRepos((rs) => rs.map((r, j) => j === i ? { ...r, host } : r));
  const addTypedPath = () => {
    const p = pathInput.trim();
    if (!p) return;
    // typed paths have no auto-detect — default to unknown; operator picks the language.
    // Host = whatever the typed-path host selector says (defaults to Axiom).
    addRepo({ label: p.replace(/\/+$/, '').split('/').pop() || p, path: p, language: '', host: typedHost });
    setPathInput('');
  };

  // Scan every repo in the set into ONE recovered estate, via the pluggable
  // framework: each repo is dispatched to its language's scanner plugin, and the
  // results are merged (dedupe + single union orchestrator) into one estate.
  const scanAll = async () => {
    if (!endpointUrl) { setErr('No scan endpoint configured. Set the model endpoint in Settings.'); return; }
    if (!repos.length) { setErr('Add at least one codebase to scan.'); return; }
    setErr(null); setReview(null); setResult(null); setBusy(true);
    let acc = null;
    const skipped = []; // repos that couldn't scan (no runtime yet, unreachable host)
    const censuses = []; // [{repo, census}] — language census per repo (DIAG-59)
    const scannedLangs = new Set(); // languages a scanner actually ran for
    try {
      for (const repo of repos) {
        // Each repo scans on ITS host. A repo whose (host, language) has no built
        // scanner doesn't abort the batch — we scan what we can and report the rest,
        // so a mixed estate (Python now, TS-on-Mac pending DIAG-51) still yields the
        // recoverable part instead of failing wholesale.
        const host = hostById(repo.host) || hostById(HOST_AXIOM);
        const ctx = { endpointUrl, hostBaseUrl: host?.baseUrl || null, hostLabel: host?.label, hostScanKind: host?.browseKind || 'http' };
        // Census the repo's language inventory REGARDLESS of whether the scan
        // succeeds — so an unscannable/unsupported tier is still counted + reported
        // loudly (no silent "fully covered"). Census failure is non-fatal.
        try { censuses.push({ repo, census: await censusRepo(repo, ctx) }); }
        catch (e) { censuses.push({ repo, census: { counts: {}, total: 0, truncated: false, unavailable: e?.message || String(e) } }); }
        try {
          const recovered = await scanRepo(repo, ctx);
          acc = mergeRecovered(acc, recovered, repo.label);
          if (repo.language) scannedLangs.add(repo.language);
        } catch (e) {
          skipped.push(`${repo.label}: ${e?.message || e}`);
        }
      }
      // Resolve cross-tier edges (DIAG-54): join the UI's service calls to the real
      // recovered backend tiers (UI→gateway→stores, UI→core→stores) by route/role
      // match + confidence; low-confidence joins are flagged, not asserted.
      if (acc) acc = resolveCrossTier(acc, {});
      // Append the estate-wide coverage finding to the recovered notes (DIAG-59).
      if (acc && censuses.length) {
        const cov = coverageFinding(censuses, scannedLangs);
        acc = { ...acc, notes: [...(acc.notes || []), ...cov.notes], coverage: cov };
      }
      if (acc?.orchestratorId) setOrchId(acc.orchestratorId);
      setResult(acc);
      if (skipped.length) {
        setErr(`Scanned ${acc ? acc.scannedRepos.length : 0} of ${repos.length}. Skipped:\n• ${skipped.join('\n• ')}`);
      } else if (!acc) {
        setErr('Nothing scanned — check the repos and try again.');
      }
    } catch (e) {
      setErr(`${e?.message || e}`);
    } finally { setBusy(false); }
  };

  const clearScan = () => { setResult(null); setReview(null); };

  // result is now the framework's merged estate: { objects, edges, notes, scannedRepos, orchestratorId }.
  const objs = result ? Object.values(result.objects) : [];
  const byKind = (k) => objs.filter((o) => o.kind === k);
  const toggleRegime = (r) => setRegimes((rs) => rs.includes(r) ? rs.filter((x) => x !== r) : [...rs, r]);

  // Apply the Core-4 intake estate-wide, returning a declaration model
  // {objects, edges, subjectAreas} ready to adopt. Residency → every system + agent
  // governance; regimes → the orchestrator; name/orch → the control plane object. We
  // DECLARE only what the operator stated; everything else stays a gap for review.
  const applyIntake = (estate) => {
    const objects = JSON.parse(JSON.stringify(estate.objects));
    const list = Object.values(objects);
    for (const o of list) { if (o.data && '_repo' in o.data) delete o.data._repo; } // strip UI-only tag
    const orch = orchId && objects[orchId] && objects[orchId].kind === 'orchestrator' ? objects[orchId] : list.find((o) => o.kind === 'orchestrator');
    if (orch) {
      if (regimes.length) orch.data.complianceRegimes = regimes;
      if (sysName.trim()) orch.data.description = `${sysName.trim()} — ${orch.data.description || 'orchestrated agentic system (recovered).'}`;
    }
    if (residency) {
      for (const o of list) {
        if (o.kind === 'task') continue;
        o.data.governance = { ...(o.data.governance || {}), residency };
      }
    }
    return { objects, edges: estate.edges || [], subjectAreas: [] };
  };

  // Synthesize a requirements-style description of the recovered (post-intake)
  // estate so the EXISTING governance review can run on it unchanged.
  const synthDescription = (model) => {
    const list = Object.values(model.objects);
    const orch = list.find((o) => o.kind === 'orchestrator');
    const L = [];
    L.push(`# ${sysName.trim() || 'Recovered system'} — recovered from code (reverse engineering)`);
    L.push('');
    L.push('This declaration was RECOVERED by scanning an existing codebase. Structure is known; governance is NOT (it was not in the code). Review for what must be declared.');
    L.push('');
    if (orch) L.push(`Control plane: ${orch.id}. Compliance regimes the system claims: ${(orch.data.complianceRegimes || []).join(', ') || 'NONE DECLARED'}. Residency: ${residency || 'NOT DECLARED'}.`);
    L.push('');
    L.push('## Agents (recovered)');
    for (const a of list.filter((o) => o.kind === 'agent')) L.push(`- ${a.id}: ${a.data.responsibility || 'recovered worker'}`);
    L.push('');
    L.push('## Systems (datastores / LLM the code touches)');
    for (const s of list.filter((o) => o.kind === 'system')) L.push(`- ${s.id} (${s.data.systemKind}): ${s.data.description || ''}`);
    L.push('');
    L.push('## Tools (recovered)');
    for (const t of list.filter((o) => o.kind === 'tool')) L.push(`- ${t.id}: ${t.data.description || ''}`);
    return L.join('\n');
  };

  const runReview = async () => {
    if (!onReviewText || !result) return;
    setErr(null); setReview(null); setReviewBusy(true);
    try {
      const enriched = applyIntake(result);
      const r = await onReviewText(synthDescription(enriched));
      setReview(r || { summary: '', recommendations: [] });
    } catch (e) {
      setErr(e?.message || String(e));
    } finally { setReviewBusy(false); }
  };

  const adopt = () => { if (onAdopt && result) onAdopt(applyIntake(result)); };

  const counts = result ? { agents: byKind('agent').length, tools: byKind('tool').length, systems: byKind('system').length } : null;

  return (
    <div className="atlas-re">
      <div className="atlas-re-head">
        <div>
          <h2>Reverse Engineering</h2>
          <p className="atlas-re-sub">
            Recover a declaration from an <strong>existing codebase</strong> — the inverse of the
            Requirements front door. Scan recovers structure; <em>governance is not in the code, so the
            gaps are the work.</em>
          </p>
        </div>
        <button className="primary" onClick={scanAll} disabled={busy || !endpointUrl || !repos.length}>
          {busy ? 'Scanning…' : `⟲ Scan ${repos.length || ''} codebase${repos.length === 1 ? '' : 's'}`}
        </button>
      </div>

      {!endpointUrl && <div className="atlas-re-hint">Set the model endpoint in Settings — the scan URL is derived from it.</div>}

      {/* The operator declares which codebases make up this system. */}
      <div className="atlas-re-repos">
        <div className="atlas-re-coltitle">Codebases that make up this system</div>
        {repos.length === 0 && <p className="atlas-re-reposhint">Add the repositories that comprise the system you’re assessing — then scan them as one. The tool doesn’t assume what they are; you tell it.</p>}
        {repos.length > 0 && (
          <ul className="atlas-re-repolist">
            {repos.map((r, i) => (
              <li key={i}>
                <span className="atlas-re-replabel">{r.label}</span>
                <code className="atlas-re-reppath">{r.path}</code>
                <select className="atlas-re-rephost" value={r.host || HOST_AXIOM} onChange={(e) => setRepoHost(i, e.target.value)}
                  title="Host → which machine/runtime scans this repo">
                  {HOSTS.map((h) => <option key={h.id} value={h.id}>{h.label}</option>)}
                </select>
                <select className="atlas-re-replang" value={r.language || ''} onChange={(e) => setRepoLanguage(i, e.target.value)}
                  title="Language → which scanner handles this repo">
                  <option value="">language…</option>
                  {LANGUAGES.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
                </select>
                <button className="atlas-re-repx" onClick={() => removeRepo(i)} title="Remove">×</button>
              </li>
            ))}
          </ul>
        )}
        <div className="atlas-re-repoadd">
          {/* One browse button per host — repos live on different machines. A host
              with no reachable runtime (Studio-Mac until DIAG-51) is shown disabled
              with its reason, so the operator knows to use a typed path instead. */}
          {HOSTS.map((h) => (
            <button key={h.id} className="atlas-re-browsebtn" onClick={() => openBrowse(h.id)}
              disabled={!h.browsable} title={h.browsable ? `Browse ${h.label}` : h.note}>
              🗀 Browse {h.label}{!h.browsable && ' (typed path only)'}
            </button>
          ))}
          <span className="atlas-re-addpath">
            <select className="atlas-re-rephost" value={typedHost} onChange={(e) => setTypedHost(e.target.value)}
              title="Which host this path is on">
              {HOSTS.map((h) => <option key={h.id} value={h.id}>{h.label}</option>)}
            </select>
            <input value={pathInput} onChange={(e) => setPathInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') addTypedPath(); }}
              placeholder="…or type a repo path on that host" />
            <button onClick={addTypedPath} disabled={!pathInput.trim()}>+ Add path</button>
          </span>
        </div>
      </div>

      {/* Host folder browser — navigates the SCANNER host's filesystem. */}
      {browse && (
        <div className="atlas-modal-backdrop" onClick={() => setBrowse(null)}>
          <div className="atlas-modal atlas-re-browser" onClick={(e) => e.stopPropagation()}>
            <div className="atlas-re-browser-head">
              <h3>{hostById(browse.hostId)?.label || 'Code workspace'} — pick repo folders</h3>
              <button className="atlas-re-browser-x" onClick={() => setBrowse(null)}>×</button>
            </div>
            <div className="atlas-re-browser-bar">
              <button disabled={!browse.parent || browseBusy} onClick={() => navigate(browse.parent, browse.hostId)} title="Up">↑</button>
              <code className="atlas-re-browser-path">{browse.path}</code>
            </div>
            <div className="atlas-re-browser-list">
              {browseBusy && <div className="atlas-empty">Loading…</div>}
              {!browseBusy && browse.entries.length === 0 && <div className="atlas-empty">No subfolders here.</div>}
              {!browseBusy && browse.entries.map((e) => (
                <div key={e.path} className="atlas-re-browser-row">
                  <button className="atlas-re-browser-open" onClick={() => navigate(e.path, browse.hostId)} title="Open">
                    🗀 {e.name} {e.isRepo && <span className="atlas-re-browser-repo">repo</span>}
                    {e.language && <span className="atlas-re-browser-lang">{e.language}</span>}
                  </button>
                  <button className="atlas-re-browser-add" disabled={repos.some((r) => r.path === e.path && r.host === browse.hostId)} onClick={() => addBrowsedRepo(e, browse.hostId)}>
                    {repos.some((r) => r.path === e.path && r.host === browse.hostId) ? 'added' : '+ add'}
                  </button>
                </div>
              ))}
            </div>
            <p className="atlas-re-browser-foot">
              Browsing <strong>{hostById(browse.hostId)?.label || 'a host'}</strong> ({browse.path}). A real system’s
              repos span machines — browse each reachable host, or add repos on other hosts by typed path. Reverse
              engineering analyzes source, not live infra (any language, any origin: GitHub/CodeCommit/Azure DevOps).
            </p>
            <div className="atlas-modal-actions">
              <button onClick={() => setBrowse(null)}>Done</button>
            </div>
          </div>
        </div>
      )}

      {err && <div className="atlas-re-msg err" style={{ whiteSpace: 'pre-line' }}>{err}</div>}

      {result && (
        <div className="atlas-re-body">
          {/* Coverage banner (DIAG-59): the no-false-"fully scanned" safety signal,
              shown LOUDLY above the structural results. Unscanned languages here mean
              whole tiers were not assessed. */}
          {result.coverage && (
            <div className={`atlas-re-coverage ${result.coverage.unscanned.length ? 'warn' : 'ok'}`}>
              <div className="atlas-re-coverage-head">
                <span className="atlas-re-coverage-pct">{result.coverage.pct}%</span>
                <span>of code source scanned ({result.coverage.grandTotal} files across {result.coverage.covered.length + result.coverage.unscanned.length} detected language{(result.coverage.covered.length + result.coverage.unscanned.length) === 1 ? '' : 's'})</span>
              </div>
              {result.coverage.unscanned.length > 0 && (
                <div className="atlas-re-coverage-gap">
                  ⚠ <strong>Detected but NOT assessed</strong> (no scanner): {result.coverage.unscanned.map((u) => `${u.label} (${u.files})`).join(', ')}.
                  These tiers are uncovered — a scanner is required before this is a complete assessment.
                </div>
              )}
            </div>
          )}

          {/* Core-4 intake: facts only the operator knows. */}
          <div className="atlas-re-intake">
            <div className="atlas-re-coltitle">Tell Atlas what the code can’t — applies across the estate</div>
            <div className="atlas-re-intake-grid">
              <label>System name
                <input value={sysName} onChange={(e) => setSysName(e.target.value)} placeholder="e.g. Noesis Health" />
              </label>
              <label>Where does it run? (residency)
                <select value={residency} onChange={(e) => setResidency(e.target.value)}>
                  <option value="">— not set —</option>
                  {RESIDENCY.map((r) => <option key={r.v} value={r.v}>{r.label}</option>)}
                </select>
              </label>
              <label>Control plane / orchestrator
                <select value={orchId} onChange={(e) => setOrchId(e.target.value)}>
                  <option value="">— no single control plane (inferred) —</option>
                  {objs.map((o) => <option key={o.id} value={o.id}>{o.id}{o.kind !== 'orchestrator' ? ` (${o.kind})` : ''}</option>)}
                </select>
              </label>
            </div>
            <div className="atlas-re-regimes">
              <span className="atlas-re-reglabel">Compliance regimes this system must satisfy:</span>
              <div className="atlas-checkset">
                {REGIMES.map((r) => (
                  <label key={r} className="atlas-check">
                    <input type="checkbox" checked={regimes.includes(r)} onChange={() => toggleRegime(r)} />{r}
                  </label>
                ))}
              </div>
            </div>
          </div>

          <div className="atlas-re-summary">
            <span className="atlas-re-scanned">
              Scanned: {(result.scannedRepos || []).map((r) => <code key={r}>{r}</code>).reduce((a, b) => a === null ? [b] : [...a, ' · ', b], null)}
              <button className="atlas-re-clear" onClick={clearScan} title="Clear and start a fresh recovery">clear</button>
            </span>
            <div className="atlas-re-counts">
              <span>{counts.agents} agents</span><span>{counts.tools} tools</span><span>{counts.systems} systems</span>
            </div>
            <button className="atlas-re-review" onClick={runReview} disabled={reviewBusy || !onReviewText}>
              {reviewBusy ? 'Reviewing…' : '✓ Review for governance gaps'}
            </button>
            {onAdopt && <button className="atlas-re-adopt" onClick={adopt} title="Load the union of all scanned repos into the Declaration tab to ratify and govern">Adopt as declaration →</button>}
          </div>

          <div className="atlas-re-cols">
            <div className="atlas-re-estate">
              <div className="atlas-re-coltitle">Recovered estate</div>
              {['agent', 'tool', 'system'].map((kind) => (
                <div key={kind} className="atlas-re-group">
                  <div className="atlas-re-grouphd">{kind === 'agent' ? 'Agents (workers + MCP servers)' : kind === 'tool' ? 'Tools (MCP)' : 'Systems (datastores / LLM)'}</div>
                  {byKind(kind).map((o) => (
                    <div key={o.id} className="atlas-re-obj">
                      <span className="atlas-re-objid">{o.id}</span>
                      {o.data?._repo && <span className="atlas-re-repo">{o.data._repo}</span>}
                      {kind === 'system' && <span className="atlas-re-objmeta">{o.data.systemKind} · {o.data.connection || 'hint —'}</span>}
                      <span className={`atlas-re-${o.data?.governance?.residency || regimes.length ? 'partial' : 'ungoverned'}`}>
                        {o.data?.governance?.residency || (kind === 'system' && residency) ? '◑ partial' : '⚠ ungoverned'}
                      </span>
                    </div>
                  ))}
                </div>
              ))}
            </div>

            <div className="atlas-re-gaps">
              <div className="atlas-re-coltitle">{review ? 'Governance gaps to declare' : 'What the code does NOT declare'}</div>
              {!review ? (
                <>
                  <p className="atlas-re-gaplead">
                    The scan recovers structure, not intent. Fill the intake above for what you know,
                    then <strong>Review for governance gaps</strong> to get the per-object declarations to add.
                  </p>
                  <ul className="atlas-re-notelist">
                    {result.notes.map((n, i) => <li key={i}>{n}</li>)}
                  </ul>
                </>
              ) : (
                <>
                  {review.summary && <p className="atlas-re-gaplead">{review.summary}</p>}
                  <ul className="atlas-re-notelist">
                    {(review.recommendations || []).map((r, i) => (
                      <li key={i} className={`sev-${(r.severity || 'medium').toLowerCase()}`}>
                        <strong>{(r.severity || 'medium').toUpperCase()} · {r.area}:</strong> {r.suggestion || r.finding}
                      </li>
                    ))}
                  </ul>
                  <p className="atlas-re-foot">
                    These are the declarations to add to govern the recovered code. Adopt the estate into the
                    Declaration tab, then fill them in — the same loop the Requirements front door uses, in reverse.
                  </p>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {!result && !busy && !err && repos.length > 0 && (
        <div className="atlas-re-empty">
          <p>Click <strong>Scan {repos.length} codebase{repos.length === 1 ? '' : 's'}</strong> to recover one declaration across the set.
          The scan reads structure only and never emits credentials — system connections are recorded as hints, and shared datastores merge into one.</p>
        </div>
      )}
    </div>
  );
}
