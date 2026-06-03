// Theme + font system for the whole app (panels AND canvas). Works by writing
// CSS custom properties onto :root; every color and the base font size in
// atlas.css reads those vars, so switching theme/font updates everything at
// once. Choice persists in localStorage. Mirrors Noesis: 3 themes, 3 font sizes.
import { createContext, useContext, useEffect, useState } from 'react';

export const THEMES = {
  dark: {
    label: 'Dark',
    vars: {
      '--bg': '#121212',
      '--bg-panel': '#161616',
      '--bg-elevated': '#1e1e1e',
      '--bg-input': '#0e0e0e',
      '--border': '#333333',
      '--border-soft': '#2a2a2a',
      '--text': '#f5f5f5',
      '--text-muted': '#999999',
      '--text-dim': '#666666',
      '--accent': '#ff9900',
      '--accent-fg': '#121212',
      '--ok': '#6ee7b7',
      '--bad': '#f0997b',
      '--agent': '#afa9ec',
      '--agent-bg': '#3c3489',
      '--tool': '#5dcaa5',
      '--tool-bg': '#085041',
    },
  },
  'high-contrast': {
    label: 'High Contrast',
    vars: {
      '--bg': '#000000',
      '--bg-panel': '#0a0a0a',
      '--bg-elevated': '#1a1a1a',
      '--bg-input': '#000000',
      '--border': '#666666',
      '--border-soft': '#444444',
      '--text': '#ffffff',
      '--text-muted': '#cccccc',
      '--text-dim': '#999999',
      '--accent': '#ffb340',
      '--accent-fg': '#000000',
      '--ok': '#7dffc0',
      '--bad': '#ff9a7a',
      '--agent': '#c4bdff',
      '--agent-bg': '#4a3fb0',
      '--tool': '#6affc0',
      '--tool-bg': '#0a6b54',
    },
  },
  light: {
    label: 'Light',
    vars: {
      '--bg': '#ffffff',
      '--bg-panel': '#f6f6f4',
      '--bg-elevated': '#ececec',
      '--bg-input': '#ffffff',
      '--border': '#d4d4d4',
      '--border-soft': '#e5e5e5',
      '--text': '#1a1a1a',
      '--text-muted': '#666666',
      '--text-dim': '#999999',
      '--accent': '#d97700',
      '--accent-fg': '#ffffff',
      '--ok': '#0a8f5b',
      '--bad': '#c2410c',
      '--agent': '#5b4fc4',
      '--agent-bg': '#e4e0fb',
      '--tool': '#0a8f5b',
      '--tool-bg': '#d6f5e9',
    },
  },
};

export const FONT_SIZES = {
  small: { label: 'Small', base: 13 },
  medium: { label: 'Medium', base: 15 },
  large: { label: 'Large', base: 17 },
};

const ThemeContext = createContext(null);

export function useTheme() {
  return useContext(ThemeContext);
}

export function ThemeProvider({ children }) {
  const [themeId, setThemeId] = useState(() => localStorage.getItem('atlas-theme') || 'dark');
  const [fontSize, setFontSize] = useState(() => localStorage.getItem('atlas-font') || 'medium');

  useEffect(() => {
    const theme = THEMES[themeId] || THEMES.dark;
    const root = document.documentElement;
    for (const [k, v] of Object.entries(theme.vars)) root.style.setProperty(k, v);
    root.style.setProperty('--font-base', `${(FONT_SIZES[fontSize] || FONT_SIZES.medium).base}px`);
    localStorage.setItem('atlas-theme', themeId);
    localStorage.setItem('atlas-font', fontSize);
  }, [themeId, fontSize]);

  return (
    <ThemeContext.Provider value={{ themeId, setThemeId, fontSize, setFontSize }}>
      {children}
    </ThemeContext.Provider>
  );
}
