// Monitoring view (DIAG-49): the declared-vs-running conformance console.
//
// Replays a captured Causeway batch (~100 objects, ~1800 OTel spans), evaluates
// each against the DECLARED model, and surfaces FINDINGS — drift (rule violations)
// and operational errors — against a stream of mostly-conformant activity. It ends
// on the attestation artifact: the exportable, NIST-tagged evidence a compliance
// buyer hands an auditor. No live platform needed; the diff logic is identical to
// production. The boundary the demo makes explicit: Atlas governs DECLARED gates,
// it does not measure quality — "the confidence score came from the runtime; the
// rule that it must refuse below 0.8 came from the registry; Atlas notices when
// the two disagree."
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { CAUSEWAY_TRACE } from './conformance/traceFixture';
import { DECLARED_NODES, DECLARED_EDGES } from './conformance/declaredFixture';
import { runConformance, buildAttestation } from './conformance/conformanceEngine';

const SEV_RANK = { critical: 0, high: 1, medium: 2, info: 3 };
const AGENTS = ['discovery-agent', 'parsing-agent', 'mapping-agent', 'codegen-agent', 'validation-agent', 'review-router-agent'];
const TAG_LABEL = { violation: 'VIOLATION', omission: 'OMISSION', shadow: 'SHADOW AGENT', error: 'ERROR' };

export default function MonitoringView() {
  const trace = CAUSEWAY_TRACE;
  const spans = trace.spans;
  const result = useMemo(() => runConformance(DECLARED_NODES, DECLARED_EDGES, trace), [trace]);

  // Replay: how many spans have "run". At 1800 spans we advance in chunks so the
  // stream looks live without taking minutes.
  const STEP = 25;
  const [cursor, setCursor] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [showAttestation, setShowAttestation] = useState(false);
  const timer = useRef(null);

  // Filters (operational console): scope by agent, and by finding type.
  const [agentFilter, setAgentFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('findings'); // findings | violations | omissions | shadows | errors

  useEffect(() => {
    if (!playing) { if (timer.current) clearInterval(timer.current); return; }
    timer.current = setInterval(() => {
      setCursor((c) => { const nx = Math.min(spans.length, c + STEP); if (nx >= spans.length) setPlaying(false); return nx; });
    }, 120);
    return () => { if (timer.current) clearInterval(timer.current); };
  }, [playing, spans.length]);

  const reset = () => { setCursor(0); setPlaying(false); setShowAttestation(false); };
  const finished = cursor >= spans.length;

  // Findings revealed so far: a finding shows once its evidence span has run
  // (span-less findings reveal at the end). Then apply the filters.
  const runSpanIds = new Set(spans.slice(0, cursor).map((s) => s.spanId));
  const allFindings = [...result.violations, ...result.omissions, ...result.shadows, ...result.errors];
  // span-anchored findings reveal as their span runs; span-less ones (omissions)
  // reveal at the end (you can only conclude "it never ran" once the run is done).
  const revealed = allFindings.filter((f) => (f.spanId ? runSpanIds.has(f.spanId) : finished));
  const filtered = revealed
    .filter((f) => agentFilter === 'all' || f.agentId === agentFilter)
    .filter((f) => typeFilter === 'findings'
      || (typeFilter === 'violations' && f.status === 'violation')
      || (typeFilter === 'omissions' && f.status === 'omission')
      || (typeFilter === 'shadows' && f.status === 'shadow')
      || (typeFilter === 'errors' && f.status === 'error'))
    .sort((a, b) => SEV_RANK[a.severity] - SEV_RANK[b.severity]);

  // Counters reflect what's revealed (and respect the agent filter for honesty).
  const inScope = (f) => agentFilter === 'all' || f.agentId === agentFilter;
  const countShown = (st) => revealed.filter((f) => f.status === st && inScope(f)).length;
  const vShown = countShown('violation');
  const oShown = countShown('omission');
  const shShown = countShown('shadow');
  const eShown = countShown('error');
  const objectsSeen = Math.min(trace.objectCount, Math.ceil((cursor / spans.length) * trace.objectCount));

  const attestation = useMemo(() => buildAttestation(DECLARED_NODES, DECLARED_EDGES, trace, result), [result, trace]);

  const [exportMsg, setExportMsg] = useState(null);
  const exportAttestation = async () => {
    const md = attestationMarkdown(attestation);
    const fname = `${attestation.model}-conformance-attestation.md`;
    const isTauri = typeof window !== 'undefined' && !!window.__TAURI_INTERNALS__;
    if (isTauri) {
      try {
        const { save } = await import('@tauri-apps/plugin-dialog');
        const { writeTextFile } = await import('@tauri-apps/plugin-fs');
        const path = await save({ defaultPath: fname, filters: [{ name: 'Markdown', extensions: ['md'] }] });
        if (!path) { setExportMsg('Export cancelled.'); return; }
        await writeTextFile(path, md);
        setExportMsg(`Attestation written → ${path}`);
      } catch (e) { setExportMsg(`Export failed: ${e?.message || e}`); }
      return;
    }
    const blob = new Blob([md], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = fname;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setExportMsg('Attestation downloaded (check your browser downloads).');
  };

  const pct = Math.round((cursor / spans.length) * 100);

  return (
    <div className="atlas-mon">
      <div className="atlas-mon-head">
        <div>
          <h2>Conformance Monitoring</h2>
          <p className="atlas-mon-sub">
            Replaying <strong>{trace.label}</strong> against the declared registry.
            <em> Captured run; the conformance diff is identical to live OTel telemetry.</em>
          </p>
        </div>
        <div className="atlas-mon-controls">
          <button onClick={() => setPlaying((p) => !p)} disabled={finished} className="primary">
            {playing ? 'Pause' : (cursor === 0 ? '▶ Replay batch' : '▶ Resume')}
          </button>
          <button onClick={() => setCursor((c) => Math.min(spans.length, c + STEP))} disabled={playing || finished}>Step</button>
          <button onClick={reset}>Reset</button>
        </div>
      </div>

      {/* progress + counters */}
      <div className="atlas-mon-stats">
        <div className="atlas-mon-progress"><div className="atlas-mon-progress-bar" style={{ width: `${pct}%` }} /></div>
        <span className="atlas-mon-stat">{objectsSeen}/{trace.objectCount} objects</span>
        <span className="atlas-mon-stat ok">{result.passCount.toLocaleString()} gates checked</span>
        <span className="atlas-mon-stat bad">{vShown} violation{vShown === 1 ? '' : 's'}</span>
        <span className="atlas-mon-stat omit">{oShown} omission{oShown === 1 ? '' : 's'}</span>
        <span className="atlas-mon-stat shadow">{shShown} shadow</span>
        <span className="atlas-mon-stat warn">{eShown} error{eShown === 1 ? '' : 's'}</span>
      </div>

      {/* filters */}
      <div className="atlas-mon-filters">
        <label>Thread:
          <select value={agentFilter} onChange={(e) => setAgentFilter(e.target.value)}>
            <option value="all">all agents</option>
            {AGENTS.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </label>
        <div className="atlas-mon-typetabs">
          {[['findings', 'All'], ['violations', 'Violations'], ['omissions', 'Omissions'], ['shadows', 'Shadow agents'], ['errors', 'Errors']].map(([k, label]) => (
            <button key={k} className={typeFilter === k ? 'active' : ''} onClick={() => setTypeFilter(k)}>{label}</button>
          ))}
        </div>
      </div>

      <div className="atlas-mon-findings">
        {filtered.length === 0 ? (
          <p className="atlas-empty">
            {revealed.length === 0
              ? (finished ? 'No findings — the run conformed to the declared registry.' : 'Conformant so far… findings surface as drift / errors occur.')
              : 'No findings match the current filter.'}
          </p>
        ) : filtered.map((f) => (
          <div key={f.id} className={`atlas-mon-viol sev-${f.severity} ${f.status}`}>
            <div className="atlas-mon-viol-head">
              <span className={`atlas-mon-tag ${f.status}`}>{TAG_LABEL[f.status] || 'FINDING'}</span>
              <span className="atlas-mon-sev">{f.severity.toUpperCase()}</span>
              {f.nist && <span className="atlas-mon-nist">NIST {f.nist}</span>}
              <span className="atlas-mon-rule">{f.rule}</span>
            </div>
            <div className="atlas-mon-viol-detail">{f.detail}</div>
            {f.regime && f.status !== 'error' && (
              <div className="atlas-mon-regime">Regime control mapping: <em>{f.regime}</em></div>
            )}
          </div>
        ))}
      </div>

      {finished && (
        <div className="atlas-mon-footer">
          <span className="atlas-empty">
            Atlas governs <strong>declared</strong> gates — it doesn't measure quality. A finding
            appears only where runtime crossed a rule the registry declared.
          </span>
          <button className="primary" onClick={() => setShowAttestation(true)}>Generate attestation →</button>
        </div>
      )}

      {showAttestation && (
        <div className="atlas-modal-backdrop" onClick={() => setShowAttestation(false)}>
          <div className="atlas-modal atlas-attest" onClick={(e) => e.stopPropagation()}>
            <h2>Conformance Attestation</h2>
            <div className={`atlas-attest-verdict ${attestation.counts.critical ? 'bad' : (attestation.counts.violations ? 'warn' : 'ok')}`}>
              {attestation.verdict}
            </div>
            <table className="atlas-attest-table">
              <tbody>
                <tr><td>Model</td><td><code>{attestation.model}</code></td></tr>
                <tr><td>Run</td><td><code>{attestation.runId}</code></td></tr>
                <tr><td>Compliance regimes</td><td>{attestation.regimes.join(' · ')}</td></tr>
                <tr><td>NIST AI RMF functions</td><td>{attestation.nistFunctions.join(' · ') || '—'}</td></tr>
                <tr><td>Gates checked</td><td>{attestation.counts.passed.toLocaleString()} passed</td></tr>
                <tr><td>Governance findings</td><td>
                  {attestation.counts.violations} violation(s), {attestation.counts.omissions} omission(s) (skipped declared step), {attestation.counts.shadows} shadow agent(s)
                  — {attestation.counts.critical} critical, {attestation.counts.high} high, {attestation.counts.medium} medium</td></tr>
                <tr><td>Operational errors</td><td>{attestation.counts.errors}</td></tr>
              </tbody>
            </table>
            <p className="atlas-attest-note">
              Each finding ties an observed runtime span to the registry rule it breached and the NIST
              AI RMF function it implicates. <strong>Specific regime control mappings (HIPAA / GDPR /
              EU AI Act / SOC 2 articles) are produced as part of a governance assessment</strong> — the
              tool reports the structural function, not a legal conclusion.
            </p>
            {exportMsg && <p className="atlas-attest-exportmsg">{exportMsg}</p>}
            <div className="atlas-modal-actions">
              <button className="atlas-slider-reset" onClick={() => setShowAttestation(false)}>Close</button>
              <button className="primary" onClick={exportAttestation}>Export attestation (.md)</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function attestationMarkdown(a) {
  const lines = [];
  lines.push(`# Conformance Attestation — ${a.model}`);
  lines.push('');
  lines.push(`**Verdict:** ${a.verdict}`);
  lines.push(`**Run:** ${a.runId}`);
  lines.push(`**Compliance regimes (declared):** ${a.regimes.join(', ')}`);
  lines.push(`**NIST AI RMF functions implicated:** ${a.nistFunctions.join(', ') || '—'}`);
  lines.push(`**Result:** ${a.counts.passed.toLocaleString()} gates passed; ${a.counts.violations} violation(s), ${a.counts.omissions} omission(s), ${a.counts.shadows} shadow agent(s) — ${a.counts.critical} critical, ${a.counts.high} high, ${a.counts.medium} medium; ${a.counts.errors} operational error(s).`);
  lines.push('');
  lines.push('_Declared-vs-running conformance: each finding ties an observed runtime span (or a declared step that produced none) to the registry rule it breached and the NIST AI RMF function it implicates. Specific regime control mappings (HIPAA / GDPR / EU AI Act / SOC 2) are produced as part of a governance assessment — this report states the structural function, not a legal conclusion._');
  lines.push('');
  const section = (title, items) => {
    if (!items.length) return;
    lines.push(`## ${title}`); lines.push('');
    for (const f of items) {
      lines.push(`### [${f.severity.toUpperCase()} · NIST ${f.nist || '—'}] ${f.rule}`);
      lines.push(f.detail);
      if (f.regime) lines.push(`Regime control mapping: ${f.regime}`);
      lines.push('');
    }
  };
  section('Violations (declared-rule drift)', a.violations);
  section('Omissions (declared step that did not run — closed-world)', a.omissions);
  section('Shadow agents (ran but undeclared)', a.shadows);
  if (a.errors.length) {
    lines.push('## Operational errors (runtime failures, independent of rules)');
    lines.push('');
    for (const e of a.errors) { lines.push(`### [${e.severity.toUpperCase()}] ${e.rule}`); lines.push(e.detail); lines.push(''); }
  }
  if (!a.governanceFindings.length && !a.errors.length) {
    lines.push('## Findings');
    lines.push('No drift, omissions, shadow agents, or errors — runtime conformed to the declared registry.');
    lines.push('');
  }
  lines.push('---');
  lines.push('Generated by Agent Atlas — declared-vs-running conformance. Atlas governs declared gates; it does not measure quality.');
  return lines.join('\n') + '\n';
}
