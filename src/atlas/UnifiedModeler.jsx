// Step-1 harness for the unified collapsible graph. Holds the single object
// store + edges + expand state, renders UnifiedGraph, and shows properties for
// the selected object. Seeded with a nested example (task → agent → tools/job)
// so expand/collapse + properties-at-every-level are verifiable now. Later
// steps fold this into the main AtlasModeler and add create/connect, SAs, stubs.
import React, { useState, useMemo, useCallback } from 'react';
import JSZip from 'jszip';
import UnifiedGraph from './UnifiedGraph';
import PropertiesPanel from './PropertiesPanel';
import ModelTree from './ModelTree';
import { SettingsModal, AboutModal } from './Modals';
import { VALIDATORS, formatErrors, DEFAULT_MODEL } from './schema';
import { manifestFor, buildRegistry } from './model';
import { blankData, CREATABLE_KINDS } from './blankData';
import { canConnect, connectionReason } from './relationships';
import './atlas.css';

// Seed: one task containing one agent; the agent contains two tools + a job.
const SEED_OBJECTS = {
  'ingest-mssql': { id: 'ingest-mssql', kind: 'task', parent: null, data: { id: 'ingest-mssql', label: 'Ingest MS SQL Data' } },
  'connect-agent': {
    id: 'connect-agent', kind: 'agent', parent: 'ingest-mssql',
    data: { id: 'connect-agent', owner: 'platform-team', version: '1.0.0', responsibility: 'Connect to the source database and read its catalog.', model: { ...DEFAULT_MODEL }, refusalConditions: ['Connection cannot be established.'], refusalEmits: 'refused', telemetry: [{ name: 'agent.connect.status', attributes: ['ok'] }] },
  },
  'db-connect': { id: 'db-connect', kind: 'tool', parent: 'connect-agent', data: { id: 'db-connect', owner: 'platform-team', version: '1.0.0', description: 'Open a connection to the source DB.', effect: 'read', authScope: 'db:read' } },
  'catalog-query': { id: 'catalog-query', kind: 'tool', parent: 'connect-agent', data: { id: 'catalog-query', owner: 'platform-team', version: '1.0.0', description: 'Query the system catalog.', effect: 'read', authScope: 'db:read' } },
  'extract-ddl': { id: 'extract-ddl', kind: 'job', parent: 'connect-agent', data: { id: 'extract-ddl', owner: 'platform-team', version: '1.0.0', description: 'Extract the full DDL.', queue: 'migrations', timeoutSeconds: 3600, retries: 3 } },
};
const SEED_EDGES = [
  { id: 'e1', source: 'connect-agent', target: 'db-connect' },
  { id: 'e2', source: 'connect-agent', target: 'catalog-query' },
  { id: 'e3', source: 'connect-agent', target: 'extract-ddl' },
];

export default function UnifiedModeler() {
  const [objects, setObjects] = useState(SEED_OBJECTS);
  const [edges, setEdges] = useState(SEED_EDGES);
  const [expanded, setExpanded] = useState({ 'ingest-mssql': true, 'connect-agent': false });
  const [selectedId, setSelectedId] = useState(null);
  const [focusReq, setFocusReq] = useState(null); // { id, n } — bump n to re-center
  // Chrome state
  const [treeCollapsed, setTreeCollapsed] = useState(false);
  const [panelOpen, setPanelOpen] = useState(true);
  const [modal, setModal] = useState(null); // 'settings' | 'about'
  const [subjectAreas] = useState([]); // wired in Step 3
  const [currentSA, setCurrentSA] = useState(null);
  const [exportMsg, setExportMsg] = useState('');

  const toggleExpand = useCallback((id) => setExpanded((e) => ({ ...e, [id]: !e[id] })), []);

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
    // Place near the currently-selected node so it appears where you're looking;
    // fall back to a default spot. (Stored positions are honored by the layout.)
    const anchor = selectedId && objects[selectedId]?.position;
    const position = anchor ? { x: anchor.x + 60, y: anchor.y + 130 } : { x: 120, y: 120 };
    setObjects((o) => ({ ...o, [id]: { id, kind, parent: null, position, data: blankData(kind) } }));
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

  // Validity per object (drives the red/ok dot), reusing the same validators.
  const validityById = useMemo(() => {
    const out = {};
    for (const o of Object.values(objects)) {
      const v = VALIDATORS[o.kind];
      if (!v) { out[o.id] = true; continue; }
      // Build a node-shaped wrapper for manifestFor.
      const node = { id: o.id, type: o.kind, data: o.data };
      const m = manifestFor(node, Object.values(objects).map((x) => ({ id: x.id, type: x.kind, data: x.data })), edges);
      out[o.id] = m ? v(m) : true;
    }
    return out;
  }, [objects, edges]);

  const allValid = useMemo(() => Object.values(validityById).every(Boolean), [validityById]);

  const exportRegistry = async () => {
    // Build edges in the source→target shape buildRegistry consumes (it reads
    // agent→tool allowlists etc. from edges between component nodes).
    const files = buildRegistry(asNodes, edges);
    if (!Object.keys(files).length) { setExportMsg('Nothing to export yet — add some objects.'); return; }
    const zip = new JSZip();
    for (const [path, content] of Object.entries(files)) zip.file(path, content);
    const blob = await zip.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'agent-atlas-registry.zip';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setExportMsg(`Exported ${Object.keys(files).length} file(s).`);
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
          <span className={`atlas-status ${allValid ? 'ok' : 'bad'}`}>
            {allValid ? '✓ registry valid' : `✗ ${issueCount} issue(s)`}
          </span>
          <button className="primary" onClick={exportRegistry} disabled={!allValid}>Export registry</button>
          <button className="atlas-panel-toggle" onClick={() => setPanelOpen((o) => !o)}
            title={panelOpen ? 'Collapse properties panel' : 'Show properties panel'}>
            {panelOpen ? 'Panel ⟩' : '⟨ Panel'}
          </button>
        </div>
      </div>

      {connectMsg && <div className="atlas-cross-issues">{connectMsg}</div>}
      {exportMsg && <div className="atlas-export-msg">{exportMsg}</div>}

      <div className="atlas-body">
        <ModelTree
          objects={objects}
          expanded={expanded}
          onToggle={toggleExpand}
          selectedId={selectedId}
          onSelect={(id) => { setSelectedId(id); setPanelOpen(true); setFocusReq({ id, n: (focusReq?.n || 0) + 1 }); }}
          validityById={validityById}
          subjectAreas={subjectAreas}
          currentSA={currentSA}
          onSelectSA={setCurrentSA}
          onNewSA={() => setExportMsg('Subject Areas (saved views) are coming next.')}
          onCreate={createObject}
          collapsed={treeCollapsed}
          onToggleCollapse={() => setTreeCollapsed((c) => !c)}
          onOpenSettings={() => setModal('settings')}
          onOpenAbout={() => setModal('about')}
        />
        <UnifiedGraph
          objects={objects}
          edges={edges}
          expanded={expanded}
          onToggleExpand={toggleExpand}
          selectedId={selectedId}
          onSelect={(id) => { setSelectedId(id); if (id) setPanelOpen(true); }}
          onConnect={connect}
          validityById={validityById}
          focusReq={focusReq}
        />
        {panelOpen && <PropertiesPanel node={selectedNode} onChange={updateSelected} errors={selectedErrors} />}
      </div>

      {modal === 'settings' && <SettingsModal onClose={() => setModal(null)} />}
      {modal === 'about' && <AboutModal onClose={() => setModal(null)} />}
    </div>
  );
}
