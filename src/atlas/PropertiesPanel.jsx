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

export default function PropertiesPanel({ node, onChange, errors }) {
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
    <div className="atlas-panel">
      <h3>{node.type === 'agent' ? 'Agent' : 'Tool'}</h3>

      <Field label="id" hint="lowercase, hyphens; matches the manifest filename">
        <input value={d.id || ''} onChange={(e) => set({ id: e.target.value })} placeholder="intake-classifier" />
      </Field>

      <Field label="owner">
        <input value={d.owner || ''} onChange={(e) => set({ owner: e.target.value })} placeholder="platform-team" />
      </Field>

      <Field label="version">
        <input value={d.version || '1.0.0'} onChange={(e) => set({ version: e.target.value })} placeholder="1.0.0" />
      </Field>

      {node.type === 'agent' && (
        <>
          <Field label="responsibility" hint="One responsibility. If you need 'and' to state it, you have two agents.">
            <textarea
              value={d.responsibility || ''}
              onChange={(e) => set({ responsibility: e.target.value })}
              rows={3}
              placeholder="Classify an inbound message into one support category and urgency."
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

      {errors && errors.length > 0 && (
        <div className="atlas-errors">
          <strong>Not yet valid:</strong>
          <ul>{errors.map((er, i) => <li key={i}>{er}</li>)}</ul>
        </div>
      )}
    </div>
  );
}
