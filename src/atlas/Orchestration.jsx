// Orchestration — the two-level DAG.
//
// Level 1 (TaskFlowView): the outer DAG of high-level tasks (ingest → convert →
//   validate). Each task is a node; edges order them. Double-click a task to
//   open its inner detail.
// Level 2 (TaskDetailView): one task's inner DAG — references to library
//   components (agents/tools/jobs/systems), sequenced. You can reference an
//   existing component or create a new stub inline (right-click); a created stub
//   lands in the component library (single source of truth) flagged incomplete.
import React, { useCallback, useState, useMemo } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  addEdge,
  applyNodeChanges,
  applyEdgeChanges,
  MarkerType,
  Handle,
  Position,
  ReactFlowProvider,
} from '@xyflow/react';

// ── Level 1: task-level DAG ───────────────────────────────────────────────
function HighLevelTaskNode({ data, selected }) {
  return (
    <div
      className={`atlas-hltask ${selected ? 'selected' : ''}`}
      onDoubleClick={() => data.onOpen?.(data.taskId)}
      title="Double-click to open this task's flow"
    >
      <Handle type="target" position={Position.Left} />
      <div className="atlas-hltask-label">{data.label}</div>
      <div className="atlas-hltask-meta">{data.count} step(s) · double-click to open</div>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
const taskFlowNodeTypes = { hltask: HighLevelTaskNode };

export function TaskFlowView({ tasks, setTasks, taskFlowEdges, setTaskFlowEdges, onOpenTask, onAddTask }) {
  // Build React Flow nodes from tasks; inject open handler + step count.
  // Memoized: React Flow v12 thrashes node measurement if it receives fresh
  // object references every render, which can leave nodes stuck visibility:hidden.
  const rfNodes = useMemo(
    () =>
      tasks.map((t) => ({
        id: t.id,
        type: 'hltask',
        position: t.position,
        data: { taskId: t.id, label: t.label, count: (t.nodes || []).length, onOpen: onOpenTask },
      })),
    [tasks, onOpenTask]
  );

  const onNodesChange = useCallback(
    (changes) =>
      setTasks((ts) => {
        const updated = applyNodeChanges(changes, ts.map((t) => ({ id: t.id, position: t.position, data: {} })));
        const posById = Object.fromEntries(updated.map((n) => [n.id, n.position]));
        return ts.map((t) => ({ ...t, position: posById[t.id] || t.position }));
      }),
    [setTasks]
  );
  const onEdgesChange = useCallback(
    (changes) => setTaskFlowEdges((es) => applyEdgeChanges(changes, es)),
    [setTaskFlowEdges]
  );
  const onConnect = useCallback(
    (params) => {
      const when = window.prompt('Condition for this task transition? (blank = unconditional "then")', '') || '';
      setTaskFlowEdges((es) => addEdge({ ...params, label: when || undefined, markerEnd: { type: MarkerType.ArrowClosed } }, es));
    },
    [setTaskFlowEdges]
  );

  if (tasks.length === 0) {
    return (
      <div className="atlas-orch">
        <div className="atlas-orch-empty">
          <p>No tasks yet.</p>
          <p className="atlas-orch-empty-sub">
            A task is a high-level step of your workflow (e.g. “Ingest MS SQL data”). Add tasks, order
            them, then open each to design the agents, tools, and jobs that carry it out.
          </p>
          <button className="primary" onClick={onAddTask}>+ Add your first task</button>
        </div>
      </div>
    );
  }

  return (
   <ReactFlowProvider>
    <div className="atlas-orch">
      <div className="atlas-orch-canvas">
        <ReactFlow
          nodes={rfNodes}
          edges={taskFlowEdges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          nodeTypes={taskFlowNodeTypes}
          fitView
          fitViewOptions={{ maxZoom: 1, padding: 0.3 }}
          minZoom={0.2}
        >
          <Background />
          <Controls />
        </ReactFlow>
      </div>
    </div>
   </ReactFlowProvider>
  );
}

// ── Level 2: one task's inner component DAG ───────────────────────────────
function StepNode({ data, selected }) {
  return (
    <div className={`atlas-node ${data.componentType || 'agent'} ${selected ? 'selected' : ''}`}>
      <Handle type="target" position={Position.Left} />
      <div className="atlas-node-head"><span className="atlas-kind">{(data.componentType || 'agent').toUpperCase()}</span></div>
      <div className="atlas-node-id">{data.componentId || '(unset)'}</div>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
const stepNodeTypes = { step: StepNode };

const COMPONENT_KINDS = [
  { type: 'agent', label: 'Agent' },
  { type: 'tool', label: 'MCP Tool' },
  { type: 'job', label: 'Job' },
  { type: 'system', label: 'System' },
];

export function TaskDetailView({ task, componentNodes, onUpdateTaskGraph, onCreateComponent }) {
  const [ctx, setCtx] = useState(null); // {x,y} right-click position on canvas

  if (!task) return <div className="atlas-orch"><div className="atlas-orch-empty"><p>Task not found.</p></div></div>;

  const nodes = task.nodes || [];
  const edges = task.edges || [];

  const setNodes = (updater) => onUpdateTaskGraph(task.id, { nodes: typeof updater === 'function' ? updater(nodes) : updater });
  const setEdges = (updater) => onUpdateTaskGraph(task.id, { edges: typeof updater === 'function' ? updater(edges) : updater });

  const onNodesChange = useCallback((changes) => setNodes((ns) => applyNodeChanges(changes, ns)), [task, nodes]);
  const onEdgesChange = useCallback((changes) => setEdges((es) => applyEdgeChanges(changes, es)), [task, edges]);
  const onConnect = useCallback(
    (params) => {
      const when = window.prompt('Condition for this step transition? (blank = unconditional "then")', '') || '';
      setEdges((es) => addEdge({ ...params, label: when || undefined, markerEnd: { type: MarkerType.ArrowClosed } }, es));
    },
    [task, edges]
  );

  // Components available to reference, grouped by type.
  const existingByType = (t) => componentNodes.filter((n) => n.type === t).map((n) => n.data.id).filter(Boolean).sort();

  // Place a step that references (or creates) a component.
  const placeStep = (componentType, componentId) => {
    const key = `step-${nodes.length + 1}-${Math.abs(hashish(componentId))}`;
    setNodes((ns) => [
      ...ns,
      {
        id: key,
        type: 'step',
        position: ctx ? { x: ctx.cx, y: ctx.cy } : { x: 120 + (ns.length * 50) % 300, y: 100 + (ns.length * 60) % 240 },
        data: { componentType, componentId },
      },
    ]);
    setCtx(null);
  };

  const handleCreateNew = (componentType) => {
    const name = window.prompt(`New ${componentType} id (lowercase-hyphens):`, '');
    if (!name) { setCtx(null); return; }
    const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    if (!id) { setCtx(null); return; }
    // Create the stub in the component library (single source of truth), then
    // reference it here. It will show invalid until fully defined in the component view.
    onCreateComponent(componentType, undefined, id);
    placeStep(componentType, id);
  };

  return (
    <div className="atlas-orch">
      <div className="atlas-orch-bar">
        <span className="atlas-orch-hint">
          Right-click the canvas to add a step (reference an existing component or create a new one).
          Drag step → step to sequence them.
        </span>
      </div>
      <div
        className="atlas-orch-canvas"
        onContextMenu={(e) => { e.preventDefault(); setCtx({ x: e.clientX, y: e.clientY, cx: e.nativeEvent.offsetX, cy: e.nativeEvent.offsetY }); }}
        onClick={() => setCtx(null)}
      >
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          nodeTypes={stepNodeTypes}
          fitView
          fitViewOptions={{ maxZoom: 1, padding: 0.3 }}
          minZoom={0.2}
        >
          <Background />
          <Controls />
        </ReactFlow>

        {ctx && (
          <div className="atlas-ctxmenu" style={{ left: ctx.x, top: ctx.y }} onClick={(e) => e.stopPropagation()}>
            {COMPONENT_KINDS.map(({ type, label }) => (
              <div key={type} className="atlas-ctx-group">
                <div className="atlas-ctx-grouplabel">{label}</div>
                {existingByType(type).map((id) => (
                  <button key={id} onClick={() => placeStep(type, id)}>{id}</button>
                ))}
                <button className="atlas-ctx-new" onClick={() => handleCreateNew(type)}>+ New {label}…</button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// tiny stable-ish hash so step ids differ without Math.random
function hashish(s) {
  let h = 0;
  for (let i = 0; i < (s || '').length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h || 1;
}
