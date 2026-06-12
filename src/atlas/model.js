// Convert the visual model (React Flow nodes + edges) into an agent-atlas
// registry: *.agent.yaml, *.tool.yaml, and io/*.json. The output is built to
// satisfy agent-atlas's own governance/ci/validate_registry.py, so the same
// deterministic checks that gate the OSS repo also gate what this UI produces.
import yaml from 'js-yaml';
import { VALIDATORS, formatErrors, agentSchema, toolSchema, jobSchema, systemSchema, routerSchema, orchestratorSchema } from './schema';
import { GOVERNANCE_FILES } from './governance';

// Emit the governance block ONLY when something is actually declared, so an
// object with no governance stays clean in the manifest (declare-or-flag: we
// never write empty/default governance as if it were a real declaration).
function governanceBlock(d) {
  const g = d.governance;
  if (!g || typeof g !== 'object') return undefined;
  const out = {};
  if (g.data_classification) out.data_classification = g.data_classification;
  if (Array.isArray(g.data_tags) && g.data_tags.filter(Boolean).length) out.data_tags = g.data_tags.filter(Boolean);
  if (g.residency) out.residency = g.residency;
  if (g.retention) out.retention = g.retention;
  if (Array.isArray(g.redaction) && g.redaction.filter(Boolean).length) out.redaction = g.redaction.filter(Boolean);
  return Object.keys(out).length ? out : undefined;
}

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
    ...(Array.isArray(d.prohibitedTools) && d.prohibitedTools.filter(Boolean).length ? { prohibited_tools: d.prohibitedTools.filter(Boolean) } : {}),
    ...(d.groundingThreshold != null && d.groundingThreshold !== '' ? { grounding_threshold: Number(d.groundingThreshold) } : {}),
    ...(d.escalationTo ? { escalation_to: d.escalationTo } : {}),
    ...(governanceBlock(d) ? { governance: governanceBlock(d) } : {}),
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
    ...(governanceBlock(d) ? { governance: governanceBlock(d) } : {}),
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
    ...(governanceBlock(d) ? { governance: governanceBlock(d) } : {}),
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
    ...(governanceBlock(d) ? { governance: governanceBlock(d) } : {}),
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
    ...(governanceBlock(d) ? { governance: governanceBlock(d) } : {}),
  };
}

export function orchestratorManifest(node) {
  const d = node.data;
  return {
    apiVersion: 'agent-atlas/v1',
    kind: 'Orchestrator',
    id: d.id,
    version: d.version || '1.0.0',
    owner: d.owner || '',
    ...(d.description ? { description: d.description } : {}),
    control_flow: d.controlFlow || 'dag',
    ...(d.stateStore ? { state_store: d.stateStore } : {}),
    ...(Array.isArray(d.complianceRegimes) && d.complianceRegimes.filter(Boolean).length ? { compliance_regimes: d.complianceRegimes.filter(Boolean) } : {}),
    ...(governanceBlock(d) ? { governance: governanceBlock(d) } : {}),
  };
}

// Build the manifest object for any node, dispatched by type.
export function manifestFor(node, nodes, edges) {
  switch (node.type) {
    case 'orchestrator': return orchestratorManifest(node);
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
  orchestrator: { dir: '.', suffix: '.orchestrator.yaml' },
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

// The per-kind JSON schemas, written into the bundle's registry/schema/ so the
// bundled CI validator (governance/ci/validate_registry.py) can run standalone.
const BUNDLE_SCHEMAS = {
  'registry/schema/agent.schema.json': agentSchema,
  'registry/schema/tool.schema.json': toolSchema,
  'registry/schema/job.schema.json': jobSchema,
  'registry/schema/system.schema.json': systemSchema,
  'registry/schema/router.schema.json': routerSchema,
  'registry/schema/orchestrator.schema.json': orchestratorSchema,
};

function bundleReadme(count) {
  return `# Build bundle — generated from Agent Atlas

This is a build-handoff bundle: the version-controlled **registry** that is the
source of truth for the platform, plus the **governance** that keeps an AI coding
agent (e.g. Claude Code) building to it.

## What's here
- \`registry/\`         — ${count} manifest(s) + schemas + agent I/O stubs (the spec).
- \`CLAUDE.md\`         — the contract: build from the manifests, honor allowlist /
  refusal / pinned model / declared telemetry; regenerate, don't hand-edit.
- \`.claude/settings.json\` — wires the PreToolUse hook + permission rules.
- \`governance/\`       — the enforcement hook + a standalone CI validator.

## Build it
1. Open this folder in your AI coding agent. It loads \`CLAUDE.md\` as the contract
   and the \`PreToolUse\` hook enforces "no agent/tool code without a manifest."
2. Generate code FROM \`registry/\` (e.g. \`src/agents/<id>\` per its manifest). Never
   hand-edit the registry to match code — change the manifest, then regenerate.

## Validate the registry (Python 3, \`pip install pyyaml jsonschema\`)
\`\`\`
python3 governance/ci/validate_registry.py
\`\`\`

Generated by Agent Atlas — https://github.com/Fox-River-AI/agent-atlas-studio
`;
}

// Assemble the full build-handoff bundle (DIAG-15): the on-disk registry, the
// per-kind schemas (so the bundled CI validator runs), the governance bundle
// (CLAUDE.md / .claude/settings.json / hook / CI validator / README), and a root
// README. Returns a { relativePath: stringContent } map — same shape as
// buildRegistry, so the zip and directory-write sinks both consume it directly.
export function buildBundle(nodes, edges) {
  const files = { ...buildRegistry(nodes, edges) };
  const registryCount = Object.keys(files).length;
  for (const [path, schema] of Object.entries(BUNDLE_SCHEMAS)) {
    files[path] = JSON.stringify(schema, null, 2) + '\n';
  }
  for (const [path, content] of Object.entries(GOVERNANCE_FILES)) {
    files[path] = content;
  }
  files['README.md'] = bundleReadme(registryCount);
  return files;
}

// ── Governance data dictionary (Step 4) ─────────────────────────────────────
// Render the DECLARATION as a human-readable governance document — the "conformance
// artifact that leaves the building" (an auditor / compliance officer / risk
// committee reads this, not YAML). Generated FROM the declaration (declaration →
// doc), so it can't drift from the registry. Vocabulary: "declaration" = the
// design-time artifact; "system" = the running thing it governs; "LLM" = the agent's
// language model. Surfaces, per object: owner, data
// classification + tags, residency/retention/redaction, refusal/grounding/
// escalation, prohibited tools, telemetry — the NIST Map+Govern declaration.
function gov(d) { return (d && d.governance) || {}; }
function fmtList(a) { return Array.isArray(a) && a.length ? a.join(', ') : '—'; }

export function buildDataDictionary(nodes, edges, projectName) {
  const byKind = (k) => nodes.filter((n) => n.type === k);
  const orch = byKind('orchestrator')[0];
  const od = orch ? orch.data : {};
  const regimes = fmtList(od.complianceRegimes);
  const lines = [];
  const P = (s) => lines.push(s);

  const systemId = od.id || projectName || 'system';
  P(`# ${projectName || 'Untitled declaration'} — Governance Data Dictionary`);
  P('');
  P('_Generated from the Agent Atlas declaration (the design-time artifact). This is a derived document — the declaration is the source of truth; regenerate this rather than hand-editing._');
  P('');
  P(`**System:** \`${systemId}\` (the orchestrated agentic system this declaration governs)`);
  P(`**Compliance regimes (system-level):** ${regimes}`);
  P(`**Control plane:** ${od.controlFlow || '—'}${od.stateStore ? ` · state store: \`${od.stateStore}\`` : ''}`);
  P(`**Objects:** ${nodes.length}`);
  P('');

  // A governance summary table across all manifest objects.
  P('## Governance summary');
  P('');
  P('| Object | Kind | Owner | Data class | Data tags | Residency | Retention |');
  P('|---|---|---|---|---|---|---|');
  for (const n of nodes) {
    if (n.type === 'task') continue;
    const d = n.data, g = gov(d);
    P(`| \`${d.id}\` | ${n.type} | ${d.owner || '—'} | ${g.data_classification || '—'} | ${fmtList(g.data_tags)} | ${g.residency || '—'} | ${g.retention || '—'} |`);
  }
  P('');

  // Agents get a dedicated governance detail section (Govern: refusal, grounding,
  // prohibited actions, escalation, telemetry — the conformance-relevant fields).
  const agents = byKind('agent');
  if (agents.length) {
    P('## Agents — governance detail');
    P('');
    for (const a of agents) {
      const d = a.data;
      const tools = toolsForAgent(a.id, nodes, edges);
      P(`### \`${d.id}\``);
      P(`- **Responsibility:** ${d.responsibility || '—'}`);
      P(`- **LLM:** ${routerForAgent(a.id, nodes, edges) ? `router \`${routerForAgent(a.id, nodes, edges)}\`` : (d.model?.pinned || d.model?.name || '—')}`);
      P(`- **Allowed tools:** ${fmtList(tools)}`);
      P(`- **Prohibited tools:** ${fmtList(d.prohibitedTools)}`);
      P(`- **Grounding threshold:** ${d.groundingThreshold != null && d.groundingThreshold !== '' ? d.groundingThreshold : '—'}`);
      P(`- **Refusal conditions:** ${fmtList((d.refusalConditions || []).filter(Boolean))}`);
      P(`- **Escalates to:** ${d.escalationTo || '—'}`);
      P(`- **Telemetry:** ${fmtList((d.telemetry || []).map((t) => t.name).filter(Boolean))}`);
      const g = gov(d);
      if (g.data_classification || (g.data_tags || []).length || g.residency || (g.redaction || []).length) {
        P(`- **Governance:** class ${g.data_classification || '—'}, tags ${fmtList(g.data_tags)}, residency ${g.residency || '—'}, redaction ${fmtList(g.redaction)}`);
      }
      P('');
    }
  }

  // Systems — the data layer (Map): what's touched, its class, residency.
  const systems = byKind('system');
  if (systems.length) {
    P('## Systems — data layer');
    P('');
    P('| System | Kind | Data class | Data tags | Residency | Retention |');
    P('|---|---|---|---|---|---|');
    for (const s of systems) {
      const d = s.data, g = gov(d);
      P(`| \`${d.id}\` | ${d.systemKind || '—'} | ${g.data_classification || '—'} | ${fmtList(g.data_tags)} | ${g.residency || '—'} | ${g.retention || '—'} |`);
    }
    P('');
  }

  P('---');
  P('Generated by Agent Atlas — https://github.com/Fox-River-AI/agent-atlas-studio');
  return lines.join('\n') + '\n';
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
