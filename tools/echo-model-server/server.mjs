// Minimal local echo "model provider" for DIAG-37 testing (option a).
// Honors the Agent Atlas provider contract (docs/llm-provider-integration.md §2):
//   POST {requirements, options?}  →  {model:{objects,edges,subjectAreas}, notes:[...]}
// It IGNORES the requirements and returns the Causeway seed model — proving the
// studio↔endpoint plumbing (CORS, request/response shape, normalize→apply→validate)
// with zero LLM and no API key. Swap this for a real backend (option b) later.
//
// Run:  node tools/echo-model-server/server.mjs        (listens on :8799)
// Then in Agent Atlas → Settings → Requirements model endpoint:
//   http://localhost:8799/generate-model
//
// No dependencies. CORS open (dev only).
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
// Load the seed model by extracting its exported arrays at runtime via a child
// import is awkward (it's ESM with ?raw deps), so we ship a prebuilt sample JSON
// next to the server. Generate it once with: npm run echo:sample  (see README).
const sample = JSON.parse(readFileSync(join(here, 'sample-model.json'), 'utf8'));

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'content-type',
};

createServer((req, res) => {
  if (req.method === 'OPTIONS') { res.writeHead(204, CORS); res.end(); return; }
  if (req.method === 'POST') {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      let reqLen = 0;
      try { reqLen = (JSON.parse(body || '{}').requirements || '').length; } catch { /* ignore */ }
      res.writeHead(200, { ...CORS, 'content-type': 'application/json' });
      res.end(JSON.stringify({
        model: sample,
        notes: [
          `Echo server: ignored ${reqLen} chars of requirements and returned the Causeway sample.`,
          'Replace this endpoint with a real backend (Claude API) to generate from the actual doc.',
        ],
      }));
    });
    return;
  }
  res.writeHead(200, { ...CORS, 'content-type': 'text/plain' });
  res.end('Agent Atlas echo model server — POST /generate-model {requirements} → {model,notes}\n');
}).listen(8799, () => console.log('echo-model-server on http://localhost:8799  → set as the Requirements model endpoint'));
