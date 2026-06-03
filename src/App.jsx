import AtlasModeler from './atlas/AtlasModeler';
import UnifiedModeler from './atlas/UnifiedModeler';
import { ThemeProvider } from './atlas/ThemeContext';

// TEMP-VERIFY (Step 1): flip to true to preview the unified collapsible graph
// in isolation. Revert to AtlasModeler before merging the migration.
const UNIFIED_PREVIEW = true;

// No auth, no Amplify, no router gymnastics — just the modeler. The clean
// foundation: this runs identically as a Vite web build and inside Tauri.
export default function App() {
  return (
    <ThemeProvider>
      {UNIFIED_PREVIEW ? <UnifiedModeler /> : <AtlasModeler />}
    </ThemeProvider>
  );
}
