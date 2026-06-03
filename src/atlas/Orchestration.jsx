// Orchestration — the two-level DAG.
//
// Level 1 (TaskFlowView): the outer DAG of high-level tasks (ingest → convert →
//   validate). Each task is a node; edges order them. Double-click a task to
//   open its inner detail.
// Level 2 (TaskDetailView): one task's inner DAG — references to library
//   components (agents/tools/jobs/systems), sequenced. You can reference an
//   existing component or create a new stub inline (right-click); a created stub
//   lands in the component library (single source of truth) flagged incomplete.
import React, { useCallback, useState, useEffect } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  addEdge,
  applyNodeChanges,
  applyEdgeChanges,
  useNodesState,
  useEdgesState,
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
  // Use React Flow's own node/edge state hooks (NOT raw parent useState) — this
  // is what registers nodes with the internal store so v12 measures them and
  // flips them visible. Driving nodes from plain parent state leaves them stuck
  // visibility:hidden. We seed from the parent's tasks and sync changes back.
  const [rfNodes, setRfNodes, onNodesChange] = useNodesState([]);
  const [rfEdges, setRfEdges, onEdgesChange] = useEdgesState(taskFlowEdges);

  // Seed/refresh RF nodes from the parent tasks (add/remove/label/count), while
  // preserving live positions React Flow is managing.
  useEffect(() => {
    setRfNodes((prev) => {
      const prevById = Object.fromEntries(prev.map((n) => [n.id, n]));
      return tasks.map((t) => ({
        id: t.id,
        type: 'hltask',
        position: prevById[t.id]?.position || t.position,
        data: { taskId: t.id, label: t.label, count: (t.nodes || []).length, onOpen: onOpenTask },
      }));
    });
  }, [tasks, onOpenTask, setRfNodes]);

  // Push position changes back to the parent so they persist across view switches.
  useEffect(() => {
    setTasks((ts) => {
      const posById = Object.fromEntries(rfNodes.map((n) => [n.id, n.position]));
      let changed = false;
      const next = ts.map((t) => {
        const p = posById[t.id];
        if (p && (p.x !== t.position.x || p.y !== t.position.y)) { changed = true; return { ...t, position: p }; }
        return t;
      });
      return changed ? next : ts;
    });
  }, [rfNodes, setTasks]);

  const onConnect = useCallback(
    (params) => {
      const when = window.prompt('Condition for this task transition? (blank = unconditional "then")', '') || '';
      const edge = { ...params, label: when || undefined, markerEnd: { type: MarkerType.ArrowClosed } };
      setRfEdges((es) => addEdge(edge, es));
      setTaskFlowEdges((es) => addEdge(edge, es));
    },
    [setRfEdges, setTaskFlowEdges]
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
          edges={rfEdges}
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
  const taskId = task?.id;

  // React Flow's own state (registers nodes with the store so they measure +
  // become visible). Seeded from the task; synced back for persistence.
  const [rfNodes, setRfNodes, onNodesChange] = useNodesState([]);
  const [rfEdges, setRfEdges, onEdgesChange] = useEdgesState([]);

  // (Re)seed when the open task changes.
  useEffect(() => {
    setRfNodes((task?.nodes || []).map((n) => ({ ...n })));
    setRfEdges((task?.edges || []).map((e) => ({ ...e })));
  }, [taskId, setRfNodes, setRfEdges]);

  // Sync inner graph back to the parent task.
  useEffect(() => {
    if (taskId) onUpdateTaskGraph(taskId, { nodes: rfNodes, edges: rfEdges });
  }, [rfNodes, rfEdges, taskId]); // eslint-disable-line react-hooks/exhaustive-deps

  const onConnect = useCallback(
    (params) => {
      const when = window.prompt('Condition for this step transition? (blank = unconditional "then")', '') || '';
      setRfEdges((es) => addEdge({ ...params, label: when || undefined, markerEnd: { type: MarkerType.ArrowClosed } }, es));
    },
    [setRfEdges]
  );

  const existingByType = (t) => componentNodes.filter((n) => n.type === t).map((n) => n.data.id).filter(Boolean).sort();

  const placeStep = useCallback((componentType, componentId) => {
    setRfNodes((ns) => [
      ...ns,
      {
        id: `step-${ns.length + 1}-${Math.abs(hashish(componentId))}`,
        type: 'step',
        position: ctx ? { x: ctx.cx, y: ctx.cy } : { x: 120 + (ns.length * 50) % 300, y: 100 + (ns.length * 60) % 240 },
        data: { componentType, componentId },
      },
    ]);
    setCtx(null);
  }, [ctx, setRfNodes]);

  const handleCreateNew = (componentType) => {
    const name = window.prompt(`New ${componentType} id (lowercase-hyphens):`, '');
    if (!name) { setCtx(null); return; }
    const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    if (!id) { setCtx(null); return; }
    // Create the stub in the component library (single source of truth), then
    // reference it here. It shows invalid until fully defined in the component view.
    onCreateComponent(componentType, undefined, id);
    placeStep(componentType, id);
  };

  if (!task) return <div className="atlas-orch"><div className="atlas-orch-empty"><p>Task not found.</p></div></div>;

  return (
   <ReactFlowProvider>
    <div className="atlas-orch">
      <div className="atlas-orch-bar">
        <span className="atlas-orch-hint">
          Add steps (an existing component or a new one), then drag step → step to sequence them.
          You can also right-click the canvas.
        </span>
      </div>
      <div
        className="atlas-orch-canvas"
        onContextMenu={(e) => { e.preventDefault(); setCtx({ x: e.clientX, y: e.clientY, cx: e.nativeEvent.offsetX, cy: e.nativeEvent.offsetY }); }}
        onClick={() => setCtx(null)}
      >
        <ReactFlow
          nodes={rfNodes}
          edges={rfEdges}
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

        {/* Empty-state prompt so a new task canvas isn't a mystery blank. */}
        {rfNodes.length === 0 && !ctx && (
          <div className="atlas-task-emptyhint">
            <p>This task has no steps yet.</p>
            <p className="atlas-orch-empty-sub">Add the agents, tools, and jobs that carry out “{task.label}”.</p>
            <button
              className="primary"
              onClick={(e) => { e.stopPropagation(); const r = e.currentTarget.getBoundingClientRect(); setCtx({ x: r.left, y: r.bottom + 6, cx: 160, cy: 120 }); }}
            >
              + Add component
            </button>
          </div>
        )}

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
   </ReactFlowProvider>
  );
}

// tiny stable-ish hash so step ids differ without Math.random
function hashish(s) {
  let h = 0;
  for (let i = 0; i < (s || '').length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h || 1;
}
