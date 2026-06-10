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
      // Tolerate either { model, notes } or a bare model object.
      const model = json && json.model ? json.model : json;
      const notes = Array.isArray(json?.notes) ? json.notes : [];
      return { model, notes };
    },
  };
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
