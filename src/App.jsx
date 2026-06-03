import AtlasModeler from './atlas/AtlasModeler';

// No auth, no Amplify, no router gymnastics — just the modeler. The clean
// foundation: this runs identically as a Vite web build and inside Tauri.
export default function App() {
  return <AtlasModeler />;
}
