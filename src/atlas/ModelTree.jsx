// Left panel for the unified model: an Erwin-style model TREE that mirrors the
// graph hierarchy (tasks → their agents → agents' tools/jobs/etc.), plus the
// Subject Area selector (header), a create menu, and the About/Settings footer.
// Clicking a tree row selects that object (the canvas focuses it); the caret
// expands/collapses, shared with the canvas's expand state.
import React, { useMemo } from 'react';
import { CREATABLE_KINDS } from './blankData';

const KIND_DOT = {
  task: 'var(--accent)', agent: 'var(--agent)', tool: 'var(--tool)',
  job: '#e0b35c', system: '#7aa2ff', router: '#e879c7',
};

function childrenOf(parentId, objects) {
  return Object.values(objects)
    .filter((o) => o.parent === parentId)
    .sort((a, b) => (a.data.id || a.id).localeCompare(b.data.id || b.id));
}

function TreeRow({ obj, objects, depth, expanded, onToggle, selectedId, onSelect, validityById }) {
  const kids = childrenOf(obj.id, objects);
  const isOpen = expanded[obj.id];
  const label = obj.data?.label || obj.data?.id || obj.id;
  const invalid = validityById && validityById[obj.id] === false;
  return (
    <>
      <div
        className={`atlas-tree-row ${selectedId === obj.id ? 'active' : ''}`}
        style={{ paddingLeft: 8 + depth * 14 }}
        onClick={() => onSelect(obj.id)}
        title={label}
      >
        <span
          className="atlas-tree-caret"
          onClick={(e) => { e.stopPropagation(); if (kids.length) onToggle(obj.id); }}
        >
          {kids.length ? (isOpen ? '▾' : '▸') : ''}
        </span>
        <span className="atlas-tree-dot" style={{ background: KIND_DOT[obj.kind] || '#888' }} />
        <span className="atlas-tree-label">{label}</span>
        {invalid && <span className="atlas-tree-invalid" title="Incomplete / invalid">!</span>}
      </div>
      {isOpen && kids.map((k) => (
        <TreeRow key={k.id} obj={k} objects={objects} depth={depth + 1}
          expanded={expanded} onToggle={onToggle} selectedId={selectedId} onSelect={onSelect} validityById={validityById} />
      ))}
    </>
  );
}

export default function ModelTree({
  objects, expanded, onToggle, selectedId, onSelect, validityById,
  subjectAreas, currentSA, onSelectSA, onNewSA, onEditSA,
  onCreate, collapsed, onToggleCollapse, onOpenSettings, onOpenAbout,
}) {
  const roots = useMemo(
    () => Object.values(objects).filter((o) => !o.parent)
      .sort((a, b) => (a.data?.label || a.id).localeCompare(b.data?.label || b.id)),
    [objects]
  );
  const [createOpen, setCreateOpen] = React.useState(false);

  if (collapsed) {
    return (
      <div className="atlas-palette collapsed">
        <button className="atlas-palette-expand" onClick={onToggleCollapse} title="Show model tree">☰</button>
      </div>
    );
  }

  return (
    <div className="atlas-palette" onClick={() => setCreateOpen(false)}>
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
            expanded={expanded} onToggle={onToggle} selectedId={selectedId} onSelect={onSelect} validityById={validityById} />
        ))}
      </div>

      <div className="atlas-palette-spacer" />
      <div className="atlas-palette-footer">
        <button className="atlas-footer-item" onClick={onOpenAbout}>ⓘ About</button>
        <button className="atlas-footer-item" onClick={onOpenSettings}>⚙ Settings</button>
      </div>
    </div>
  );
}
