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

export const nodeTypes = { agent: AgentNode, tool: ToolNode };
