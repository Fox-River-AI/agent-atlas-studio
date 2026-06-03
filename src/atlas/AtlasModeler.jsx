// agent-atlas visual modeler: lay out agents + tools, draw allowlist edges, and
// export a registry that agent-atlas's own validator accepts. This is the
// "forward" half of the Erwin loop — design visually, generate the spec.
import React, { useCallback, useMemo, useState } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  addEdge,
  useNodesState,
  useEdgesState,
  MarkerType,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import JSZip from 'jszip';

import { nodeTypes } from './nodes';
import PropertiesPanel from './PropertiesPanel';
import ObjectPalette from './ObjectPalette';
import { SettingsModal, AboutModal } from './Modals';
import { DEFAULT_MODEL } from './schema';
import { buildRegistry, validateModel, crossChecks } from './model';
import './atlas.css';

let seq = 0;
const nextKey = () => `n${++seq}`;

// A starter model so the canvas isn't empty — mirrors the agent-atlas example.
const initialNodes = [
  {
    id: 'n-agent-1',
    type: 'agent',
    position: { x: 80, y: 120 },
    data: {
      id: 'intake-classifier',
      owner: 'platform-team',
      version: '1.0.0',
      responsibility: 'Classify an inbound customer message into one support category and an urgency level.',
      model: { ...DEFAULT_MODEL },
      refusalConditions: ['The message is empty or contains no classifiable text.', 'The request is outside support triage.'],
      refusalEmits: 'refused',
      telemetry: [{ name: 'agent.intake_classifier.classification', attributes: ['category', 'urgency', 'confidence'] }],
    },
  },
  {
    id: 'n-tool-1',
    type: 'tool',
    position: { x: 480, y: 140 },
    data: {
      id: 'knowledge-base-search',
      owner: 'platform-team',
      version: '1.0.0',
      description: 'Full-text search over the public support knowledge base.',
      effect: 'read',
      authScope: 'kb:read',
      ratePerMinute: 60,
    },
  },
];
const initialEdges = [
  { id: 'e1', source: 'n-agent-1', target: 'n-tool-1', markerEnd: { type: MarkerType.ArrowClosed } },
];

export default function AtlasModeler() {
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  const [selectedId, setSelectedId] = useState(null);
  const [exportMsg, setExportMsg] = useState('');
  const [panelOpen, setPanelOpen] = useState(true);
  const [paletteCollapsed, setPaletteCollapsed] = useState(false);
  // Subject Areas = saved views (projections of the model). null = whole model.
  // Persistence of named SAs is a follow-up; the selector + "All" work now.
  const [subjectAreas] = useState([]);
  const [currentSA, setCurrentSA] = useState(null);
  const [modal, setModal] = useState(null); // 'settings' | 'about' | null

  // Live validation: recompute per-node schema problems whenever the model changes.
  const problems = useMemo(() => validateModel(nodes, edges), [nodes, edges]);
  const crossIssues = useMemo(() => crossChecks(nodes), [nodes]);
  const allValid = Object.keys(problems).length === 0 && crossIssues.length === 0;

  // Decorate nodes with their validity so the canvas dots reflect schema state.
  const decoratedNodes = useMemo(
    () => nodes.map((n) => ({ ...n, data: { ...n.data, valid: !problems[n.id] } })),
    [nodes, problems]
  );

  const onConnect = useCallback(
    (params) => setEdges((eds) => addEdge({ ...params, markerEnd: { type: MarkerType.ArrowClosed } }, eds)),
    [setEdges]
  );

  const onSelectionChange = useCallback(({ nodes: sel }) => {
    const id = sel && sel.length ? sel[0].id : null;
    setSelectedId(id);
    // Selecting a node auto-opens the panel so editing is always one click away.
    if (id) setPanelOpen(true);
  }, []);

  const blankData = (type) => {
    const common = { id: '', owner: '', version: '1.0.0' };
    switch (type) {
      case 'agent':
        return { ...common, responsibility: '', model: { ...DEFAULT_MODEL }, refusalConditions: [], refusalEmits: 'refused', telemetry: [{ name: '', attributes: [] }] };
      case 'tool':
        return { ...common, description: '', effect: 'read', authScope: '' };
      case 'job':
        return { ...common, description: '', queue: '', trigger: '', timeoutSeconds: '', retries: '' };
      case 'system':
        return { ...common, description: '', systemKind: 'relational-db', connection: '', authScope: '' };
      default:
        return common;
    }
  };

  // Create a new object of `type` at an optional drop position; select it so the
  // properties panel opens ready to edit.
  const addNode = (type, position) => {
    const key = nextKey();
    const id = `n-${type}-${key}`;
    setNodes((nds) => [
      ...nds,
      {
        id,
        type,
        position: position || { x: 200 + (Math.round(seq * 12) % 200), y: 80 + ((seq * 40) % 240) },
        data: blankData(type),
      },
    ]);
    setSelectedId(id);
    setPanelOpen(true);
  };

  // Drag an existing instance from the palette → re-focus it on the canvas.
  const onDragInstanceStart = (e, node) => {
    e.dataTransfer.setData('application/atlas-instance', node.id);
    e.dataTransfer.effectAllowed = 'move';
  };
  const onCanvasDrop = useCallback(
    (e) => {
      e.preventDefault();
      const instanceId = e.dataTransfer.getData('application/atlas-instance');
      if (instanceId) {
        // Instance already exists in the model; select + focus it.
        setSelectedId(instanceId);
        setPanelOpen(true);
      }
    },
    []
  );
  const onCanvasDragOver = useCallback((e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  }, []);

  const updateNode = (nodeId, patch) => {
    setNodes((nds) => nds.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, ...patch } } : n)));
  };

  const exportRegistry = async () => {
    const files = buildRegistry(nodes, edges);
    const zip = new JSZip();
    for (const [path, content] of Object.entries(files)) zip.file(path, content);
    const blob = await zip.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'agent-atlas-registry.zip';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setExportMsg(`Exported ${Object.keys(files).length} file(s). Run agent-atlas validate_registry.py to confirm.`);
  };

  const selectedNode = nodes.find((n) => n.id === selectedId) || null;

  return (
    <div className="atlas-page">
        <div className="atlas-toolbar">
          <h1>Agent Atlas — Modeler</h1>
          <div className="atlas-actions">
            <button onClick={() => addNode('agent')}>+ Agent</button>
            <button onClick={() => addNode('tool')}>+ Tool</button>
            <span className={`atlas-status ${allValid ? 'ok' : 'bad'}`}>
              {allValid ? '✓ registry valid' : `✗ ${Object.keys(problems).length + crossIssues.length} issue(s)`}
            </span>
            <button className="primary" onClick={exportRegistry} disabled={!allValid}>Export registry</button>
            <button
              className="atlas-panel-toggle"
              onClick={() => setPanelOpen((o) => !o)}
              title={panelOpen ? 'Collapse properties panel' : 'Show properties panel'}
            >
              {panelOpen ? 'Panel ⟩' : '⟨ Panel'}
            </button>
          </div>
        </div>

        {crossIssues.length > 0 && (
          <div className="atlas-cross-issues">{crossIssues.join(' · ')}</div>
        )}
        {exportMsg && <div className="atlas-export-msg">{exportMsg}</div>}

        <div className="atlas-body">
          <ObjectPalette
            nodes={nodes}
            subjectAreas={subjectAreas}
            currentSA={currentSA}
            onSelectSA={setCurrentSA}
            onNewSA={() => setExportMsg('Subject Areas (saved views) are coming soon.')}
            onCreate={addNode}
            onSelectInstance={(id) => { setSelectedId(id); setPanelOpen(true); }}
            onDragInstanceStart={onDragInstanceStart}
            collapsed={paletteCollapsed}
            onToggleCollapse={() => setPaletteCollapsed((c) => !c)}
            onOpenSettings={() => setModal('settings')}
            onOpenAbout={() => setModal('about')}
          />
          <div className="atlas-canvas" onDrop={onCanvasDrop} onDragOver={onCanvasDragOver}>
            <ReactFlow
              nodes={decoratedNodes}
              edges={edges}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              onSelectionChange={onSelectionChange}
              nodeTypes={nodeTypes}
              fitView
            >
              <Background />
              <Controls />
            </ReactFlow>
          </div>
          {panelOpen && (
            <PropertiesPanel node={selectedNode} onChange={updateNode} errors={selectedNode ? problems[selectedNode.id] : null} />
          )}
        </div>

        {modal === 'settings' && <SettingsModal onClose={() => setModal(null)} />}
        {modal === 'about' && <AboutModal onClose={() => setModal(null)} />}
    </div>
  );
}
