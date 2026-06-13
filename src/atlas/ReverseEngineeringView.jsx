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

// Register the built-in scanner plugins once (DIAG-50). The backend Python/host
// scanner is plugin #1; future plugins (TS UI, SQL, Spark) register here too.
registerScanner(backendScanner);

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

  // The operator DECLARES which codebases comprise this system — the tool doesn't
  // pre-know them. A repo is { label, path, preset? }. Presets are convenience
  // shortcuts ("this deployment's known repos"), not the only way in.
  const [repos, setRepos] = useState([]);        // the set to scan
  const [presets, setPresets] = useState([]);    // optional example shortcuts (this deployment)
  const [browseRoot, setBrowseRoot] = useState('');
  const [pathInput, setPathInput] = useState(''); // free-text path being typed
  // Host folder browser: navigate the SCANNER host's filesystem to pick repos.
  const [browse, setBrowse] = useState(null); // { path, parent, entries } | null
  const [browseBusy, setBrowseBusy] = useState(false);

  // Derive sibling endpoint URLs (presets/list-dir) from the generate URL. The scan
  // URL itself is owned by the backend scanner plugin now.
  const base = (suffix) => (endpointUrl ? endpointUrl.replace(/generate-model\/?$/, suffix) : '');

  // Pull any known-repo shortcuts the backend offers (optional — the operator can
  // always just type paths). These are convenience, not the source of truth.
  useEffect(() => {
    if (!endpointUrl) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(base('scan-presets'));
        if (!res.ok) return;
        const j = await res.json();
        if (!cancelled) { setPresets(j.presets || []); setBrowseRoot(j.browseRoot || ''); }
      } catch { /* shortcuts are optional */ }
    })();
    return () => { cancelled = true; };
  }, [endpointUrl]);

  // Open / navigate the scanner-host folder browser.
  const openBrowse = (path) => navigate(path || browseRoot || '');
  const navigate = async (path) => {
    setErr(null); setBrowseBusy(true);
    try {
      const res = await fetch(base('list-dir'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path: path || undefined }) });
      if (!res.ok) { const t = await res.text().catch(() => ''); throw new Error(`Browse failed: ${res.status} ${t.slice(0, 120)}`); }
      setBrowse(await res.json());
    } catch (e) {
      setErr(`Could not browse the scanner host. [${e?.message || e}]`);
    } finally { setBrowseBusy(false); }
  };
  const addBrowsedRepo = (entry) => {
    addRepo({ label: entry.name, path: entry.path });
  };

  const addRepo = (repo) => {
    setRepos((rs) => rs.some((r) => (r.preset && r.preset === repo.preset) || r.path === repo.path) ? rs : [...rs, repo]);
  };
  const removeRepo = (i) => setRepos((rs) => rs.filter((_, j) => j !== i));
  const addTypedPath = () => {
    const p = pathInput.trim();
    if (!p) return;
    addRepo({ label: p.replace(/\/+$/, '').split('/').pop() || p, path: p });
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
    try {
      for (const repo of repos) {
        const recovered = await scanRepo(repo, { endpointUrl });
        acc = mergeRecovered(acc, recovered, repo.label);
      }
      if (acc?.orchestratorId) setOrchId(acc.orchestratorId);
      setResult(acc);
    } catch (e) {
      setErr(`${e?.message || e} (backend reachable + CORS-open? path correct on the host?)`);
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
                <code className="atlas-re-reppath">{r.preset ? `(preset) ${r.path}` : r.path}</code>
                <button className="atlas-re-repx" onClick={() => removeRepo(i)} title="Remove">×</button>
              </li>
            ))}
          </ul>
        )}
        <div className="atlas-re-repoadd">
          <button className="atlas-re-browsebtn" onClick={() => openBrowse()} disabled={!endpointUrl} title="Browse the scanner host's filesystem to pick repo folders">🗀 Browse host…</button>
          <input value={pathInput} onChange={(e) => setPathInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') addTypedPath(); }}
            placeholder="…or type a path on the scanner host" />
          <button onClick={addTypedPath} disabled={!pathInput.trim()}>+ Add path</button>
          {presets.filter((p) => p.available && !repos.some((r) => r.preset === p.id)).map((p) => (
            <button key={p.id} className="atlas-re-presetbtn" onClick={() => addRepo({ label: p.id, path: p.path, preset: p.id })}
              title={`example shortcut · ${p.path}`}>+ {p.id} (example)</button>
          ))}
        </div>
      </div>

      {/* Host folder browser — navigates the SCANNER host's filesystem. */}
      {browse && (
        <div className="atlas-modal-backdrop" onClick={() => setBrowse(null)}>
          <div className="atlas-modal atlas-re-browser" onClick={(e) => e.stopPropagation()}>
            <div className="atlas-re-browser-head">
              <h3>Scanner host — pick repo folders</h3>
              <button className="atlas-re-browser-x" onClick={() => setBrowse(null)}>×</button>
            </div>
            <div className="atlas-re-browser-bar">
              <button disabled={!browse.parent || browseBusy} onClick={() => navigate(browse.parent)} title="Up">↑</button>
              <code className="atlas-re-browser-path">{browse.path}</code>
            </div>
            <div className="atlas-re-browser-list">
              {browseBusy && <div className="atlas-empty">Loading…</div>}
              {!browseBusy && browse.entries.length === 0 && <div className="atlas-empty">No subfolders here.</div>}
              {!browseBusy && browse.entries.map((e) => (
                <div key={e.path} className="atlas-re-browser-row">
                  <button className="atlas-re-browser-open" onClick={() => navigate(e.path)} title="Open">
                    🗀 {e.name} {e.isRepo && <span className="atlas-re-browser-repo">repo</span>}
                  </button>
                  <button className="atlas-re-browser-add" disabled={repos.some((r) => r.path === e.path)} onClick={() => addBrowsedRepo(e)}>
                    {repos.some((r) => r.path === e.path) ? 'added' : '+ add'}
                  </button>
                </div>
              ))}
            </div>
            <p className="atlas-re-browser-foot">
              Browsing the <strong>scanner host</strong> ({browseRoot}). For code that lives in the cloud (AWS/Azure/GitHub),
              clone it to this host first, then pick the clone here.
            </p>
            <div className="atlas-modal-actions">
              <button onClick={() => setBrowse(null)}>Done</button>
            </div>
          </div>
        </div>
      )}

      {err && <div className="atlas-re-msg err">{err}</div>}

      {result && (
        <div className="atlas-re-body">
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
