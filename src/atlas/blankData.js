// Default field values for a freshly-created object of each kind. Shared by the
// unified graph and (legacy) component canvas so creation is consistent.
import { DEFAULT_MODEL } from './schema';

// Empty governance block — present so the panel can render the fields, but blank
// so nothing is DECLARED until a human (or the doc, via the generator) fills it.
// governanceBlock() in model.js omits it from the manifest while it's empty.
export function blankGovernance() {
  return { data_classification: '', data_tags: [], residency: '', retention: '', redaction: [] };
}

export function blankData(kind, presetId) {
  const common = { id: presetId || '', owner: '', version: '1.0.0', governance: blankGovernance() };
  switch (kind) {
    case 'orchestrator':
      return { ...common, description: '', controlFlow: 'dag', stateStore: '', complianceRegimes: [] };
    case 'task':
      return { id: presetId || '', label: '', description: '' };
    case 'agent':
      return { ...common, responsibility: '', model: { ...DEFAULT_MODEL }, refusalConditions: [], refusalEmits: 'refused', telemetry: [{ name: '', attributes: [] }], prohibitedTools: [], groundingThreshold: '', escalationTo: '' };
    case 'tool':
      return { ...common, description: '', effect: 'read', authScope: '' };
    case 'job':
      return { ...common, description: '', queue: '', trigger: '', timeoutSeconds: '', retries: '' };
    case 'system':
      return { ...common, description: '', systemKind: 'relational-db', connection: '', authScope: '' };
    case 'router':
      return {
        ...common,
        description: '',
        candidates: [{ provider: 'anthropic', name: 'claude-opus-4-8', pinned: '' }, { provider: 'openai', name: 'gpt-5', pinned: '' }],
        optimizeFor: ['quality', 'cost'],
        rules: [{ when: 'task_complexity == high', select: 'claude-opus-4-8' }],
        fallback: 'claude-opus-4-8',
      };
    default:
      return common;
  }
}

export const CREATABLE_KINDS = [
  { kind: 'task', label: 'Task' },
  { kind: 'agent', label: 'Agent' },
  { kind: 'tool', label: 'MCP Tool' },
  { kind: 'router', label: 'Router' },
  { kind: 'job', label: 'Job' },
  { kind: 'system', label: 'System' },
];
