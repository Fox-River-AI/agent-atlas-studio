// Which object kinds may connect to which (source → target). The model enforces
// these so you can't draw a nonsensical relationship (e.g. Task → System).
//
// - A Task contains Agents (the agents that carry it out).
// - An Agent uses Tools, dispatches Jobs, routes via a Router, and connects to
//   Systems (datastores).
// - Tools, Jobs, Systems, Routers are LEAVES — no outgoing relationships.
// - Tasks may sequence other Tasks (task-level order).
export const ALLOWED_TARGETS = {
  task: new Set(['agent', 'task']),
  agent: new Set(['tool', 'job', 'router', 'system']),
  tool: new Set([]),
  job: new Set([]),
  system: new Set([]),
  router: new Set([]),
};

export function canConnect(sourceKind, targetKind) {
  return !!ALLOWED_TARGETS[sourceKind]?.has(targetKind);
}

// Human-readable reason for a rejected connection (for a toast/hint).
export function connectionReason(sourceKind, targetKind) {
  if (canConnect(sourceKind, targetKind)) return null;
  if (ALLOWED_TARGETS[sourceKind]?.size === 0) {
    return `A ${sourceKind} is a leaf — it has no outgoing relationships.`;
  }
  const allowed = [...(ALLOWED_TARGETS[sourceKind] || [])].join(', ') || 'nothing';
  return `A ${sourceKind} can connect to: ${allowed} — not a ${targetKind}.`;
}
