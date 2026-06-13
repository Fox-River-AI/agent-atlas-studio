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
  runtimes: ['http'], // runs against a backend HTTP endpoint — NOT studio-side. A
                      // studio-host repo (the Mac) is never routed here, even if its
                      // language matches; that's the DIAG-51 studio scanner's job.
  async scan(repo, ctx) {
    // Scan on the repo's HOST: prefer the host's base URL (so a multi-host estate
    // hits the right machine); fall back to the configured endpoint (single-host).
    const { endpointUrl, hostBaseUrl } = ctx;
    const scanUrl = hostBaseUrl ? hostBaseUrl.replace(/\/?$/, '/') + 'scan-codebase'
                  : (endpointUrl ? scanUrlFrom(endpointUrl) : '');
    if (!scanUrl) throw new Error(`No scan endpoint for "${repo.label}" — ${ctx.hostLabel || 'its host'} isn’t reachable. Set the model endpoint in Settings.`);
    const body = { root: repo.path };
    const res = await fetch(scanUrl, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Scan of "${repo.label}" returned ${res.status} ${res.statusText}.`);
    const json = await res.json();
    return asRecovered(json.declaration || {}, { notes: json.notes || [], meta: { root: json.scannedRoot } });
  },
};
