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
import React, { useState } from 'react';
import { normalizeGeneratedModel } from './normalizeModel';

const RESIDENCY = [
  { v: 'on-prem', label: 'On-prem data center (nothing leaves the boundary)' },
  { v: 'in-region', label: 'Cloud, region-pinned (AWS/Azure/GCP, in-region)' },
  { v: 'any', label: 'Any / unconstrained' },
];
const REGIMES = ['HIPAA', 'SOC 2', 'GDPR', 'PCI-DSS', 'FedRAMP', 'EU AI Act', 'HITRUST', 'ISO 27001'];

export default function ReverseEngineeringView({ endpointUrl, onReviewText, onAdopt }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null); // { model, notes, scannedRoot }
  const [err, setErr] = useState(null);

  // Core-4 intake (Bucket-A facts not in the code).
  const [sysName, setSysName] = useState('');
  const [residency, setResidency] = useState('');
  const [regimes, setRegimes] = useState([]);
  const [orchId, setOrchId] = useState(''); // which recovered object IS the control plane

  // R2 review state.
  const [reviewBusy, setReviewBusy] = useState(false);
  const [review, setReview] = useState(null);

  const scanUrl = endpointUrl ? endpointUrl.replace(/generate-model\/?$/, 'scan-codebase') : '';

  const scan = async () => {
    if (!endpointUrl) { setErr('No scan endpoint configured. Set the model endpoint in Settings.'); return; }
    setErr(null); setResult(null); setReview(null); setBusy(true);
    try {
      const res = await fetch(scanUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({}) });
      if (!res.ok) throw new Error(`Scan endpoint returned ${res.status} ${res.statusText}.`);
      const json = await res.json();
      const { model } = normalizeGeneratedModel(json.declaration || {});
      setResult({ model, notes: json.notes || [], scannedRoot: json.scannedRoot });
      // Pre-fill the orchestration question with the inferred orchestrator if any.
      const inferred = Object.values(model.objects).find((o) => o.kind === 'orchestrator');
      setOrchId(inferred ? inferred.id : '');
    } catch (e) {
      setErr(`Could not reach the scan endpoint (${scanUrl}). Check the backend is running and CORS-open. [${e?.message || e}]`);
    } finally { setBusy(false); }
  };

  const objs = result ? Object.values(result.model.objects) : [];
  const byKind = (k) => objs.filter((o) => o.kind === k);
  const toggleRegime = (r) => setRegimes((rs) => rs.includes(r) ? rs.filter((x) => x !== r) : [...rs, r]);

  // Apply the Core-4 intake estate-wide, returning a new model. Residency → every
  // system + agent governance; regimes → the orchestrator; name/orch → the control
  // plane object. We DECLARE only what the operator stated; everything else stays a
  // gap for the per-object review.
  const applyIntake = (model) => {
    const objects = JSON.parse(JSON.stringify(model.objects));
    const list = Object.values(objects);
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
    return { ...model, objects };
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
      const enriched = applyIntake(result.model);
      const r = await onReviewText(synthDescription(enriched));
      setReview(r || { summary: '', recommendations: [] });
    } catch (e) {
      setErr(e?.message || String(e));
    } finally { setReviewBusy(false); }
  };

  const adopt = () => { if (onAdopt && result) onAdopt(applyIntake(result.model)); };

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
        <button className="primary" onClick={scan} disabled={busy || !endpointUrl}>
          {busy ? 'Scanning…' : '⟲ Scan codebase'}
        </button>
      </div>

      {!endpointUrl && <div className="atlas-re-hint">Set the model endpoint in Settings — the scan URL is derived from it.</div>}
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
            <span className="atlas-re-scanned">Scanned <code>{result.scannedRoot}</code></span>
            <div className="atlas-re-counts">
              <span>{counts.agents} agents</span><span>{counts.tools} tools</span><span>{counts.systems} systems</span>
            </div>
            <button className="atlas-re-review" onClick={runReview} disabled={reviewBusy || !onReviewText}>
              {reviewBusy ? 'Reviewing…' : '✓ Review for governance gaps'}
            </button>
            {onAdopt && <button className="atlas-re-adopt" onClick={adopt} title="Load into the Declaration tab to ratify and govern">Adopt as declaration →</button>}
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

      {!result && !busy && !err && (
        <div className="atlas-re-empty">
          <p>Click <strong>Scan codebase</strong> to recover the declaration from the running backend.
          The scan reads structure only and never emits credentials — system connections are recorded as hints.</p>
        </div>
      )}
    </div>
  );
}
