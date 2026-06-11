// Edits the selected node's fields. The fields map 1:1 to the agent-atlas
// schema, so filling the form is literally authoring a manifest.
import React from 'react';

function Field({ label, hint, children }) {
  return (
    <label className="atlas-field">
      <span className="atlas-field-label">{label}</span>
      {hint && <span className="atlas-field-hint">{hint}</span>}
      {children}
    </label>
  );
}

// Common regimes (model-level) and data classes (per-object). Free-text entry is
// also allowed via the "+ other" inputs, so this list is a convenience, not a cap.
export const COMPLIANCE_REGIMES = ['HIPAA', 'SOC 2', 'PCI-DSS', 'GDPR', 'FedRAMP', 'EU AI Act', 'HITRUST', 'ISO 27001'];
const DATA_TAGS = ['PHI', 'PII', 'PCI', 'PFI', 'IP', 'none'];

// Reusable per-object governance controls (NIST AI RMF: privacy/security/
// accountability). Regime-neutral — the control is declared here; the standard is
// named by data_tags + the model-level compliance_regimes. Edits the `governance`
// sub-object. Rendered for every manifest kind (not task).
function GovernanceFields({ g, setG }) {
  const tags = g.data_tags || [];
  const toggleTag = (t) => setG({ ...g, data_tags: tags.includes(t) ? tags.filter((x) => x !== t) : [...tags, t] });
  return (
    <fieldset className="atlas-group">
      <legend>governance — privacy & trust</legend>
      <Field label="data classification" hint="sensitivity of the data this object touches">
        <select value={g.data_classification || ''} onChange={(e) => setG({ ...g, data_classification: e.target.value })}>
          <option value="">— not set —</option>
          <option value="public">public</option>
          <option value="internal">internal</option>
          <option value="confidential">confidential</option>
          <option value="regulated">regulated</option>
        </select>
      </Field>
      <Field label="data tags" hint="regulatory data classes — MULTIPLE may apply (e.g. PHI + PII)">
        <div className="atlas-checkset">
          {DATA_TAGS.map((t) => (
            <label key={t} className="atlas-check">
              <input type="checkbox" checked={tags.includes(t)} onChange={() => toggleTag(t)} />{t}
            </label>
          ))}
        </div>
      </Field>
      <Field label="residency" hint="'on-prem' = data never leaves the boundary (the local-inference trust model)">
        <select value={g.residency || ''} onChange={(e) => setG({ ...g, residency: e.target.value })}>
          <option value="">— not set —</option>
          <option value="any">any</option>
          <option value="in-region">in-region</option>
          <option value="on-prem">on-prem</option>
        </select>
      </Field>
      <Field label="retention" hint="e.g. 7y, 30d, none (optional)">
        <input value={g.retention || ''} onChange={(e) => setG({ ...g, retention: e.target.value })} placeholder="7y" />
      </Field>
      <Field label="redaction" hint="fields to filter/redact before telemetry is indexed — comma-separated (so observability isn't a compliance liability)">
        <input
          value={(g.redaction || []).join(', ')}
          onChange={(e) => setG({ ...g, redaction: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })}
          placeholder="prompt, completion, patient_id"
        />
      </Field>
    </fieldset>
  );
}

// Mirrors the left pane's "MODEL ⟨" header — an orange title + collapse control,
// here labelled "Properties ⟩" (collapses to the right).
function PanelHead({ title, dirty, onCollapse, children }) {
  return (
    <div className="atlas-panel-head">
      <button className="atlas-palette-collapse" onClick={onCollapse} title="Collapse properties">⟩</button>
      <span className="atlas-palette-title">{title}{dirty && <span className="atlas-dirty-dot" title="Unsaved changes"> ●</span>}</span>
      {children}
    </div>
  );
}

export default function PropertiesPanel({ node, onChange, errors, idError, dirty, canSave, onSave, onRevert, newObject, onCollapse }) {
  if (!node) {
    return (
      <div className="atlas-panel empty">
        <PanelHead title="PROPERTIES" onCollapse={onCollapse} />
        <p className="atlas-panel-emptymsg">Select a node to edit it, or add an Agent or Tool from the model tree.</p>
      </div>
    );
  }

  const d = node.data;
  const set = (patch) => onChange(node.id, patch);
  // id is the durable join key (manifest filename + telemetry tag that
  // conformance matches running spans back to). It is set once at creation and
  // locked thereafter — editable only while the object is a brand-new draft.
  const idLocked = !newObject;

  return (
    // autoCapitalize/Correct/spellCheck off so ids like "db-connect" aren't
    // mangled to "Db-connect" by the webview (WebKit inherits these to inputs).
    <div className="atlas-panel" autoCapitalize="off" autoCorrect="off" spellCheck={false}>
      <PanelHead
        title={({ orchestrator: 'ORCHESTRATOR', task: 'TASK', agent: 'AGENT', tool: 'MCP TOOL', job: 'JOB', system: 'EXTERNAL SYSTEM', router: 'ROUTER' }[node.type] || node.type).toUpperCase()}
        dirty={dirty}
        onCollapse={onCollapse}
      >
        <div className="atlas-panel-actions">
          <button className="atlas-revert" onClick={onRevert} disabled={!dirty} title={newObject ? 'Discard this new object' : 'Revert changes'}>
            {newObject ? 'Discard' : 'Revert'}
          </button>
          <button
            className="atlas-save"
            onClick={onSave}
            // Stay clickable when the only blocker is a duplicate id, so clicking
            // Save surfaces an explicit pop-up rather than a silent disabled button.
            disabled={!canSave && !idError}
            title={canSave ? 'Save changes' : (idError ? 'Duplicate id' : 'Fill required fields to save')}
          >
            Save
          </button>
        </div>
      </PanelHead>

      {node.type === 'task' ? (
        <>
          <Field label="id" hint={idLocked ? 'set at creation — the durable identity, not editable' : 'lowercase, hyphens — set once; cannot be changed after saving'}>
            <input className={idError ? 'atlas-input-error' : ''} value={d.id || ''} disabled={idLocked} readOnly={idLocked}
              onChange={(e) => set({ id: e.target.value.toLowerCase() })} placeholder="ingest-mssql-data" />
            {idError && <div className="atlas-field-error">{idError}</div>}
          </Field>
          <Field label="label" hint="human-readable name shown on the canvas">
            <input value={d.label || ''} onChange={(e) => set({ label: e.target.value })} placeholder="Ingest MS SQL Data" />
          </Field>
          <Field label="description">
            <textarea value={d.description || ''} onChange={(e) => set({ description: e.target.value })} rows={3} placeholder="What this high-level task accomplishes." />
          </Field>
        </>
      ) : (
        <>
          <Field label="id" hint={idLocked ? 'set at creation — the durable identity (manifest filename + telemetry tag), not editable' : 'lowercase, hyphens — set once; matches the manifest filename; cannot be changed after saving'}>
            <input className={idError ? 'atlas-input-error' : ''} value={d.id || ''} disabled={idLocked} readOnly={idLocked}
              onChange={(e) => set({ id: e.target.value.toLowerCase() })} placeholder="intake-classifier" />
            {idError && <div className="atlas-field-error">{idError}</div>}
          </Field>
          <Field label="owner">
            <input value={d.owner || ''} onChange={(e) => set({ owner: e.target.value })} placeholder="platform-team" />
          </Field>
          <Field label="version">
            <input value={d.version || '1.0.0'} onChange={(e) => set({ version: e.target.value })} placeholder="1.0.0" />
          </Field>
        </>
      )}

      {node.type === 'agent' && (
        <>
          <Field label="responsibility" hint="One responsibility. If you need 'and' to state it, you have two agents.">
            <textarea
              value={d.responsibility || ''}
              onChange={(e) => set({ responsibility: e.target.value })}
              rows={3}
              placeholder="Classify an inbound message into a single support category."
            />
          </Field>

          <fieldset className="atlas-group">
            <legend>model</legend>
            <Field label="provider">
              <input value={d.model?.provider || ''} onChange={(e) => set({ model: { ...d.model, provider: e.target.value } })} />
            </Field>
            <Field label="name">
              <input value={d.model?.name || ''} onChange={(e) => set({ model: { ...d.model, name: e.target.value } })} />
            </Field>
            <Field label="pinned" hint="exact, pinned version">
              <input value={d.model?.pinned || ''} onChange={(e) => set({ model: { ...d.model, pinned: e.target.value } })} />
            </Field>
          </fieldset>

          <Field label="refusal conditions" hint="When should this agent DECLINE rather than guess? One situation per line (at least one required). Each line is a condition that makes the agent emit its refusal value instead of an answer.">
            <textarea
              value={(d.refusalConditions || []).join('\n')}
              onChange={(e) => set({ refusalConditions: e.target.value.split('\n') })}
              rows={3}
              placeholder={'Required clinical inputs are missing or ungrounded\nThe note contains no codable diagnosis\nEvidence does not meet the documentation threshold for the queried condition'}
            />
          </Field>
          <Field label="refusal emits" hint="the output value that signals a refusal">
            <input value={d.refusalEmits || ''} onChange={(e) => set({ refusalEmits: e.target.value })} placeholder="refused" />
          </Field>

          <Field label="telemetry event name" hint="the decision this agent records">
            <input
              value={d.telemetry?.[0]?.name || ''}
              onChange={(e) => set({ telemetry: [{ name: e.target.value, attributes: d.telemetry?.[0]?.attributes || [] }] })}
              placeholder="agent.intake_classifier.classification"
            />
          </Field>
          <Field label="telemetry attributes" hint="comma-separated">
            <input
              value={(d.telemetry?.[0]?.attributes || []).join(', ')}
              onChange={(e) =>
                set({ telemetry: [{ name: d.telemetry?.[0]?.name || '', attributes: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) }] })
              }
              placeholder="category, urgency, confidence"
            />
          </Field>

          <fieldset className="atlas-group">
            <legend>governance — controls (NIST Govern)</legend>
            <Field label="prohibited tools" hint="NEGATIVE list: tool ids this agent must NEVER call (one per line). Conformance flags any runtime call to these. Distinct from the allowlist (the edges to tools).">
              <textarea
                value={(d.prohibitedTools || []).join('\n')}
                onChange={(e) => set({ prohibitedTools: e.target.value.split('\n').map((s) => s.trim()).filter(Boolean) })}
                rows={2}
                placeholder={'tool-external-send\ntool-bigquery-emitter'}
              />
            </Field>
            <Field label="grounding threshold" hint="0–1. Refuse rather than answer when grounding/confidence is below this (e.g. 0.95 for regulated domains). Leave blank if not specified.">
              <input type="number" min="0" max="1" step="0.01" value={d.groundingThreshold ?? ''} onChange={(e) => set({ groundingThreshold: e.target.value })} placeholder="0.95" />
            </Field>
            <Field label="escalation to" hint="id of the System/Job/queue this agent escalates to on refusal/low confidence (optional)">
              <input value={d.escalationTo || ''} onChange={(e) => set({ escalationTo: e.target.value.toLowerCase() })} placeholder="hitl-review-queue" />
            </Field>
          </fieldset>
        </>
      )}

      {node.type === 'tool' && (
        <>
          <Field label="description">
            <textarea value={d.description || ''} onChange={(e) => set({ description: e.target.value })} rows={2} placeholder="Full-text search over the support knowledge base." />
          </Field>
          <Field label="effect" hint="read = side-effect free; write = mutates; external = third party">
            <select value={d.effect || 'read'} onChange={(e) => set({ effect: e.target.value })}>
              <option value="read">read</option>
              <option value="write">write</option>
              <option value="external">external</option>
            </select>
          </Field>
          <Field label="auth scope">
            <input value={d.authScope || ''} onChange={(e) => set({ authScope: e.target.value })} placeholder="kb:read" />
          </Field>
          <Field label="rate limit (per minute)" hint="optional">
            <input type="number" value={d.ratePerMinute || ''} onChange={(e) => set({ ratePerMinute: e.target.value })} placeholder="60" />
          </Field>
        </>
      )}

      {node.type === 'job' && (
        <>
          <Field label="description">
            <textarea value={d.description || ''} onChange={(e) => set({ description: e.target.value })} rows={2} placeholder="Extract the full DDL for the source database." />
          </Field>
          <Field label="queue" hint="the task queue this job is dispatched to">
            <input value={d.queue || ''} onChange={(e) => set({ queue: e.target.value })} placeholder="migrations" />
          </Field>
          <Field label="trigger" hint="id of the tool/agent that enqueues it (optional)">
            <input value={d.trigger || ''} onChange={(e) => set({ trigger: e.target.value })} placeholder="extract-ddl" />
          </Field>
          <Field label="timeout (seconds)" hint="optional">
            <input type="number" value={d.timeoutSeconds || ''} onChange={(e) => set({ timeoutSeconds: e.target.value })} placeholder="3600" />
          </Field>
          <Field label="retries" hint="optional">
            <input type="number" value={d.retries ?? ''} onChange={(e) => set({ retries: e.target.value })} placeholder="3" />
          </Field>
        </>
      )}

      {node.type === 'system' && (
        <>
          <Field label="description">
            <textarea value={d.description || ''} onChange={(e) => set({ description: e.target.value })} rows={2} placeholder="Source MS SQL Server holding the legacy schema." />
          </Field>
          <Field label="kind" hint="the class of system — drives the data/knowledge layer view">
            <select value={d.systemKind || 'relational-db'} onChange={(e) => set({ systemKind: e.target.value })}>
              <option value="relational-db">relational-db</option>
              <option value="vector-store">vector-store</option>
              <option value="graph-db">graph-db</option>
              <option value="document-store">document-store</option>
              <option value="fhir">fhir</option>
              <option value="state-store">state-store</option>
              <option value="external-api">external-api</option>
              <option value="other">other</option>
            </select>
          </Field>
          <Field label="connection" hint="host/endpoint hint — not secrets">
            <input value={d.connection || ''} onChange={(e) => set({ connection: e.target.value })} placeholder="mssql://host:1433/legacy" />
          </Field>
          <Field label="auth scope" hint="optional">
            <input value={d.authScope || ''} onChange={(e) => set({ authScope: e.target.value })} placeholder="db:read" />
          </Field>
        </>
      )}

      {node.type === 'router' && (
        <>
          <Field label="description">
            <textarea value={d.description || ''} onChange={(e) => set({ description: e.target.value })} rows={2} placeholder="Selects a model by task complexity, quality, latency, and cost." />
          </Field>

          <fieldset className="atlas-group">
            <legend>candidate models</legend>
            {(d.candidates || []).map((c, i) => (
              <div key={i} className="atlas-router-cand">
                <input
                  value={c.provider || ''} placeholder="provider"
                  onChange={(e) => set({ candidates: d.candidates.map((x, j) => (j === i ? { ...x, provider: e.target.value } : x)) })}
                />
                <input
                  value={c.name || ''} placeholder="model name"
                  onChange={(e) => set({ candidates: d.candidates.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })}
                />
                <button className="atlas-row-del" title="Remove" onClick={() => set({ candidates: d.candidates.filter((_, j) => j !== i) })}>×</button>
              </div>
            ))}
            <button className="atlas-row-add" onClick={() => set({ candidates: [...(d.candidates || []), { provider: '', name: '', pinned: '' }] })}>+ candidate</button>
          </fieldset>

          <Field label="optimize for" hint="comma-separated priority: quality, cost, latency">
            <input
              value={(d.optimizeFor || []).join(', ')}
              onChange={(e) => set({ optimizeFor: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })}
              placeholder="quality, cost, latency"
            />
          </Field>

          <fieldset className="atlas-group">
            <legend>routing rules</legend>
            {(d.rules || []).map((r, i) => (
              <div key={i} className="atlas-router-rule">
                <input
                  value={r.when || ''} placeholder="when (condition)"
                  onChange={(e) => set({ rules: d.rules.map((x, j) => (j === i ? { ...x, when: e.target.value } : x)) })}
                />
                <input
                  value={r.select || ''} placeholder="→ model name"
                  onChange={(e) => set({ rules: d.rules.map((x, j) => (j === i ? { ...x, select: e.target.value } : x)) })}
                />
                <button className="atlas-row-del" title="Remove" onClick={() => set({ rules: d.rules.filter((_, j) => j !== i) })}>×</button>
              </div>
            ))}
            <button className="atlas-row-add" onClick={() => set({ rules: [...(d.rules || []), { when: '', select: '' }] })}>+ rule</button>
          </fieldset>

          <Field label="fallback model" hint="used when no rule matches">
            <input value={d.fallback || ''} onChange={(e) => set({ fallback: e.target.value })} placeholder="claude-opus-4-8" />
          </Field>
        </>
      )}

      {node.type === 'orchestrator' && (
        <>
          <Field label="description">
            <textarea value={d.description || ''} onChange={(e) => set({ description: e.target.value })} rows={2} placeholder="The control plane: decides which task/agent runs, in what order." />
          </Field>
          <Field label="control flow" hint="how the orchestrator expresses control flow">
            <select value={d.controlFlow || 'dag'} onChange={(e) => set({ controlFlow: e.target.value })}>
              <option value="dag">dag</option>
              <option value="state-machine">state-machine</option>
              <option value="sequential">sequential</option>
            </select>
          </Field>
          <Field label="state store" hint="id of a System (kind=state-store) for run/step state">
            <input value={d.stateStore || ''} onChange={(e) => set({ stateStore: e.target.value })} placeholder="run-state" />
          </Field>
          <fieldset className="atlas-group">
            <legend>compliance regimes (model-level)</legend>
            <p className="atlas-field-hint">Which standards this whole system claims to satisfy. System-governing regimes live here; per-object data classes (PHI/PII/PCI) go in each object's Governance.</p>
            <div className="atlas-checkset">
              {COMPLIANCE_REGIMES.map((r) => {
                const on = (d.complianceRegimes || []).includes(r);
                return (
                  <label key={r} className="atlas-check">
                    <input type="checkbox" checked={on}
                      onChange={() => set({ complianceRegimes: on ? d.complianceRegimes.filter((x) => x !== r) : [...(d.complianceRegimes || []), r] })} />
                    {r}
                  </label>
                );
              })}
            </div>
          </fieldset>
        </>
      )}

      {node.type !== 'task' && (
        <GovernanceFields
          g={d.governance || {}}
          setG={(g) => set({ governance: g })}
        />
      )}

      {errors && errors.length > 0 && (
        <div className="atlas-errors">
          <strong>Required to be valid:</strong>
          <ul>{errors.map((er, i) => <li key={i}>{er}</li>)}</ul>
        </div>
      )}
    </div>
  );
}
