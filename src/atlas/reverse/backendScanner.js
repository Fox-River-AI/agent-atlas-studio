// Scanner plugin #1 (DIAG-50): the backend code scanner.
//
// Wraps the Axiom /scan-codebase endpoint (the Python AST/pattern scanner, R1) as a
// framework plugin. It handles python + sql + spark today because the backend scan
// recurses for those patterns; as dedicated SQL/Spark plugins (DIAG-52/53) arrive,
// they can claim those languages and this narrows to python. The TS scanner
// (DIAG-51) is a SEPARATE studio-side plugin.
//
// This is the "plugin = a thing that emits the contract" pattern: it calls a remote
// endpoint, but the framework only sees a RecoveredDeclaration come back.
import { asRecovered } from './scannerFramework';

const scanUrlFrom = (endpointUrl) => endpointUrl.replace(/generate-model\/?$/, 'scan-codebase');

export const backendScanner = {
  id: 'backend-python',
  label: 'Backend code scanner (Python/host)',
  languages: ['python', 'sql', 'spark'],
  async scan(repo, ctx) {
    const { endpointUrl } = ctx;
    if (!endpointUrl) throw new Error('No scan endpoint configured. Set the model endpoint in Settings.');
    const body = repo.preset ? { preset: repo.preset } : { root: repo.path };
    const res = await fetch(scanUrlFrom(endpointUrl), {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Scan of "${repo.label}" returned ${res.status} ${res.statusText}.`);
    const json = await res.json();
    return asRecovered(json.declaration || {}, { notes: json.notes || [], meta: { root: json.scannedRoot } });
  },
};
