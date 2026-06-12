// Reverse Engineering view (DIAG, R1): recover a declaration FROM existing code.
//
// The inverse of the Requirements front door. Instead of requirements → declaration,
// this scans a running codebase (the Noesis backend) and recovers what's ACTUALLY
// there — the MCP tool servers + tools, the clinical workers, the datastore/LLM
// systems — as a first-cut declaration. It recovers STRUCTURE (parsing), never
// governance: thresholds, prohibitions, data classification, residency are DECLARED
// decisions, not facts in the code, so they come back empty. That gap — "here's what
// your code does, here's everything about it that isn't governed" — is the point.
//
// Fully isolated from the demo: own component, own endpoint (/scan-codebase). It can
// hand the recovered declaration to the Declaration tab to ratify + govern, but it
// does not touch the seed, generator, conformance, or Monitoring.
import React, { useState } from 'react';
import { normalizeGeneratedModel } from './normalizeModel';

export default function ReverseEngineeringView({ endpointUrl, onAdopt }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null); // { objects, notes, scannedRoot }
  const [err, setErr] = useState(null);

  const scanUrl = endpointUrl ? endpointUrl.replace(/generate-model\/?$/, 'scan-codebase') : '';

  const scan = async () => {
    if (!endpointUrl) { setErr('No scan endpoint configured. Set the model endpoint in Settings (the scan URL is derived from it).'); return; }
    setErr(null); setResult(null); setBusy(true);
    try {
      const res = await fetch(scanUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({}) });
      if (!res.ok) { throw new Error(`Scan endpoint returned ${res.status} ${res.statusText}.`); }
      const json = await res.json();
      const { model } = normalizeGeneratedModel(json.declaration || {});
      setResult({ model, notes: json.notes || [], scannedRoot: json.scannedRoot });
    } catch (e) {
      setErr(`Could not reach the scan endpoint (${scanUrl}). Check the backend is running and CORS-open. [${e?.message || e}]`);
    } finally { setBusy(false); }
  };

  const objs = result ? Object.values(result.model.objects) : [];
  const byKind = (k) => objs.filter((o) => o.kind === k);
  const counts = result ? {
    agents: byKind('agent').length, tools: byKind('tool').length,
    systems: byKind('system').length, orchestrators: byKind('orchestrator').length,
  } : null;

  return (
    <div className="atlas-re">
      <div className="atlas-re-head">
        <div>
          <h2>Reverse Engineering</h2>
          <p className="atlas-re-sub">
            Recover a declaration from an <strong>existing codebase</strong> — the inverse of the
            Requirements front door. This scans the running backend and recovers the agentic estate
            it finds; <em>governance is not in the code, so the gaps it surfaces are the work.</em>
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
          <div className="atlas-re-summary">
            <span className="atlas-re-scanned">Scanned <code>{result.scannedRoot}</code></span>
            <div className="atlas-re-counts">
              <span>{counts.agents} agents</span>
              <span>{counts.tools} tools</span>
              <span>{counts.systems} systems</span>
            </div>
            {onAdopt && (
              <button className="atlas-re-adopt" onClick={() => onAdopt(result.model)}
                title="Load the recovered declaration into the Declaration tab to ratify and govern it">
                Adopt as declaration →
              </button>
            )}
          </div>

          <div className="atlas-re-cols">
            {/* the recovered estate */}
            <div className="atlas-re-estate">
              <div className="atlas-re-coltitle">Recovered estate</div>
              {['agent', 'tool', 'system'].map((kind) => (
                <div key={kind} className="atlas-re-group">
                  <div className="atlas-re-grouphd">{kind === 'agent' ? 'Agents (workers + MCP servers)' : kind === 'tool' ? 'Tools (MCP)' : 'Systems (datastores / LLM)'}</div>
                  {byKind(kind).map((o) => (
                    <div key={o.id} className="atlas-re-obj">
                      <span className="atlas-re-objid">{o.id}</span>
                      {kind === 'system' && <span className="atlas-re-objmeta">{o.data.systemKind} · {o.data.connection || 'hint —'}</span>}
                      {/* governance is the GAP — show it empty, in red */}
                      <span className="atlas-re-ungoverned">⚠ ungoverned</span>
                    </div>
                  ))}
                </div>
              ))}
            </div>

            {/* the governance gap — the wedge */}
            <div className="atlas-re-gaps">
              <div className="atlas-re-coltitle">What the code does NOT declare</div>
              <p className="atlas-re-gaplead">
                The scan recovers structure, not intent. Every recovered object is <strong>ungoverned</strong>:
                no data classification, residency, grounding threshold, prohibited action, or compliance
                regime — because none of that is in the source. These are the declarations a human must add.
              </p>
              <ul className="atlas-re-notelist">
                {result.notes.map((n, i) => <li key={i}>{n}</li>)}
              </ul>
              <p className="atlas-re-foot">
                Adopt this as a declaration, then run the governance review to turn each gap into a
                concrete declaration to make — the same loop the Requirements front door uses, in reverse.
              </p>
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
