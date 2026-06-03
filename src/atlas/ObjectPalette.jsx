// Left panel: the model explorer / object palette.
//
// MODEL header (Subject Area selector — "All" = whole model) on top, then the
// object types in hierarchical order. Each type is a collapsible group; the
// objects of that type are listed alphabetically beneath it. Right-click a type
// header to create a new object of that type; drag an instance onto the canvas
// to place it in the current view. Collapsible, Noesis-style.
import React, { useState, useMemo } from 'react';

// Hierarchical order of the object taxonomy (decided 2026-06-02). Orchestrator
// and State store are singular roles; Agents/Tools/Jobs/Systems are the
// first-class runtime/structural types. Jobs + Systems render-support is on the
// roadmap — the groups appear now so the structure is established.
export const OBJECT_TYPES = [
  { type: 'orchestrator', label: 'Orchestrator', singular: true },
  { type: 'agent', label: 'Agents' },
  { type: 'tool', label: 'MCP Tools' },
  { type: 'job', label: 'Jobs' },
  { type: 'system', label: 'Systems' },
];

function Caret({ open }) {
  return <span className="atlas-caret">{open ? '▾' : '▸'}</span>;
}

export default function ObjectPalette({
  nodes,
  subjectAreas,
  currentSA,
  onSelectSA,
  onNewSA,
  onCreate,
  onSelectInstance,
  onDragInstanceStart,
  collapsed,
  onToggleCollapse,
  onOpenSettings,
  onOpenAbout,
}) {
  const [openGroups, setOpenGroups] = useState(() =>
    Object.fromEntries(OBJECT_TYPES.map((t) => [t.type, true]))
  );
  const [ctxMenu, setCtxMenu] = useState(null); // {type, x, y}

  // Group the model's objects by type, alphabetical by id within each group.
  const byType = useMemo(() => {
    const m = Object.fromEntries(OBJECT_TYPES.map((t) => [t.type, []]));
    for (const n of nodes) if (m[n.type]) m[n.type].push(n);
    for (const k of Object.keys(m)) {
      m[k].sort((a, b) => (a.data.id || '').localeCompare(b.data.id || ''));
    }
    return m;
  }, [nodes]);

  if (collapsed) {
    return (
      <div className="atlas-palette collapsed">
        <button className="atlas-palette-expand" onClick={onToggleCollapse} title="Show objects">
          ☰
        </button>
      </div>
    );
  }

  const toggleGroup = (type) => setOpenGroups((g) => ({ ...g, [type]: !g[type] }));

  return (
    <div className="atlas-palette" onClick={() => setCtxMenu(null)}>
      {/* ── MODEL header: subject area selector + tools ── */}
      <div className="atlas-palette-head">
        <span className="atlas-palette-title">MODEL</span>
        <button className="atlas-palette-collapse" onClick={onToggleCollapse} title="Collapse">⟨</button>
      </div>
      <div className="atlas-sa">
        <label>Subject Area</label>
        <select value={currentSA || ''} onChange={(e) => onSelectSA(e.target.value || null)}>
          <option value="">All (whole model)</option>
          {subjectAreas.map((sa) => (
            <option key={sa.id} value={sa.id}>{sa.name}</option>
          ))}
        </select>
        <button className="atlas-sa-new" onClick={onNewSA}>+ New Subject Area</button>
      </div>

      {/* ── object type groups ── */}
      <div className="atlas-groups">
        {OBJECT_TYPES.map(({ type, label, singular }) => {
          const items = byType[type];
          const open = openGroups[type];
          return (
            <div key={type} className="atlas-group-section">
              <div
                className="atlas-group-header"
                onClick={() => toggleGroup(type)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setCtxMenu({ type, label, x: e.clientX, y: e.clientY });
                }}
                title="Right-click to create"
              >
                <Caret open={open} />
                <span className="atlas-group-label">{label}</span>
                <span className="atlas-group-count">{items.length}</span>
              </div>
              {open && (
                <div className="atlas-group-items">
                  {items.length === 0 && <div className="atlas-empty">— none —</div>}
                  {items.map((n) => (
                    <div
                      key={n.id}
                      className={`atlas-item ${type}`}
                      draggable
                      onDragStart={(e) => onDragInstanceStart(e, n)}
                      onClick={() => onSelectInstance(n.id)}
                      title={n.data.id || '(unnamed)'}
                    >
                      {n.data.id || '(unnamed)'}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* ── right-click context menu ── */}
      {ctxMenu && (
        <div className="atlas-ctxmenu" style={{ left: ctxMenu.x, top: ctxMenu.y }}>
          <button
            onClick={() => {
              onCreate(ctxMenu.type);
              setCtxMenu(null);
            }}
          >
            New {ctxMenu.label.replace(/s$/, '')}
          </button>
        </div>
      )}

      {/* ── footer (pinned bottom): About / Settings / Collapse ── */}
      <div className="atlas-palette-spacer" />
      <div className="atlas-palette-footer">
        <button className="atlas-footer-item" onClick={onOpenAbout}>ⓘ About</button>
        <button className="atlas-footer-item" onClick={onOpenSettings}>⚙ Settings</button>
        <button className="atlas-footer-item" onClick={onToggleCollapse}>⟨ Collapse</button>
      </div>
    </div>
  );
}
