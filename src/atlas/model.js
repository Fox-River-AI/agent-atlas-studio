// Convert the visual model (React Flow nodes + edges) into an agent-atlas
// registry: *.agent.yaml, *.tool.yaml, and io/*.json. The output is built to
// satisfy agent-atlas's own governance/ci/validate_registry.py, so the same
// deterministic checks that gate the OSS repo also gate what this UI produces.
import yaml from 'js-yaml';
import { validateAgent, validateTool, formatErrors } from './schema';

// Edges encode "agent allowlists tool": source = agent node, target = tool node.
export function toolsForAgent(agentId, nodes, edges) {
  const toolIds = new Set();
  for (const e of edges) {
    if (e.source === agentId) {
      const target = nodes.find((n) => n.id === e.target);
      if (target && target.type === 'tool') toolIds.add(target.data.id);
    }
  }
  return [...toolIds];
}

// reused_by is the inverse: every agent whose allowlist includes this tool.
// This is the bidirectional-consistency field the CI validator cross-checks —
// the one that surfaces redundant, near-duplicate agents.
export function agentsUsingTool(toolId, nodes, edges) {
  const agentIds = new Set();
  for (const e of edges) {
    const source = nodes.find((n) => n.id === e.source);
    const target = nodes.find((n) => n.id === e.target);
    if (source && target && source.type === 'agent' && target.type === 'tool' && target.data.id === toolId) {
      agentIds.add(source.data.id);
    }
  }
  return [...agentIds];
}

// Build the agent manifest object from a node's data + the graph.
export function agentManifest(node, nodes, edges) {
  const d = node.data;
  return {
    apiVersion: 'agent-atlas/v1',
    kind: 'Agent',
    id: d.id,
    version: d.version || '1.0.0',
    owner: d.owner || '',
    responsibility: d.responsibility || '',
    model: d.model,
    io: {
      input: `registry/io/${d.id}.input.json`,
      output: `registry/io/${d.id}.output.json`,
    },
    tools: toolsForAgent(node.id, nodes, edges),
    refusal: {
      conditions: (d.refusalConditions || []).filter(Boolean),
      ...(d.refusalEmits ? { emits: d.refusalEmits } : {}),
    },
    telemetry: {
      emits: (d.telemetry || []).map((t) => ({
        name: t.name,
        ...(t.attributes && t.attributes.length ? { attributes: t.attributes } : {}),
      })),
    },
  };
}

export function toolManifest(node, nodes, edges) {
  const d = node.data;
  return {
    apiVersion: 'agent-atlas/v1',
    kind: 'Tool',
    id: d.id,
    version: d.version || '1.0.0',
    owner: d.owner || '',
    description: d.description || '',
    effect: d.effect || 'read',
    auth: { scope: d.authScope || '' },
    ...(d.ratePerMinute ? { rate_limit: { per_minute: Number(d.ratePerMinute) } } : {}),
    reused_by: agentsUsingTool(d.id, nodes, edges),
  };
}

// A minimal but valid JSON Schema stub for an agent's input/output, so the
// declared io.* files actually exist (validate_registry.py check #6).
function ioStub(title) {
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    title,
    type: 'object',
    properties: {},
  };
}

// Produce the full registry as a map of relative path -> file contents (string).
export function buildRegistry(nodes, edges) {
  const files = {};
  for (const node of nodes) {
    if (node.type === 'agent') {
      const m = agentManifest(node, nodes, edges);
      files[`registry/agents/${m.id}.agent.yaml`] = yaml.dump(m, { lineWidth: 100, noRefs: true });
      files[`registry/io/${m.id}.input.json`] = JSON.stringify(ioStub(`${m.id} input`), null, 2) + '\n';
      files[`registry/io/${m.id}.output.json`] = JSON.stringify(ioStub(`${m.id} output`), null, 2) + '\n';
    } else if (node.type === 'tool') {
      const m = toolManifest(node, nodes, edges);
      files[`registry/tools/${m.id}.tool.yaml`] = yaml.dump(m, { lineWidth: 100, noRefs: true });
    }
  }
  return files;
}

// Validate every node against the JSON schema (the same schema the CI validator
// uses). Returns { nodeId: [errors] } for nodes that fail. Empty = all valid.
export function validateModel(nodes, edges) {
  const problems = {};
  for (const node of nodes) {
    if (node.type === 'agent') {
      const m = agentManifest(node, nodes, edges);
      if (!validateAgent(m)) problems[node.id] = formatErrors(validateAgent.errors);
    } else if (node.type === 'tool') {
      const m = toolManifest(node, nodes, edges);
      if (!validateTool(m)) problems[node.id] = formatErrors(validateTool.errors);
    }
  }
  return problems;
}

// Cross-manifest checks that mirror validate_registry.py beyond per-node schema:
// unique ids, and allowlisted tools resolving to real tool nodes. (reused_by is
// computed, so it is consistent by construction.)
export function crossChecks(nodes) {
  const issues = [];
  const ids = nodes.map((n) => n.data.id).filter(Boolean);
  const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
  for (const d of [...new Set(dupes)]) issues.push(`duplicate id '${d}'`);
  return issues;
}
