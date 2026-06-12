// Requirements section (DIAG-38): the canvas area becomes a document editor for
// the single requirements project. Create the project (one allowed, like the
// orchestrator), import a .md/.txt or write directly, and seed the model from it.
// The MODEL is canonical; this doc seeds it (overwrite + warn + undo) and is later
// rendered FROM it (DIAG-41). Edit in a textarea; Preview renders the Markdown
// (so **bold** shows as bold, not literal asterisks) via react-markdown + GFM.
import React, { useState, useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

const FILL_RE = /«FILL:[^»]*»/g;

// Turn react-markdown text children into React nodes where each «FILL: …» token
// becomes a highlighted, id'd chip (fill-0, fill-1, … in document order) so the
// blanks are unmissable in Preview and "Next blank" can scroll to one. A render-
// scoped counter keeps the ids stable per render. We only wrap STRING children;
// already-rendered nodes (bold, links) pass through untouched.
function makeChipComponents(counter, onChipClick) {
  const wrap = (children) =>
    React.Children.map(children, (child) => {
      if (typeof child !== 'string' || !child.includes('«FILL:')) return child;
      const out = [];
      let last = 0, m;
      FILL_RE.lastIndex = 0;
      while ((m = FILL_RE.exec(child))) {
        if (m.index > last) out.push(child.slice(last, m.index));
        const idx = counter.n++;
        const id = `fill-${idx}`;
        // Show "FILL: <what> — <suggested>" compactly inside the chip.
        const inner = m[0].replace(/^«FILL:\s*/, '').replace(/»$/, '');
        out.push(
          <span key={id} id={id} className="atlas-fill-chip" role="button" tabIndex={0}
            title="Click to edit this blank" onClick={() => onChipClick(idx)}>
            {inner}
          </span>
        );
        last = m.index + m[0].length;
      }
      if (last < child.length) out.push(child.slice(last));
      return out;
    });
  const C = (Tag) => ({ children, ...props }) => <Tag {...props}>{wrap(children)}</Tag>;
  return { p: C('p'), li: C('li'), td: C('td'), th: C('th'), h3: C('h3'), h4: C('h4'), em: C('em'), strong: C('strong') };
}

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
  const docRef = useRef(null);       // the editor textarea
  const cursor = useRef(0);          // which blank index "Next blank" should go to
  const pendingEditSel = useRef(null); // [start,end] char offsets to restore when Edit re-mounts

  // Count of unfilled «FILL: …» tokens. A textarea can't reliably highlight, so
  // "Next blank" jumps to the highlighted CHIP in Preview (where we control the
  // markup) and flashes it.
  const text = requirements?.text || '';
  const fillCount = (text.match(/«FILL:[^»]*»/g) || []).length;
  // Character offset of the Nth «FILL» token in the raw text (for Edit scroll).
  const fillOffsetAt = (n) => {
    const re = /«FILL:[^»]*»/g; let m, i = 0;
    while ((m = re.exec(text))) { if (i === n) return [m.index, m.index + m[0].length]; i++; }
    return null;
  };
  // Click a chip in Preview → jump to Edit at that blank, token selected.
  const editBlank = (idx) => {
    pendingEditSel.current = fillOffsetAt(idx);
    setMode('edit');
  };
  const nextBlank = () => {
    if (fillCount === 0) return;
    setMode('preview');
    const idx = cursor.current % fillCount;
    cursor.current = idx + 1; // advance for the next press (wraps)
    pendingEditSel.current = fillOffsetAt(idx); // so switching to Edit lands here, not at top
    requestAnimationFrame(() => {
      // give Preview a tick to render, then scroll + flash the chip
      requestAnimationFrame(() => {
        const el = document.getElementById(`fill-${idx}`);
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          el.classList.remove('flash');
          // reflow so re-adding the class restarts the animation
          void el.offsetWidth;
          el.classList.add('flash');
        }
      });
    });
  };
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

  // When Edit re-mounts the textarea (e.g. coming back from Preview via Next blank),
  // restore the selection/scroll to the blank we were looking at — otherwise the
  // fresh textarea starts at the top and you lose your place. One-shot per request.
  useEffect(() => {
    if (mode !== 'edit') return;
    const sel = pendingEditSel.current;
    if (!sel) return;
    pendingEditSel.current = null;
    const ta = docRef.current;
    if (!ta) return;
    requestAnimationFrame(() => {
      ta.focus();
      ta.setSelectionRange(sel[0], sel[1]);
      // Scroll so the selection sits roughly centered (textarea can't scrollIntoView a range).
      const cs = window.getComputedStyle(ta);
      const lh = parseFloat(cs.lineHeight) || 18;
      const line = text.slice(0, sel[0]).split('\n').length;
      const visibleLines = Math.max(1, Math.floor(ta.clientHeight / lh));
      ta.scrollTop = Math.max(0, (line - Math.floor(visibleLines / 2)) * lh);
    });
  }, [mode]);

  const importFile = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    try {
      const text = await f.text();
      onImport(f.name.replace(/\.(md|txt|markdown)$/i, ''), text);
    } catch (e2) { setErr(`Could not read ${f.name}: ${e2?.message || e2}`); }
  };

  const generate = async () => {
    setErr(null); setMsg(null);
    // Don't start busy/timer yet — onGenerate first shows the overwrite confirm and
    // waits for the user. It calls onStart() the instant real generation begins, so
    // the elapsed clock measures the work, not the time spent at the confirm dialog.
    try {
      const res = await onGenerate(() => setBusy(true));
      if (res?.cancelled) { setBusy(false); return; }
      const notes = res?.notes || [];
      setMsg(`Declaration generated from requirements. Switch to Declaration to refine it.${notes.length ? ` (${notes.length} note${notes.length === 1 ? '' : 's'} to confirm)` : ''}`);
    } catch (e2) {
      setErr(e2?.message || String(e2));
    } finally { setBusy(false); }
  };

  const [applied, setApplied] = useState(() => new Set()); // indices already appended

  const runReview = async () => {
    setErr(null); setMsg(null); setReview(null); setApplied(new Set()); setReviewBusy(true);
    try {
      const r = await onReview();
      setReview(r || { summary: '', recommendations: [] });
    } catch (e2) {
      setErr(e2?.message || String(e2));
    } finally { setReviewBusy(false); }
  };

  // Append a recommendation's suggestion into the doc, under a single
  // "## Governance — to declare" section (created once). You then fill the
  // <to-be-declared> blanks with real values and regenerate. The doc stays the
  // single source — no copy-paste, and we never assert values for you.
  const HEADING = '## Governance — to declare';
  const recBlock = (r) => `\n### ${r.area || 'Governance'}${r.severity ? ` _(${r.severity})_` : ''}\n${r.suggestion || ''}\n`;
  const applyRec = (r, i) => {
    let text = requirements.text || '';
    if (!text.includes(HEADING)) {
      text = `${text.replace(/\s*$/, '')}\n\n${HEADING}\n\n_Declarations recommended by the governance review. Fill each <…> with a real value, then Generate. Delete any you don't want._\n${recBlock(r)}`;
    } else {
      text = `${text.replace(/\s*$/, '')}\n${recBlock(r)}`;
    }
    onChangeText(text);
    setApplied((s) => new Set(s).add(i));
    setMode('edit');
    setMsg(`Added “${r.area}” to the document — fill the blanks, then Generate.`);
  };
  const applyAll = () => {
    const recs = review?.recommendations || [];
    const pending = recs.map((r, i) => [r, i]).filter(([, i]) => !applied.has(i));
    if (!pending.length) return;
    let text = requirements.text || '';
    if (!text.includes(HEADING)) {
      text = `${text.replace(/\s*$/, '')}\n\n${HEADING}\n\n_Declarations recommended by the governance review. Fill each <…> with a real value, then Generate. Delete any you don't want._\n`;
    }
    text = `${text.replace(/\s*$/, '')}\n${pending.map(([r]) => recBlock(r)).join('')}`;
    onChangeText(text);
    setApplied(new Set(recs.map((_, i) => i)));
    setMode('edit');
    setMsg(`Added ${pending.length} recommendation(s) to the document — fill the blanks, then Generate.`);
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
          {fillCount > 0 && (
            <button className="atlas-reqview-nextblank" onClick={nextBlank}
              title="Jump to the next «FILL: …» blank to fill in">
              Next blank → <span className="atlas-fill-count">{fillCount}</span>
            </button>
          )}
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
            title={endpointConfigured ? 'Generate the declaration from these requirements (replaces the current declaration)' : 'Set a model endpoint in Settings first'}
          >
            {busy ? `Generating… ${fmtElapsed(elapsed)}` : 'Generate declaration from requirements'}
          </button>
        </div>
      </div>

      {!endpointConfigured && (
        <div className="atlas-reqview-hint">No model endpoint set — add one in Settings to enable “Generate declaration”.</div>
      )}
      {working && (
        <div className="atlas-reqview-msg working">
          <span className="atlas-spinner" aria-hidden="true" />
          {busy
            ? 'Generating the declaration from your requirements — this can take a couple of minutes.'
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
            <div className="atlas-review-headbtns">
              {(review.recommendations || []).length > 0 && (
                <button className="atlas-review-applyall" onClick={applyAll}
                  disabled={applied.size >= (review.recommendations || []).length}
                  title="Append every recommendation's suggested declaration into the document">
                  Apply all to document
                </button>
              )}
              <button className="atlas-review-dismiss" onClick={() => setReview(null)} title="Dismiss">×</button>
            </div>
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
                    <button className="atlas-review-apply" onClick={() => applyRec(r, i)} disabled={applied.has(i)}>
                      {applied.has(i) ? '✓ Added' : 'Apply'}
                    </button>
                  </div>
                  {r.finding && <div className="atlas-review-finding">{r.finding}</div>}
                  {r.suggestion && <div className="atlas-review-suggestion"><em>Add:</em> {r.suggestion}</div>}
                </li>
              ))}
            </ul>
          )}
          <p className="atlas-review-foot">
            “Apply” appends the suggested declaration into your document under
            <strong> Governance — to declare</strong>. Each blank shows as a yellow chip in
            Preview — <strong>click a chip</strong> (or use <strong>Next blank →</strong>) to jump
            to it in Edit with the token selected; type your value, then Generate. The declaration
            only fills governance the document states.
          </p>
        </div>
      )}

      {mode === 'edit' ? (
        <textarea
          ref={docRef}
          className="atlas-reqview-doc"
          value={requirements.text}
          onChange={(e) => onChangeText(e.target.value)}
          placeholder="Write the requirements / SSDD here, in Markdown…"
          spellCheck={true}
        />
      ) : (
        <div className="atlas-reqview-preview">
          {requirements.text?.trim() ? (
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={makeChipComponents({ n: 0 }, editBlank)}>
              {requirements.text}
            </ReactMarkdown>
          ) : (
            <p className="atlas-empty">Nothing to preview yet — switch to Edit and write the document.</p>
          )}
        </div>
      )}
      <div className="atlas-reqview-foot">
        Markdown · saved automatically · the declaration is generated from this document
      </div>
    </div>
  );
}
