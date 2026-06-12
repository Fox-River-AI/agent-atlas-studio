// Monitoring view (DIAG-49): the declared-vs-running conformance demo.
//
// Replays a captured Causeway run (canned OTel spans), evaluates each span against
// the DECLARED model, and lights up the diff — mostly green with sharp red where
// runtime drifted. It ENDS on the attestation artifact: the exportable evidence,
// mapped to the declared compliance regimes, that a compliance buyer hands an
// auditor. That closing frame is the point of the whole product, so the demo
// builds to it. No live platform needed — the diff logic is identical to prod.
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { CAUSEWAY_TRACE } from './conformance/traceFixture';
import { DECLARED_NODES, DECLARED_EDGES } from './conformance/declaredFixture';
import { runConformance, buildAttestation } from './conformance/conformanceEngine';

const SEV_RANK = { critical: 0, high: 1, medium: 2, info: 3 };

export default function MonitoringView() {
  const trace = CAUSEWAY_TRACE;
  const spans = trace.spans;

  // Full result, computed once (pure). We reveal it progressively during replay.
  const result = useMemo(() => runConformance(DECLARED_NODES, DECLARED_EDGES, trace), [trace]);

  // Replay state: how many spans have "run" so far.
  const [cursor, setCursor] = useState(0); // 0..spans.length
  const [playing, setPlaying] = useState(false);
  const [showAttestation, setShowAttestation] = useState(false);
  const timer = useRef(null);

  useEffect(() => {
    if (!playing) { if (timer.current) clearInterval(timer.current); return; }
    timer.current = setInterval(() => {
      setCursor((c) => {
        if (c >= spans.length) { setPlaying(false); return c; }
        return c + 1;
      });
    }, 650);
    return () => { if (timer.current) clearInterval(timer.current); };
  }, [playing, spans.length]);

  const reset = () => { setCursor(0); setPlaying(false); setShowAttestation(false); };
  const finished = cursor >= spans.length;

  // Checks whose evidence span has "run" yet (by spanId), so the diff reveals in
  // step with the replay. Checks without a spanId (e.g. missing-telemetry) reveal
  // at the end.
  const runSpanIds = new Set(spans.slice(0, cursor).map((s) => s.spanId));
  const revealedChecks = result.checks.filter((c) =>
    (c.spanId && runSpanIds.has(c.spanId)) || (!c.spanId && finished));
  const revealedViolations = revealedChecks.filter((c) => c.status === 'violation')
    .sort((a, b) => SEV_RANK[a.severity] - SEV_RANK[b.severity]);

  const attestation = useMemo(
    () => buildAttestation(DECLARED_NODES, DECLARED_EDGES, trace, result),
    [result, trace]);

  const [exportMsg, setExportMsg] = useState(null);
  // Export the attestation. In Tauri the browser <a download> trick is a no-op
  // (webview limitation) — use the native save dialog; on web, fall back to download.
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
      } catch (e) {
        setExportMsg(`Export failed: ${e?.message || e}`);
      }
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

  return (
    <div className="atlas-mon">
      <div className="atlas-mon-head">
        <div>
          <h2>Conformance Monitoring</h2>
          <p className="atlas-mon-sub">
            Replaying <strong>{trace.label}</strong> — comparing what actually ran against the
            declared registry. <em>Captured run; the conformance diff is identical to live OTel.</em>
          </p>
        </div>
        <div className="atlas-mon-controls">
          <button onClick={() => setPlaying((p) => !p)} disabled={finished} className="primary">
            {playing ? 'Pause' : (cursor === 0 ? '▶ Replay run' : '▶ Resume')}
          </button>
          <button onClick={() => setCursor((c) => Math.min(spans.length, c + 1))} disabled={playing || finished}>Step</button>
          <button onClick={reset}>Reset</button>
        </div>
      </div>

      {/* Live counters */}
      <div className="atlas-mon-stats">
        <span className="atlas-mon-stat">{cursor}/{spans.length} spans</span>
        <span className="atlas-mon-stat ok">{revealedChecks.filter((c) => c.status === 'pass').length} conformant</span>
        <span className="atlas-mon-stat bad">{revealedViolations.length} violation{revealedViolations.length === 1 ? '' : 's'}</span>
      </div>

      <div className="atlas-mon-body">
        {/* Left: the span timeline */}
        <div className="atlas-mon-trace">
          <div className="atlas-mon-coltitle">Run trace</div>
          {spans.map((s, i) => {
            const ran = i < cursor;
            const chk = result.checks.find((c) => c.spanId === s.spanId);
            const bad = ran && chk?.status === 'violation';
            return (
              <div key={s.spanId} className={`atlas-mon-span ${ran ? 'ran' : 'pending'} ${bad ? 'bad' : ''}`}>
                <span className="atlas-mon-span-kind">{s.kind}</span>
                <span className="atlas-mon-span-who">{s.agentId}{s.target ? ` → ${s.target}` : ''}</span>
                {s.confidence != null && <span className="atlas-mon-span-meta">conf {s.confidence}</span>}
                {s.dataClass && <span className="atlas-mon-span-meta">{s.dataClass}</span>}
                {bad && <span className="atlas-mon-span-flag">⚠ drift</span>}
              </div>
            );
          })}
          {/* Violations of ABSENCE (e.g. declared telemetry never emitted) have no
              span to flag — surface them as "expected but missing" rows once the
              run finishes, so the trace and the diff reconcile. */}
          {finished && result.violations.filter((v) => !v.spanId).map((v) => (
            <div key={v.id} className="atlas-mon-span ran bad missing">
              <span className="atlas-mon-span-kind">missing</span>
              <span className="atlas-mon-span-who">{v.agentId} — declared span not emitted</span>
              <span className="atlas-mon-span-flag">⚠ absent</span>
            </div>
          ))}
        </div>

        {/* Right: the conformance diff */}
        <div className="atlas-mon-diff">
          <div className="atlas-mon-coltitle">Conformance — declared vs. running</div>
          {revealedViolations.length === 0 && !finished && (
            <p className="atlas-empty">Conformant so far… violations surface as drift occurs.</p>
          )}
          {revealedViolations.map((v) => (
            <div key={v.id} className={`atlas-mon-viol sev-${v.severity}`}>
              <div className="atlas-mon-viol-head">
                <span className="atlas-mon-sev">{v.severity.toUpperCase()}</span>
                <span className="atlas-mon-rule">{v.rule}</span>
              </div>
              <div className="atlas-mon-viol-detail">{v.detail}</div>
            </div>
          ))}
          {finished && (
            <div className="atlas-mon-attest-cta">
              <button className="primary" onClick={() => setShowAttestation(true)}>
                Generate attestation →
              </button>
            </div>
          )}
        </div>
      </div>

      {/* The closing frame: the attestation artifact (the thing the buyer purchases). */}
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
                <tr><td>Checks</td><td>{attestation.counts.passed} passed / {attestation.counts.violations} violations
                  ({attestation.counts.critical} critical, {attestation.counts.high} high, {attestation.counts.medium} medium)</td></tr>
              </tbody>
            </table>
            <p className="atlas-attest-note">
              This declared-vs-running attestation is the evidence artifact: every finding ties a
              runtime span to the registry rule it breached. Mapped to the declared regimes, it is
              what an auditor reviews.
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
  lines.push(`**Compliance regimes:** ${a.regimes.join(', ')}`);
  lines.push(`**Result:** ${a.counts.passed} checks passed, ${a.counts.violations} violation(s) — ${a.counts.critical} critical, ${a.counts.high} high, ${a.counts.medium} medium.`);
  lines.push('');
  lines.push('_Declared-vs-running conformance: each finding ties an observed runtime span to the registry rule it breached. This is the evidence an auditor reviews._');
  lines.push('');
  if (a.violations.length) {
    lines.push('## Findings');
    lines.push('');
    for (const v of a.violations) {
      lines.push(`### [${v.severity.toUpperCase()}] ${v.rule}`);
      lines.push(v.detail);
      lines.push('');
    }
  } else {
    lines.push('## Findings');
    lines.push('No drift detected — runtime behavior conformed to the declared registry.');
    lines.push('');
  }
  lines.push('---');
  lines.push('Generated by Agent Atlas — declared-vs-running conformance.');
  return lines.join('\n') + '\n';
}
