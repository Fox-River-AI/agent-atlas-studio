// Which object kinds may connect to which (source → target). The model enforces
// these so you can't draw a nonsensical relationship (e.g. Tool → Agent).
//
// Hierarchy:
// - Orchestrator contains Tasks (the only thing directly under the root).
// - A Task contains the Agents that carry it out, and may sequence other Tasks.
//   A Task may ALSO hold stage-level shared infrastructure: Systems shared across
//   the stage's agents (a metadata catalog, a state store) and Jobs the workflow/
//   orchestrator dispatches (a nightly batch run no single agent owns).
// - An Agent uses Tools, dispatches its own Jobs, routes via a Router (its dynamic
//   model selector), and connects to the Systems it touches.
// - Job parent rule (dispatcher decides): agent-dispatched Job → under the Agent;
//   workflow/orchestrator-dispatched Job → under the Task.
// - System parent: the owning Agent, OR the Task when the datastore is shared
//   across the stage.
// - Router belongs to exactly one Agent (it selects THAT agent's model) — Agent only.
// - Gate is the CONTROLS layer: it parents to the Orchestrator (beside Tasks, not under
//   them), and a gated Task connects to the Gate it must pass (the gated-task → gate
//   edge). A Gate contains nothing (its reasoner is a field, not a child object).
// - Tools, Jobs, Systems, Routers, Gates are LEAVES — no outgoing CONTAINMENT.
export const ALLOWED_TARGETS = {
  orchestrator: new Set(['task', 'gate']),
  task: new Set(['agent', 'task', 'system', 'job']),
  agent: new Set(['tool', 'job', 'router', 'system']),
  tool: new Set([]),
  job: new Set([]),
  system: new Set([]),
  router: new Set([]),
  gate: new Set([]),
};

// EDGE legality is broader than CONTAINMENT: a gated Task draws an EDGE to the Gate it
// must pass (the gated-task → gate relationship), but the Gate is PARENTED to the
// orchestrator, not contained by the task. ALLOWED_TARGETS above governs containment
// (used by parentKindsFor for the create dialog, so a Gate's only offered parent is the
// orchestrator). This set adds connection-only pairs the canvas may draw as edges
// without implying parentage.
const EXTRA_EDGE_TARGETS = {
  task: new Set(['gate']),   // gated-task → gate (edge, not parent)
};

export function canConnect(sourceKind, targetKind) {
  return !!ALLOWED_TARGETS[sourceKind]?.has(targetKind)
      || !!EXTRA_EDGE_TARGETS[sourceKind]?.has(targetKind);
}

// The kinds that may CONTAIN (be the parent of) a given child kind — the reverse
// of ALLOWED_TARGETS. Used when creating an object to offer only valid parents.
export function parentKindsFor(childKind) {
  return Object.keys(ALLOWED_TARGETS).filter((k) => ALLOWED_TARGETS[k].has(childKind));
}

// The kinds a given parent kind may CONTAIN (its legal direct children). Used by
// the "Add child" context-menu submenu so it only offers valid kinds.
export function childKindsFor(parentKind) {
  return [...(ALLOWED_TARGETS[parentKind] || [])];
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
