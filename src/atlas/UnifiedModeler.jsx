// Step-1 harness for the unified collapsible graph. Holds the single object
// store + edges + expand state, renders UnifiedGraph, and shows properties for
// the selected object. Seeded with a nested example (task → agent → tools/job)
// so expand/collapse + properties-at-every-level are verifiable now. Later
// steps fold this into the main AtlasModeler and add create/connect, SAs, stubs.
import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import JSZip from 'jszip';
import UnifiedGraph from './UnifiedGraph';
import PropertiesPanel from './PropertiesPanel';
import ModelTree from './ModelTree';
import { SettingsModal, AboutModal } from './Modals';
import { VALIDATORS, formatErrors, DEFAULT_MODEL } from './schema';
import { manifestFor, buildRegistry } from './model';
import { blankData, CREATABLE_KINDS } from './blankData';
import { canConnect, connectionReason } from './relationships';
import { namedIssues } from './validationMessages';
import './atlas.css';
import { SEED_OBJECTS, SEED_EDGES, SEED_EXPANDED, SEED_SUBJECT_AREAS } from './seedModel';
import { loadModel, saveModel, clearModel } from './persistence';

export default function UnifiedModeler() {
  // Render the demo seed first; if a saved model exists on disk it's loaded
  // asynchronously on mount (see the hydrate effect) and swapped in. Persistence
  // is a real file in Tauri (localStorage doesn't survive restart on the dev
  // http origin) — so loading can't be synchronous.
  const [objects, setObjects] = useState(SEED_OBJECTS);
  const [edges, setEdges] = useState(SEED_EDGES);
  const [expanded, setExpanded] = useState(SEED_EXPANDED);
  const [selectedId, setSelectedId] = useState(null);
  const [focusReq, setFocusReq] = useState(null); // { id, n } — bump n to re-center
  // Chrome state
  const [treeCollapsed, setTreeCollapsed] = useState(false);
  const [panelOpen, setPanelOpen] = useState(true);
  const [modal, setModal] = useState(null); // 'settings' | 'about'
  // Subject Areas = saved views: { id, name, taskIds: [] }. null = whole model.
  const [subjectAreas, setSubjectAreas] = useState(SEED_SUBJECT_AREAS);
  const [currentSA, setCurrentSA] = useState(null);
  const [saEditor, setSaEditor] = useState(null); // { id, name, taskIds } being edited
  const [exportMsg, setExportMsg] = useState('');
  // Per-VIEW node layout (Erwin-style saved diagrams): layouts[viewId][objId] = {x,y}.
  // viewId is 'all' or the SA id. The same object can sit differently per view.
  // Positions live HERE, not on the object — so selection never re-lays-out.
  const [layouts, setLayouts] = useState({});
  // Per-VIEW zoom/pan: viewports[viewId] = {x,y,zoom}. Each view remembers how
  // the user last had it framed; restored on switch and across restarts.
  const [viewports, setViewports] = useState({});
  const viewId = currentSA || 'all';
  // Persist a node's dragged position into the current view's layout.
  const setNodePosition = useCallback((objId, pos) => {
    setLayouts((L) => ({ ...L, [viewId]: { ...(L[viewId] || {}), [objId]: pos } }));
  }, [viewId]);
  // Persist a view's zoom/pan. Keyed by the passed id (not the closure's viewId)
  // so a move captured mid-switch lands on the right view.
  const setViewport = useCallback((vId, vp) => {
    setViewports((V) => ({ ...V, [vId]: vp }));
  }, []);

  // Hydrate from the saved model once on mount. Until this completes, the
  // `hydrated` gate keeps auto-save from overwriting the saved file with the
  // seed defaults. If nothing is saved, we stay on the seed and mark hydrated.
  const hydrated = useRef(false);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const saved = await loadModel();
      if (!cancelled && saved) {
        setObjects(saved.objects);
        setEdges(saved.edges);
        setExpanded(saved.expanded);
        setSubjectAreas(saved.subjectAreas);
        setLayouts(saved.layouts);
        setViewports(saved.viewports);
      }
      if (!cancelled) hydrated.current = true;
    })();
    return () => { cancelled = true; };
  }, []);

  // Auto-save the whole model whenever any part changes (debounced so a drag or
  // continuous zoom doesn't write on every frame). This is the "it survives a
  // restart" guarantee — like Erwin auto-saving the .erwin file. Gated on
  // `hydrated` so the initial seed render doesn't clobber a saved model.
  const saveTimer = useRef(null);
  useEffect(() => {
    if (!hydrated.current) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      saveModel({ objects, edges, expanded, subjectAreas, layouts, viewports });
    }, 400);
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current); };
  }, [objects, edges, expanded, subjectAreas, layouts, viewports]);

  // Escape hatch: wipe the saved model and reload to the pristine demo seed
  // (for screenshots / talks). Without this, persistence would trap the user in
  // whatever they last left.
  const resetToDemo = useCallback(() => {
    clearModel();
    setObjects(SEED_OBJECTS);
    setEdges(SEED_EDGES);
    setExpanded(SEED_EXPANDED);
    setSubjectAreas(SEED_SUBJECT_AREAS);
    setLayouts({});
    setViewports({});
    setCurrentSA(null);
    setSelectedId(null);
  }, []);

  const toggleExpand = useCallback((id) => setExpanded((e) => ({ ...e, [id]: !e[id] })), []);

  // The current SA's visible object ids = its tasks + everything nested under
  // them (descendants via the parent chain). null SA = the whole model.
  const sa = currentSA ? subjectAreas.find((s) => s.id === currentSA) : null;
  const visibleObjects = useMemo(() => {
    if (!sa) return objects;
    const childrenByParent = {};
    for (const o of Object.values(objects)) {
      if (o.parent) (childrenByParent[o.parent] ||= []).push(o.id);
    }
    const keep = new Set();
    const walk = (id) => { if (keep.has(id) || !objects[id]) return; keep.add(id); (childrenByParent[id] || []).forEach(walk); };
    sa.taskIds.forEach(walk);
    return Object.fromEntries(Object.entries(objects).filter(([id]) => keep.has(id)));
  }, [objects, sa]);

  const allTasks = useMemo(() => Object.values(objects).filter((o) => o.kind === 'task'), [objects]);

  // ── Subject Area management ──
  // Open the editor modal directly (name is typed IN the modal). Do NOT use
  // window.prompt — Tauri's webview returns null from it, so the dialog never
  // appeared and "New Subject Area" silently did nothing.
  const newSubjectArea = () => {
    setSaEditor({ id: `sa-${Date.now().toString(36)}`, name: '', taskIds: [] });
  };
  const saveSubjectArea = (editor) => {
    setSubjectAreas((sas) => {
      const exists = sas.some((s) => s.id === editor.id);
      return exists ? sas.map((s) => (s.id === editor.id ? editor : s)) : [...sas, editor];
    });
    setCurrentSA(editor.id);
    setSaEditor(null);
  };
  const editCurrentSA = () => { if (sa) setSaEditor({ ...sa }); };

  // The unified objects, in the {id,type,data} node shape buildRegistry/manifestFor expect.
  const asNodes = useMemo(
    () => Object.values(objects).filter((o) => o.kind !== 'task').map((o) => ({ id: o.id, type: o.kind, data: o.data })),
    [objects]
  );

  let seq = Object.keys(objects).length;
  // Create a new object (top-level until connected). Select it so its
  // properties open ready to edit.
  const createObject = (kind) => {
    seq += 1;
    const id = `${kind}-${seq}`;
    setObjects((o) => ({ ...o, [id]: { id, kind, parent: null, data: blankData(kind) } }));
    // Place near the currently-selected node, in the CURRENT view's layout.
    const anchor = selectedId && layouts[viewId]?.[selectedId];
    const position = anchor ? { x: anchor.x + 60, y: anchor.y + 130 } : { x: 140, y: 120 };
    setNodePosition(id, position);
    setSelectedId(id);
    setFocusReq({ id, n: (focusReq?.n || 0) + 1 });
  };

  // Draw a relationship: source → target. This also establishes nesting —
  // the target becomes the source's child (Erwin "create then connect"). Expand
  // the source so the new child is visible.
  const [connectMsg, setConnectMsg] = useState('');
  const connect = useCallback((params) => {
    const { source, target } = params;
    if (!source || !target || source === target) return;
    setObjects((o) => {
      const src = o[source], child = o[target];
      if (!src || !child) return o;
      // Enforce sensible relationships (e.g. no Task → System).
      if (!canConnect(src.kind, child.kind)) {
        setConnectMsg(connectionReason(src.kind, child.kind));
        return o;
      }
      setConnectMsg('');
      setEdges((es) => (es.some((e) => e.source === source && e.target === target) ? es : [...es, { id: `e-${source}-${target}`, source, target }]));
      setExpanded((e) => ({ ...e, [source]: true }));
      return { ...o, [target]: { ...child, parent: source } };
    });
  }, []);

  // Validate each object; capture both validity (for the dot) and raw errors
  // (for the named, plain-language summary).
  const { validityById, problemsByObj } = useMemo(() => {
    const valid = {}, problems = {};
    const allNodes = Object.values(objects).map((x) => ({ id: x.id, type: x.kind, data: x.data }));
    for (const o of Object.values(objects)) {
      const v = VALIDATORS[o.kind];
      if (!v) { valid[o.id] = true; continue; }
      const node = { id: o.id, type: o.kind, data: o.data };
      const m = manifestFor(node, allNodes, edges);
      const ok = m ? v(m) : true;
      valid[o.id] = ok;
      if (!ok && v.errors) problems[o.id] = v.errors.slice();
    }
    return { validityById: valid, problemsByObj: problems };
  }, [objects, edges]);

  const allValid = useMemo(() => Object.values(validityById).every(Boolean), [validityById]);
  const issues = useMemo(() => namedIssues(problemsByObj, objects), [problemsByObj, objects]);
  const [showIssues, setShowIssues] = useState(false);

  const exportRegistry = async () => {
    // Build edges in the source→target shape buildRegistry consumes (it reads
    // agent→tool allowlists etc. from edges between component nodes).
    const files = buildRegistry(asNodes, edges);
    const count = Object.keys(files).length;
    if (!count) { setExportMsg('Nothing to export yet — add some objects.'); return; }
    const zip = new JSZip();
    for (const [path, content] of Object.entries(files)) zip.file(path, content);

    const isTauri = typeof window !== 'undefined' && !!window.__TAURI_INTERNALS__;
    if (isTauri) {
      // Native Save-As → write the zip to the chosen path (the browser <a download>
      // trick doesn't reliably write to disk inside the Tauri webview).
      try {
        const { save } = await import('@tauri-apps/plugin-dialog');
        const { writeFile } = await import('@tauri-apps/plugin-fs');
        const path = await save({ defaultPath: 'agent-atlas-registry.zip', filters: [{ name: 'Zip', extensions: ['zip'] }] });
        if (!path) { setExportMsg('Export cancelled.'); return; }
        const bytes = await zip.generateAsync({ type: 'uint8array' });
        await writeFile(path, bytes);
        setExportMsg(`Exported ${count} file(s) → ${path}`);
      } catch (e) {
        setExportMsg(`Export failed: ${e?.message || e}`);
      }
      return;
    }

    // Web build: ordinary browser download.
    const blob = await zip.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'agent-atlas-registry.zip';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setExportMsg(`Exported ${count} file(s) (check your browser downloads).`);
  };

  const selected = selectedId ? objects[selectedId] : null;
  // PropertiesPanel expects a React-Flow-style node ({type, data}); adapt.
  const selectedNode = selected ? { id: selected.id, type: selected.kind, data: selected.data } : null;
  const updateSelected = (id, patch) =>
    setObjects((o) => ({ ...o, [id]: { ...o[id], data: { ...o[id].data, ...patch } } }));

  const selectedErrors = useMemo(() => {
    if (!selected) return null;
    const v = VALIDATORS[selected.kind];
    if (!v) return null;
    const node = { id: selected.id, type: selected.kind, data: selected.data };
    const m = manifestFor(node, Object.values(objects).map((x) => ({ id: x.id, type: x.kind, data: x.data })), edges);
    return m && !v(m) ? formatErrors(v.errors) : null;
  }, [selected, objects, edges]);

  const issueCount = Object.values(validityById).filter((v) => v === false).length;

  return (
    <div className="atlas-page">
      <div className="atlas-toolbar">
        <h1>Agent Atlas</h1>
        <div className="atlas-actions">
          {allValid ? (
            <span className="atlas-status ok">✓ registry valid</span>
          ) : (
            <button
              className="atlas-status as-button bad"
              onClick={() => setShowIssues((s) => !s)}
              title="Show what needs fixing"
            >
              ✗ {issueCount} issue(s) {showIssues ? '▴' : '▾'}
            </button>
          )}
          <button className="primary" onClick={exportRegistry} disabled={!allValid}>Export registry</button>
          <button className="atlas-panel-toggle" onClick={() => setModal('reset')}
            title="Discard saved changes and reload the demo model">Reset to demo</button>
          <button className="atlas-panel-toggle" onClick={() => setPanelOpen((o) => !o)}
            title={panelOpen ? 'Collapse properties panel' : 'Show properties panel'}>
            {panelOpen ? 'Panel ⟩' : '⟨ Panel'}
          </button>
        </div>
      </div>

      {connectMsg && <div className="atlas-cross-issues">{connectMsg}</div>}
      {exportMsg && <div className="atlas-export-msg">{exportMsg}</div>}

      {showIssues && issues.length > 0 && (
        <div className="atlas-issues-bar">
          {issues.map((it) => (
            <button
              key={it.objId}
              className="atlas-issue-item"
              onClick={() => { setSelectedId(it.objId); setPanelOpen(true); setFocusReq({ id: it.objId, n: (focusReq?.n || 0) + 1 }); }}
              title="Jump to this object"
            >
              <strong>{it.noun} “{it.label}”:</strong> {it.reasons.join('; ')}
            </button>
          ))}
        </div>
      )}

      <div className="atlas-body">
        <ModelTree
          objects={visibleObjects}
          expanded={expanded}
          onToggle={toggleExpand}
          selectedId={selectedId}
          onSelect={(id) => { setSelectedId(id); setPanelOpen(true); setFocusReq({ id, n: (focusReq?.n || 0) + 1 }); }}
          validityById={validityById}
          subjectAreas={subjectAreas}
          currentSA={currentSA}
          onSelectSA={setCurrentSA}
          onNewSA={newSubjectArea}
          onEditSA={editCurrentSA}
          onCreate={createObject}
          collapsed={treeCollapsed}
          onToggleCollapse={() => setTreeCollapsed((c) => !c)}
          onOpenSettings={() => setModal('settings')}
          onOpenAbout={() => setModal('about')}
        />
        <UnifiedGraph
          objects={visibleObjects}
          edges={edges}
          expanded={expanded}
          onToggleExpand={toggleExpand}
          selectedId={selectedId}
          onSelect={(id) => { setSelectedId(id); if (id) setPanelOpen(true); }}
          onConnect={connect}
          validityById={validityById}
          focusReq={focusReq}
          viewId={viewId}
          layout={layouts[viewId]}
          onNodePosition={setNodePosition}
          viewport={viewports[viewId]}
          onViewportChange={setViewport}
        />
        {panelOpen && <PropertiesPanel node={selectedNode} onChange={updateSelected} errors={selectedErrors} />}
      </div>

      {saEditor && (
        <SAEditor
          editor={saEditor}
          allTasks={allTasks}
          onChange={setSaEditor}
          onSave={() => saveSubjectArea(saEditor)}
          onCancel={() => setSaEditor(null)}
        />
      )}
      {modal === 'reset' && (
        <div className="atlas-modal-backdrop" onClick={() => setModal(null)}>
          <div className="atlas-modal" onClick={(e) => e.stopPropagation()}>
            <h2>Reset to demo model?</h2>
            <p className="atlas-empty">
              This discards your saved objects, layout, and views, and reloads the
              built-in demo. This can’t be undone.
            </p>
            <div className="atlas-modal-actions">
              <button className="atlas-slider-reset" onClick={() => setModal(null)}>Cancel</button>
              <button onClick={() => { resetToDemo(); setModal(null); }}>Reset</button>
            </div>
          </div>
        </div>
      )}
      {modal === 'settings' && <SettingsModal onClose={() => setModal(null)} />}
      {modal === 'about' && <AboutModal onClose={() => setModal(null)} />}
    </div>
  );
}

// Modal to name a Subject Area and choose which tasks belong to it.
function SAEditor({ editor, allTasks, onChange, onSave, onCancel }) {
  const toggle = (taskId) => {
    const has = editor.taskIds.includes(taskId);
    onChange({ ...editor, taskIds: has ? editor.taskIds.filter((t) => t !== taskId) : [...editor.taskIds, taskId] });
  };
  return (
    <div className="atlas-modal-backdrop" onClick={onCancel}>
      <div className="atlas-modal" onClick={(e) => e.stopPropagation()} autoCapitalize="off" autoCorrect="off" spellCheck={false}>
        <h2>Subject Area</h2>
        <div className="atlas-modal-row">
          <label>Name</label>
          <input
            className="atlas-sa-name"
            value={editor.name}
            onChange={(e) => onChange({ ...editor, name: e.target.value })}
            placeholder="MS SQL → Aurora migration"
          />
        </div>
        <div className="atlas-modal-row">
          <label>Tasks in this view</label>
          {allTasks.length === 0 && <div className="atlas-empty">No tasks in the model yet.</div>}
          {allTasks.map((t) => (
            <label key={t.id} className="atlas-sa-check">
              <input type="checkbox" checked={editor.taskIds.includes(t.id)} onChange={() => toggle(t.id)} />
              <span>{t.data?.label || t.data?.id || t.id}</span>
            </label>
          ))}
        </div>
        <div className="atlas-modal-actions">
          <button className="atlas-slider-reset" onClick={onCancel}>Cancel</button>
          <button onClick={onSave} disabled={!editor.name}>Save</button>
        </div>
      </div>
    </div>
  );
}
