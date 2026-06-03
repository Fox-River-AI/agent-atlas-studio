// Settings + About modals (Noesis-style). Settings controls theme + font size,
// both of which flow through ThemeContext → CSS variables → the whole app.
import React from 'react';
import { useTheme, THEMES, FONT_SIZES } from './ThemeContext';

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
  const { themeId, setThemeId, fontSize, setFontSize } = useTheme();
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
        <label>Font size (applies to panels and canvas)</label>
        <div className="atlas-seg">
          {Object.entries(FONT_SIZES).map(([id, f]) => (
            <button
              key={id}
              className={fontSize === id ? 'active' : ''}
              onClick={() => setFontSize(id)}
            >
              {f.label}
            </button>
          ))}
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
      <h2>Agent Atlas Studio</h2>
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
