// Requirements section (DIAG-38): the canvas area becomes a document editor for
// the single requirements project. Create the project (one allowed, like the
// orchestrator), import a .md/.txt or write directly, and seed the model from it.
// The MODEL is canonical; this doc seeds it (overwrite + warn + undo) and is later
// rendered FROM it (DIAG-41). Edit in a textarea; Preview renders the Markdown
// (so **bold** shows as bold, not literal asterisks) via react-markdown + GFM.
import React, { useState, useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

export default function RequirementsView({
  requirements,       // { name, text } | null
  onCreate,           // (name) => void   — create the single project
  onChangeText,       // (text) => void   — edit the doc body
  onImport,           // (name, text) => void  — set from an imported file
  onGenerate,         // () => Promise<{notes?:[]}>  — seed the model (parent handles confirm/apply)
  onReview,           // () => Promise<{summary,recommendations[]}> — governance review of the doc
  endpointConfigured, // bool — is a generate endpoint set in Settings?
}) {
  const [busy, setBusy] = useState(false);
  const [reviewBusy, setReviewBusy] = useState(false);
  const [review, setReview] = useState(null); // { summary, recommendations[] } | null
  const [msg, setMsg] = useState(null);
  const [err, setErr] = useState(null);
  const [mode, setMode] = useState('edit'); // 'edit' | 'preview'
  const [elapsed, setElapsed] = useState(0); // seconds the current op has run
  const tick = useRef(null);

  // While generating OR reviewing, tick a once-a-second elapsed counter so the
  // user sees the run is alive (these take 1-3 min). Cleared when idle.
  const working = busy || reviewBusy;
  useEffect(() => {
    if (!working) { if (tick.current) { clearInterval(tick.current); tick.current = null; } return; }
    setElapsed(0);
    tick.current = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => { if (tick.current) { clearInterval(tick.current); tick.current = null; } };
  }, [working]);

  const fmtElapsed = (s) => (s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`);

  const importFile = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    try {
      const text = await f.text();
      onImport(f.name.replace(/\.(md|txt|markdown)$/i, ''), text);
    } catch (e2) { setErr(`Could not read ${f.name}: ${e2?.message || e2}`); }
  };

  const generate = async () => {
    setErr(null); setMsg(null); setBusy(true);
    try {
      const res = await onGenerate();
      if (res?.cancelled) { setBusy(false); return; }
      const notes = res?.notes || [];
      setMsg(`Model generated from requirements. Switch to Model to refine it.${notes.length ? ` (${notes.length} note${notes.length === 1 ? '' : 's'} to confirm)` : ''}`);
    } catch (e2) {
      setErr(e2?.message || String(e2));
    } finally { setBusy(false); }
  };

  const runReview = async () => {
    setErr(null); setMsg(null); setReview(null); setReviewBusy(true);
    try {
      const r = await onReview();
      setReview(r || { summary: '', recommendations: [] });
    } catch (e2) {
      setErr(e2?.message || String(e2));
    } finally { setReviewBusy(false); }
  };

  // ── No project yet: create it (singular) ──
  if (!requirements) {
    return (
      <div className="atlas-reqview empty">
        <div className="atlas-reqview-empty">
          <h2>Requirements</h2>
          <p>Start the single requirements project for this platform. Import an existing
            SSDD / requirements document, or create a blank one and write it here.</p>
          <div className="atlas-reqview-actions">
            <label className="atlas-reqview-import">
              Import a document (.md / .txt)
              <input type="file" accept=".md,.txt,text/plain,text/markdown" onChange={importFile} />
            </label>
            <button onClick={() => onCreate('Platform Modernization')}>Create blank project</button>
          </div>
        </div>
      </div>
    );
  }

  // ── Project exists: the document editor ──
  return (
    <div className="atlas-reqview">
      <div className="atlas-reqview-head">
        <input
          className="atlas-reqview-name"
          value={requirements.name}
          onChange={(e) => onImport(e.target.value, requirements.text)}
          aria-label="Requirements project name"
        />
        <div className="atlas-reqview-headactions">
          <div className="atlas-reqview-modes" role="tablist" aria-label="Document view">
            <button
              role="tab"
              aria-selected={mode === 'edit'}
              className={mode === 'edit' ? 'active' : ''}
              onClick={() => setMode('edit')}
            >Edit</button>
            <button
              role="tab"
              aria-selected={mode === 'preview'}
              className={mode === 'preview' ? 'active' : ''}
              onClick={() => setMode('preview')}
              title="Render the Markdown (bold, headings, lists, tables)"
            >Preview</button>
          </div>
          <label className="atlas-reqview-reimport" title="Replace with an imported file">
            Import…
            <input type="file" accept=".md,.txt,text/plain,text/markdown" onChange={importFile} />
          </label>
          <button
            className="atlas-reqview-review"
            onClick={runReview}
            disabled={working || !requirements.text?.trim() || !endpointConfigured}
            title={endpointConfigured ? 'Review the document for NIST-style governance gaps before generating' : 'Set a model endpoint in Settings first'}
          >
            {reviewBusy ? `Reviewing… ${fmtElapsed(elapsed)}` : '✓ Review for governance'}
          </button>
          <button
            className="atlas-reqview-generate"
            onClick={generate}
            disabled={working || !requirements.text?.trim()}
            title={endpointConfigured ? 'Seed the model from these requirements (replaces the current model)' : 'Set a model endpoint in Settings first'}
          >
            {busy ? `Generating… ${fmtElapsed(elapsed)}` : 'Generate model from requirements'}
          </button>
        </div>
      </div>

      {!endpointConfigured && (
        <div className="atlas-reqview-hint">No model endpoint set — add one in Settings to enable “Generate model”.</div>
      )}
      {working && (
        <div className="atlas-reqview-msg working">
          <span className="atlas-spinner" aria-hidden="true" />
          {busy
            ? 'Generating the model from your requirements — this can take a couple of minutes.'
            : 'Reviewing the document for governance gaps — about a minute.'}
          {' '}Elapsed {fmtElapsed(elapsed)}.
        </div>
      )}
      {msg && <div className="atlas-reqview-msg ok">{msg}</div>}
      {err && <div className="atlas-reqview-msg err">{err}</div>}

      {review && (
        <div className="atlas-review-panel">
          <div className="atlas-review-head">
            <strong>Governance review</strong>
            <button className="atlas-review-dismiss" onClick={() => setReview(null)} title="Dismiss">×</button>
          </div>
          {review.summary && <p className="atlas-review-summary">{review.summary}</p>}
          {(review.recommendations || []).length === 0 ? (
            <p className="atlas-empty">No recommendations — the document looks governance-complete.</p>
          ) : (
            <ul className="atlas-review-list">
              {review.recommendations.map((r, i) => (
                <li key={i} className={`atlas-review-item sev-${(r.severity || 'medium').toLowerCase()}`}>
                  <div className="atlas-review-item-head">
                    <span className="atlas-review-sev">{(r.severity || 'medium').toUpperCase()}</span>
                    <span className="atlas-review-area">{r.area}</span>
                  </div>
                  {r.finding && <div className="atlas-review-finding">{r.finding}</div>}
                  {r.suggestion && <div className="atlas-review-suggestion"><em>Add:</em> {r.suggestion}</div>}
                </li>
              ))}
            </ul>
          )}
          <p className="atlas-review-foot">
            These are suggested declarations to ADD to your requirements — the model only fills
            governance the document states. Edit the document above, then Generate.
          </p>
        </div>
      )}

      {mode === 'edit' ? (
        <textarea
          className="atlas-reqview-doc"
          value={requirements.text}
          onChange={(e) => onChangeText(e.target.value)}
          placeholder="Write the requirements / SSDD here, in Markdown…"
          spellCheck={true}
        />
      ) : (
        <div className="atlas-reqview-preview">
          {requirements.text?.trim() ? (
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{requirements.text}</ReactMarkdown>
          ) : (
            <p className="atlas-empty">Nothing to preview yet — switch to Edit and write the document.</p>
          )}
        </div>
      )}
      <div className="atlas-reqview-foot">
        Markdown · saved automatically · the model is generated from this document
      </div>
    </div>
  );
}
