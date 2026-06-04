// The unified collapsible graph (Erwin-style). ONE underlying model of objects
// (tasks, agents, tools, jobs, routers, systems) with parent/child nesting and
// edges. Double-click a node to expand/collapse its children; leaves don't
// expand. Selecting any node shows its properties in the right pane. The same
// model renders as the main graph or a filtered Subject-Area graph.
//
// Step 1 scope (verifiable): nesting + expand/collapse + properties-always-show,
// with automatic child layout. Create-then-connect relationships, SA switching,
// and stubs come in later steps.
import React, { useMemo, useCallback, useState, useEffect } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  useNodesState,
  useEdgesState,
  applyEdgeChanges,
  MarkerType,
  Handle,
  Position,
  ReactFlowProvider,
  useReactFlow,
} from '@xyflow/react';
// React Flow's base stylesheet — REQUIRED for edges, controls, and node layout
// to render. (Previously imported by the now-deleted AtlasModeler; without it
// edges vanish, controls show as unstyled "white squares", and the canvas
// desyncs from the tree.)
import '@xyflow/react/dist/style.css';
import { useTheme } from './ThemeContext';

const KIND_LABEL = { orchestrator: 'ORCHESTRATOR', task: 'TASK', agent: 'AGENT', tool: 'MCP TOOL', job: 'JOB', router: 'ROUTER', system: 'SYSTEM' };

// Which kinds can contain children (can expand). Leaves (tool/job/system/router)
// terminate — they never show an expand affordance.
const CONTAINER_KINDS = new Set(['orchestrator', 'task', 'agent']);

function childrenOf(parentId, objects) {
  return Object.values(objects).filter((o) => o.parent === parentId);
}

// A single object rendered as a node. Shows a ▸/▾ toggle only if it has children.
function ObjectNode({ data }) {
  const hasChildren = data.childCount > 0;
  const canExpand = CONTAINER_KINDS.has(data.kind);
  return (
    <div
      className={`atlas-unode ${data.kind} ${data.selected ? 'selected' : ''} ${data.valid === false ? 'invalid' : ''}`}
      onDoubleClick={(e) => { if (canExpand && hasChildren) { e.stopPropagation(); data.onToggle(data.objId); } }}
    >
      <Handle type="target" position={Position.Left} />
      <div className="atlas-unode-head">
        {canExpand && (
          <span
            className="atlas-unode-caret"
            onClick={(e) => { e.stopPropagation(); data.onToggle(data.objId); }}
            title={data.expanded ? 'Collapse' : 'Expand'}
          >
            {hasChildren ? (data.expanded ? '▾' : '▸') : '·'}
          </span>
        )}
        <span className="atlas-unode-kind">{KIND_LABEL[data.kind] || data.kind}</span>
      </div>
      <div className="atlas-unode-id">{data.label || '(unnamed)'}</div>
      {hasChildren && !data.expanded && (
        <div className="atlas-unode-meta">{data.childCount} child{data.childCount === 1 ? '' : 'ren'} · double-click to expand</div>
      )}
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
const unifiedNodeTypes = { object: ObjectNode };

// Lay out the VISIBLE objects: roots across the top; a node's visible children
// are placed below/right of it. Collapsed nodes contribute no visible children.
// Lay out the visible objects. A node's position comes from the per-view
// `layout` map if present (the user's saved/dragged position for this view);
// otherwise it's auto-placed by depth/band. layout = { objId: {x,y} }.
function layoutVisible(objects, expanded, rootIds, layout = {}) {
  const visible = [];
  const COL = 240, ROW = 120;

  function place(id, depth, yBand) {
    const o = objects[id];
    if (!o) return yBand;
    const kids = childrenOf(id, objects);
    const isExpanded = expanded[id];
    const saved = layout[id];
    const x = saved ? saved.x : depth * COL;
    const y = saved ? saved.y : yBand * ROW;
    visible.push({ id, depth, x, y });
    let band = yBand;
    if (isExpanded && kids.length) {
      kids.forEach((k, i) => { band = place(k.id, depth + 1, band + (i === 0 ? 0 : 1)); });
    }
    return band + 1;
  }

  let band = 0;
  for (const rid of rootIds) band = place(rid, 0, band);
  return visible;
}

function UnifiedGraphInner({
  objects,         // { id: {id, kind, parent, data} }
  edges,           // [{ id, source, target, label? }]
  expanded,        // { id: bool }
  onToggleExpand,
  selectedId,
  onSelect,
  onConnect,
  validityById,    // { id: bool }
  focusReq,        // { id, n } — when this changes, center the view on that node
  viewId,          // current view id ('all' or an SA id) — changing it reloads layout
  layout,          // { objId: {x,y} } for the current view
  onNodePosition,  // (objId, {x,y}) — persist a dragged position to the current view
}) {
  const { themeId } = useTheme();
  const colorMode = themeId === 'light' ? 'light' : 'dark';
  const rf = useReactFlow();

  // Roots = objects whose parent isn't in the current set (the orchestrator in
  // "All"; the member tasks in a Subject Area, whose parent is filtered out).
  const rootIds = useMemo(
    () => Object.values(objects).filter((o) => !o.parent || !objects[o.parent]).map((o) => o.id),
    [objects]
  );

  // Compute visible nodes (respecting collapse), positioned from the per-view
  // layout. NOTE: deliberately NOT dependent on selectedId — selection must
  // never re-lay-out (that was the reset-on-click bug).
  const positioned = useMemo(
    () => layoutVisible(objects, expanded, rootIds, layout || {}),
    [objects, expanded, rootIds, layout]
  );
  const visibleIds = useMemo(() => new Set(positioned.map((p) => p.id)), [positioned]);

  const [rfNodes, setRfNodes, onNodesChange] = useNodesState([]);
  const [rfEdges, setRfEdges, onEdgesChange] = useEdgesState([]);

  // Build nodes when the structure/layout/view changes — NOT on selection.
  useEffect(() => {
    setRfNodes(
      positioned.map((p) => {
        const o = objects[p.id];
        return {
          id: o.id,
          type: 'object',
          position: { x: p.x, y: p.y },
          data: {
            objId: o.id,
            kind: o.kind,
            label: o.data?.id || o.id,
            childCount: childrenOf(o.id, objects).length,
            expanded: !!expanded[o.id],
            selected: o.id === selectedId,
            valid: validityById ? validityById[o.id] !== false : true,
            onToggle: onToggleExpand,
          },
        };
      })
    );
  // NOT dependent on selectedId — rebuilding on select is what reset the layout.
  }, [positioned, objects, expanded, validityById, onToggleExpand, setRfNodes]);

  // Selection updates ONLY the `selected` flag on existing nodes, in place —
  // no rebuild, no position change. This is the fix for layout-reset-on-click.
  useEffect(() => {
    setRfNodes((nds) => nds.map((n) =>
      n.data.selected === (n.id === selectedId) ? n : { ...n, data: { ...n.data, selected: n.id === selectedId } }
    ));
  }, [selectedId, setRfNodes]);

  // Edges shown = implicit containment edges (parent → visible child) PLUS the
  // explicit relationship edges, both filtered to currently-visible endpoints.
  // Containment edges make the hierarchy (task → agent → tool) visible even
  // before any explicit relationships are drawn.
  useEffect(() => {
    const containment = Object.values(objects)
      .filter((o) => o.parent && visibleIds.has(o.parent) && visibleIds.has(o.id))
      .map((o) => ({
        id: `contain-${o.parent}-${o.id}`,
        source: o.parent,
        target: o.id,
        className: 'atlas-edge-contain',
        markerEnd: { type: MarkerType.ArrowClosed },
      }));
    const explicit = edges
      .filter((e) => visibleIds.has(e.source) && visibleIds.has(e.target))
      .map((e) => ({ ...e, markerEnd: { type: MarkerType.ArrowClosed } }));
    // De-dupe: if an explicit edge already connects parent→child, prefer it.
    const explicitPairs = new Set(explicit.map((e) => `${e.source}->${e.target}`));
    const merged = [...containment.filter((c) => !explicitPairs.has(`${c.source}->${c.target}`)), ...explicit];
    setRfEdges(merged);
  }, [objects, edges, visibleIds, setRfEdges]);

  const handleConnect = useCallback((params) => onConnect?.(params), [onConnect]);

  // Bring a just-created/focused node into view so new objects never appear
  // off-screen. Runs after the node is laid out.
  useEffect(() => {
    if (!focusReq?.id) return;
    const p = positioned.find((n) => n.id === focusReq.id);
    if (!p) return;
    const t = setTimeout(() => {
      rf.setCenter(p.x + 95, p.y + 30, { zoom: Math.max(rf.getZoom?.() || 1, 0.8), duration: 300 });
    }, 60);
    return () => clearTimeout(t);
  }, [focusReq, positioned, rf]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fit the view to its content when the VIEW changes (e.g. switching Subject
  // Areas), so a new view is readable instead of clumped/tiny. (DIAG-10)
  useEffect(() => {
    const t = setTimeout(() => { try { rf.fitView({ maxZoom: 1, padding: 0.2, duration: 300 }); } catch { /* not ready */ } }, 80);
    return () => clearTimeout(t);
  }, [viewId, rf]);

  // Select on node click ONLY. We deliberately do NOT use onSelectionChange to
  // drive selection: because we rebuild the node array each render (without
  // carrying React Flow's internal `selected` flag), onSelectionChange fires
  // with an empty set right after a click and would stomp the selection back to
  // null. onNodeClick is the single source of selection truth here.
  const onNodeClick = useCallback((_e, node) => onSelect?.(node.id), [onSelect]);

  // Apply React Flow's node changes locally, and persist finished drags to the
  // current view's layout so positions survive selection, re-render, and view
  // switches. (dragging:false marks the end of a drag.)
  const handleNodesChange = useCallback((changes) => {
    onNodesChange(changes);
    for (const c of changes) {
      if (c.type === 'position' && c.position && c.dragging === false) {
        onNodePosition?.(c.id, c.position);
      }
    }
  }, [onNodesChange, onNodePosition]);

  return (
    <div className="atlas-canvas">
      <ReactFlow
        nodes={rfNodes}
        edges={rfEdges}
        onNodesChange={handleNodesChange}
        onEdgesChange={(c) => { onEdgesChange(c); }}
        onConnect={handleConnect}
        onNodeClick={onNodeClick}
        nodeTypes={unifiedNodeTypes}
        colorMode={colorMode}
        proOptions={{ hideAttribution: true }}
        fitView
        fitViewOptions={{ maxZoom: 1, padding: 0.3 }}
        minZoom={0.2}
      >
        <Background />
        <Controls />
      </ReactFlow>
    </div>
  );
}

// Wrap in a provider so the inner component can use useReactFlow (setCenter etc.).
export default function UnifiedGraph(props) {
  return (
    <ReactFlowProvider>
      <UnifiedGraphInner {...props} />
    </ReactFlowProvider>
  );
}
