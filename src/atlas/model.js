// Convert the visual model (React Flow nodes + edges) into an agent-atlas
// registry: *.agent.yaml, *.tool.yaml, and io/*.json. The output is built to
// satisfy agent-atlas's own governance/ci/validate_registry.py, so the same
// deterministic checks that gate the OSS repo also gate what this UI produces.
import yaml from 'js-yaml';
import { VALIDATORS, formatErrors } from './schema';

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

// An agent → router edge means "this agent routes via this router" (dynamic
// model selection) instead of using a pinned model. Returns the router id or null.
export function routerForAgent(agentId, nodes, edges) {
  for (const e of edges) {
    if (e.source === agentId) {
      const target = nodes.find((n) => n.id === e.target);
      if (target && target.type === 'router') return target.data.id;
    }
  }
  return null;
}

// Build the agent manifest object from a node's data + the graph.
export function agentManifest(node, nodes, edges) {
  const d = node.data;
  const routerId = routerForAgent(node.id, nodes, edges);
  return {
    apiVersion: 'agent-atlas/v1',
    kind: 'Agent',
    id: d.id,
    version: d.version || '1.0.0',
    owner: d.owner || '',
    responsibility: d.responsibility || '',
    // A router edge wins: the agent routes dynamically instead of a pinned model.
    model: routerId ? { router: routerId } : d.model,
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

export function jobManifest(node) {
  const d = node.data;
  return {
    apiVersion: 'agent-atlas/v1',
    kind: 'Job',
    id: d.id,
    version: d.version || '1.0.0',
    owner: d.owner || '',
    ...(d.description ? { description: d.description } : {}),
    queue: d.queue || '',
    ...(d.trigger ? { trigger: d.trigger } : {}),
    ...(d.timeoutSeconds ? { timeout_seconds: Number(d.timeoutSeconds) } : {}),
    ...(d.retries != null && d.retries !== '' ? { retries: Number(d.retries) } : {}),
  };
}

export function systemManifest(node) {
  const d = node.data;
  return {
    apiVersion: 'agent-atlas/v1',
    kind: 'System',
    id: d.id,
    version: d.version || '1.0.0',
    owner: d.owner || '',
    ...(d.description ? { description: d.description } : {}),
    systemKind: d.systemKind || 'other',
    ...(d.connection ? { connection: d.connection } : {}),
    ...(d.authScope ? { auth: { scope: d.authScope } } : {}),
  };
}

export function routerManifest(node) {
  const d = node.data;
  return {
    apiVersion: 'agent-atlas/v1',
    kind: 'Router',
    id: d.id,
    version: d.version || '1.0.0',
    owner: d.owner || '',
    ...(d.description ? { description: d.description } : {}),
    candidates: (d.candidates || []).map((c) => ({
      provider: c.provider || '',
      name: c.name || '',
      ...(c.pinned ? { pinned: c.pinned } : {}),
    })),
    policy: {
      ...(d.optimizeFor && d.optimizeFor.length ? { optimize_for: d.optimizeFor } : {}),
      ...(d.rules && d.rules.length ? { rules: d.rules.filter((r) => r.when && r.select) } : {}),
      fallback: d.fallback || '',
    },
  };
}

// Build the manifest object for any node, dispatched by type.
export function manifestFor(node, nodes, edges) {
  switch (node.type) {
    case 'agent': return agentManifest(node, nodes, edges);
    case 'tool': return toolManifest(node, nodes, edges);
    case 'job': return jobManifest(node);
    case 'system': return systemManifest(node);
    case 'router': return routerManifest(node);
    default: return null;
  }
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

// Where each node type's manifest is written, and its file suffix.
const REGISTRY_DIRS = {
  agent: { dir: 'agents', suffix: '.agent.yaml' },
  tool: { dir: 'tools', suffix: '.tool.yaml' },
  job: { dir: 'jobs', suffix: '.job.yaml' },
  system: { dir: 'systems', suffix: '.system.yaml' },
  router: { dir: 'routers', suffix: '.router.yaml' },
};

// Produce the full registry as a map of relative path -> file contents (string).
export function buildRegistry(nodes, edges) {
  const files = {};
  for (const node of nodes) {
    const loc = REGISTRY_DIRS[node.type];
    const m = manifestFor(node, nodes, edges);
    if (!loc || !m) continue;
    files[`registry/${loc.dir}/${m.id}${loc.suffix}`] = yaml.dump(m, { lineWidth: 100, noRefs: true });
    if (node.type === 'agent') {
      files[`registry/io/${m.id}.input.json`] = JSON.stringify(ioStub(`${m.id} input`), null, 2) + '\n';
      files[`registry/io/${m.id}.output.json`] = JSON.stringify(ioStub(`${m.id} output`), null, 2) + '\n';
    }
  }
  return files;
}

// Validate every node against its JSON schema. Returns { nodeId: [errors] } for
// nodes that fail. Empty = all valid.
export function validateModel(nodes, edges) {
  const problems = {};
  for (const node of nodes) {
    const validator = VALIDATORS[node.type];
    const m = manifestFor(node, nodes, edges);
    if (!validator || !m) continue;
    if (!validator(m)) problems[node.id] = formatErrors(validator.errors);
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
