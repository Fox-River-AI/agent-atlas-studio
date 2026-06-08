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
import { canConnect, connectionReason, parentKindsFor } from './relationships';
import { namedIssues } from './validationMessages';
import './atlas.css';
import { SEED_OBJECTS, SEED_EDGES, SEED_EXPANDED, SEED_SUBJECT_AREAS } from './seedModel';
import { loadModel, saveModel, clearModel, saveRecovery, loadRecovery, clearRecovery } from './persistence';

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
  // Subject Areas = saved views: { id, name, memberIds: [], hiddenIds: [] }. null = whole model.
  const [subjectAreas, setSubjectAreas] = useState(SEED_SUBJECT_AREAS);
  const [currentSA, setCurrentSA] = useState(null);
  const [saEditor, setSaEditor] = useState(null); // { id, name, memberIds } being edited
  const [exportMsg, setExportMsg] = useState('');
  // Delete confirm: { id, label, kind, childCount, childNames } — only in "All".
  const [deleteReq, setDeleteReq] = useState(null);
  const [deleteAck, setDeleteAck] = useState(false); // checkbox must be ticked to delete
  // Undo stack of recent deletions (newest last). Each entry is a snapshot of
  // what was removed, so Undo can be pressed repeatedly to walk back deletions.
  const [undoStack, setUndoStack] = useState([]);
  // Crash-recovery restore prompt: a recovered draft from a previous unclean exit.
  const [recoveryReq, setRecoveryReq] = useState(null); // { draft, selectedId, pendingNew } or null
  // Create flow: the chosen kind, awaiting a parent pick. null = closed.
  const [createKind, setCreateKind] = useState(null);
  // A just-created object that has never been committed — discarding it deletes
  // it (vs. reverting an existing object's edits).
  const [pendingNew, setPendingNew] = useState(null); // objId or null
  // Per-object DRAFT (Feature A): edits accumulate here, NOT in the model, until
  // the user clicks Save. { id, data } or null. The model only changes on Save.
  const [draft, setDraft] = useState(null);
  // Navigation guard prompt when leaving a dirty/new draft:
  // { run } — `run` performs the deferred navigation after the user decides.
  const [navReq, setNavReq] = useState(null);
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
        // Guarantee the single orchestrator root exists (a corrupt save could
        // lack it; the orchestrator is never user-deletable but be defensive).
        let objs = saved.objects;
        if (!Object.values(objs).some((o) => o.kind === 'orchestrator')) {
          const orch = SEED_OBJECTS['cdi-orchestrator']
            || { id: 'orchestrator', kind: 'orchestrator', parent: null, data: blankData('orchestrator') };
          objs = { ...objs, [orch.id]: orch };
        }
        // Self-heal: drop any edge / SA member / SA hidden ref that points at an
        // object that no longer exists (defends against a half-pruned save).
        const exists = (x) => !!objs[x];
        const cleanEdges = (saved.edges || []).filter((e) => exists(e.source) && exists(e.target));
        const cleanSAs = (saved.subjectAreas || []).map((s) => ({
          ...s,
          memberIds: (s.memberIds || []).filter(exists),
          hiddenIds: (s.hiddenIds || []).filter(exists),
        }));
        setObjects(objs);
        setEdges(cleanEdges);
        setExpanded(saved.expanded);
        setSubjectAreas(cleanSAs);
        setLayouts(saved.layouts);
        setViewports(saved.viewports);
      }
      if (!cancelled) hydrated.current = true;
      // Crash recovery: if a recovery snapshot holds an uncommitted draft from a
      // previous unclean exit, offer to restore it. (A clean exit leaves draft
      // null, so nothing is offered.)
      try {
        const rec = await loadRecovery();
        if (!cancelled && rec && rec.draft && rec.draft.id) {
          setRecoveryReq({ draft: rec.draft, selectedId: rec.selectedId, pendingNew: rec.pendingNew });
        }
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, []);

  // Suppress the webview's native "Reload / Inspect" context menu app-wide — a
  // desktop modeling app never wants it, and our own right-click menus open via
  // React handlers that run regardless of this document-level preventDefault.
  useEffect(() => {
    const block = (e) => e.preventDefault();
    document.addEventListener('contextmenu', block);
    return () => document.removeEventListener('contextmenu', block);
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

  // CRASH RECOVERY (requirement #3): write a recovery snapshot on every change,
  // INCLUDING the in-progress draft + selection that the committed model file
  // doesn't hold. On a clean exit the model file is current and the recovery's
  // draft is null, so there's nothing unsaved to restore. If the app dies
  // mid-edit, the recovery still holds the uncommitted draft → we offer it on
  // next launch (see the restore prompt). Written via requestRecoveryWrite.
  const recoveryTimer = useRef(null);
  useEffect(() => {
    if (!hydrated.current) return;
    if (recoveryTimer.current) clearTimeout(recoveryTimer.current);
    recoveryTimer.current = setTimeout(() => {
      saveRecovery({
        savedAt: Date.now(),
        model: { objects, edges, expanded, subjectAreas, layouts, viewports },
        // include the kind so a brand-new uncommitted object can be rebuilt
        draft: draft ? { ...draft, kind: objects[draft.id]?.kind } : null,
        selectedId,
        pendingNew,
      });
    }, 700);
    return () => { if (recoveryTimer.current) clearTimeout(recoveryTimer.current); };
  }, [objects, edges, expanded, subjectAreas, layouts, viewports, draft, selectedId, pendingNew]);

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
  // Objects that BELONG to the current view. Membership is explicit (memberIds),
  // with two expansions: checking a CONTAINER includes its whole subtree
  // (descendants), and the ANCESTORS of every member are shown for structural
  // context (so nothing floats rootless) — ancestors aren't members themselves.
  // This is what the left TREE shows; hidden objects still appear here (dimmed).
  // (null SA = the whole model.)
  const visibleObjects = useMemo(() => {
    if (!sa) return objects;
    const childrenByParent = {};
    for (const o of Object.values(objects)) {
      if (o.parent) (childrenByParent[o.parent] ||= []).push(o.id);
    }
    const keep = new Set();
    // member + descendants (container check = whole subtree)
    const down = (id) => { if (keep.has(id) || !objects[id]) return; keep.add(id); (childrenByParent[id] || []).forEach(down); };
    (sa.memberIds || []).forEach(down);
    // ancestors of everything kept so far (for context; parent chain)
    const withAncestors = new Set(keep);
    for (const id of keep) {
      let cur = objects[id]?.parent;
      while (cur && objects[cur] && !withAncestors.has(cur)) { withAncestors.add(cur); cur = objects[cur].parent; }
    }
    return Object.fromEntries(Object.entries(objects).filter(([id]) => withAncestors.has(id)));
  }, [objects, sa]);

  // The set of ids hidden in the current view, EXPANDED to include descendants
  // (hiding a container hides its subtree). Tree uses it to dim; canvas to omit.
  const hiddenInView = useMemo(() => {
    const out = new Set();
    if (!sa) return out;
    const childrenByParent = {};
    for (const o of Object.values(objects)) {
      if (o.parent) (childrenByParent[o.parent] ||= []).push(o.id);
    }
    const walk = (id) => { if (out.has(id) || !objects[id]) return; out.add(id); (childrenByParent[id] || []).forEach(walk); };
    (sa.hiddenIds || []).forEach(walk);
    return out;
  }, [objects, sa]);

  // What the CANVAS draws = view objects minus the hidden ones.
  const canvasObjects = useMemo(() => {
    if (!sa) return objects;
    if (hiddenInView.size === 0) return visibleObjects;
    return Object.fromEntries(Object.entries(visibleObjects).filter(([id]) => !hiddenInView.has(id)));
  }, [sa, objects, visibleObjects, hiddenInView]);


  // ── Subject Area management ──
  // Open the editor modal directly (name is typed IN the modal). Do NOT use
  // window.prompt — Tauri's webview returns null from it, so the dialog never
  // appeared and "New Subject Area" silently did nothing.
  const newSubjectArea = () => {
    setSaEditor({ id: `sa-${Date.now().toString(36)}`, name: '', memberIds: [], hiddenIds: [] });
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

  // ── Erwin-style object actions (DIAG-11/12/13) ──
  // Workflow (Randy's design):
  //  • DELETE from the model is permitted ONLY in "All" (whole model). It removes
  //    the object + its subtree + edges everywhere, and prunes SA references.
  //  • In a Subject Area you can only HIDE / SHOW an object (with its subtree).
  //    Hidden objects stay in the model AND in the left tree (dimmed) — you
  //    right-click → "Show in this view" to bring them back onto the canvas.
  //  • The orchestrator is the model root and is never deletable.

  // All ids in the subtree rooted at `id` (inclusive).
  const descendantsOf = useCallback((id, objs) => {
    const childrenByParent = {};
    for (const o of Object.values(objs)) {
      if (o.parent) (childrenByParent[o.parent] ||= []).push(o.id);
    }
    const out = [];
    const walk = (x) => { out.push(x); (childrenByParent[x] || []).forEach(walk); };
    walk(id);
    return out;
  }, []);

  // Delete an object (and its subtree) from the whole model.
  const deleteFromModel = useCallback((id) => {
    if (!objects[id] || objects[id].kind === 'orchestrator') return;
    const doomed = new Set(descendantsOf(id, objects));
    // SNAPSHOT what we're about to remove, so Undo can restore it exactly.
    const snapshot = {
      objects: Object.fromEntries(Object.entries(objects).filter(([k]) => doomed.has(k))),
      edges: edges.filter((e) => doomed.has(e.source) || doomed.has(e.target)),
      saRefs: subjectAreas.map((s) => ({
        id: s.id,
        memberIds: (s.memberIds || []).filter((m) => doomed.has(m)),
        hiddenIds: (s.hiddenIds || []).filter((h) => doomed.has(h)),
      })).filter((r) => r.memberIds.length || r.hiddenIds.length),
      layouts: Object.fromEntries(Object.entries(layouts).map(([v, m]) =>
        [v, Object.fromEntries(Object.entries(m).filter(([oid]) => doomed.has(oid)))])),
      label: objects[id].data?.label || objects[id].data?.id || id,
      count: doomed.size,
    };
    setUndoStack((stk) => [...stk, snapshot].slice(-25)); // cap history at 25
    // Compute the doomed set ONCE up front, then call each setter at the top
    // level. (Calling other setters INSIDE the setObjects updater is a React
    // anti-pattern — under Strict Mode the updater runs twice, which corrupted
    // state and blanked the screen when deleting many objects.)
    setObjects((objs) => Object.fromEntries(Object.entries(objs).filter(([k]) => !doomed.has(k))));
    setEdges((es) => es.filter((e) => !doomed.has(e.source) && !doomed.has(e.target)));
    setSubjectAreas((sas) => sas.map((s) => ({
      ...s,
      memberIds: (s.memberIds || []).filter((m) => !doomed.has(m)),
      hiddenIds: (s.hiddenIds || []).filter((h) => !doomed.has(h)),
    })));
    setLayouts((L) => {
      const cleaned = {};
      for (const [v, m] of Object.entries(L)) {
        cleaned[v] = Object.fromEntries(Object.entries(m).filter(([oid]) => !doomed.has(oid)));
      }
      return cleaned;
    });
    setSelectedId((cur) => (doomed.has(cur) ? null : cur));
    setDraft((d) => (d && doomed.has(d.id) ? null : d));
    setPendingNew((p) => (doomed.has(p) ? null : p));
  }, [objects, edges, subjectAreas, layouts, descendantsOf]);

  // Undo the most recent deletion (pop the stack). Repeatable — press again to
  // walk back further. Restores the exact subtree, edges, SA refs, and layout.
  const undoDelete = useCallback(() => {
    setUndoStack((stk) => {
      if (stk.length === 0) return stk;
      const snap = stk[stk.length - 1];
      setObjects((o) => ({ ...o, ...snap.objects }));
      setEdges((es) => {
        const have = new Set(es.map((e) => e.id));
        return [...es, ...snap.edges.filter((e) => !have.has(e.id))];
      });
      setSubjectAreas((sas) => sas.map((s) => {
        const r = snap.saRefs.find((x) => x.id === s.id);
        if (!r) return s;
        return {
          ...s,
          memberIds: [...new Set([...(s.memberIds || []), ...r.memberIds])],
          hiddenIds: [...new Set([...(s.hiddenIds || []), ...r.hiddenIds])],
        };
      }));
      setLayouts((L) => {
        const next = { ...L };
        for (const [v, m] of Object.entries(snap.layouts)) next[v] = { ...(next[v] || {}), ...m };
        return next;
      });
      return stk.slice(0, -1);
    });
  }, []);

  // Toggle hide/show for a SINGLE object in the CURRENT view (Erwin "remove from
  // / add to diagram"). Per-OBJECT — clicking a tool hides only that tool (and
  // its subtree visually), never its whole task. The object stays in the model
  // and the left tree. No-op in "All".
  const toggleHideInView = useCallback((id) => {
    if (!currentSA) return;
    setSubjectAreas((sas) => sas.map((s) => {
      if (s.id !== currentSA) return s;
      const hidden = s.hiddenIds || [];
      return hidden.includes(id)
        ? { ...s, hiddenIds: hidden.filter((h) => h !== id) } // show
        : { ...s, hiddenIds: [...hidden, id] };               // hide
    }));
  }, [currentSA]);

  // Un-hide everything in the current view (clears the SA's hidden set).
  const showAllInView = useCallback(() => {
    if (!currentSA) return;
    setSubjectAreas((sas) => sas.map((s) => (s.id === currentSA ? { ...s, hiddenIds: [] } : s)));
  }, [currentSA]);

  // Go To: select + zoom the canvas IN on the object (explicit navigation, unlike
  // a plain tree click which only reveals it). The `zoom` flag tells the canvas
  // to actually change zoom.
  // goToObject is defined later (after selectObject) so it can reuse the guard.

  // Open the delete confirm. Delete is ONLY available in "All" (no SA), so this
  // is a straight from-model confirm. The orchestrator root is never deletable.
  const requestDelete = useCallback((id) => {
    if (currentSA) return; // safety: no deleting from inside a Subject Area
    const o = objects[id];
    if (!o || o.kind === 'orchestrator') return;
    // Cascade preview: everything that will be destroyed (the subtree).
    const ids = descendantsOf(id, objects);
    const childIds = ids.filter((x) => x !== id);
    const childNames = childIds.map((x) => objects[x]?.data?.label || objects[x]?.data?.id || x);
    setDeleteAck(false); // require a fresh acknowledgment each time
    setDeleteReq({
      id,
      label: o.data?.label || o.data?.id || o.id,
      kind: o.kind,
      childCount: childIds.length,
      childNames,
    });
  }, [objects, currentSA, descendantsOf]);

  // The unified objects, in the {id,type,data} node shape buildRegistry/manifestFor expect.
  const asNodes = useMemo(
    () => Object.values(objects).filter((o) => o.kind !== 'task').map((o) => ({ id: o.id, type: o.kind, data: o.data })),
    [objects]
  );

  // Create a new object already NESTED under a chosen parent (Erwin-style), so it
  // appears in both the main model AND the current Subject Area immediately —
  // no dangling top-level root, no create-then-connect Catch-22 inside a view.
  // parentId null is only valid for a top-level task (parented to the
  // orchestrator if one exists). For a task created inside an SA, we also add it
  // to that SA's memberIds so the view actually shows it.
  const createObject = useCallback((kind, parentId = null) => {
    const seq = Object.keys(objects).length + 1;
    const id = `${kind}-${seq}`;
    // A top-level task auto-parents to the single orchestrator if present.
    let parent = parentId;
    if (!parent && kind === 'task') {
      const orch = Object.values(objects).find((o) => o.kind === 'orchestrator');
      parent = orch ? orch.id : null;
    }
    setObjects((o) => ({ ...o, [id]: { id, kind, parent, data: blankData(kind) } }));
    // Establish the containment edge so the relationship is explicit too.
    if (parent) {
      setEdges((es) => (es.some((e) => e.source === parent && e.target === id)
        ? es : [...es, { id: `e-${parent}-${id}`, source: parent, target: id }]));
      setExpanded((e) => ({ ...e, [parent]: true }));
    }
    // If created inside an SA, include the new object in that view (membership
    // is general now, so any kind can be a direct member).
    if (currentSA) {
      setSubjectAreas((sas) => sas.map((s) =>
        s.id === currentSA && !s.memberIds.includes(id) ? { ...s, memberIds: [...s.memberIds, id] } : s));
    }
    // Place near the parent (or the selected node) in the CURRENT view's layout.
    const anchorId = parent || selectedId;
    const anchor = anchorId && layouts[viewId]?.[anchorId];
    const position = anchor ? { x: anchor.x + 60, y: anchor.y + 130 } : { x: 140, y: 120 };
    setNodePosition(id, position);
    setSelectedId(id);
    setPanelOpen(true);
    setPendingNew(id); // brand-new → discarding deletes it
    setDraft({ id, data: blankData(kind) }); // edit the new object as a draft
    setFocusReq((f) => ({ id, n: (f?.n || 0) + 1 }));
  }, [objects, currentSA, selectedId, layouts, viewId, setNodePosition]);

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

  // Run a navigation, but if the current draft is dirty, defer it behind the
  // The panel edits the DRAFT, not the model. The draft mirrors the selected
  // object's data and is the working copy until Save. (Defined here, before the
  // navigation guard that depends on draftDirty.)
  const draftNode = (draft && objects[draft.id])
    ? { id: draft.id, type: objects[draft.id].kind, data: draft.data }
    : null;
  const editDraft = (id, patch) => setDraft((d) => (d && d.id === id ? { ...d, data: { ...d.data, ...patch } } : d));
  // Dirty = draft differs from committed (a brand-new object is always dirty so
  // its discard-deletes flow works even before any edit).
  const draftDirty = !!draft && (
    pendingNew === draft.id ||
    JSON.stringify(draft.data) !== JSON.stringify(objects[draft.id]?.data)
  );

  // Save/Discard/Cancel prompt. ALL navigation (tree, canvas, go-to, issues, SA
  // switch, reset, SA editor) routes through this so unsaved edits are never
  // silently lost.
  const guardedNavigate = useCallback((run) => {
    if (draftDirty) { setNavReq({ run }); return; }
    run();
  }, [draftDirty]);

  // Perform the actual selection + draft (re)initialization. Not guarded — the
  // guard wraps the callers.
  const doSelect = useCallback((nextId, opts = {}) => {
    setSelectedId(nextId);
    setDraft(nextId && objects[nextId]
      ? { id: nextId, data: JSON.parse(JSON.stringify(objects[nextId].data)) }
      : null);
    if (nextId) setPanelOpen(true);
    if (nextId && opts.focus) setFocusReq((f) => ({ id: nextId, n: (f?.n || 0) + 1, zoom: opts.zoom }));
  }, [objects]);

  const selectObject = useCallback((nextId, opts = {}) => {
    if (nextId === selectedId) return; // re-selecting self: keep the draft
    guardedNavigate(() => doSelect(nextId, opts));
  }, [selectedId, guardedNavigate, doSelect]);

  // Go To (context menu): select + zoom the canvas IN on the object.
  const goToObject = useCallback((id) => {
    if (id === selectedId) { setFocusReq((f) => ({ id, n: (f?.n || 0) + 1, zoom: true })); return; }
    guardedNavigate(() => doSelect(id, { focus: true, zoom: true }));
  }, [selectedId, guardedNavigate, doSelect]);

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

  // Validate the DRAFT (substitute its data into the node list) so the panel's
  // "Required to be valid" list and the Save-enabled state reflect live edits.
  const { selectedErrors, draftValid } = useMemo(() => {
    if (!draftNode) return { selectedErrors: null, draftValid: true };
    const v = VALIDATORS[draftNode.type];
    if (!v) return { selectedErrors: null, draftValid: true };
    const nodes = Object.values(objects).map((x) =>
      x.id === draftNode.id ? draftNode : { id: x.id, type: x.kind, data: x.data });
    const m = manifestFor(draftNode, nodes, edges);
    const ok = m ? v(m) : false;
    return { selectedErrors: ok ? null : formatErrors(v.errors), draftValid: ok };
  }, [draftNode, objects, edges]);

  // Commit the draft into the model; clear the new-object flag once valid.
  const saveDraft = useCallback(() => {
    if (!draft) return;
    setObjects((o) => ({ ...o, [draft.id]: { ...o[draft.id], data: draft.data } }));
    setPendingNew((p) => (p === draft.id ? null : p));
  }, [draft]);
  // Revert edits back to the committed data.
  const revertDraft = useCallback(() => {
    setDraft((d) => (d && objects[d.id] ? { id: d.id, data: JSON.parse(JSON.stringify(objects[d.id].data)) } : d));
  }, [objects]);

  const issueCount = Object.values(validityById).filter((v) => v === false).length;

  return (
    <div className="atlas-page">
      <div className="atlas-toolbar">
        <div className="atlas-brand">
          <img className="atlas-logo" src={`${import.meta.env.BASE_URL}agent-atlas-logo.svg`} alt="" aria-hidden="true" />
          <h1>Agent Atlas</h1>
        </div>
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
      {recoveryReq && (
        <div className="atlas-modal-backdrop">
          <div className="atlas-modal" onClick={(e) => e.stopPropagation()}>
            <h2>Restore unsaved work?</h2>
            <p className="atlas-empty">
              The app closed with unsaved edits to
              “{recoveryReq.draft.data?.label || recoveryReq.draft.data?.id || recoveryReq.draft.id}”.
              Restore those edits, or discard them and use the last saved model?
            </p>
            <div className="atlas-modal-actions">
              <button
                className="atlas-slider-reset"
                onClick={() => { clearRecovery(); setRecoveryReq(null); }}
              >
                Discard
              </button>
              <button
                onClick={() => {
                  const r = recoveryReq;
                  const kind = objects[r.draft.id]?.kind || r.draft.kind;
                  // A brand-new object was never committed to the model — re-insert
                  // a shell so the draft has something to attach to.
                  if (!objects[r.draft.id] && r.pendingNew === r.draft.id) {
                    setObjects((o) => ({ ...o, [r.draft.id]: { id: r.draft.id, kind: kind || 'agent', parent: null, data: r.draft.data } }));
                  }
                  if (objects[r.draft.id] || r.pendingNew === r.draft.id) {
                    setDraft(r.draft);
                    setSelectedId(r.draft.id);
                    setPanelOpen(true);
                    if (r.pendingNew) setPendingNew(r.pendingNew);
                  }
                  setRecoveryReq(null);
                }}
              >
                Restore edits
              </button>
            </div>
          </div>
        </div>
      )}
      {undoStack.length > 0 && (() => {
        const last = undoStack[undoStack.length - 1];
        return (
          <div className="atlas-undo-bar">
            <span>
              Deleted “{last.label}” ({last.count} object{last.count === 1 ? '' : 's'}).
              {undoStack.length > 1 && ` ${undoStack.length} deletions undoable.`}
            </span>
            <button onClick={undoDelete}>Undo</button>
            <button className="atlas-undo-dismiss" onClick={() => setUndoStack([])}>Dismiss</button>
          </div>
        );
      })()}

      {showIssues && issues.length > 0 && (
        <div className="atlas-issues-bar">
          {issues.map((it) => (
            <button
              key={it.objId}
              className="atlas-issue-item"
              onClick={() => selectObject(it.objId, { focus: true })}
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
          onSelect={(id) => selectObject(id, { focus: true })}
          validityById={validityById}
          subjectAreas={subjectAreas}
          currentSA={currentSA}
          onSelectSA={(id) => guardedNavigate(() => { setCurrentSA(id); doSelect(null); })}
          onNewSA={() => guardedNavigate(newSubjectArea)}
          onEditSA={() => guardedNavigate(editCurrentSA)}
          onCreate={(kind) => guardedNavigate(() => setCreateKind(kind))}
          collapsed={treeCollapsed}
          onToggleCollapse={() => setTreeCollapsed((c) => !c)}
          onOpenSettings={() => setModal('settings')}
          onOpenAbout={() => setModal('about')}
          inSubjectArea={!!currentSA}
          canDelete={!currentSA}
          hiddenIds={hiddenInView}
          onGoTo={goToObject}
          onToggleHide={toggleHideInView}
          onDelete={requestDelete}
          hiddenCount={sa ? (sa.hiddenIds || []).length : 0}
          onShowAllInView={showAllInView}
          onAddChild={(parentId, kind) => guardedNavigate(() => createObject(kind, parentId))}
          onAddTopLevel={(kind) => guardedNavigate(() => createObject(kind, null))}
        />
        <UnifiedGraph
          objects={canvasObjects}
          edges={edges}
          expanded={expanded}
          onToggleExpand={toggleExpand}
          selectedId={selectedId}
          onSelect={(id) => selectObject(id)}
          onConnect={connect}
          validityById={validityById}
          focusReq={focusReq}
          viewId={viewId}
          layout={layouts[viewId]}
          onNodePosition={setNodePosition}
          viewport={viewports[viewId]}
          onViewportChange={setViewport}
        />
        {panelOpen && (
          <PropertiesPanel
            node={draftNode}
            onChange={editDraft}
            errors={selectedErrors}
            dirty={draftDirty}
            canSave={draftDirty && draftValid}
            onSave={saveDraft}
            onRevert={() => {
              if (pendingNew === draft?.id) { // new object → revert = discard it
                const id = draft.id;
                setDraft(null); setPendingNew(null); setSelectedId(null);
                deleteFromModel(id);
              } else {
                revertDraft();
              }
            }}
            newObject={pendingNew === draft?.id}
          />
        )}
      </div>

      {saEditor && (
        <SAEditor
          editor={saEditor}
          objects={objects}
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
      {deleteReq && (
        <div className="atlas-modal-backdrop" onClick={() => setDeleteReq(null)}>
          <div className="atlas-modal" onClick={(e) => e.stopPropagation()}>
            <h2>Delete “{deleteReq.label}”?</h2>
            {deleteReq.childCount > 0 ? (
              <>
                <p className="atlas-empty">
                  This deletes the {deleteReq.kind} <strong>and its {deleteReq.childCount} nested
                  object{deleteReq.childCount === 1 ? '' : 's'}</strong> from the model, along with
                  their relationships:
                </p>
                <div className="atlas-delete-list">
                  {deleteReq.childNames.slice(0, 12).map((n, i) => <div key={i}>• {n}</div>)}
                  {deleteReq.childNames.length > 12 && <div>…and {deleteReq.childNames.length - 12} more</div>}
                </div>
                <p className="atlas-empty">You can Undo immediately after.</p>
              </>
            ) : (
              <p className="atlas-empty">
                This deletes the {deleteReq.kind} from the model and its relationships.
                You can Undo immediately after.
              </p>
            )}
            <label className="atlas-sa-check atlas-delete-ack">
              <input type="checkbox" checked={deleteAck} onChange={(e) => setDeleteAck(e.target.checked)} />
              <span>Yes, permanently delete {deleteReq.childCount > 0 ? `these ${deleteReq.childCount + 1} objects` : 'this object'}.</span>
            </label>
            <div className="atlas-modal-actions">
              <button className="atlas-slider-reset" onClick={() => setDeleteReq(null)}>Cancel</button>
              <button
                className="danger"
                disabled={!deleteAck}
                title={deleteAck ? undefined : 'Tick the box to confirm'}
                onClick={() => { deleteFromModel(deleteReq.id); setDeleteReq(null); setDeleteAck(false); }}
              >
                Delete {deleteReq.childCount > 0 ? `${deleteReq.childCount + 1} objects` : 'object'}
              </button>
            </div>
          </div>
        </div>
      )}
      {navReq && draft && (() => {
        const isNew = pendingNew === draft.id;
        return (
        // For a brand-new object we DON'T let a backdrop click dismiss silently —
        // the user must explicitly Complete it or Discard it (requirement #2:
        // no half-made objects left lying around). Editing an existing object can
        // be cancelled (returns you to keep editing).
        <div className="atlas-modal-backdrop" onClick={() => { if (!isNew) setNavReq(null); }}>
          <div className="atlas-modal" onClick={(e) => e.stopPropagation()}>
            <h2>{isNew ? `Finish this ${draft && objects[draft.id] ? objects[draft.id].kind : 'object'}?` : 'Unsaved changes'}</h2>
            <p className="atlas-empty">
              {isNew ? (
                <>This new object {draftValid ? 'is ready to save' : 'is missing required fields'}.
                Complete its required fields to keep it, or discard it.</>
              ) : (
                <>“{draft.data?.label || draft.data?.id || draft.id}” has unsaved
                changes{draftValid ? '' : ' and isn’t valid yet'}. Save them, or discard?</>
              )}
            </p>
            <div className="atlas-modal-actions">
              <button className="atlas-slider-reset" onClick={() => setNavReq(null)}>
                {isNew ? 'Keep editing' : 'Cancel'}
              </button>
              <button
                className="danger"
                onClick={() => {
                  const run = navReq.run;
                  if (isNew) { deleteFromModel(draft.id); setPendingNew(null); }
                  setDraft(null);
                  setNavReq(null);
                  run && run();
                }}
              >
                Discard
              </button>
              <button
                disabled={!draftValid}
                title={draftValid ? undefined : 'Fill required fields first'}
                onClick={() => {
                  const run = navReq.run;
                  saveDraft();
                  setNavReq(null);
                  run && run();
                }}
              >
                {isNew ? 'Save & keep' : 'Save changes'}
              </button>
            </div>
          </div>
        </div>
        );
      })()}
      {createKind && (
        <CreateObjectModal
          kind={createKind}
          objects={objects}
          currentSA={currentSA}
          visibleObjects={visibleObjects}
          onCancel={() => setCreateKind(null)}
          onCreate={(parentId) => { createObject(createKind, parentId); setCreateKind(null); }}
        />
      )}
      {modal === 'settings' && <SettingsModal onClose={() => setModal(null)} />}
      {modal === 'about' && <AboutModal onClose={() => setModal(null)} />}
    </div>
  );
}

// Modal: choose the parent for a newly-created object. Parents are filtered to
// kinds that may legally contain this kind (connection rules) AND, inside a
// Subject Area, to objects visible in that view — so the new child lands where
// you can see it. Tasks may be created top-level (under the orchestrator).
function CreateObjectModal({ kind, objects, currentSA, visibleObjects, onCancel, onCreate }) {
  const allowedParentKinds = useMemo(() => new Set(parentKindsFor(kind)), [kind]);
  // In an SA, only offer parents that are in the view; in All, any valid parent.
  const pool = currentSA ? visibleObjects : objects;
  const candidates = useMemo(
    () => Object.values(pool)
      .filter((o) => allowedParentKinds.has(o.kind))
      .sort((a, b) => (a.data?.label || a.data?.id || a.id).localeCompare(b.data?.label || b.data?.id || b.id)),
    [pool, allowedParentKinds]
  );
  // A task can be top-level (no parent → auto-attaches to the orchestrator).
  const allowTopLevel = kind === 'task';
  const [parentId, setParentId] = useState(allowTopLevel ? '' : (candidates[0]?.id || ''));
  const kindLabel = (CREATABLE_KINDS.find((k) => k.kind === kind)?.label) || kind;
  const noParents = candidates.length === 0 && !allowTopLevel;

  return (
    <div className="atlas-modal-backdrop" onClick={onCancel}>
      <div className="atlas-modal" onClick={(e) => e.stopPropagation()}>
        <h2>New {kindLabel}</h2>
        {noParents ? (
          <p className="atlas-empty">
            There’s no valid parent for a {kindLabel} {currentSA ? 'in this view' : 'yet'}.
            {currentSA ? ' Switch to “All”, or add a suitable parent first.' : ` Create a ${[...allowedParentKinds].join(' or ')} first.`}
          </p>
        ) : (
          <div className="atlas-modal-row">
            <label>Place under</label>
            <select value={parentId} onChange={(e) => setParentId(e.target.value)}>
              {allowTopLevel && <option value="">Top level (under the orchestrator)</option>}
              {candidates.map((o) => (
                <option key={o.id} value={o.id}>
                  {(o.data?.label || o.data?.id || o.id)} · {o.kind}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="atlas-modal-actions">
          <button className="atlas-slider-reset" onClick={onCancel}>Cancel</button>
          {!noParents && <button onClick={() => onCreate(parentId || null)}>Create</button>}
        </div>
      </div>
    </div>
  );
}

// Modal to name a Subject Area and pick which objects belong to it — the whole
// model as a checkable tree (Erwin "add to view"). Check any object of any kind;
// checking a container also auto-checks its subtree (the view expands it anyway,
// but explicit membership keeps the picker honest). Ancestors are shown for
// context in the view but need not be checked.
function SAEditor({ editor, objects, onChange, onSave, onCancel }) {
  const members = new Set(editor.memberIds || []);
  const childrenByParent = useMemo(() => {
    const m = {};
    for (const o of Object.values(objects)) { if (o.parent) (m[o.parent] ||= []).push(o.id); }
    return m;
  }, [objects]);
  const roots = useMemo(
    () => Object.values(objects).filter((o) => !o.parent || !objects[o.parent])
      .map((o) => o.id).sort((a, b) => a.localeCompare(b)),
    [objects]
  );
  const subtree = (id) => { const out = []; const w = (x) => { out.push(x); (childrenByParent[x] || []).forEach(w); }; w(id); return out; };
  const toggle = (id) => {
    const ids = subtree(id); // container check toggles its whole subtree
    const next = new Set(members);
    const turningOn = !members.has(id);
    ids.forEach((x) => (turningOn ? next.add(x) : next.delete(x)));
    onChange({ ...editor, memberIds: [...next] });
  };

  const Row = ({ id, depth }) => {
    const o = objects[id];
    if (!o) return null;
    const kids = (childrenByParent[id] || []).slice().sort((a, b) => a.localeCompare(b));
    const label = o.data?.label || o.data?.id || o.id;
    return (
      <>
        <label className="atlas-sa-check" style={{ paddingLeft: depth * 16 }}>
          <input type="checkbox" checked={members.has(id)} onChange={() => toggle(id)} />
          <span>{label} <span className="atlas-sa-kind">· {o.kind}</span></span>
        </label>
        {kids.map((k) => <Row key={k} id={k} depth={depth + 1} />)}
      </>
    );
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
            placeholder="Gateway & Ingestion"
          />
        </div>
        <div className="atlas-modal-row">
          <label>Objects in this view <span className="atlas-sa-kind">(check to include; checking a container includes its children)</span></label>
          <div className="atlas-sa-tree">
            {roots.length === 0 && <div className="atlas-empty">The model is empty.</div>}
            {roots.map((r) => <Row key={r} id={r} depth={0} />)}
          </div>
        </div>
        <div className="atlas-modal-actions">
          <button className="atlas-slider-reset" onClick={onCancel}>Cancel</button>
          <button onClick={onSave} disabled={!editor.name || (editor.memberIds || []).length === 0}>Save</button>
        </div>
      </div>
    </div>
  );
}
