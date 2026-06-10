// Left panel for the unified model: an Erwin-style model TREE that mirrors the
// graph hierarchy (tasks → their agents → agents' tools/jobs/etc.), plus the
// Subject Area selector (header), a create menu, and the About/Settings footer.
// Clicking a tree row selects that object (the canvas focuses it); the caret
// expands/collapses, shared with the canvas's expand state.
import React, { useMemo } from 'react';
import { CREATABLE_KINDS } from './blankData';
import { childKindsFor } from './relationships';

const KIND_DOT = {
  orchestrator: '#ff5c8a', task: 'var(--accent)', agent: 'var(--agent)', tool: 'var(--tool)',
  job: '#e0b35c', system: '#7aa2ff', router: '#e879c7',
};
const KIND_LABEL = Object.fromEntries(CREATABLE_KINDS.map((k) => [k.kind, k.label]));

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
function ContextMenu({ ctx, inSubjectArea, canDelete, isHidden, onGoTo, onToggleHide, onDelete, onAddChild, onClose }) {
  const { obj, x, y } = ctx;
  const isRoot = obj.kind === 'orchestrator';
  const childKinds = childKindsFor(obj.kind); // legal direct children of this object
  const [submenu, setSubmenu] = React.useState(false);
  const act = (fn) => { fn(obj.id); onClose(); };
  return (
    <>
      <div className="atlas-ctx-backdrop" onClick={onClose} onContextMenu={(e) => { e.preventDefault(); onClose(); }} />
      <div className="atlas-ctx-menu" style={{ left: x, top: y }} role="menu">
        <button className="atlas-ctx-item" onClick={() => act(onGoTo)}>Go to object on canvas</button>

        {childKinds.length > 0 && (
          <>
            <div className="atlas-ctx-sep" />
            <div
              className="atlas-ctx-sub"
              onMouseEnter={() => setSubmenu(true)}
              onMouseLeave={() => setSubmenu(false)}
            >
              <button className="atlas-ctx-item has-sub">Add child ▸</button>
              {submenu && (
                <div className="atlas-ctx-submenu" role="menu">
                  {childKinds.map((k) => (
                    <button key={k} className="atlas-ctx-item"
                      onClick={() => { onAddChild(obj.id, k); onClose(); }}>
                      {KIND_LABEL[k] || k}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </>
        )}

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

// Context menu for BLANK space (no object). The orchestrator is the always-present
// root, so the only top-level add is a Task (which nests under it).
function BlankContextMenu({ pos, onAddTopLevel, onClose }) {
  return (
    <>
      <div className="atlas-ctx-backdrop" onClick={onClose} onContextMenu={(e) => { e.preventDefault(); onClose(); }} />
      <div className="atlas-ctx-menu" style={{ left: pos.x, top: pos.y }} role="menu">
        <button className="atlas-ctx-item" onClick={() => { onAddTopLevel('task'); onClose(); }}>Add Task</button>
      </div>
    </>
  );
}

export default function ModelTree({
  objects, expanded, onToggle, selectedId, onSelect, validityById,
  subjectAreas, currentSA, onSelectSA, onNewSA, onEditSA,
  onCreate, collapsed, onToggleCollapse, onOpenSettings, onOpenAbout,
  inSubjectArea, canDelete, hiddenIds, onGoTo, onToggleHide, onDelete,
  hiddenCount = 0, onShowAllInView, onAddChild, onAddTopLevel, onOpenRequirements,
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
  // Blank-space right-click menu (top-level add): { x, y } or null.
  const [blankCtx, setBlankCtx] = React.useState(null);
  const openContextMenu = React.useCallback((e, obj) => {
    e.preventDefault();
    e.stopPropagation();
    setBlankCtx(null);
    onSelect(obj.id); // selecting the right-clicked row matches Erwin/most apps
    setCtx({ obj, x: e.clientX, y: e.clientY });
  }, [onSelect]);
  const openBlankMenu = React.useCallback((e) => {
    // Only when the right-click is on empty tree space, not a row (rows
    // stopPropagation). Top-level add is a whole-model action, so suppress it
    // inside a Subject Area (you add via a parent there).
    e.preventDefault();
    if (inSubjectArea) return;
    setCtx(null);
    setBlankCtx({ x: e.clientX, y: e.clientY });
  }, [inSubjectArea]);
  const closeContextMenu = React.useCallback(() => { setCtx(null); setBlankCtx(null); }, []);

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
        {onOpenRequirements && (
          <button className="atlas-sa-new" onClick={onOpenRequirements} title="Generate a first-cut model from a requirements doc">✦ Generate from requirements</button>
        )}
      </div>

      <div className="atlas-tree" onContextMenu={openBlankMenu}>
        {roots.length === 0 && (
          <div className="atlas-empty">
            — empty model —{!inSubjectArea && <><br />right-click to add a Task</>}
          </div>
        )}
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
          onAddChild={onAddChild}
          onClose={closeContextMenu}
        />
      )}
      {blankCtx && (
        <BlankContextMenu
          pos={blankCtx}
          onAddTopLevel={onAddTopLevel}
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
