// Step-1 harness for the unified collapsible graph. Holds the single object
// store + edges + expand state, renders UnifiedGraph, and shows properties for
// the selected object. Seeded with a nested example (task → agent → tools/job)
// so expand/collapse + properties-at-every-level are verifiable now. Later
// steps fold this into the main AtlasModeler and add create/connect, SAs, stubs.
import React, { useState, useMemo, useCallback } from 'react';
import UnifiedGraph from './UnifiedGraph';
import PropertiesPanel from './PropertiesPanel';
import { VALIDATORS, formatErrors, DEFAULT_MODEL } from './schema';
import { manifestFor } from './model';
import { blankData, CREATABLE_KINDS } from './blankData';
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

  const toggleExpand = useCallback((id) => setExpanded((e) => ({ ...e, [id]: !e[id] })), []);

  let seq = Object.keys(objects).length;
  // Create a new object (top-level until connected). Select it so its
  // properties open ready to edit.
  const createObject = (kind) => {
    seq += 1;
    const id = `${kind}-${seq}`;
    setObjects((o) => ({ ...o, [id]: { id, kind, parent: null, data: blankData(kind) } }));
    setSelectedId(id);
  };

  // Draw a relationship: source → target. This also establishes nesting —
  // the target becomes the source's child (Erwin "create then connect"). Expand
  // the source so the new child is visible.
  const connect = useCallback((params) => {
    const { source, target } = params;
    if (!source || !target || source === target) return;
    setObjects((o) => {
      const child = o[target];
      if (!child) return o;
      return { ...o, [target]: { ...child, parent: source } };
    });
    setEdges((es) => {
      if (es.some((e) => e.source === source && e.target === target)) return es;
      return [...es, { id: `e-${source}-${target}`, source, target }];
    });
    setExpanded((e) => ({ ...e, [source]: true }));
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

  return (
    <div className="atlas-page">
      <div className="atlas-toolbar">
        <h1>Agent Atlas — Unified Graph (Step 1)</h1>
        <div className="atlas-actions">
          {CREATABLE_KINDS.map((k) => (
            <button key={k.kind} onClick={() => createObject(k.kind)}>+ {k.label}</button>
          ))}
          <span className="atlas-orch-hint">Drag node → node to connect (sets nesting). Double-click to expand/collapse. Click to edit.</span>
        </div>
      </div>
      <div className="atlas-body">
        <UnifiedGraph
          objects={objects}
          edges={edges}
          expanded={expanded}
          onToggleExpand={toggleExpand}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onConnect={connect}
          validityById={validityById}
        />
        <PropertiesPanel node={selectedNode} onChange={updateSelected} errors={selectedErrors} />
      </div>
    </div>
  );
}
