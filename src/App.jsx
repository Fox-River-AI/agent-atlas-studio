import UnifiedModeler from './atlas/UnifiedModeler';
import { ThemeProvider } from './atlas/ThemeContext';

// The unified collapsible graph IS the app: one model of tasks/agents/tools/
// jobs/routers/systems, expand-collapse hierarchy, Subject-Area views, live
// validation, registry export. No auth, no Amplify — runs as a Vite web build
// and inside Tauri identically.
export default function App() {
  return (
    <ThemeProvider>
      <UnifiedModeler />
    </ThemeProvider>
  );
}
