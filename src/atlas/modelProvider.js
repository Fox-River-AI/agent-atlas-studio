// Model providers for the "System Requirements → first-cut model" front door
// (DIAG-37). Agent Atlas is open source and PROVIDER-AGNOSTIC: it ships no LLM
// SDK, no API key, and no vendor assumption. It defines a tiny ModelProvider
// contract and calls whatever endpoint the adopter configures.
//
// A ModelProvider is just:  generateModel(requirementsText, options) -> { model, notes }
//   - model: an Atlas-model shape { objects, edges, subjectAreas } (same shape as
//            seedModel.js); normalized + validated by the caller before rendering.
//   - notes: string[] of low-confidence inferences for the human to confirm.
//
// KEY SAFETY: the studio NEVER holds an API key. The configured endpoint runs in
// the ADOPTER's backend, which holds the key and calls the model. The web build
// is static client JS — a key here would be public. Only a desktop build talking
// to a LOCAL model (e.g. http://localhost:11434) may legitimately call directly.
// See docs/llm-provider-integration.md for the full contract + reference adapters.

// Adapter: POST requirements to a user-configured HTTP endpoint that honors the
// contract. Works identically in web and Tauri (both use global fetch).
export function httpEndpointProvider(endpointUrl) {
  return {
    async generateModel(requirementsText, options = {}) {
      if (!endpointUrl) {
        const e = new Error('No model endpoint configured. Set it in Settings → Requirements model endpoint.');
        e.code = 'no-endpoint';
        throw e;
      }
      let res;
      try {
        res = await fetch(endpointUrl, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ requirements: requirementsText, options }),
        });
      } catch (err) {
        // Network/CORS failures surface here as opaque TypeErrors — make it legible.
        const e = new Error(`Could not reach the endpoint (${endpointUrl}). Check the URL, that the server is running, and that it allows this origin (CORS). [${err?.message || err}]`);
        e.code = 'network';
        throw e;
      }
      if (!res.ok) {
        let body = '';
        try { body = (await res.text()).slice(0, 300); } catch { /* ignore */ }
        const e = new Error(`Endpoint returned ${res.status} ${res.statusText}. ${body}`);
        e.code = 'http';
        throw e;
      }
      let json;
      try {
        json = await res.json();
      } catch {
        const e = new Error('Endpoint did not return JSON. Expected { model, notes } per the provider contract.');
        e.code = 'parse';
        throw e;
      }
      // ASYNC JOB (202 + job_id): a full-doc generation runs minutes — longer than
      // a webview will hold one fetch open — so the backend returns a job id and we
      // POLL for the result with fast GETs. (A synchronous backend returns 200 with
      // {model,notes} directly; that path is handled below, unchanged.)
      if (json && json.job_id && (json.status === 'pending' || res.status === 202)) {
        return pollJob(endpointUrl, json.job_id);
      }
      // Synchronous: tolerate either { model, notes } or a bare model object.
      const model = json && json.model ? json.model : json;
      const notes = Array.isArray(json?.notes) ? json.notes : [];
      return { model, notes };
    },

    // Review the requirements doc for governance gaps BEFORE generating (Step 3).
    // Calls a sibling endpoint (<base>/review-requirements) that returns
    // { summary, recommendations[] }; async-job + poll like generateModel.
    async reviewRequirements(requirementsText) {
      if (!endpointUrl) {
        const e = new Error('No model endpoint configured. Set it in Settings → Requirements model endpoint.');
        e.code = 'no-endpoint';
        throw e;
      }
      // Derive the review URL from the generate URL: …/generate-model → …/review-requirements.
      const reviewUrl = endpointUrl.replace(/generate-model\/?$/, 'review-requirements');
      let res;
      try {
        res = await fetch(reviewUrl, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ requirements: requirementsText }),
        });
      } catch (err) {
        const e = new Error(`Could not reach the review endpoint (${reviewUrl}). [${err?.message || err}]`);
        e.code = 'network';
        throw e;
      }
      if (!res.ok) {
        let body = ''; try { body = (await res.text()).slice(0, 300); } catch { /* ignore */ }
        const e = new Error(`Review endpoint returned ${res.status} ${res.statusText}. ${body}`);
        e.code = 'http';
        throw e;
      }
      const json = await res.json();
      if (json && json.job_id && (json.status === 'pending' || res.status === 202)) {
        // Poll the SAME status URL space the job lives in (…/generate-model/<id>).
        const statusBase = endpointUrl.replace(/\/+$/, '');
        return pollReview(statusBase, json.job_id);
      }
      return json.review || { summary: '', recommendations: [] };
    },
  };
}

// Poll a review job (returns { summary, recommendations }).
async function pollReview(generateUrl, jobId) {
  const statusUrl = `${generateUrl.replace(/\/+$/, '')}/${jobId}`;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const deadline = Date.now() + 5 * 60 * 1000;
  while (Date.now() < deadline) {
    await sleep(3000);
    let res;
    try { res = await fetch(statusUrl, { method: 'GET' }); } catch { if (Date.now() >= deadline) break; else continue; }
    if (!res.ok) { const e = new Error(`Review status ${res.status}.`); e.code = 'http'; throw e; }
    let s; try { s = await res.json(); } catch { continue; }
    if (s.status === 'pending') continue;
    if (s.status === 'error') { const e = new Error(s.error || 'Review failed.'); e.code = 'generation'; throw e; }
    return s.review || { summary: '', recommendations: [] };
  }
  const e = new Error('Review timed out.'); e.code = 'timeout'; throw e;
}

// Poll GET <endpoint>/<job_id> until the job finishes. Each call is quick (well
// under any webview request cap), so total wait is unbounded by design — the work
// itself can take minutes. Gives up only on an explicit error or a hard ceiling.
async function pollJob(endpointUrl, jobId) {
  const statusUrl = `${endpointUrl.replace(/\/+$/, '')}/${jobId}`;
  const INTERVAL_MS = 3000;
  const MAX_WAIT_MS = 10 * 60 * 1000; // 10 min hard ceiling — far past a normal full-doc run
  const deadline = Date.now() + MAX_WAIT_MS;
  // small helper; avoids pulling in a timer lib
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  while (Date.now() < deadline) {
    await sleep(INTERVAL_MS);
    let res;
    try {
      res = await fetch(statusUrl, { method: 'GET' });
    } catch (err) {
      // A transient poll failure shouldn't kill the whole generation — keep trying
      // until the deadline, then surface it.
      if (Date.now() >= deadline) {
        const e = new Error(`Lost contact with the generation job (${statusUrl}). [${err?.message || err}]`);
        e.code = 'network';
        throw e;
      }
      continue;
    }
    if (!res.ok) {
      let body = '';
      try { body = (await res.text()).slice(0, 300); } catch { /* ignore */ }
      const e = new Error(`Job status returned ${res.status} ${res.statusText}. ${body}`);
      e.code = 'http';
      throw e;
    }
    let s;
    try { s = await res.json(); } catch { continue; }
    if (s.status === 'pending') continue;
    if (s.status === 'error') {
      const e = new Error(s.error || 'The generator reported an error.');
      e.code = 'generation';
      throw e;
    }
    // done
    const model = s.model || {};
    const notes = Array.isArray(s.notes) ? s.notes : [];
    return { model, notes };
  }
  const e = new Error('Generation timed out (no result after 10 minutes). The job may still be running on the server.');
  e.code = 'timeout';
  throw e;
}

// Adapter: a stub that ignores input and returns a fixed model. Lets the feature
// be exercised + tested with no backend (used by the round-trip acceptance test
// and as a safe dev default).
export function stubProvider(fixtureModel) {
  return {
    async generateModel() {
      return { model: fixtureModel, notes: ['Stub provider — no live model call was made; this is a fixed sample.'] };
    },
  };
}
