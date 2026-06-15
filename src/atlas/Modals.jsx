// Settings + About modals (Noesis-style). Settings controls theme + font size,
// both of which flow through ThemeContext → CSS variables → the whole app.
import React from 'react';
import { useTheme, THEMES, FONT_SCALE } from './ThemeContext';

function Backdrop({ onClose, children }) {
  return (
    <div className="atlas-modal-backdrop" onClick={onClose}>
      <div className="atlas-modal" onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}

export function SettingsModal({ onClose }) {
  const { themeId, setThemeId, fontScale, setFontScale, endpointUrl, setEndpointUrl } = useTheme();
  const pct = Math.round(fontScale * 100);
  return (
    <Backdrop onClose={onClose}>
      <h2>Settings</h2>

      <div className="atlas-modal-row">
        <label>Theme</label>
        <div className="atlas-seg">
          {Object.entries(THEMES).map(([id, t]) => (
            <button
              key={id}
              className={themeId === id ? 'active' : ''}
              onClick={() => setThemeId(id)}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="atlas-modal-row">
        <label>Interface font size — scales all panels, menus, and text proportionally (canvas nodes use zoom)</label>
        <div className="atlas-slider-row">
          <input
            type="range"
            min={FONT_SCALE.min}
            max={FONT_SCALE.max}
            step={FONT_SCALE.step}
            value={fontScale}
            onChange={(e) => setFontScale(parseFloat(e.target.value))}
          />
          <span className="atlas-slider-pct">{pct}%</span>
          <button className="atlas-slider-reset" onClick={() => setFontScale(FONT_SCALE.default)}>Reset</button>
        </div>
        <div className="atlas-slider-sample">The quick brown fox — sample text at {pct}%.</div>
      </div>

      <div className="atlas-modal-row">
        <label>Requirements model endpoint — your backend URL that turns a requirements doc into a first-cut model</label>
        <input
          type="url"
          value={endpointUrl}
          onChange={(e) => setEndpointUrl(e.target.value.trim())}
          placeholder="https://your-backend/generate-model"
          autoCapitalize="off" autoCorrect="off" spellCheck={false}
        />
        <div className="atlas-slider-sample">
          The call runs in <em>your</em> backend — never put an API key here; this is a URL only.
        </div>
      </div>

      <div className="atlas-modal-actions">
        <button onClick={onClose}>Done</button>
      </div>
    </Backdrop>
  );
}

export function AboutModal({ onClose }) {
  return (
    <Backdrop onClose={onClose}>
      <div className="atlas-about-head">
        <span className="atlas-mark atlas-about-mark" aria-hidden="true">A</span>
        <h2>Agent Atlas Studio</h2>
      </div>
      <p>
        A visual modeler for agentic AI systems. Design your agents, tools, and
        the registry that governs them; validate it live against the open{' '}
        <a href="https://github.com/Fox-River-AI/agent-atlas" target="_blank" rel="noreferrer">
          agent-atlas
        </a>{' '}
        schema; export a build-ready registry.
      </p>
      <p>An Erwin-style loop for agent fleets: model it, then see the one that's actually running.</p>
      <p style={{ marginTop: 16 }}>Apache-2.0 · © Fox River AI</p>
      <div className="atlas-modal-actions">
        <button onClick={onClose}>Close</button>
      </div>
    </Backdrop>
  );
}
