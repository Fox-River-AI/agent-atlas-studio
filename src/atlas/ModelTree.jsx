// Left panel for the unified model: an Erwin-style model TREE that mirrors the
// graph hierarchy (tasks → their agents → agents' tools/jobs/etc.), plus the
// Subject Area selector (header), a create menu, and the About/Settings footer.
// Clicking a tree row selects that object (the canvas focuses it); the caret
// expands/collapses, shared with the canvas's expand state.
import React, { useMemo } from 'react';
import { CREATABLE_KINDS } from './blankData';

const KIND_DOT = {
  orchestrator: '#ff5c8a', task: 'var(--accent)', agent: 'var(--agent)', tool: 'var(--tool)',
  job: '#e0b35c', system: '#7aa2ff', router: '#e879c7',
};

function childrenOf(parentId, objects) {
  return Object.values(objects)
    .filter((o) => o.parent === parentId)
    .sort((a, b) => (a.data.id || a.id).localeCompare(b.data.id || b.id));
}

function TreeRow({ obj, objects, depth, expanded, onToggle, selectedId, onSelect, validityById, onContextMenu, hiddenIds }) {
  const kids = childrenOf(obj.id, objects);
  const isOpen = expanded[obj.id];
  const label = obj.data?.label || obj.data?.id || obj.id;
  const invalid = validityById && validityById[obj.id] === false;
  const hidden = hiddenIds && hiddenIds.has(obj.id); // hidden from the current view
  return (
    <>
      <div
        className={`atlas-tree-row ${selectedId === obj.id ? 'active' : ''} ${hidden ? 'hidden-in-view' : ''}`}
        style={{ paddingLeft: 8 + depth * 14 }}
        onClick={() => onSelect(obj.id)}
        onContextMenu={(e) => onContextMenu(e, obj)}
        title={hidden ? `${label} — hidden in this view (right-click to show)` : label}
      >
        <span
          className="atlas-tree-caret"
          onClick={(e) => { e.stopPropagation(); if (kids.length) onToggle(obj.id); }}
        >
          {kids.length ? (isOpen ? '▾' : '▸') : ''}
        </span>
        <span className="atlas-tree-dot" style={{ background: KIND_DOT[obj.kind] || '#888' }} />
        <span className="atlas-tree-label">{label}</span>
        {hidden && <span className="atlas-tree-hidden" title="Hidden in this view">⦸</span>}
        {invalid && <span className="atlas-tree-invalid" title="Incomplete / invalid">!</span>}
      </div>
      {isOpen && kids.map((k) => (
        <TreeRow key={k.id} obj={k} objects={objects} depth={depth + 1}
          expanded={expanded} onToggle={onToggle} selectedId={selectedId} onSelect={onSelect}
          validityById={validityById} onContextMenu={onContextMenu} hiddenIds={hiddenIds} />
      ))}
    </>
  );
}

// Erwin-style right-click menu for a tree object (DIAG-12). Inside a Subject Area
// you can only Hide/Show (toggle). Delete-from-model is offered ONLY in "All"
// (canDelete) and never for the orchestrator root.
function ContextMenu({ ctx, inSubjectArea, canDelete, isHidden, onGoTo, onToggleHide, onDelete, onClose }) {
  const { obj, x, y } = ctx;
  const isRoot = obj.kind === 'orchestrator';
  const act = (fn) => { fn(obj.id); onClose(); };
  return (
    <>
      <div className="atlas-ctx-backdrop" onClick={onClose} onContextMenu={(e) => { e.preventDefault(); onClose(); }} />
      <div className="atlas-ctx-menu" style={{ left: x, top: y }} role="menu">
        <button className="atlas-ctx-item" onClick={() => act(onGoTo)}>Go to object on canvas</button>
        {inSubjectArea && (
          <>
            <div className="atlas-ctx-sep" />
            <button className="atlas-ctx-item" onClick={() => act(onToggleHide)}>
              {isHidden ? 'Show object in this view' : 'Hide object from this view'}
            </button>
          </>
        )}
        {canDelete && (
          <>
            <div className="atlas-ctx-sep" />
            <button
              className="atlas-ctx-item danger"
              disabled={isRoot}
              title={isRoot ? 'The orchestrator is the model root and cannot be deleted' : undefined}
              onClick={() => !isRoot && act(onDelete)}
            >
              Delete object from model…
            </button>
          </>
        )}
      </div>
    </>
  );
}

export default function ModelTree({
  objects, expanded, onToggle, selectedId, onSelect, validityById,
  subjectAreas, currentSA, onSelectSA, onNewSA, onEditSA,
  onCreate, collapsed, onToggleCollapse, onOpenSettings, onOpenAbout,
  inSubjectArea, canDelete, hiddenIds, onGoTo, onToggleHide, onDelete,
  hiddenCount = 0, onShowAllInView,
}) {
  // Roots = objects whose parent is not in the current (possibly SA-filtered)
  // set. In "All" that's the orchestrator; in a Subject Area it's the member
  // tasks (their parent orchestrator is filtered out). Without this, an SA view
  // would have no renderable root and show empty.
  const roots = useMemo(
    () => Object.values(objects).filter((o) => !o.parent || !objects[o.parent])
      .sort((a, b) => (a.data?.label || a.id).localeCompare(b.data?.label || b.id)),
    [objects]
  );
  const [createOpen, setCreateOpen] = React.useState(false);
  // Right-click context menu: { obj, x, y } or null. (DIAG-12)
  const [ctx, setCtx] = React.useState(null);
  const openContextMenu = React.useCallback((e, obj) => {
    e.preventDefault();
    e.stopPropagation();
    onSelect(obj.id); // selecting the right-clicked row matches Erwin/most apps
    setCtx({ obj, x: e.clientX, y: e.clientY });
  }, [onSelect]);
  const closeContextMenu = React.useCallback(() => setCtx(null), []);

  if (collapsed) {
    return (
      <div className="atlas-palette collapsed">
        <button className="atlas-palette-expand" onClick={onToggleCollapse} title="Show model tree">☰</button>
      </div>
    );
  }

  return (
    <div
      className="atlas-palette"
      onClick={() => setCreateOpen(false)}
      // Suppress the webview's native "Reload / Inspect" menu anywhere in the
      // panel — only our object context menu should appear here. Right-clicking
      // empty tree space just closes any open menu.
      onContextMenu={(e) => { e.preventDefault(); setCtx(null); }}
    >
      <div className="atlas-palette-head">
        <span className="atlas-palette-title">MODEL</span>
        <button className="atlas-palette-collapse" onClick={onToggleCollapse} title="Collapse">⟨</button>
      </div>

      <div className="atlas-sa">
        <label>Subject Area</label>
        <select value={currentSA || ''} onChange={(e) => onSelectSA(e.target.value || null)}>
          <option value="">All (whole model)</option>
          {(subjectAreas || []).map((sa) => <option key={sa.id} value={sa.id}>{sa.name}</option>)}
        </select>
        <div className="atlas-sa-links">
          <button className="atlas-sa-new" onClick={onNewSA}>+ New Subject Area</button>
          {currentSA && <button className="atlas-sa-new" onClick={onEditSA}>Edit current</button>}
        </div>
        {currentSA && hiddenCount > 0 && (
          <button className="atlas-sa-showall" onClick={onShowAllInView}>
            {hiddenCount} hidden in this view — show all
          </button>
        )}
      </div>

      <div className="atlas-tree-add">
        <button className="atlas-row-add" onClick={(e) => { e.stopPropagation(); setCreateOpen((o) => !o); }}>+ New object ▾</button>
        {createOpen && (
          <div className="atlas-create-menu">
            {CREATABLE_KINDS.map((k) => (
              <button key={k.kind} onClick={() => { onCreate(k.kind); setCreateOpen(false); }}>{k.label}</button>
            ))}
          </div>
        )}
      </div>

      <div className="atlas-tree">
        {roots.length === 0 && <div className="atlas-empty">— empty model —</div>}
        {roots.map((r) => (
          <TreeRow key={r.id} obj={r} objects={objects} depth={0}
            expanded={expanded} onToggle={onToggle} selectedId={selectedId} onSelect={onSelect}
            validityById={validityById} onContextMenu={openContextMenu} hiddenIds={hiddenIds} />
        ))}
      </div>

      {ctx && (
        <ContextMenu
          ctx={ctx}
          inSubjectArea={inSubjectArea}
          canDelete={canDelete}
          isHidden={hiddenIds ? hiddenIds.has(ctx.obj.id) : false}
          onGoTo={onGoTo}
          onToggleHide={onToggleHide}
          onDelete={onDelete}
          onClose={closeContextMenu}
        />
      )}

      <div className="atlas-palette-spacer" />
      <div className="atlas-palette-footer">
        <button className="atlas-footer-item" onClick={onOpenAbout}>ⓘ About</button>
        <button className="atlas-footer-item" onClick={onOpenSettings}>⚙ Settings</button>
      </div>
    </div>
  );
}
