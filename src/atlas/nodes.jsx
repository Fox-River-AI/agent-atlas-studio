// Custom React Flow nodes for the agent-atlas modeler. Agents are sources of
// allowlist edges; tools are targets. Each node shows its id, kind, and a
// validity dot so schema problems are visible right on the canvas.
import React from 'react';
import { Handle, Position } from '@xyflow/react';

function ValidityDot({ valid }) {
  return (
    <span
      className={`atlas-dot ${valid ? 'ok' : 'bad'}`}
      title={valid ? 'Valid against schema' : 'Does not yet satisfy the schema'}
    />
  );
}

export function AgentNode({ data, selected }) {
  return (
    <div className={`atlas-node agent ${selected ? 'selected' : ''}`}>
      <div className="atlas-node-head">
        <span className="atlas-kind">AGENT</span>
        <ValidityDot valid={data.valid} />
      </div>
      <div className="atlas-node-id">{data.id || '(unnamed)'}</div>
      <div className="atlas-node-sub">{data.model?.name || 'no model'}</div>
      {/* Agents emit allowlist edges from the right. */}
      <Handle type="source" position={Position.Right} />
    </div>
  );
}

export function ToolNode({ data, selected }) {
  return (
    <div className={`atlas-node tool ${selected ? 'selected' : ''}`}>
      <div className="atlas-node-head">
        <span className="atlas-kind">TOOL</span>
        <ValidityDot valid={data.valid} />
      </div>
      <div className="atlas-node-id">{data.id || '(unnamed)'}</div>
      <div className="atlas-node-sub">effect: {data.effect || 'read'}</div>
      {/* Tools receive allowlist edges on the left. */}
      <Handle type="target" position={Position.Left} />
    </div>
  );
}

export function JobNode({ data, selected }) {
  return (
    <div className={`atlas-node job ${selected ? 'selected' : ''}`}>
      <div className="atlas-node-head">
        <span className="atlas-kind">JOB</span>
        <ValidityDot valid={data.valid} />
      </div>
      <div className="atlas-node-id">{data.id || '(unnamed)'}</div>
      <div className="atlas-node-sub">queue: {data.queue || '—'}</div>
      {/* Jobs are dispatched to — they receive edges on the left. */}
      <Handle type="target" position={Position.Left} />
    </div>
  );
}

export function SystemNode({ data, selected }) {
  return (
    <div className={`atlas-node system ${selected ? 'selected' : ''}`}>
      <div className="atlas-node-head">
        <span className="atlas-kind">SYSTEM</span>
        <ValidityDot valid={data.valid} />
      </div>
      <div className="atlas-node-id">{data.id || '(unnamed)'}</div>
      <div className="atlas-node-sub">{data.systemKind || 'other'}</div>
      {/* Systems are connected to — they receive edges on the left. */}
      <Handle type="target" position={Position.Left} />
    </div>
  );
}

export function RouterNode({ data, selected }) {
  const count = (data.candidates || []).length;
  return (
    <div className={`atlas-node router ${selected ? 'selected' : ''}`}>
      <div className="atlas-node-head">
        <span className="atlas-kind">ROUTER</span>
        <ValidityDot valid={data.valid} />
      </div>
      <div className="atlas-node-id">{data.id || '(unnamed)'}</div>
      <div className="atlas-node-sub">{count} model{count === 1 ? '' : 's'}{data.fallback ? ` · ↘ ${data.fallback}` : ''}</div>
      {/* Agents route via a router — it receives edges on the left. */}
      <Handle type="target" position={Position.Left} />
    </div>
  );
}

export const nodeTypes = { agent: AgentNode, tool: ToolNode, job: JobNode, system: SystemNode, router: RouterNode };
