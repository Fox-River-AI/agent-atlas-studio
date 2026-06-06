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

export default function PropertiesPanel({ node, onChange, errors, dirty, canSave, onSave, onRevert, newObject }) {
  if (!node) {
    return (
      <div className="atlas-panel empty">
        <p>Select a node to edit it, or add an Agent or Tool from the toolbar.</p>
      </div>
    );
  }

  const d = node.data;
  const set = (patch) => onChange(node.id, patch);

  return (
    // autoCapitalize/Correct/spellCheck off so ids like "db-connect" aren't
    // mangled to "Db-connect" by the webview (WebKit inherits these to inputs).
    <div className="atlas-panel" autoCapitalize="off" autoCorrect="off" spellCheck={false}>
      <div className="atlas-panel-bar">
        <h3>{{ orchestrator: 'Orchestrator', task: 'Task', agent: 'Agent', tool: 'MCP Tool', job: 'Job', system: 'External System', router: 'Router' }[node.type] || node.type}{dirty && <span className="atlas-dirty-dot" title="Unsaved changes"> ●</span>}</h3>
        <div className="atlas-panel-actions">
          <button className="atlas-revert" onClick={onRevert} disabled={!dirty} title={newObject ? 'Discard this new object' : 'Revert changes'}>
            {newObject ? 'Discard' : 'Revert'}
          </button>
          <button className="atlas-save" onClick={onSave} disabled={!canSave} title={canSave ? 'Save changes' : 'Fill required fields to save'}>
            Save
          </button>
        </div>
      </div>

      {node.type === 'task' ? (
        <>
          <Field label="id" hint="lowercase, hyphens">
            <input value={d.id || ''} onChange={(e) => set({ id: e.target.value.toLowerCase() })} placeholder="ingest-mssql-data" />
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
          <Field label="id" hint="lowercase, hyphens; matches the manifest filename">
            <input value={d.id || ''} onChange={(e) => set({ id: e.target.value.toLowerCase() })} placeholder="intake-classifier" />
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

          <Field label="refusal conditions" hint="one per line; refusal is a first-class output">
            <textarea
              value={(d.refusalConditions || []).join('\n')}
              onChange={(e) => set({ refusalConditions: e.target.value.split('\n') })}
              rows={3}
              placeholder={'The message is empty.\nThe request is outside support triage.'}
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
        </>
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
