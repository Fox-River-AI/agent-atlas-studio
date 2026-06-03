// The orchestrator's dedicated canvas. Selecting the (single, fixed) Orchestrator
// switches the modeler to this view. It shows ONLY tasks — the control flow —
// not the component graph. Each task invokes one component (agent/tool); edges
// between tasks are transitions (a label = a conditional branch, blank = "then").
import React, { useCallback } from 'react';
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
} from '@xyflow/react';

// A task node: its id + a dropdown to choose which component (agent/tool) it
// invokes. The options are passed in via node data (the model's components).
function TaskNode({ data, selected }) {
  return (
    <div className={`atlas-task ${selected ? 'selected' : ''} ${data.invokes ? '' : 'unset'}`}>
      <Handle type="target" position={Position.Left} />
      <div className="atlas-task-id">{data.id || '(task)'}</div>
      <select
        className="atlas-task-select"
        value={data.invokes || ''}
        onChange={(e) => data.onSetInvokes?.(data.id, e.target.value)}
        onClick={(e) => e.stopPropagation()}
      >
        <option value="">invokes: —</option>
        {(data.options || []).map((id) => (
          <option key={id} value={id}>{id}</option>
        ))}
      </select>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
const taskNodeTypes = { task: TaskNode };

export default function OrchestrationView({
  taskNodes,
  setTaskNodes,
  taskEdges,
  setTaskEdges,
  componentNodes,
  onSelectTask,
}) {
  // Drive React Flow directly off parent state so tasks persist across view
  // switches and feed the orchestrator export.
  const onNodesChange = useCallback(
    (changes) => setTaskNodes((ns) => applyNodeChanges(changes, ns)),
    [setTaskNodes]
  );
  const onEdgesChange = useCallback(
    (changes) => setTaskEdges((es) => applyEdgeChanges(changes, es)),
    [setTaskEdges]
  );
  const onConnect = useCallback(
    (params) => {
      const when = window.prompt('Condition for this transition? (blank = unconditional "then")', '') || '';
      setTaskEdges((eds) =>
        addEdge({ ...params, label: when || undefined, markerEnd: { type: MarkerType.ArrowClosed } }, eds)
      );
    },
    [setTaskEdges]
  );

  const options = componentNodes
    .filter((n) => n.type === 'agent' || n.type === 'tool')
    .map((n) => n.data.id)
    .filter(Boolean)
    .sort();
  const componentCount = options.length;

  const setInvokes = useCallback(
    (taskId, invokes) =>
      setTaskNodes((ts) => ts.map((t) => (t.id === taskId ? { ...t, data: { ...t.data, invokes } } : t))),
    [setTaskNodes]
  );

  // Decorate each task with the component options + the setter so the in-node
  // dropdown works (React Flow node components only receive `data`).
  const decoratedTasks = taskNodes.map((t) => ({
    ...t,
    data: { ...t.data, options, onSetInvokes: setInvokes },
  }));

  return (
    <div className="atlas-orch">
      <div className="atlas-orch-bar">
        <span className="atlas-orch-title">Orchestration — control flow</span>
        <span className="atlas-orch-hint">
          {taskNodes.length} task(s) · drag task → task to add a transition; label it to make it conditional
        </span>
        {componentCount === 0 && (
          <span className="atlas-orch-warn">Add agents/tools in the component view first — tasks invoke them.</span>
        )}
      </div>
      <div className="atlas-orch-canvas">
        <ReactFlow
          nodes={decoratedTasks}
          edges={taskEdges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onSelectionChange={({ nodes: sel }) => onSelectTask(sel && sel.length ? sel[0].id : null)}
          nodeTypes={taskNodeTypes}
          fitView
        >
          <Background />
          <Controls />
        </ReactFlow>
      </div>
    </div>
  );
}
