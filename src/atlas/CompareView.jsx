// Compare view — model-vs-model diff (the Compare tab, DIAG / Remediation).
//
// Holds a BASELINE declaration beside a TARGET declaration and diffs them by id +
// governance fields. Two framings (project_agent_atlas_remediation):
//   • recovered(current) vs intended(authored)        — "are we aligned?"
//   • recovered(current) vs synthesized target (Path3) — "what to remediate"
// Side A defaults to the LIVE declaration (whatever's in the Declaration tab — which
// is also where an adopted recovered model lands). Side B is loaded from a saved
// declaration/recovery JSON. The operator picks which side is the baseline.
//
// This is NOT Monitoring (declared-vs-running). This is declared-vs-declared — the
// "Complete Compare" arm. Demo-isolated: own component, own file input; the only
// host wiring is the live model passed in as a prop.
import React, { useState, useMemo } from 'react';
import { diffDeclarations, diffNotes } from './compare/declarationDiff';

const isTauri = () => typeof window !== 'undefined' && !!window.__TAURI_INTERNALS__;

// Coerce a loaded JSON into the { objects:{}, edges:[] } shape the diff expects.
// Accepts: a raw model, a build-bundle-ish {objects,edges}, or a recovery snapshot
// {result:{objects,...}} / {model:{...}}. Objects may be a keyed map OR an array.
function coerceDeclaration(raw) {
  const m = raw?.objects ? raw : (raw?.model || raw?.result || raw?.declaration || raw || {});
  let objects = m.objects || {};
  if (Array.isArray(objects)) {
    const map = {};
    for (const o of objects) if (o && o.id) map[o.id] = o;
    objects = map;
  }
  return { objects, edges: Array.isArray(m.edges) ? m.edges : [] };
}

export default function CompareView({ liveModel }) {
  // liveModel = { objects, edges } from the Declaration tab (current declaration).
  const [loaded, setLoaded] = useState(null);   // { label, decl } the other side
  const [loadedName, setLoadedName] = useState('');
  const [baselineSide, setBaselineSide] = useState('loaded'); // 'loaded' | 'live'
  const [err, setErr] = useState(null);
  const [expanded, setExpanded] = useState({}); // category → open

  const live = useMemo(() => ({
    label: 'Live declaration',
    decl: { objects: liveModel?.objects || {}, edges: liveModel?.edges || [] },
  }), [liveModel]);

  const loadFile = async () => {
    setErr(null);
    try {
      let text;
      if (isTauri()) {
        const { open } = await import('@tauri-apps/plugin-dialog');
        const path = await open({ title: 'Choose a declaration / recovery JSON', filters: [{ name: 'JSON', extensions: ['json'] }] });
        if (!path) return;
        const { readTextFile } = await import('@tauri-apps/plugin-fs');
        text = await readTextFile(path);
        setLoadedName(String(path).split('/').pop());
      } else {
        text = await pickFileWeb();
        if (text == null) return;
      }
      const decl = coerceDeclaration(JSON.parse(text));
      if (!Object.keys(decl.objects).length) throw new Error('No objects found in that file.');
      setLoaded({ label: loadedName || 'Loaded declaration', decl });
    } catch (e) {
      setErr(`Could not load that declaration. [${e?.message || e}]`);
    }
  };

  // Browser fallback file picker → resolves to file text (or null if cancelled).
  const pickFileWeb = () => new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = '.json,application/json';
    input.onchange = () => {
      const f = input.files && input.files[0];
      if (!f) return resolve(null);
      setLoadedName(f.name);
      const r = new FileReader();
      r.onload = () => resolve(String(r.result || ''));
      r.onerror = () => resolve(null);
      r.readAsText(f);
    };
    input.click();
  });

  const otherLabel = loaded ? (loadedName || 'Loaded declaration') : null;
  const baseline = baselineSide === 'live' ? live : (loaded ? { ...loaded, label: otherLabel } : null);
  const targetSide = baselineSide === 'live' ? (loaded ? { ...loaded, label: otherLabel } : null) : live;

  const diff = useMemo(() => {
    if (!baseline || !targetSide) return null;
    return diffDeclarations(baseline.decl, targetSide.decl);
  }, [baseline, targetSide]);

  const notes = useMemo(() => (
    diff ? diffNotes(diff, { baselineLabel: baseline.label, targetLabel: targetSide.label }) : []
  ), [diff, baseline, targetSide]);

  const toggle = (k) => setExpanded((e) => ({ ...e, [k]: !e[k] }));

  return (
    <div className="atlas-cmp">
      <div className="atlas-cmp-head">
        <div>
          <h2>Compare</h2>
          <p className="atlas-cmp-sub">
            Diff two declarations — <strong>declared vs discovered</strong>, or current vs an optimized target.
            The diff IS the change set: what to add, change, re-parent, or remove. (This is model-vs-model;
            for declared-vs-running use Monitoring.)
          </p>
        </div>
      </div>

      <div className="atlas-cmp-load">
        <div className="atlas-cmp-side">
          <span className="atlas-cmp-sidelabel">A · Live declaration</span>
          <span className="atlas-cmp-count">{Object.keys(live.decl.objects).length} object(s)</span>
        </div>
        <div className="atlas-cmp-side">
          <span className="atlas-cmp-sidelabel">B · {loaded ? otherLabel : 'No file loaded'}</span>
          <span className="atlas-cmp-count">{loaded ? `${Object.keys(loaded.decl.objects).length} object(s)` : '—'}</span>
          <button onClick={loadFile}>{loaded ? 'Load a different…' : '🗁 Load declaration / recovery JSON'}</button>
        </div>
        {loaded && (
          <label className="atlas-cmp-baseline" title="Which side is the baseline — the diff describes what it takes to go baseline → target">
            Baseline (current):
            <select value={baselineSide} onChange={(e) => setBaselineSide(e.target.value)}>
              <option value="loaded">B · {otherLabel}</option>
              <option value="live">A · Live declaration</option>
            </select>
          </label>
        )}
      </div>

      {err && <div className="atlas-cmp-err">{err}</div>}

      {!loaded && <p className="atlas-cmp-empty">Load a second declaration (a saved model, a recovery snapshot, or a synthesized target) to diff against the live one.</p>}

      {diff && (
        <div className="atlas-cmp-body">
          <div className="atlas-cmp-summary">
            <span className="atlas-cmp-distance">{diff.summary.actionable}</span>
            <span>object(s) need action · {diff.summary.aligned} aligned of {diff.summary.total} · edges +{diff.summary.edgesAdded}/−{diff.summary.edgesRemoved}</span>
          </div>
          <div className="atlas-cmp-dir">{baseline.label} → {targetSide.label}</div>

          <CatBlock k="unbuilt" title="To add — in target, not in baseline" rows={diff.categories.unbuilt}
            open={expanded.unbuilt} onToggle={toggle} render={(r) => `${r.kind} · ${r.id}`} />
          <CatBlock k="drifted" title="To change — governance field diverged" rows={diff.categories.drifted}
            open={expanded.drifted} onToggle={toggle}
            render={(r) => `${r.kind} · ${r.id}: ${r.fields.map((f) => `${f.field} (“${shortv(f.baseline)}” → “${shortv(f.target)}”)`).join('; ')}`} />
          <CatBlock k="moved" title="Re-parented — structural change" rows={diff.categories.moved}
            open={expanded.moved} onToggle={toggle}
            render={(r) => `${r.kind} · ${r.id}: parent ${r.fromParent} → ${r.toParent}`} />
          <CatBlock k="shadow" title="Declare or remove — in baseline, not in target" rows={diff.categories.shadow}
            open={expanded.shadow} onToggle={toggle} render={(r) => `${r.kind} · ${r.id}`} />
          <CatBlock k="aligned" title="Aligned — no action" rows={diff.categories.aligned}
            open={expanded.aligned} onToggle={toggle} render={(r) => `${r.kind} · ${r.id}`} muted />

          <ul className="atlas-cmp-notes">
            {notes.map((n, i) => <li key={i}>{n}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}

function CatBlock({ k, title, rows, open, onToggle, render, muted }) {
  if (!rows.length) return null;
  return (
    <div className={`atlas-cmp-cat cat-${k}${muted ? ' muted' : ''}`}>
      <button className="atlas-cmp-cathead" onClick={() => onToggle(k)}>
        <span className="atlas-cmp-catcount">{rows.length}</span> {title} <span className="atlas-cmp-chev">{open ? '▾' : '▸'}</span>
      </button>
      {open && <ul className="atlas-cmp-catlist">{rows.map((r) => <li key={r.id}>{render(r)}</li>)}</ul>}
    </div>
  );
}

function shortv(v) {
  const s = Array.isArray(v) ? (v.length ? v.join(', ') : '∅') : (v == null || v === '' ? '∅' : String(v));
  return s.length > 40 ? s.slice(0, 38) + '…' : s;
}
